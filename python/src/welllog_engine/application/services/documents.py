import ctypes
import json
import os
import shutil
import tempfile
from concurrent.futures import ProcessPoolExecutor
from ctypes import wintypes
from dataclasses import dataclass
from multiprocessing import get_context
from pathlib import Path
from threading import RLock
from uuid import uuid4

import duckdb  # type: ignore[import-untyped]

from welllog_engine.adapters.formats.dlis.reader import convert_dlis
from welllog_engine.adapters.formats.las.converter import convert_las
from welllog_engine.adapters.formats.witsml.reader import convert_witsml
from welllog_engine.adapters.storage.cxlog import (
    CXLOG_EXTENSION,
    CxlogError,
    copy_package,
    extract_asset,
    finalize_staging,
    open_package,
    read_document_summary,
    refresh_staging_manifest,
    remove_session_directory,
    verify_package,
    write_package,
    write_updated_package,
)
from welllog_engine.contracts.documents import (
    DatasetViewSettings,
    DatasetViewSettingsUpdate,
    DocumentSummary,
    PackageVerificationResponse,
)
from welllog_engine.domain.documents import ConversionResult, CxlogManifest


class DocumentError(ValueError):
    pass


@dataclass
class DocumentSession:
    id: str
    working_path: Path
    catalog_path: Path
    saved: bool
    package_path: Path | None
    manifest: CxlogManifest
    owned_source_path: Path | None = None
    modified: bool = False


def _convert_dlis_in_worker(
    source_path: str,
    staging_path: str,
    max_preview_points: int,
) -> ConversionResult:
    return convert_dlis(Path(source_path), Path(staging_path), max_preview_points)


class DocumentService:
    def __init__(self) -> None:
        self._root = Path(tempfile.gettempdir()) / "cx-well-log-processor" / "sessions"
        self._root.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, DocumentSession] = {}
        self._lock = RLock()
        self._cleanup_stale_sessions()

    def open_document(
        self,
        source_path: Path,
        *,
        max_preview_points: int = 800,
        index_candidate_id: str | None = None,
        owned_source: bool = False,
    ) -> DocumentSummary:
        source = source_path.expanduser().resolve()
        session_path = self._create_session_path()
        try:
            if source.suffix.casefold() == CXLOG_EXTENSION:
                manifest, catalog_path = open_package(source, session_path)
                document_id = manifest.package_id
                session = DocumentSession(
                    id=document_id,
                    working_path=session_path,
                    catalog_path=catalog_path,
                    saved=True,
                    package_path=source,
                    manifest=manifest,
                    owned_source_path=source if owned_source else None,
                )
            else:
                result = self._convert_source(
                    source,
                    session_path,
                    max_preview_points,
                    index_candidate_id,
                )
                manifest = finalize_staging(session_path, result)
                session = DocumentSession(
                    id=result.document_id,
                    working_path=session_path,
                    catalog_path=session_path / "catalog.duckdb",
                    saved=False,
                    package_path=None,
                    manifest=manifest,
                    owned_source_path=source if owned_source else None,
                )
            with self._lock:
                existing = self._sessions.pop(session.id, None)
                if existing is not None:
                    self._discard_session(existing)
                self._sessions[session.id] = session
            return self._summary(session)
        except Exception:
            remove_session_directory(session_path)
            if owned_source:
                self.discard_upload(source)
            raise

    def create_upload_path(self, filename: str) -> Path:
        safe_name = Path(filename).name
        if not safe_name or safe_name in {".", ".."}:
            raise DocumentError("The uploaded file must have a filename.")
        directory = self._root / f"upload-{uuid4().hex}"
        directory.mkdir(parents=True)
        (directory / ".owner.json").write_text(
            json.dumps({"pid": os.getpid()}),
            encoding="utf-8",
        )
        return directory / safe_name

    def discard_upload(self, source_path: Path) -> None:
        source = source_path.expanduser().resolve()
        directory = source.parent
        if directory.parent != self._root or not directory.name.startswith("upload-"):
            return
        remove_session_directory(directory)

    def get_document(self, document_id: str) -> DocumentSummary:
        return self._summary(self._get_session(document_id))

    def save_document(self, document_id: str, destination_path: Path) -> Path:
        session = self._get_session(document_id)
        if (session.working_path / "manifest.json").is_file():
            session.manifest = refresh_staging_manifest(
                session.working_path,
                session.manifest,
            )
            destination = write_package(session.working_path, destination_path)
        elif session.package_path is not None and session.modified:
            destination, session.manifest = write_updated_package(
                session.package_path,
                session.working_path,
                session.manifest,
                destination_path,
            )
        elif session.package_path is not None:
            destination = copy_package(session.package_path, destination_path)
        else:
            raise DocumentError("The open document has no package data to save.")
        session.saved = True
        session.package_path = destination
        session.modified = False
        return destination

    def catalog_path(self, document_id: str) -> Path:
        return self._get_session(document_id).catalog_path

    def resolve_asset(self, document_id: str, asset_path: str) -> Path:
        session = self._get_session(document_id)
        destination = session.working_path / Path(asset_path)
        if destination.is_file():
            return destination
        asset = next(
            (item for item in session.manifest.assets if item.path == asset_path),
            None,
        )
        if asset is None or session.package_path is None:
            raise DocumentError(f"Document asset {asset_path} was not found.")
        try:
            return extract_asset(
                session.package_path,
                session.working_path,
                asset,
            )
        except CxlogError as error:
            raise DocumentError(str(error)) from error

    def update_view_settings(
        self,
        document_id: str,
        dataset_id: str,
        settings: DatasetViewSettingsUpdate,
    ) -> DatasetViewSettings:
        session = self._get_session(document_id)
        connection = duckdb.connect(str(session.catalog_path))
        try:
            dataset_row = connection.execute(
                "SELECT count(*) FROM datasets WHERE id = ?",
                [dataset_id],
            ).fetchone()
            if dataset_row is None or int(dataset_row[0]) == 0:
                raise DocumentError(f"Dataset {dataset_id} was not found.")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS dataset_view_settings(
                    dataset_id VARCHAR PRIMARY KEY,
                    time_display_mode VARCHAR NOT NULL,
                    time_zone VARCHAR NOT NULL,
                    manual_anchor_index DOUBLE,
                    manual_anchor_timestamp DOUBLE
                )
                """
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO dataset_view_settings
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    dataset_id,
                    settings.time_display_mode.value,
                    settings.time_zone.value,
                    settings.manual_anchor_index,
                    settings.manual_anchor_timestamp,
                ],
            )
            connection.execute("CHECKPOINT")
        finally:
            connection.close()
        session.modified = True
        return DatasetViewSettings(**settings.model_dump())

    def close_document(self, document_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(document_id, None)
        if session is None:
            raise DocumentError(f"Document {document_id} is not open.")
        self._discard_session(session)

    def inspect(self, source_path: Path, *, max_preview_points: int = 800) -> DocumentSummary:
        summary = self.open_document(
            source_path,
            max_preview_points=max_preview_points,
        )
        self.close_document(summary.id)
        return summary

    def convert(self, source_path: Path, destination_path: Path) -> DocumentSummary:
        summary = self.open_document(source_path)
        try:
            self.save_document(summary.id, destination_path)
            return self.get_document(summary.id)
        finally:
            self.close_document(summary.id)

    def verify(self, package_path: Path) -> PackageVerificationResponse:
        return verify_package(package_path.expanduser().resolve())

    def close_all(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            self._discard_session(session)

    def _discard_session(self, session: DocumentSession) -> None:
        remove_session_directory(session.working_path)
        if session.owned_source_path is not None:
            self.discard_upload(session.owned_source_path)

    def _convert_source(
        self,
        source: Path,
        session_path: Path,
        max_preview_points: int,
        index_candidate_id: str | None,
    ) -> ConversionResult:
        suffix = source.suffix.casefold()
        if suffix == ".las":
            return convert_las(
                source,
                session_path,
                max_preview_points,
                index_candidate_id,
            )
        if suffix == ".dlis":
            with ProcessPoolExecutor(
                max_workers=1,
                mp_context=get_context("spawn"),
            ) as executor:
                return executor.submit(
                    _convert_dlis_in_worker,
                    str(source),
                    str(session_path),
                    max_preview_points,
                ).result()
        if suffix in {".xml", ".epc"}:
            return convert_witsml(source, session_path, max_preview_points)
        raise DocumentError(
            "Supported files are LAS, DLIS, WITSML XML/EPC, and CX Log packages."
        )

    def _summary(self, session: DocumentSession) -> DocumentSummary:
        return read_document_summary(
            session.catalog_path,
            document_id=session.id,
            saved=session.saved,
            modified=session.modified,
        )

    def _get_session(self, document_id: str) -> DocumentSession:
        with self._lock:
            session = self._sessions.get(document_id)
        if session is None:
            raise DocumentError(f"Document {document_id} is not open.")
        return session

    def _create_session_path(self) -> Path:
        path = self._root / f"session-{uuid4().hex}"
        path.mkdir(parents=True)
        (path / ".owner.json").write_text(
            json.dumps({"pid": os.getpid()}),
            encoding="utf-8",
        )
        return path

    def _cleanup_stale_sessions(self) -> None:
        for path in [*self._root.glob("session-*"), *self._root.glob("upload-*")]:
            marker = path / ".owner.json"
            try:
                owner = json.loads(marker.read_text(encoding="utf-8"))
                pid = int(owner["pid"])
            except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
                pid = -1
            if pid != os.getpid() and not _pid_is_running(pid):
                shutil.rmtree(path, ignore_errors=True)


def _pid_is_running(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        return _windows_pid_is_running(pid)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _windows_pid_is_running(pid: int) -> bool:
    process_query_limited_information = 0x1000
    still_active = 259
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
    open_process = kernel32.OpenProcess
    open_process.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    open_process.restype = wintypes.HANDLE
    get_exit_code = kernel32.GetExitCodeProcess
    get_exit_code.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    get_exit_code.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [wintypes.HANDLE]
    close_handle.restype = wintypes.BOOL

    handle = open_process(process_query_limited_information, False, pid)
    if not handle:
        return False
    try:
        exit_code = wintypes.DWORD()
        return bool(get_exit_code(handle, ctypes.byref(exit_code))) and (
            exit_code.value == still_active
        )
    finally:
        close_handle(handle)


document_service = DocumentService()


def open_document(
    source_path: Path,
    max_preview_points: int = 800,
    index_candidate_id: str | None = None,
) -> DocumentSummary:
    try:
        return document_service.open_document(
            source_path,
            max_preview_points=max_preview_points,
            index_candidate_id=index_candidate_id,
        )
    except CxlogError as error:
        raise DocumentError(str(error)) from error
