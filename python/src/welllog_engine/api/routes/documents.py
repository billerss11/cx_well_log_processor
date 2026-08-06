from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status

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
UPLOAD_CHUNK_SIZE = 1024 * 1024
SUPPORTED_UPLOAD_SUFFIXES = {".las", ".dlis", ".xml", ".epc", ".cxlog"}


@router.post("/open", operation_id="openDocument", status_code=status.HTTP_202_ACCEPTED)
def open_document(request: OpenDocumentRequest) -> JobAcceptedResponse:
    return job_service.submit_open(
        Path(request.source_path),
        request.max_preview_points,
        request.index_candidate_id,
    )


@router.post(
    "/upload",
    operation_id="uploadDocument",
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(
    file: Annotated[
        UploadFile,
        File(description="LAS, DLIS, WITSML XML/EPC, or CX Log file."),
    ],
    max_preview_points: Annotated[int, Form(ge=100, le=2_000)] = 800,
    index_candidate_id: Annotated[str | None, Form()] = None,
) -> JobAcceptedResponse:
    filename = Path(file.filename or "").name
    staged_path: Path | None = None
    ownership_transferred = False
    try:
        if Path(filename).suffix.casefold() not in SUPPORTED_UPLOAD_SUFFIXES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Supported uploads are LAS, DLIS, WITSML XML/EPC, and CX Log files."
                ),
            )
        staged_path = document_service.create_upload_path(filename)
        size = 0
        with staged_path.open("wb") as stream:
            while chunk := await file.read(UPLOAD_CHUNK_SIZE):
                stream.write(chunk)
                size += len(chunk)
        if size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The uploaded file is empty.",
            )
        accepted = job_service.submit_open(
            staged_path,
            max_preview_points,
            index_candidate_id,
            owned_source=True,
        )
        ownership_transferred = True
        return accepted
    except (DocumentError, OSError) as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
    finally:
        await file.close()
        if staged_path is not None and not ownership_transferred:
            document_service.discard_upload(staged_path)


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
