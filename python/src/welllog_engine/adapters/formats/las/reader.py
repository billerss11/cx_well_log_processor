import math
import re
from pathlib import Path
from typing import Any

import lasio  # type: ignore[import-untyped]
import numpy as np

from welllog_engine.contracts.imports import (
    LasCurveSummary,
    LasImportResponse,
    LasPreviewSample,
)

MAX_STANDARD_LAS_BYTES = 64 * 1024 * 1024


class LasImportError(ValueError):
    pass


class LasFileTooLargeError(LasImportError):
    pass


def read_las_preview(source_path: Path, max_preview_points: int) -> LasImportResponse:
    path = source_path.expanduser().resolve()
    _validate_source(path)

    try:
        las = lasio.read(path, autodetect_encoding=True)
    except Exception as error:
        raise LasImportError(f"Could not read LAS file: {error}") from error

    data = np.asarray(las.data, dtype=float)
    if data.ndim != 2 or data.shape[0] == 0 or data.shape[1] < 1:
        raise LasImportError("The LAS file does not contain a readable data table.")

    depth_values = data[:, 0]
    finite_depths = depth_values[np.isfinite(depth_values)]
    if finite_depths.size == 0:
        raise LasImportError("The LAS file does not contain a valid depth index.")

    row_count = int(data.shape[0])
    sample_indices = _sample_indices(row_count, max_preview_points)
    curve_summaries = [
        _summarize_curve(
            curve=curve,
            values=data[:, curve_index],
            depth_values=depth_values,
            sample_indices=sample_indices,
            curve_index=curve_index,
            row_count=row_count,
        )
        for curve_index, curve in enumerate(las.curves[1:], start=1)
    ]

    if not curve_summaries:
        raise LasImportError("The LAS file does not contain any curves besides the depth index.")

    index_curve = las.curves[0]
    return LasImportResponse(
        source_file=path.name,
        file_size_bytes=path.stat().st_size,
        las_version=_header_value(las.version, "VERS", "unknown"),
        well_name=_header_value(las.well, "WELL", path.stem),
        field_name=_header_value(las.well, "FLD", "Unknown field"),
        depth_mnemonic=str(index_curve.mnemonic or "DEPTH").strip(),
        depth_unit=str(index_curve.unit or "").strip(),
        depth_minimum=float(np.min(finite_depths)),
        depth_maximum=float(np.max(finite_depths)),
        row_count=row_count,
        curves=curve_summaries,
        warnings=[],
    )


def _validate_source(path: Path) -> None:
    if path.suffix.casefold() != ".las":
        raise LasImportError("Only LAS files are supported in this import step.")
    if not path.is_file():
        raise LasImportError("The selected LAS file does not exist or is not accessible.")

    file_size = path.stat().st_size
    if file_size > MAX_STANDARD_LAS_BYTES:
        maximum_megabytes = MAX_STANDARD_LAS_BYTES // (1024 * 1024)
        raise LasFileTooLargeError(
            f"This LAS file is larger than {maximum_megabytes} MB. "
            "Large-file streaming import is not implemented yet."
        )


def _sample_indices(row_count: int, maximum_points: int) -> np.ndarray[Any, np.dtype[np.int64]]:
    if row_count <= maximum_points:
        return np.arange(row_count, dtype=np.int64)

    indices = np.linspace(0, row_count - 1, num=maximum_points, dtype=np.int64)
    return np.unique(indices)


def _summarize_curve(
    *,
    curve: Any,
    values: np.ndarray[Any, np.dtype[np.float64]],
    depth_values: np.ndarray[Any, np.dtype[np.float64]],
    sample_indices: np.ndarray[Any, np.dtype[np.int64]],
    curve_index: int,
    row_count: int,
) -> LasCurveSummary:
    finite_values = values[np.isfinite(values)]
    mnemonic = str(curve.mnemonic or f"CURVE_{curve_index}").strip()
    description = re.sub(r"\s+", " ", str(curve.descr or "Imported LAS curve")).strip()
    preview_samples = [
        LasPreviewSample(
            depth=float(depth_values[index]),
            value=float(values[index]) if math.isfinite(float(values[index])) else None,
        )
        for index in sample_indices
        if math.isfinite(float(depth_values[index]))
    ]

    return LasCurveSummary(
        id=f"curve-{curve_index}-{_slug(mnemonic)}",
        mnemonic=mnemonic,
        unit=str(curve.unit or "").strip(),
        description=description,
        minimum=float(np.min(finite_values)) if finite_values.size else None,
        maximum=float(np.max(finite_values)) if finite_values.size else None,
        sample_count=row_count,
        null_count=row_count - int(finite_values.size),
        preview_samples=preview_samples,
    )


def _header_value(section: Any, mnemonic: str, fallback: str) -> str:
    try:
        value = str(section[mnemonic].value).strip()
    except (KeyError, TypeError):
        return fallback
    return value or fallback


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return normalized or "curve"
