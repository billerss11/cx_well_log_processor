import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from welllog_engine.api.routes.data import router as data_router
from welllog_engine.api.routes.documents import router as documents_router
from welllog_engine.api.routes.imports import router as imports_router
from welllog_engine.api.routes.jobs import router as jobs_router
from welllog_engine.api.routes.system import router as system_router
from welllog_engine.application.services.documents import document_service
from welllog_engine.version import ENGINE_VERSION


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield
    document_service.close_all()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Well Log Engine API",
        version=ENGINE_VERSION,
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/v1/docs",
        redoc_url=None,
        lifespan=lifespan,
    )

    if os.getenv("WELLLOG_DEV_CORS") == "1":
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://127.0.0.1:5174", "http://localhost:5174"],
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )

    app.include_router(system_router, prefix="/api/v1")
    app.include_router(imports_router, prefix="/api/v1")
    app.include_router(documents_router, prefix="/api/v1")
    app.include_router(data_router, prefix="/api/v1")
    app.include_router(jobs_router, prefix="/api/v1")
    return app
