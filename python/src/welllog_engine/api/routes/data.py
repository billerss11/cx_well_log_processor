from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response, status

from welllog_engine.application.services.documents import DocumentError, document_service
from welllog_engine.application.services.jobs import job_service
from welllog_engine.application.services.metadata import metadata_service
from welllog_engine.application.services.qc import quality_control_service
from welllog_engine.application.services.scalar_data import (
    ARROW_STREAM_MEDIA_TYPE,
    scalar_data_service,
)
from welllog_engine.contracts.documents import (
    CsvExportRequest,
    CursorValueRequest,
    CursorValueResponse,
    DatasetViewSettings,
    DatasetViewSettingsUpdate,
    JobAcceptedResponse,
    MetadataObjectDetail,
    MetadataObjectPage,
    ScalarPreviewPageRequest,
    ScalarVisibleRangeRequest,
)
from welllog_engine.contracts.qc import QcReport

router = APIRouter(prefix="/documents", tags=["document data"])


@router.get(
    "/{document_id}/datasets/{dataset_id}/qc",
    operation_id="runDatasetQc",
)
def run_dataset_qc(document_id: str, dataset_id: str) -> QcReport:
    try:
        return quality_control_service.run_dataset(document_id, dataset_id)
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.post(
    "/{document_id}/datasets/{dataset_id}/scalar/visible-range",
    operation_id="getScalarVisibleRange",
    response_class=Response,
)
def get_scalar_visible_range(
    document_id: str,
    dataset_id: str,
    request: ScalarVisibleRangeRequest,
) -> Response:
    try:
        content = scalar_data_service.visible_range_arrow(
            document_id,
            dataset_id,
            request,
        )
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    return Response(content=content, media_type=ARROW_STREAM_MEDIA_TYPE)


@router.post(
    "/{document_id}/datasets/{dataset_id}/scalar/preview",
    operation_id="getScalarPreviewPage",
    response_class=Response,
)
def get_scalar_preview_page(
    document_id: str,
    dataset_id: str,
    request: ScalarPreviewPageRequest,
) -> Response:
    try:
        content = scalar_data_service.preview_page_arrow(
            document_id,
            dataset_id,
            request,
        )
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    return Response(content=content, media_type=ARROW_STREAM_MEDIA_TYPE)


@router.post(
    "/{document_id}/datasets/{dataset_id}/cursor-values",
    operation_id="getCursorValues",
)
def get_cursor_values(
    document_id: str,
    dataset_id: str,
    request: CursorValueRequest,
) -> CursorValueResponse:
    try:
        return scalar_data_service.cursor_values(
            document_id,
            dataset_id,
            request.curve_ids,
            request.index,
        )
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.put(
    "/{document_id}/datasets/{dataset_id}/view-settings",
    operation_id="updateDatasetViewSettings",
)
def update_dataset_view_settings(
    document_id: str,
    dataset_id: str,
    request: DatasetViewSettingsUpdate,
) -> DatasetViewSettings:
    try:
        return document_service.update_view_settings(document_id, dataset_id, request)
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.get(
    "/{document_id}/metadata-objects",
    operation_id="listMetadataObjects",
)
def list_metadata_objects(
    document_id: str,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=50, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
) -> MetadataObjectPage:
    try:
        return metadata_service.list_objects(
            document_id,
            page=page,
            page_size=page_size,
            search=search,
        )
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.get(
    "/{document_id}/metadata-objects/{object_id}",
    operation_id="getMetadataObject",
)
def get_metadata_object(document_id: str, object_id: str) -> MetadataObjectDetail:
    try:
        return metadata_service.get_object(document_id, object_id)
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.post(
    "/{document_id}/datasets/{dataset_id}/export-csv",
    operation_id="exportDatasetCsv",
    status_code=status.HTTP_202_ACCEPTED,
)
def export_dataset_csv(
    document_id: str,
    dataset_id: str,
    request: CsvExportRequest,
) -> JobAcceptedResponse:
    try:
        document_service.get_document(document_id)
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    if not request.all_scalar_curves and not request.curve_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one curve or export all scalar curves.",
        )
    return job_service.submit_export(
        document_id,
        dataset_id,
        Path(request.destination_path),
        None if request.all_scalar_curves else request.curve_ids,
    )
