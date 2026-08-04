from pathlib import Path

from fastapi import APIRouter, HTTPException, Response, status

from welllog_engine.application.services.documents import (
    DocumentError,
    document_service,
)
from welllog_engine.application.services.jobs import job_service
from welllog_engine.contracts.documents import (
    DocumentSummary,
    JobAcceptedResponse,
    OpenDocumentRequest,
    PackageVerificationResponse,
    SaveDocumentRequest,
    VerifyPackageRequest,
)

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/open", operation_id="openDocument", status_code=status.HTTP_202_ACCEPTED)
def open_document(request: OpenDocumentRequest) -> JobAcceptedResponse:
    return job_service.submit_open(
        Path(request.source_path),
        request.max_preview_points,
        request.index_candidate_id,
    )


@router.get("/{document_id}", operation_id="getDocument")
def get_document(document_id: str) -> DocumentSummary:
    try:
        return document_service.get_document(document_id)
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.post(
    "/{document_id}/save-as",
    operation_id="saveDocumentAs",
    status_code=status.HTTP_202_ACCEPTED,
)
def save_document_as(
    document_id: str,
    request: SaveDocumentRequest,
) -> JobAcceptedResponse:
    try:
        document_service.get_document(document_id)
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    return job_service.submit_save(document_id, Path(request.destination_path))


@router.post(
    "/{document_id}/close",
    operation_id="closeDocument",
    status_code=status.HTTP_204_NO_CONTENT,
)
def close_document(document_id: str) -> Response:
    try:
        document_service.close_document(document_id)
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/verify", operation_id="verifyPackage")
def verify_package(request: VerifyPackageRequest) -> PackageVerificationResponse:
    return document_service.verify(Path(request.package_path))
