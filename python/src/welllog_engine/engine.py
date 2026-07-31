from welllog_engine.application.services.system import get_health
from welllog_engine.contracts.system import HealthResponse


class Engine:
    """In-process entry point for application operations."""

    def health(self) -> HealthResponse:
        return get_health()
