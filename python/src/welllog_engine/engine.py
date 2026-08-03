from pathlib import Path

from welllog_engine.application.services.documents import document_service
from welllog_engine.application.services.system import get_health
from welllog_engine.contracts.documents import (
    DocumentSummary,
    PackageVerificationResponse,
)
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
    ) -> DocumentSummary:
        return document_service.open_document(
            source_path,
            max_preview_points=max_preview_points,
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
