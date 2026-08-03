from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from uuid import uuid4

from welllog_engine.application.services.documents import DocumentService, document_service
from welllog_engine.contracts.documents import (
    DocumentSummary,
    JobAcceptedResponse,
    JobState,
    JobStatusResponse,
)


@dataclass
class JobRecord:
    id: str
    operation: str
    state: JobState
    progress: float
    message: str
    document: DocumentSummary | None = None
    saved_path: str | None = None
    error: str | None = None
    cancel_requested: bool = False
    future: Future[None] | None = None


class JobService:
    def __init__(self, documents: DocumentService) -> None:
        self._documents = documents
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="welllog-job")
        self._jobs: dict[str, JobRecord] = {}
        self._lock = RLock()

    def submit_open(self, source_path: Path, max_preview_points: int) -> JobAcceptedResponse:
        return self._submit(
            operation="open_document",
            work=lambda: self._documents.open_document(
                source_path,
                max_preview_points=max_preview_points,
            ),
        )

    def submit_save(self, document_id: str, destination_path: Path) -> JobAcceptedResponse:
        return self._submit(
            operation="save_document",
            work=lambda: self._documents.save_document(document_id, destination_path),
        )

    def get(self, job_id: str) -> JobStatusResponse:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                raise KeyError(job_id)
            return JobStatusResponse(
                id=record.id,
                operation=record.operation,
                state=record.state,
                progress=record.progress,
                message=record.message,
                document=record.document,
                saved_path=record.saved_path,
                error=record.error,
            )

    def cancel(self, job_id: str) -> JobStatusResponse:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                raise KeyError(job_id)
            if record.state in {JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED}:
                return self.get(job_id)
            record.cancel_requested = True
            if record.future is not None and record.future.cancel():
                record.state = JobState.CANCELLED
                record.progress = 1
                record.message = "Cancelled"
            else:
                record.state = JobState.CANCELLING
                record.message = "Cancellation requested"
        return self.get(job_id)

    def _submit(
        self,
        *,
        operation: str,
        work: Callable[[], DocumentSummary | Path],
    ) -> JobAcceptedResponse:
        job_id = uuid4().hex
        record = JobRecord(
            id=job_id,
            operation=operation,
            state=JobState.QUEUED,
            progress=0,
            message="Queued",
        )
        with self._lock:
            self._jobs[job_id] = record
        future = self._executor.submit(self._run, record, work)
        record.future = future
        return JobAcceptedResponse(job_id=job_id)

    def _run(
        self,
        record: JobRecord,
        work: Callable[[], DocumentSummary | Path],
    ) -> None:
        with self._lock:
            if record.cancel_requested:
                record.state = JobState.CANCELLED
                record.progress = 1
                record.message = "Cancelled"
                return
            record.state = JobState.RUNNING
            record.progress = 0.1
            record.message = "Processing source data"
        try:
            result = work()
            with self._lock:
                if record.cancel_requested:
                    if isinstance(result, DocumentSummary):
                        self._documents.close_document(result.id)
                    record.state = JobState.CANCELLED
                    record.message = "Cancelled"
                elif isinstance(result, DocumentSummary):
                    record.document = result
                    record.state = JobState.COMPLETED
                    record.message = "Document opened"
                elif isinstance(result, Path):
                    record.saved_path = str(result)
                    record.state = JobState.COMPLETED
                    record.message = "CX Log package saved"
                else:
                    raise TypeError("Job returned an unsupported result.")
                record.progress = 1
        except Exception as error:
            with self._lock:
                record.state = JobState.FAILED
                record.progress = 1
                record.message = "Operation failed"
                record.error = str(error)


job_service = JobService(document_service)
