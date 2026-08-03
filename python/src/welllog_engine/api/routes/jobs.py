from fastapi import APIRouter, HTTPException, status

from welllog_engine.application.services.jobs import job_service
from welllog_engine.contracts.documents import JobStatusResponse

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", operation_id="getJob")
def get_job(job_id: str) -> JobStatusResponse:
    try:
        return job_service.get(job_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} was not found.",
        ) from error


@router.post("/{job_id}/cancel", operation_id="cancelJob")
def cancel_job(job_id: str) -> JobStatusResponse:
    try:
        return job_service.cancel(job_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} was not found.",
        ) from error
