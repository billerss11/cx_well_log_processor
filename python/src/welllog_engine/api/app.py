import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from welllog_engine.api.routes.imports import router as imports_router
from welllog_engine.api.routes.system import router as system_router
from welllog_engine.version import ENGINE_VERSION


def create_app() -> FastAPI:
    app = FastAPI(
        title="Well Log Engine API",
        version=ENGINE_VERSION,
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/v1/docs",
        redoc_url=None,
    )

    if os.getenv("WELLLOG_DEV_CORS") == "1":
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )

    app.include_router(system_router, prefix="/api/v1")
    app.include_router(imports_router, prefix="/api/v1")
    return app
