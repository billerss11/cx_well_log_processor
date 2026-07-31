from welllog_engine.contracts.system import HealthResponse
from welllog_engine.version import API_VERSION, ENGINE_VERSION


def get_health() -> HealthResponse:
    """Return engine and API compatibility information."""
    return HealthResponse(
        status="ok",
        engine_version=ENGINE_VERSION,
        api_version=API_VERSION,
    )
