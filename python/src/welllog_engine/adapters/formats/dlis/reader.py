from collections.abc import Iterable
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np
import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.parquet as pq  # type: ignore[import-untyped]
import zarr  # type: ignore[import-untyped]
from dlisio import dlis  # type: ignore[import-untyped]
from numpy.typing import NDArray

from welllog_engine.adapters.formats.common import (
    build_preview,
    numeric_statistics,
    slug,
    write_json,
)
from welllog_engine.adapters.storage.cxlog import sha256_file
from welllog_engine.contracts.documents import IndexKind, SourceFormat, StorageKind
from welllog_engine.domain.documents import (
    ConversionResult,
    ImportedChannel,
    ImportedDataset,
    ImportedSource,
    PreservedObject,
)


class DlisImportError(ValueError):
    pass


def convert_dlis(
    source_path: Path,
    staging_path: Path,
    max_preview_points: int,
) -> ConversionResult:
    source = source_path.expanduser().resolve()
    if source.suffix.casefold() != ".dlis" or not source.is_file():
        raise DlisImportError("The selected DLIS file does not exist or is not accessible.")

    document_id = uuid4().hex
    datasets: list[ImportedDataset] = []
    objects: list[PreservedObject] = []
    relationships: list[tuple[str, str, str]] = []
    warnings: list[str] = []
    well_name = source.stem
    field_name = "Unknown field"
    try:
        with dlis.load(str(source)) as physical_file:
            for logical_index, logical_file in enumerate(physical_file):
                origin = next(iter(getattr(logical_file, "origins", [])), None)
                if origin is not None:
                    well_name = _first_text(
                        getattr(origin, "well_name", None),
                        getattr(origin, "well_id", None),
                        well_name,
                    )
                    field_name = _first_text(
                        getattr(origin, "field_name", None),
                        field_name,
                    )
                _preserve_logical_file_metadata(
                    logical_file,
                    logical_index,
                    staging_path,
                    document_id,
                    objects,
                )
                frames = list(getattr(logical_file, "frames", []))
                for frame_index, frame in enumerate(frames):
                    try:
                        dataset, frame_relationships = _convert_frame(
                            frame=frame,
                            logical_index=logical_index,
                            frame_index=frame_index,
                            staging_path=staging_path,
                            document_id=document_id,
                            well_name=well_name,
                            max_preview_points=max_preview_points,
                            warnings=warnings,
                        )
                    except Exception as error:
                        warnings.append(
                            f"DLIS frame {_object_name(frame, str(frame_index))} could not be "
                            f"decoded: {error}"
                        )
                        continue
                    datasets.append(dataset)
                    relationships.extend(frame_relationships)
    except Exception as error:
        raise DlisImportError(f"Could not read DLIS file: {error}") from error

    if not datasets:
        raise DlisImportError("The DLIS file does not contain any readable frames.")
    return ConversionResult(
        document_id=document_id,
        source=ImportedSource(
            filename=source.name,
            source_format=SourceFormat.DLIS,
            source_version="RP66V1",
            file_size_bytes=source.stat().st_size,
            sha256=sha256_file(source),
            field_name=field_name,
        ),
        datasets=datasets,
        objects=objects,
        relationships=relationships,
        warnings=warnings,
    )


def _convert_frame(
    *,
    frame: object,
    logical_index: int,
    frame_index: int,
    staging_path: Path,
    document_id: str,
    well_name: str,
    max_preview_points: int,
    warnings: list[str],
) -> tuple[ImportedDataset, list[tuple[str, str, str]]]:
    frame_name = _object_name(frame, f"frame-{frame_index + 1}")
    dataset_id = (
        f"dataset-dlis-{logical_index + 1}-{frame_index + 1}-{slug(frame_name)}"
    )
    curves = frame.curves(strict=False)  # type: ignore[attr-defined]
    row_count = int(len(curves))
    field_names = list(curves.dtype.names or ())
    frame_channels = list(getattr(frame, "channels", []))
    if not frame_channels or not field_names:
        raise DlisImportError("The frame has no readable channel data.")
    channel_fields = field_names[-len(frame_channels) :]
    if len(channel_fields) != len(frame_channels):
        raise DlisImportError("The frame channel metadata does not match its data fields.")

    index_channel = frame_channels[0]
    index_field = channel_fields[0]
    raw_index = np.asarray(curves[index_field])
    numeric_index = _numeric_index(raw_index)
    finite_index = numeric_index[np.isfinite(numeric_index)]
    index_minimum = float(np.min(finite_index)) if finite_index.size else None
    index_maximum = float(np.max(finite_index)) if finite_index.size else None
    index_type = str(getattr(frame, "index_type", "") or "").casefold()
    index_kind = (
        IndexKind.MEASURED_DEPTH
        if "depth" in index_type
        or _object_name(index_channel, "").casefold() in {"dept", "depth", "md"}
        else IndexKind.TIME
        if "time" in index_type
        else IndexKind.SAMPLE
    )

    scalar_columns: dict[str, pa.Array] = {"index": _arrow_array(raw_index)}
    used_columns = {"index"}
    imported_channels: list[ImportedChannel] = []
    frame_object_id = f"dlis-frame-{logical_index + 1}-{frame_index + 1}"
    relationships: list[tuple[str, str, str]] = []
    array_group_path = staging_path / "data" / "arrays" / f"{dataset_id}.zarr"
    array_group: object | None = None

    for position, (channel, field_name) in enumerate(
        zip(frame_channels[1:], channel_fields[1:], strict=True)
    ):
        mnemonic = _object_name(channel, field_name)
        values = np.asarray(curves[field_name])
        sample_shape = list(values.shape[1:])
        channel_id = f"curve-{dataset_id}-{position + 1}-{slug(mnemonic)}"
        minimum, maximum, null_count = numeric_statistics(values)
        unit = str(getattr(channel, "units", "") or "")
        description = str(getattr(channel, "long_name", "") or "Imported DLIS channel")
        native_metadata: dict[str, object] = {
            "fingerprint": str(getattr(channel, "fingerprint", "")),
            "dimension": list(getattr(channel, "dimension", []) or []),
            "properties": list(getattr(channel, "properties", []) or []),
            "source": str(getattr(channel, "source", "") or ""),
        }
        if not sample_shape:
            column_name = slug(mnemonic).replace("-", "_")
            if column_name in used_columns:
                column_name = f"{column_name}_{position + 1}"
            used_columns.add(column_name)
            scalar_columns[column_name] = _arrow_array(values)
            native_metadata["parquet_column"] = column_name
            storage_kind = StorageKind.PARQUET
            asset_path = f"data/scalar/{dataset_id}.parquet"
            preview = build_preview(numeric_index, values, max_preview_points)
        else:
            if array_group is None:
                array_group_path.parent.mkdir(parents=True, exist_ok=True)
                array_group = zarr.open_group(str(array_group_path), mode="w")
                array_group.create_array(  # type: ignore[attr-defined]
                    "index",
                    data=raw_index.reshape(-1),
                    chunks=(min(max(row_count, 1), 2048),),
                    overwrite=True,
                )
            try:
                chunks = (min(max(row_count, 1), 256), *values.shape[1:])
                array_group.create_array(  # type: ignore[attr-defined]
                    channel_id,
                    data=values,
                    chunks=chunks,
                    overwrite=True,
                )
                storage_kind = StorageKind.ZARR
                asset_path = f"data/arrays/{dataset_id}.zarr/{channel_id}"
            except Exception as error:
                warnings.append(f"DLIS array channel {mnemonic} could not be stored: {error}")
                storage_kind = StorageKind.METADATA_ONLY
                asset_path = None
            preview = []
            if values.ndim > 1:
                try:
                    finite_rows = np.isfinite(values.astype(float)).reshape(row_count, -1)
                    null_count = int(np.count_nonzero(~finite_rows.all(axis=1)))
                except (TypeError, ValueError):
                    null_count = 0
        imported_channels.append(
            ImportedChannel(
                id=channel_id,
                position=position,
                mnemonic=mnemonic,
                unit=unit,
                description=description,
                minimum=minimum,
                maximum=maximum,
                sample_count=row_count,
                null_count=null_count,
                sample_shape=sample_shape,
                storage_kind=storage_kind,
                asset_path=asset_path,
                preview_samples=preview,
                native_metadata=native_metadata,
            )
        )
        relationships.append(
            (
                frame_object_id,
                str(getattr(channel, "fingerprint", mnemonic)),
                "contains",
            )
        )

    scalar_path = staging_path / "data" / "scalar" / f"{dataset_id}.parquet"
    scalar_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        pa.table(scalar_columns),
        scalar_path,
        compression="zstd",
        row_group_size=65_536,
    )
    return (
        ImportedDataset(
            id=dataset_id,
            name=frame_name,
            kind="log",
            well_name=well_name,
            wellbore_name="Imported wellbore",
            row_count=row_count,
            index_mnemonic=_object_name(index_channel, index_field),
            index_unit=str(getattr(index_channel, "units", "") or ""),
            index_kind=index_kind,
            index_minimum=index_minimum,
            index_maximum=index_maximum,
            channels=imported_channels,
            native_metadata={
                "logical_file": logical_index + 1,
                "frame_fingerprint": str(getattr(frame, "fingerprint", frame_name)),
                "direction": str(getattr(frame, "direction", "") or ""),
                "spacing": str(getattr(frame, "spacing", "") or ""),
                "time_index_reference": (
                    "elapsed" if index_kind == IndexKind.TIME else "none"
                ),
            },
        ),
        relationships,
    )


def _preserve_logical_file_metadata(
    logical_file: object,
    logical_index: int,
    staging_path: Path,
    document_id: str,
    objects: list[PreservedObject],
) -> None:
    collections = (
        "origins",
        "axes",
        "channels",
        "frames",
        "tools",
        "parameters",
        "computations",
        "calibrations",
        "equipments",
        "processes",
        "wellrefs",
        "groups",
        "messages",
        "comments",
        "longnames",
        "splices",
        "paths",
    )
    seen: set[str] = set()
    for collection_name in collections:
        collection = _iter_collection(getattr(logical_file, collection_name, []))
        for position, item in enumerate(collection):
            fingerprint = str(
                getattr(item, "fingerprint", "")
                or f"{collection_name}-{position + 1}"
            )
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            object_id = f"dlis-object-{logical_index + 1}-{len(objects) + 1}-{document_id[:8]}"
            relative_path = (
                Path("metadata")
                / "dlis"
                / f"logical-{logical_index + 1}"
                / f"{slug(collection_name)}-{position + 1}.json"
            )
            write_json(
                staging_path / relative_path,
                {
                    "type": str(getattr(item, "type", collection_name)),
                    "name": _object_name(item, fingerprint),
                    "fingerprint": fingerprint,
                    "origin": str(getattr(item, "origin", "") or ""),
                    "copy": str(getattr(item, "copynumber", "") or ""),
                    "attributes": getattr(item, "attic", {}),
                },
            )
            objects.append(
                PreservedObject(
                    id=object_id,
                    object_type=str(getattr(item, "type", collection_name)).upper(),
                    native_id=fingerprint,
                    name=_object_name(item, fingerprint),
                    parent_native_id=f"logical-file-{logical_index + 1}",
                    metadata_path=relative_path.as_posix(),
                )
            )


def _arrow_array(values: NDArray[Any]) -> pa.Array:
    flattened = np.asarray(values).reshape(-1)
    try:
        return pa.array(flattened, from_pandas=True)
    except (pa.ArrowInvalid, pa.ArrowNotImplementedError, TypeError):
        return pa.array([str(value) if value is not None else None for value in flattened])


def _numeric_index(values: NDArray[Any]) -> NDArray[np.float64]:
    try:
        return np.asarray(values, dtype=float).reshape(-1)
    except (TypeError, ValueError):
        return np.arange(len(values), dtype=float)


def _object_name(value: object, fallback: str) -> str:
    name = getattr(value, "name", None)
    text = str(name or fallback).strip()
    return text or fallback


def _first_text(*values: object) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _iter_collection(value: object) -> Iterable[object]:
    if isinstance(value, dict):
        return value.values()
    if isinstance(value, Iterable) and not isinstance(value, (str, bytes)):
        return value
    return ()
