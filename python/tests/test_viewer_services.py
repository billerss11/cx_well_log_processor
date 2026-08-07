import csv
import hashlib
import json
import shutil
import time
import zipfile
from pathlib import Path
from typing import Any

import duckdb  # type: ignore[import-untyped]
import pyarrow.ipc as ipc  # type: ignore[import-untyped]
import pytest
from fastapi.testclient import TestClient

from welllog_engine.api import create_app
from welllog_engine.application.services.documents import DocumentService
from welllog_engine.application.services.metadata import MetadataService
from welllog_engine.application.services.qc import QualityControlService
from welllog_engine.application.services.scalar_data import ExportCancelled, ScalarDataService
from welllog_engine.contracts.documents import (
    DatasetViewSettingsUpdate,
    ScalarPreviewPageRequest,
    ScalarVisibleRangeRequest,
    TimeDisplayMode,
    TimeZoneMode,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_LAS_PATH = REPOSITORY_ROOT / "files" / "test.las"


def test_ambiguous_las_job_returns_structured_candidates() -> None:
    with TestClient(create_app()) as client:
        accepted = client.post(
            "/api/v1/documents/open",
            json={"source_path": str(SAMPLE_LAS_PATH)},
        )
        job = _wait_for_job(client, accepted.json()["job_id"])

        assert job["state"] == "FAILED"
        assert job["error_code"] == "INDEX_SELECTION_REQUIRED"
        candidates = job["error_details"]["candidates"]
        assert [candidate["mnemonic"] for candidate in candidates[:2]] == ["DEPT", "TVD"]


def test_uploaded_las_returns_parsed_document_job() -> None:
    with TestClient(create_app()) as client, SAMPLE_LAS_PATH.open("rb") as source:
        accepted = client.post(
            "/api/v1/documents/upload",
            data={"index_candidate_id": "curve:0", "max_preview_points": "100"},
            files={"file": ("test.las", source, "application/octet-stream")},
        )

        assert accepted.status_code == 202
        job = _wait_for_job(client, accepted.json()["job_id"])
        assert job["state"] == "COMPLETED"
        assert job["document"]["source_format"] == "LAS"
        assert job["document"]["datasets"][0]["curves"][0]["preview_samples"]

        closed = client.post(
            f"/api/v1/documents/{job['document']['id']}/close",
        )
        assert closed.status_code == 204


def test_owned_upload_is_removed_when_document_closes() -> None:
    service = DocumentService()
    upload_path = service.create_upload_path("test.las")
    shutil.copyfile(SAMPLE_LAS_PATH, upload_path)
    try:
        summary = service.open_document(
            upload_path,
            index_candidate_id="curve:0",
            owned_source=True,
        )
        assert upload_path.is_file()

        service.close_document(summary.id)

        assert not upload_path.parent.exists()
    finally:
        service.close_all()
        service.discard_upload(upload_path)


def test_scalar_queries_are_bounded_and_cursor_is_honest() -> None:
    service = DocumentService()
    scalar = ScalarDataService(service)
    try:
        summary = service.open_document(SAMPLE_LAS_PATH, index_candidate_id="curve:0")
        dataset = summary.datasets[0]
        curve_ids = [curve.id for curve in dataset.curves[:2]]
        visible = scalar.visible_range_arrow(
            summary.id,
            dataset.id,
            ScalarVisibleRangeRequest(
                curve_ids=curve_ids,
                index_minimum=dataset.index_minimum or 0,
                index_maximum=dataset.index_maximum or 1,
                viewport_height=400,
                point_budget=800,
            ),
        )
        table = ipc.open_stream(visible).read_all()
        assert table.num_rows <= 800
        assert set(table.column("curve_id").to_pylist()) == set(curve_ids)

        preview = scalar.preview_page_arrow(
            summary.id,
            dataset.id,
            ScalarPreviewPageRequest(curve_ids=curve_ids, page=1, page_size=100),
        )
        preview_table = ipc.open_stream(preview).read_all()
        assert preview_table.num_rows == 100
        assert preview_table.column_names == ["__index", *curve_ids]

        range_minimum = float(preview_table.column("__index")[10].as_py())
        range_maximum = float(preview_table.column("__index")[20].as_py())
        filtered_preview = scalar.preview_page_arrow(
            summary.id,
            dataset.id,
            ScalarPreviewPageRequest(
                curve_ids=curve_ids,
                index_minimum=range_maximum,
                index_maximum=range_minimum,
                page=0,
                page_size=100,
            ),
        )
        filtered_table = ipc.open_stream(filtered_preview).read_all()
        filtered_indexes = [
            float(value) for value in filtered_table.column("__index").to_pylist()
        ]
        assert filtered_indexes
        assert all(range_minimum <= value <= range_maximum for value in filtered_indexes)

        exact_index = float(preview_table.column("__index")[0].as_py())
        cursor = scalar.cursor_values(summary.id, dataset.id, curve_ids, exact_index)
        assert all(
            value.status in {"exact", "interpolated", "no_data"}
            for value in cursor.values
        )
    finally:
        service.close_all()


def test_basic_qc_report_uses_document_catalog_and_scalar_assets() -> None:
    service = DocumentService()
    qc = QualityControlService(service)
    try:
        summary = service.open_document(SAMPLE_LAS_PATH, index_candidate_id="curve:0")
        dataset = summary.datasets[0]

        report = qc.run_dataset(summary.id, dataset.id)

        assert report.document_id == summary.id
        assert report.dataset_id == dataset.id
        assert report.summary.checks_run == dataset.scalar_curve_count * 4 + 6
        assert report.summary.issue_count == len(report.issues)
        assert {issue.code for issue in report.issues} <= {
            "CURVE_CONSTANT",
            "CURVE_DUPLICATE_MNEMONIC",
            "CURVE_EXCESSIVE_NULLS",
            "CURVE_INVALID_NUMERIC",
            "CURVE_UNIT_MISSING",
            "INDEX_DUPLICATE",
            "INDEX_INVALID",
            "INDEX_IRREGULAR_STEP",
            "INDEX_LARGE_GAP",
            "INDEX_NON_MONOTONIC",
            "INDEX_REVERSED",
        }
    finally:
        service.close_all()


def test_metadata_settings_overlay_save_and_csv_export(tmp_path: Path) -> None:
    service = DocumentService()
    scalar = ScalarDataService(service)
    metadata = MetadataService(service)
    source_hash = _sha256(SAMPLE_LAS_PATH)
    try:
        imported = service.open_document(SAMPLE_LAS_PATH, index_candidate_id="curve:0")
        dataset = imported.datasets[0]
        page = metadata.list_objects(imported.id, page=0, page_size=10, search=None)
        detail = metadata.get_object(imported.id, page.items[0].id)
        assert isinstance(detail.content_json, dict)
        assert set(detail.content_json) == {"version", "well", "curves", "parameters", "other"}

        csv_path = scalar.export_csv(
            imported.id,
            dataset.id,
            tmp_path / "selected",
            curve_ids=[dataset.curves[0].id, dataset.curves[1].id],
            cancel_requested=lambda: False,
        )
        with csv_path.open(encoding="utf-8", newline="") as stream:
            rows = list(csv.reader(stream))
        assert rows[0] == [
            dataset.index_mnemonic,
            dataset.curves[0].mnemonic,
            dataset.curves[1].mnemonic,
        ]
        assert len(rows) == dataset.row_count + 1

        original_package = service.save_document(imported.id, tmp_path / "original")
        service.close_document(imported.id)
        original_manifest = _manifest(original_package)

        reopened = service.open_document(original_package)
        settings = service.update_view_settings(
            reopened.id,
            reopened.datasets[0].id,
            DatasetViewSettingsUpdate(
                time_display_mode=TimeDisplayMode.CLOCK,
                time_zone=TimeZoneMode.LOCAL,
                manual_anchor_index=1000,
                manual_anchor_timestamp=1_800_000_000,
            ),
        )
        assert settings.time_zone == TimeZoneMode.LOCAL
        assert service.get_document(reopened.id).modified is True
        updated_package = service.save_document(reopened.id, tmp_path / "updated")
        assert service.verify(updated_package).valid is True
        assert service.get_document(reopened.id).modified is False
        updated_manifest = _manifest(updated_package)
        original_assets = {asset["path"]: asset["sha256"] for asset in original_manifest["assets"]}
        updated_assets = {asset["path"]: asset["sha256"] for asset in updated_manifest["assets"]}
        assert {
            path: digest for path, digest in original_assets.items() if path != "catalog.duckdb"
        } == {
            path: digest for path, digest in updated_assets.items() if path != "catalog.duckdb"
        }
        assert _sha256(SAMPLE_LAS_PATH) == source_hash
    finally:
        service.close_all()


def test_old_catalog_defaults_and_cancelled_export_leave_no_file(tmp_path: Path) -> None:
    service = DocumentService()
    scalar = ScalarDataService(service)
    try:
        summary = service.open_document(SAMPLE_LAS_PATH, index_candidate_id="curve:0")
        connection = duckdb.connect(str(service.catalog_path(summary.id)))
        try:
            connection.execute("DROP TABLE dataset_view_settings")
            connection.execute("CHECKPOINT")
        finally:
            connection.close()
        refreshed = service.get_document(summary.id)
        assert refreshed.datasets[0].view_settings.time_display_mode == "elapsed"

        destination = tmp_path / "cancelled.csv"
        with pytest.raises(ExportCancelled):
            scalar.export_csv(
                summary.id,
                refreshed.datasets[0].id,
                destination,
                curve_ids=[refreshed.datasets[0].curves[0].id],
                cancel_requested=lambda: True,
            )
        assert not destination.exists()
    finally:
        service.close_all()


def _wait_for_job(client: TestClient, job_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        if job["state"] in {"COMPLETED", "FAILED", "CANCELLED"}:
            return job
        time.sleep(0.05)
    raise AssertionError("Job did not finish")


def _manifest(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path) as package:
        return json.loads(package.read("manifest.json"))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
