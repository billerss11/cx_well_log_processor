from pathlib import Path

from welllog_engine.application.services.documents import document_service
from welllog_engine.application.services.qc import quality_control_service
from welllog_engine.application.services.scalar_data import scalar_data_service
from welllog_engine.application.services.system import get_health
from welllog_engine.contracts.documents import (
    DocumentSummary,
    PackageVerificationResponse,
)
from welllog_engine.contracts.qc import QcReport
from welllog_engine.contracts.system import HealthResponse


class Engine:
    """In-process entry point for application operations."""

    def health(self) -> HealthResponse:
        return get_health()

    def open_document(
        self,
        source_path: Path,
        *,
        max_preview_points: int = 800,
        index_candidate_id: str | None = None,
    ) -> DocumentSummary:
        return document_service.open_document(
            source_path,
            max_preview_points=max_preview_points,
            index_candidate_id=index_candidate_id,
        )

    def get_document(self, document_id: str) -> DocumentSummary:
        return document_service.get_document(document_id)

    def save_document(self, document_id: str, destination_path: Path) -> Path:
        return document_service.save_document(document_id, destination_path)

    def close_document(self, document_id: str) -> None:
        document_service.close_document(document_id)

    def inspect_document(self, source_path: Path) -> DocumentSummary:
        return document_service.inspect(source_path)

    def convert_document(
        self,
        source_path: Path,
        destination_path: Path,
    ) -> DocumentSummary:
        return document_service.convert(source_path, destination_path)

    def verify_package(self, package_path: Path) -> PackageVerificationResponse:
        return document_service.verify(package_path)

    def export_dataset_csv(
        self,
        document_id: str,
        dataset_id: str,
        destination_path: Path,
        *,
        curve_ids: list[str] | None = None,
    ) -> Path:
        return scalar_data_service.export_csv(
            document_id,
            dataset_id,
            destination_path,
            curve_ids=curve_ids,
            cancel_requested=lambda: False,
        )

    def run_dataset_qc(self, document_id: str, dataset_id: str) -> QcReport:
        return quality_control_service.run_dataset(document_id, dataset_id)
