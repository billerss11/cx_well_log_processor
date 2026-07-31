from fastapi import APIRouter, HTTPException, status

from welllog_engine.adapters.formats.las.reader import (
    LasFileTooLargeError,
    LasImportError,
)
from welllog_engine.application.services.imports import import_las
from welllog_engine.contracts.imports import (
    ImportErrorResponse,
    LasImportRequest,
    LasImportResponse,
)

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post(
    "/las",
    operation_id="importLas",
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": ImportErrorResponse},
        status.HTTP_413_CONTENT_TOO_LARGE: {"model": ImportErrorResponse},
    },
)
def import_las_route(request: LasImportRequest) -> LasImportResponse:
    try:
        return import_las(request)
    except LasFileTooLargeError as error:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=str(error),
        ) from error
    except LasImportError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
