import json
import time
import zipfile
from pathlib import Path

import h5py  # type: ignore[import-untyped]
import numpy as np
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from welllog_engine.api import create_app
from welllog_engine.application.services.documents import DocumentService
from welllog_engine.cli.main import app

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_LAS_PATH = REPOSITORY_ROOT / "files" / "test.las"
SAMPLE_DLIS_PATH = REPOSITORY_ROOT / "files" / "test.dlis"
SAMPLE_WITSML_PATH = REPOSITORY_ROOT / "files" / "test_witsml.xml"


def test_las_can_be_saved_verified_and_reopened(tmp_path: Path) -> None:
    service = DocumentService()
    destination = tmp_path / "saved-log"
    try:
        imported = service.open_document(
            SAMPLE_LAS_PATH,
            max_preview_points=200,
            index_candidate_id="curve:0",
        )
        saved_path = service.save_document(imported.id, destination)
        service.close_document(imported.id)

        assert saved_path.name == "saved-log.cxlog"
        verification = service.verify(saved_path)
        assert verification.valid is True

        with zipfile.ZipFile(saved_path) as package:
            package_names = package.namelist()
            manifest = json.loads(package.read("manifest.json"))
        assert ".owner.json" not in package_names
        assert not any(name.casefold().endswith(".las") for name in package_names)
        assert manifest["source"]["filename"] == "test.las"
        assert "source_path" not in manifest["source"]

        reopened = service.open_document(saved_path)
        assert reopened.saved is True
        assert reopened.source_format == "LAS"
        assert reopened.datasets[0].row_count == 3931
        assert len(reopened.datasets[0].curves) == 20

        copied_path = service.save_document(reopened.id, tmp_path / "copied.cxlog")
        assert service.verify(copied_path).valid is True
        assert copied_path.read_bytes() == saved_path.read_bytes()
    finally:
        service.close_all()


def test_witsml_sample_preserves_object_and_converts_log_data() -> None:
    service = DocumentService()
    try:
        summary = service.open_document(SAMPLE_WITSML_PATH, max_preview_points=200)
        assert summary.source_format == "WITSML"
        assert summary.source_version == "1.4.1.1"
        assert summary.preserved_object_count == 1
        assert len(summary.datasets) == 1
        assert summary.datasets[0].row_count == 19_895
        assert len(summary.datasets[0].curves) == 24
    finally:
        service.close_all()


def test_dlis_sample_isolated_worker_converts_all_frame_channels() -> None:
    service = DocumentService()
    try:
        summary = service.open_document(SAMPLE_DLIS_PATH, max_preview_points=200)
        assert summary.source_format == "DLIS"
        assert summary.source_version == "RP66V1"
        assert len(summary.datasets) == 1
        assert summary.datasets[0].row_count == 761
        assert len(summary.datasets[0].curves) == 102
        assert summary.preserved_object_count == 145
        assert summary.warnings == []
    finally:
        service.close_all()


def test_witsml_21_inline_time_and_array_channels(tmp_path: Path) -> None:
    source_path = tmp_path / "time-log.xml"
    source_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<Log schemaVersion="2.1" uuid="11111111-1111-1111-1111-111111111111"
     xmlns="http://www.energistics.org/energyml/data/witsmlv2">
  <Citation><Title>Time log</Title></Citation>
  <ChannelSet>
    <Citation><Title>Main channels</Title></Citation>
    <Index><Mnemonic>TIME</Mnemonic><IndexType>Time</IndexType><Uom>s</Uom></Index>
    <Channel><Mnemonic>GR</Mnemonic><Uom>gAPI</Uom></Channel>
    <Channel><Mnemonic>IMAGE</Mnemonic><Uom>unitless</Uom></Channel>
    <Data><Data><![CDATA[
      [
        [["2026-08-02T00:00:00Z"], [55.0, [1.0, 2.0, 3.0]]],
        [["2026-08-02T00:00:01Z"], [56.0, [4.0, 5.0, 6.0]]]
      ]
    ]]></Data></Data>
  </ChannelSet>
</Log>
""",
        encoding="utf-8",
    )
    service = DocumentService()
    try:
        summary = service.open_document(source_path, max_preview_points=100)
        dataset = summary.datasets[0]
        assert summary.source_version == "2.1"
        assert dataset.index_kind == "time"
        assert dataset.index_mnemonic == "TIME"
        assert dataset.row_count == 2
        assert [curve.storage_kind for curve in dataset.curves] == ["parquet", "zarr"]
        assert dataset.curves[1].sample_shape == [3]
        assert summary.warnings == []
    finally:
        service.close_all()


def test_witsml_epc_preserves_companion_hdf5_arrays(tmp_path: Path) -> None:
    xml_path = tmp_path / "well.xml"
    xml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<Well schemaVersion="2.1" uuid="22222222-2222-2222-2222-222222222222"
      xmlns="http://www.energistics.org/energyml/data/witsmlv2">
  <Citation><Title>Array well</Title></Citation>
</Well>
""",
        encoding="utf-8",
    )
    hdf_path = tmp_path / "arrays.h5"
    with h5py.File(hdf_path, mode="w") as hdf_file:
        hdf_file.create_dataset("image", data=np.arange(6).reshape(2, 3))
    epc_path = tmp_path / "array-well.epc"
    with zipfile.ZipFile(epc_path, mode="w") as epc:
        epc.write(xml_path, "objects/well.xml")
        epc.write(hdf_path, "arrays/arrays.h5")

    service = DocumentService()
    try:
        summary = service.open_document(epc_path, max_preview_points=100)
        array_dataset = next(
            dataset for dataset in summary.datasets if dataset.kind == "array_collection"
        )
        assert summary.source_format == "WITSML"
        assert summary.source_version == "2.1"
        assert array_dataset.curves[0].storage_kind == "zarr"
        assert array_dataset.curves[0].sample_shape == [3]
    finally:
        service.close_all()


def test_http_open_job_reports_document_and_can_close() -> None:
    with TestClient(create_app()) as client:
        accepted = client.post(
            "/api/v1/documents/open",
            json={
                "source_path": str(SAMPLE_LAS_PATH),
                "max_preview_points": 200,
                "index_candidate_id": "curve:0",
            },
        )
        assert accepted.status_code == 202
        job_id = accepted.json()["job_id"]

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = client.get(f"/api/v1/jobs/{job_id}").json()
            if job["state"] in {"COMPLETED", "FAILED", "CANCELLED"}:
                break
            time.sleep(0.05)

        assert job["state"] == "COMPLETED"
        assert job["document"]["source_format"] == "LAS"
        document_id = job["document"]["id"]
        assert client.post(f"/api/v1/documents/{document_id}/close").status_code == 204


def test_package_verification_rejects_unsafe_archive_member(tmp_path: Path) -> None:
    package_path = tmp_path / "unsafe.cxlog"
    with zipfile.ZipFile(package_path, mode="w") as package:
        package.writestr("../outside.txt", "unsafe")

    result = DocumentService().verify(package_path)

    assert result.valid is False
    assert "Unsafe or duplicate archive member" in result.errors[0]


def test_cli_convert_and_package_verify(tmp_path: Path) -> None:
    destination = tmp_path / "cli-output.cxlog"
    runner = CliRunner()

    conversion = runner.invoke(
        app,
        [
            "convert",
            str(SAMPLE_LAS_PATH),
            str(destination),
            "--index-candidate",
            "curve:0",
        ],
    )
    verification = runner.invoke(app, ["package", "verify", str(destination)])

    assert conversion.exit_code == 0
    assert json.loads(conversion.stdout)["saved"] is True
    assert verification.exit_code == 0
    assert json.loads(verification.stdout)["valid"] is True


def test_openapi_has_stable_document_job_operation_ids() -> None:
    schema = create_app().openapi()

    assert schema["paths"]["/api/v1/documents/open"]["post"]["operationId"] == (
        "openDocument"
    )
    assert schema["paths"]["/api/v1/jobs/{job_id}"]["get"]["operationId"] == "getJob"
    assert schema["paths"]["/api/v1/documents/upload"]["post"]["operationId"] == (
        "uploadDocument"
    )
