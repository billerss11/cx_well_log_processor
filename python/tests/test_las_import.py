from pathlib import Path

from fastapi.testclient import TestClient

from welllog_engine.api import create_app

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_LAS_PATH = REPOSITORY_ROOT / "files" / "test.las"


def test_import_las_returns_bounded_real_preview() -> None:
    response = TestClient(create_app()).post(
        "/api/v1/imports/las",
        json={
            "source_path": str(SAMPLE_LAS_PATH),
            "max_preview_points": 300,
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["source_file"] == "test.las"
    assert result["well_name"] == "Geographe 2 L1"
    assert result["row_count"] == 3931
    assert result["depth_minimum"] == 1750.0
    assert result["depth_maximum"] == 2143.0
    assert len(result["curves"]) == 20
    assert all(len(curve["preview_samples"]) <= 300 for curve in result["curves"])
    assert any(curve["mnemonic"] == "GR" for curve in result["curves"])


def test_import_las_rejects_other_formats(tmp_path: Path) -> None:
    source_path = tmp_path / "not-las.txt"
    source_path.write_text("not a LAS file", encoding="utf-8")

    response = TestClient(create_app()).post(
        "/api/v1/imports/las",
        json={"source_path": str(source_path)},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Only LAS files are supported in this import step."


def test_openapi_uses_stable_las_import_operation_id() -> None:
    schema = create_app().openapi()

    operation = schema["paths"]["/api/v1/imports/las"]["post"]
    assert operation["operationId"] == "importLas"
