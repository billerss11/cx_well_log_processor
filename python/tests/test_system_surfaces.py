import json

from fastapi.testclient import TestClient
from typer.testing import CliRunner

from welllog_engine import Engine
from welllog_engine.api import create_app
from welllog_engine.cli.main import app


def test_health_is_consistent_across_python_http_and_cli() -> None:
    python_result = Engine().health().model_dump()

    response = TestClient(create_app()).get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == python_result

    cli_result = CliRunner().invoke(app, ["doctor", "--output", "json"])
    assert cli_result.exit_code == 0
    assert json.loads(cli_result.stdout) == python_result


def test_openapi_uses_stable_health_operation_id() -> None:
    schema = create_app().openapi()

    operation = schema["paths"]["/api/v1/health"]["get"]
    assert operation["operationId"] == "getHealth"
