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
from welllog_engine.adapters.formats.las.errors import LasImportError
from welllog_engine.adapters.formats.las.reader import _header_value, _validate_source
from welllog_engine.adapters.formats.las.table import normalize_las_table
from welllog_engine.adapters.storage.cxlog import sha256_file
from welllog_engine.contracts.documents import SourceFormat, StorageKind
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
    index_candidate_id: str | None = None,
) -> ConversionResult:
    source = source_path.expanduser().resolve()
    _validate_source(source)
    try:
        las = lasio.read(source, autodetect_encoding=True)
    except Exception as error:
        raise LasImportError(f"Could not read LAS file: {error}") from error

    table = normalize_las_table(las, index_candidate_id)
    if table.row_count == 0 or not table.curves:
        raise LasImportError("The LAS file does not contain readable curve data.")

    document_id = uuid4().hex
    dataset_id = f"dataset-las-{document_id[:12]}"
    index_values = table.index_values
    finite_index = index_values[np.isfinite(index_values)]
    if not finite_index.size:
        raise LasImportError("The LAS file does not contain a valid index curve.")

    columns: dict[str, pa.Array] = {"index": pa.array(index_values, type=pa.float64())}
    source_index_columns: dict[str, str] = {}
    channels: list[ImportedChannel] = []
    used_columns: set[str] = {"index"}
    for mnemonic, values in table.source_index_columns.items():
        column_name = _unique_column_name(f"source_{mnemonic}", 0, used_columns)
        columns[column_name] = pa.array(values, from_pandas=True)
        source_index_columns[mnemonic] = column_name
    for channel_position, curve_data in enumerate(table.curves):
        curve = curve_data.curve
        position = curve_data.source_position
        mnemonic = str(curve.mnemonic or f"CURVE_{position}").strip()
        column_name = _unique_column_name(mnemonic, position, used_columns)
        values = curve_data.values
        columns[column_name] = pa.array(values, from_pandas=True)
        minimum, maximum, null_count = numeric_statistics(values)
        preview_samples = (
            build_preview(index_values, curve_data.numeric_values, max_preview_points)
            if curve_data.numeric_values is not None
            else []
        )
        channel_id = f"curve-{position}-{slug(mnemonic)}"
        channels.append(
            ImportedChannel(
                id=channel_id,
                position=channel_position,
                mnemonic=mnemonic,
                unit=str(curve.unit or "").strip(),
                description=str(curve.descr or "Imported LAS curve").strip(),
                minimum=minimum,
                maximum=maximum,
                sample_count=table.row_count,
                null_count=(null_count if curve_data.numeric_values is not None else 0),
                sample_shape=[],
                storage_kind=StorageKind.PARQUET,
                asset_path=f"data/scalar/{dataset_id}.parquet",
                preview_samples=preview_samples,
                native_metadata={
                    "parquet_column": column_name,
                    "data_type": "numeric" if curve_data.numeric_values is not None else "text",
                },
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
    dataset = ImportedDataset(
        id=dataset_id,
        name=f"LAS {_header_value(las.version, 'VERS', 'unknown')}",
        kind="log",
        well_name=well_name,
        wellbore_name="Imported wellbore",
        row_count=table.row_count,
        index_mnemonic=table.index_mnemonic,
        index_unit=table.index_unit,
        index_kind=table.index_kind,
        index_minimum=float(np.min(finite_index)),
        index_maximum=float(np.max(finite_index)),
        channels=channels,
        native_metadata={
            "null_value": _header_value(las.well, "NULL", ""),
            "source_index_columns": source_index_columns,
            "time_index_reference": table.time_index_reference.value,
        },
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
        warnings=list(table.warnings),
    )


def _unique_column_name(mnemonic: str, position: int, used: set[str]) -> str:
    candidate = slug(mnemonic).replace("-", "_")
    if candidate in used:
        candidate = f"{candidate}_{position}"
    used.add(candidate)
    return candidate


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
