from pathlib import Path
from uuid import uuid4

import lasio  # type: ignore[import-untyped]
import numpy as np
import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.parquet as pq  # type: ignore[import-untyped]

from welllog_engine.adapters.formats.common import (
    build_preview,
    numeric_statistics,
    slug,
    write_json,
)
from welllog_engine.adapters.formats.las.reader import (
    LasImportError,
    _header_value,
    _validate_source,
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


def convert_las(
    source_path: Path,
    staging_path: Path,
    max_preview_points: int,
) -> ConversionResult:
    source = source_path.expanduser().resolve()
    _validate_source(source)
    try:
        las = lasio.read(source, autodetect_encoding=True)
    except Exception as error:
        raise LasImportError(f"Could not read LAS file: {error}") from error

    data = np.asarray(las.data, dtype=float)
    if data.ndim != 2 or data.shape[0] == 0 or data.shape[1] < 2:
        raise LasImportError("The LAS file does not contain readable curve data.")

    document_id = uuid4().hex
    dataset_id = f"dataset-las-{document_id[:12]}"
    index_curve = las.curves[0]
    index_values = data[:, 0]
    finite_index = index_values[np.isfinite(index_values)]
    if not finite_index.size:
        raise LasImportError("The LAS file does not contain a valid index curve.")

    columns: dict[str, pa.Array] = {"index": pa.array(index_values, type=pa.float64())}
    channels: list[ImportedChannel] = []
    used_columns: set[str] = {"index"}
    for position, curve in enumerate(las.curves[1:], start=1):
        mnemonic = str(curve.mnemonic or f"CURVE_{position}").strip()
        column_name = slug(mnemonic).replace("-", "_")
        if column_name in used_columns:
            column_name = f"{column_name}_{position}"
        used_columns.add(column_name)
        values = data[:, position]
        columns[column_name] = pa.array(values, type=pa.float64(), from_pandas=True)
        minimum, maximum, null_count = numeric_statistics(values)
        channel_id = f"curve-{position}-{slug(mnemonic)}"
        channels.append(
            ImportedChannel(
                id=channel_id,
                position=position - 1,
                mnemonic=mnemonic,
                unit=str(curve.unit or "").strip(),
                description=str(curve.descr or "Imported LAS curve").strip(),
                minimum=minimum,
                maximum=maximum,
                sample_count=int(data.shape[0]),
                null_count=null_count,
                sample_shape=[],
                storage_kind=StorageKind.PARQUET,
                asset_path=f"data/scalar/{dataset_id}.parquet",
                preview_samples=build_preview(index_values, values, max_preview_points),
                native_metadata={"parquet_column": column_name},
            )
        )

    scalar_path = staging_path / "data" / "scalar" / f"{dataset_id}.parquet"
    scalar_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        pa.table(columns),
        scalar_path,
        compression="zstd",
        row_group_size=65_536,
    )

    metadata_path = staging_path / "metadata" / "las" / "header.json"
    write_json(
        metadata_path,
        {
            "version": _section_items(las.version),
            "well": _section_items(las.well),
            "curves": _section_items(las.curves),
            "parameters": _section_items(las.params),
            "other": str(las.other or ""),
        },
    )
    well_name = _header_value(las.well, "WELL", source.stem)
    field_name = _header_value(las.well, "FLD", "Unknown field")
    index_mnemonic = str(index_curve.mnemonic or "INDEX").strip()
    index_unit = str(index_curve.unit or "").strip()
    index_kind = (
        IndexKind.MEASURED_DEPTH
        if index_mnemonic.casefold() in {"dept", "depth", "md"}
        else IndexKind.OTHER
    )
    dataset = ImportedDataset(
        id=dataset_id,
        name=f"LAS {_header_value(las.version, 'VERS', 'unknown')}",
        kind="log",
        well_name=well_name,
        wellbore_name="Imported wellbore",
        row_count=int(data.shape[0]),
        index_mnemonic=index_mnemonic,
        index_unit=index_unit,
        index_kind=index_kind,
        index_minimum=float(np.min(finite_index)),
        index_maximum=float(np.max(finite_index)),
        channels=channels,
        native_metadata={"null_value": _header_value(las.well, "NULL", "")},
    )
    return ConversionResult(
        document_id=document_id,
        source=ImportedSource(
            filename=source.name,
            source_format=SourceFormat.LAS,
            source_version=_header_value(las.version, "VERS", "unknown"),
            file_size_bytes=source.stat().st_size,
            sha256=sha256_file(source),
            field_name=field_name,
        ),
        datasets=[dataset],
        objects=[
            PreservedObject(
                id=f"object-las-{document_id[:12]}",
                object_type="LAS_HEADER",
                native_id=source.name,
                name=well_name,
                parent_native_id=None,
                metadata_path="metadata/las/header.json",
            )
        ],
        relationships=[],
        warnings=[],
    )


def _section_items(section: object) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for item in section:  # type: ignore[attr-defined]
        result.append(
            {
                "mnemonic": str(getattr(item, "mnemonic", "")),
                "unit": str(getattr(item, "unit", "")),
                "value": getattr(item, "value", None),
                "description": str(getattr(item, "descr", "")),
            }
        )
    return result
