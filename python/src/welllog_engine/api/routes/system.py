from fastapi import APIRouter

from welllog_engine.application.services.system import get_health
from welllog_engine.contracts.system import HealthResponse

router = APIRouter(tags=["system"])


@router.get("/health", operation_id="getHealth")
def health() -> HealthResponse:
    return get_health()
