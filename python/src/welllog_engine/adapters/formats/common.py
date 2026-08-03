import math
import re
from pathlib import Path
from typing import Any

import numpy as np

from welllog_engine.domain.documents import ImportedPreviewSample


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return normalized or "item"


def sample_indices(row_count: int, maximum_points: int) -> np.ndarray[Any, np.dtype[np.int64]]:
    if row_count <= 0:
        return np.array([], dtype=np.int64)
    if row_count <= maximum_points:
        return np.arange(row_count, dtype=np.int64)
    return np.unique(
        np.linspace(0, row_count - 1, num=maximum_points, dtype=np.int64)
    )


def numeric_statistics(values: np.ndarray[Any, Any]) -> tuple[float | None, float | None, int]:
    try:
        numeric = np.asarray(values, dtype=float)
    except (TypeError, ValueError):
        return None, None, 0
    finite = numeric[np.isfinite(numeric)]
    return (
        float(np.min(finite)) if finite.size else None,
        float(np.max(finite)) if finite.size else None,
        int(numeric.size - finite.size),
    )


def build_preview(
    index_values: np.ndarray[Any, Any],
    values: np.ndarray[Any, Any],
    maximum_points: int,
) -> list[ImportedPreviewSample]:
    if values.ndim != 1:
        return []
    preview: list[ImportedPreviewSample] = []
    for position in sample_indices(len(values), maximum_points):
        try:
            index_value = float(index_values[position])
        except (TypeError, ValueError):
            continue
        if not math.isfinite(index_value):
            continue
        try:
            value = float(values[position])
            display_value = value if math.isfinite(value) else None
        except (TypeError, ValueError):
            display_value = None
        preview.append(ImportedPreviewSample(index=index_value, value=display_value))
    return preview


def write_json(path: Path, value: object) -> None:
    import json

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, default=_json_default, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _json_default(value: object) -> object:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    return str(value)

