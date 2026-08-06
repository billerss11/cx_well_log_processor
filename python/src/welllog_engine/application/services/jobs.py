from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from uuid import uuid4

from welllog_engine.application.services.documents import DocumentService, document_service
from welllog_engine.application.services.scalar_data import (
    ExportCancelled,
    ScalarDataService,
    scalar_data_service,
)
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
    exported_path: str | None = None
    error: str | None = None
    error_code: str | None = None
    error_details: dict[str, object] | None = None
    cancel_requested: bool = False
    future: Future[None] | None = None
    cleanup_on_cancel: Callable[[], None] | None = None


class JobService:
    def __init__(self, documents: DocumentService, scalar_data: ScalarDataService) -> None:
        self._documents = documents
        self._scalar_data = scalar_data
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="welllog-job")
        self._jobs: dict[str, JobRecord] = {}
        self._lock = RLock()

    def submit_open(
        self,
        source_path: Path,
        max_preview_points: int,
        index_candidate_id: str | None = None,
        *,
        owned_source: bool = False,
    ) -> JobAcceptedResponse:
        return self._submit(
            operation="open_document",
            work=lambda _cancel_requested: self._documents.open_document(
                source_path,
                max_preview_points=max_preview_points,
                index_candidate_id=index_candidate_id,
                owned_source=owned_source,
            ),
            cleanup_on_cancel=(
                (lambda: self._documents.discard_upload(source_path))
                if owned_source
                else None
            ),
        )

    def submit_save(self, document_id: str, destination_path: Path) -> JobAcceptedResponse:
        return self._submit(
            operation="save_document",
            work=lambda _cancel_requested: self._documents.save_document(
                document_id,
                destination_path,
            ),
        )

    def submit_export(
        self,
        document_id: str,
        dataset_id: str,
        destination_path: Path,
        curve_ids: list[str] | None,
    ) -> JobAcceptedResponse:
        return self._submit(
            operation="export_csv",
            work=lambda cancel_requested: self._scalar_data.export_csv(
                document_id,
                dataset_id,
                destination_path,
                curve_ids=curve_ids,
                cancel_requested=cancel_requested,
            ),
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
                exported_path=record.exported_path,
                error=record.error,
                error_code=record.error_code,
                error_details=record.error_details,
            )

    def cancel(self, job_id: str) -> JobStatusResponse:
        cleanup: Callable[[], None] | None = None
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
                cleanup = record.cleanup_on_cancel
                record.cleanup_on_cancel = None
            else:
                record.state = JobState.CANCELLING
                record.message = "Cancellation requested"
        if cleanup is not None:
            cleanup()
        return self.get(job_id)

    def _submit(
        self,
        *,
        operation: str,
        work: Callable[[Callable[[], bool]], DocumentSummary | Path],
        cleanup_on_cancel: Callable[[], None] | None = None,
    ) -> JobAcceptedResponse:
        job_id = uuid4().hex
        record = JobRecord(
            id=job_id,
            operation=operation,
            state=JobState.QUEUED,
            progress=0,
            message="Queued",
            cleanup_on_cancel=cleanup_on_cancel,
        )
        with self._lock:
            self._jobs[job_id] = record
        future = self._executor.submit(self._run, record, work)
        record.future = future
        return JobAcceptedResponse(job_id=job_id)

    def _run(
        self,
        record: JobRecord,
        work: Callable[[Callable[[], bool]], DocumentSummary | Path],
    ) -> None:
        cleanup: Callable[[], None] | None = None
        with self._lock:
            if record.cancel_requested:
                record.state = JobState.CANCELLED
                record.progress = 1
                record.message = "Cancelled"
                cleanup = record.cleanup_on_cancel
                record.cleanup_on_cancel = None
            else:
                record.state = JobState.RUNNING
                record.progress = 0.1
                record.message = "Processing source data"
        if cleanup is not None:
            cleanup()
            return
        if record.state == JobState.CANCELLED:
            return
        try:
            result = work(lambda: self._is_cancel_requested(record.id))
            with self._lock:
                if record.cancel_requested:
                    if isinstance(result, DocumentSummary):
                        self._documents.close_document(result.id)
                    elif isinstance(result, Path) and record.operation == "export_csv":
                        result.unlink(missing_ok=True)
                    record.state = JobState.CANCELLED
                    record.message = "Cancelled"
                elif isinstance(result, DocumentSummary):
                    record.document = result
                    record.state = JobState.COMPLETED
                    record.message = "Document opened"
                elif isinstance(result, Path):
                    if record.operation == "export_csv":
                        record.exported_path = str(result)
                        record.message = "CSV export completed"
                    else:
                        record.saved_path = str(result)
                        record.message = "CX Log package saved"
                    record.state = JobState.COMPLETED
                else:
                    raise TypeError("Job returned an unsupported result.")
                record.progress = 1
        except ExportCancelled:
            with self._lock:
                record.state = JobState.CANCELLED
                record.progress = 1
                record.message = "Cancelled"
        except Exception as error:
            with self._lock:
                record.state = JobState.FAILED
                record.progress = 1
                record.message = "Operation failed"
                record.error = str(error)
                error_code = getattr(error, "code", None)
                error_details = getattr(error, "details", None)
                record.error_code = str(error_code) if error_code is not None else None
                record.error_details = (
                    error_details if isinstance(error_details, dict) else None
                )

    def _is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            record = self._jobs.get(job_id)
            return record is not None and record.cancel_requested


job_service = JobService(document_service, scalar_data_service)
