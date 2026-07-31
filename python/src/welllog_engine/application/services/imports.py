from pathlib import Path

from welllog_engine.adapters.formats.las.reader import read_las_preview
from welllog_engine.contracts.imports import LasImportRequest, LasImportResponse


def import_las(request: LasImportRequest) -> LasImportResponse:
    return read_las_preview(
        Path(request.source_path),
        max_preview_points=request.max_preview_points,
    )
