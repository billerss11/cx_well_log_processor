import hashlib
import json
import os
import shutil
import zipfile
from pathlib import Path, PurePosixPath
from uuid import uuid4

import duckdb  # type: ignore[import-untyped]
import pyarrow as pa  # type: ignore[import-untyped]

from welllog_engine.contracts.documents import (
    CurvePreviewSample,
    DatasetViewSettings,
    DocumentCurveSummary,
    DocumentDatasetSummary,
    DocumentSummary,
    IndexKind,
    PackageVerificationResponse,
    SourceFormat,
    StorageKind,
    TimeDisplayMode,
    TimeIndexReference,
    TimeZoneMode,
)
from welllog_engine.domain.documents import (
    ConversionResult,
    CxlogManifest,
    PackageAsset,
)
from welllog_engine.version import ENGINE_VERSION

CXLOG_EXTENSION = ".cxlog"
CXLOG_MEDIA_TYPE = "application/vnd.cx.welllog+zip"
CXLOG_PACKAGE_VERSION = "1.0"
MANIFEST_PATH = "manifest.json"
CATALOG_PATH = "catalog.duckdb"
SESSION_MARKER_PATH = ".owner.json"


class CxlogError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finalize_staging(staging_path: Path, result: ConversionResult) -> CxlogManifest:
    staging_path.mkdir(parents=True, exist_ok=True)
    catalog_path = staging_path / CATALOG_PATH
    _write_catalog(catalog_path, result)

    assets = [
        PackageAsset(
            path=path.relative_to(staging_path).as_posix(),
            kind=_asset_kind(path),
            size_bytes=path.stat().st_size,
            sha256=sha256_file(path),
        )
        for path in sorted(staging_path.rglob("*"))
        if path.is_file()
        and path.name
        not in {MANIFEST_PATH, "conversion.json", "progress.json", SESSION_MARKER_PATH}
    ]
    manifest = CxlogManifest(
        media_type=CXLOG_MEDIA_TYPE,
        package_version=CXLOG_PACKAGE_VERSION,
        package_id=result.document_id,
        created_by=f"cx-well-log-processor/{ENGINE_VERSION}",
        source=result.source,
        assets=assets,
    )
    (staging_path / MANIFEST_PATH).write_text(
        manifest.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def write_package(staging_path: Path, destination_path: Path) -> Path:
    destination = _package_destination(destination_path)
    destination.parent.mkdir(parents=True, exist_ok=True)

    manifest_path = staging_path / MANIFEST_PATH
    if not manifest_path.is_file():
        raise CxlogError("The document staging area has not been finalized.")

    temporary_path = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
    try:
        with zipfile.ZipFile(
            temporary_path,
            mode="w",
            allowZip64=True,
        ) as archive:
            for path in sorted(staging_path.rglob("*")):
                if not path.is_file() or path.name in {
                    "conversion.json",
                    "progress.json",
                    SESSION_MARKER_PATH,
                }:
                    continue
                relative_path = path.relative_to(staging_path).as_posix()
                compression = (
                    zipfile.ZIP_DEFLATED
                    if path.suffix.casefold() in {".json", ".xml"}
                    else zipfile.ZIP_STORED
                )
                archive.write(path, relative_path, compress_type=compression)
        os.replace(temporary_path, destination)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    return destination


def refresh_staging_manifest(
    staging_path: Path,
    manifest: CxlogManifest,
) -> CxlogManifest:
    updated = _manifest_with_catalog(manifest, staging_path / CATALOG_PATH)
    (staging_path / MANIFEST_PATH).write_text(
        updated.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )
    return updated


def write_updated_package(
    source_path: Path,
    working_path: Path,
    manifest: CxlogManifest,
    destination_path: Path,
) -> tuple[Path, CxlogManifest]:
    source = source_path.expanduser().resolve()
    destination = _package_destination(destination_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    updated_manifest = _manifest_with_catalog(manifest, working_path / CATALOG_PATH)
    temporary_path = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
    try:
        with (
            zipfile.ZipFile(source, mode="r") as input_archive,
            zipfile.ZipFile(temporary_path, mode="w", allowZip64=True) as output_archive,
        ):
            members = _validated_members(input_archive)
            for asset in updated_manifest.assets:
                compression = (
                    zipfile.ZIP_DEFLATED
                    if Path(asset.path).suffix.casefold() in {".json", ".xml"}
                    else zipfile.ZIP_STORED
                )
                if asset.path == CATALOG_PATH:
                    output_archive.write(
                        working_path / CATALOG_PATH,
                        CATALOG_PATH,
                        compress_type=compression,
                    )
                    continue
                member = members.get(asset.path)
                if member is None:
                    raise CxlogError(f"The package is missing asset {asset.path}.")
                destination_info = zipfile.ZipInfo(asset.path)
                destination_info.compress_type = compression
                with input_archive.open(member, mode="r") as source_stream:
                    with output_archive.open(
                        destination_info,
                        mode="w",
                        force_zip64=True,
                    ) as destination_stream:
                        shutil.copyfileobj(
                            source_stream,
                            destination_stream,
                            length=1024 * 1024,
                        )
            output_archive.writestr(
                MANIFEST_PATH,
                updated_manifest.model_dump_json(indent=2) + "\n",
                compress_type=zipfile.ZIP_DEFLATED,
            )
        os.replace(temporary_path, destination)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    return destination, updated_manifest


def copy_package(source_path: Path, destination_path: Path) -> Path:
    source = source_path.expanduser().resolve()
    destination = _package_destination(destination_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
    try:
        with source.open("rb") as input_stream, temporary_path.open("wb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream, length=1024 * 1024)
        os.replace(temporary_path, destination)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    return destination


def _manifest_with_catalog(
    manifest: CxlogManifest,
    catalog_path: Path,
) -> CxlogManifest:
    updated_assets: list[PackageAsset] = []
    found_catalog = False
    for asset in manifest.assets:
        if asset.path != CATALOG_PATH:
            updated_assets.append(asset)
            continue
        found_catalog = True
        updated_assets.append(
            PackageAsset(
                path=CATALOG_PATH,
                kind="catalog",
                size_bytes=catalog_path.stat().st_size,
                sha256=sha256_file(catalog_path),
            )
        )
    if not found_catalog:
        raise CxlogError("The CX Log manifest does not declare catalog.duckdb.")
    return manifest.model_copy(update={"assets": updated_assets})


def open_package(package_path: Path, session_path: Path) -> tuple[CxlogManifest, Path]:
    source = package_path.expanduser().resolve()
    if not source.is_file() or source.suffix.casefold() != CXLOG_EXTENSION:
        raise CxlogError("The selected CX Log package does not exist.")

    session_path.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source, mode="r") as archive:
        members = _validated_members(archive)
        if MANIFEST_PATH not in members:
            raise CxlogError("The CX Log package is missing manifest.json.")
        try:
            manifest = CxlogManifest.model_validate_json(archive.read(MANIFEST_PATH))
        except Exception as error:
            raise CxlogError(f"The CX Log manifest is invalid: {error}") from error
        _validate_manifest(manifest, members)

        catalog_asset = next(
            (asset for asset in manifest.assets if asset.path == CATALOG_PATH),
            None,
        )
        if catalog_asset is None:
            raise CxlogError("The CX Log package does not declare catalog.duckdb.")
        catalog_path = _extract_member(archive, members[CATALOG_PATH], session_path)
        if sha256_file(catalog_path) != catalog_asset.sha256:
            raise CxlogError("The CX Log catalog checksum does not match its manifest.")

    return manifest, catalog_path


def extract_asset(package_path: Path, session_path: Path, asset: PackageAsset) -> Path:
    destination = session_path / Path(PurePosixPath(asset.path))
    if destination.is_file() and sha256_file(destination) == asset.sha256:
        return destination
    with zipfile.ZipFile(package_path, mode="r") as archive:
        members = _validated_members(archive)
        member = members.get(asset.path)
        if member is None:
            raise CxlogError(f"The package is missing asset {asset.path}.")
        destination = _extract_member(archive, member, session_path)
    if sha256_file(destination) != asset.sha256:
        destination.unlink(missing_ok=True)
        raise CxlogError(f"The checksum for {asset.path} does not match the manifest.")
    return destination


def verify_package(package_path: Path) -> PackageVerificationResponse:
    errors: list[str] = []
    package_version: str | None = None
    asset_count = 0
    try:
        with zipfile.ZipFile(package_path, mode="r") as archive:
            members = _validated_members(archive)
            manifest = CxlogManifest.model_validate_json(archive.read(MANIFEST_PATH))
            package_version = manifest.package_version
            _validate_manifest(manifest, members)
            asset_count = len(manifest.assets)
            for asset in manifest.assets:
                member = members[asset.path]
                digest = hashlib.sha256()
                size = 0
                with archive.open(member, mode="r") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        size += len(chunk)
                        digest.update(chunk)
                if size != asset.size_bytes:
                    errors.append(f"{asset.path}: size mismatch")
                if digest.hexdigest() != asset.sha256:
                    errors.append(f"{asset.path}: checksum mismatch")
    except Exception as error:
        errors.append(str(error))
    return PackageVerificationResponse(
        valid=not errors,
        package_version=package_version,
        asset_count=asset_count,
        errors=errors,
    )


def read_document_summary(
    catalog_path: Path,
    *,
    document_id: str,
    saved: bool,
    modified: bool = False,
) -> DocumentSummary:
    connection = duckdb.connect(str(catalog_path), read_only=True)
    try:
        source_row = connection.execute(
            """
            SELECT filename, source_format, source_version, field_name, file_size_bytes
            FROM sources LIMIT 1
            """
        ).fetchone()
        if source_row is None:
            raise CxlogError("The CX Log catalog does not contain a source record.")

        datasets: list[DocumentDatasetSummary] = []
        for dataset_row in connection.execute(
            """
            SELECT id, name, kind, well_name, wellbore_name, row_count,
                   index_mnemonic, index_unit, index_kind, index_minimum, index_maximum,
                   native_metadata_json
            FROM datasets ORDER BY position
            """
        ).fetchall():
            dataset_id = str(dataset_row[0])
            curves: list[DocumentCurveSummary] = []
            channel_rows = connection.execute(
                """
                SELECT id, mnemonic, unit, description, minimum, maximum,
                       sample_count, null_count, sample_shape_json, storage_kind
                FROM channels WHERE dataset_id = ? ORDER BY position
                """,
                [dataset_id],
            ).fetchall()
            for channel_row in channel_rows:
                channel_id = str(channel_row[0])
                preview_rows = connection.execute(
                    """
                    SELECT index_value, value FROM preview_samples
                    WHERE channel_id = ? ORDER BY ordinal
                    """,
                    [channel_id],
                ).fetchall()
                curves.append(
                    DocumentCurveSummary(
                        id=channel_id,
                        mnemonic=str(channel_row[1]),
                        unit=str(channel_row[2]),
                        description=str(channel_row[3]),
                        minimum=channel_row[4],
                        maximum=channel_row[5],
                        sample_count=int(channel_row[6]),
                        null_count=int(channel_row[7]),
                        sample_shape=json.loads(str(channel_row[8])),
                        storage_kind=StorageKind(str(channel_row[9])),
                        preview_samples=[
                            CurvePreviewSample(index=float(row[0]), value=row[1])
                            for row in preview_rows
                        ],
                    )
                )
            native_metadata = json.loads(str(dataset_row[11]))
            reference_value = native_metadata.get("time_index_reference", "none")
            try:
                time_index_reference = TimeIndexReference(str(reference_value))
            except ValueError:
                time_index_reference = TimeIndexReference.NONE
            view_settings = _read_view_settings(
                connection,
                dataset_id,
                time_index_reference,
            )
            scalar_curve_count = sum(
                curve.storage_kind == StorageKind.PARQUET and not curve.sample_shape
                for curve in curves
            )
            datasets.append(
                DocumentDatasetSummary(
                    id=dataset_id,
                    name=str(dataset_row[1]),
                    kind=str(dataset_row[2]),
                    well_name=str(dataset_row[3]),
                    wellbore_name=str(dataset_row[4]),
                    row_count=int(dataset_row[5]),
                    index_mnemonic=str(dataset_row[6]),
                    index_unit=str(dataset_row[7]),
                    index_kind=IndexKind(str(dataset_row[8])),
                    index_minimum=dataset_row[9],
                    index_maximum=dataset_row[10],
                    time_index_reference=time_index_reference,
                    view_settings=view_settings,
                    scalar_curve_count=scalar_curve_count,
                    curves=curves,
                )
            )
        warnings = [
            str(row[0])
            for row in connection.execute(
                "SELECT message FROM warnings ORDER BY ordinal"
            ).fetchall()
        ]
        count_row = connection.execute(
            "SELECT count(*) FROM preserved_objects"
        ).fetchone()
        if count_row is None:
            raise CxlogError("The CX Log catalog could not count preserved objects.")
        preserved_object_count = int(count_row[0])
        return DocumentSummary(
            id=document_id,
            source_file=str(source_row[0]),
            source_format=SourceFormat(str(source_row[1])),
            source_version=str(source_row[2]),
            field_name=str(source_row[3]),
            file_size_bytes=int(source_row[4]),
            scalar_curve_count=sum(dataset.scalar_curve_count for dataset in datasets),
            saved=saved,
            modified=modified,
            datasets=datasets,
            preserved_object_count=preserved_object_count,
            warnings=warnings,
        )
    finally:
        connection.close()


def remove_session_directory(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)


def _write_catalog(catalog_path: Path, result: ConversionResult) -> None:
    catalog_path.unlink(missing_ok=True)
    connection = duckdb.connect(str(catalog_path))
    try:
        connection.execute("BEGIN TRANSACTION")
        connection.execute("CREATE TABLE schema_info(package_version VARCHAR NOT NULL)")
        connection.execute("INSERT INTO schema_info VALUES (?)", [CXLOG_PACKAGE_VERSION])
        connection.execute(
            """
            CREATE TABLE sources(
                id VARCHAR PRIMARY KEY,
                filename VARCHAR NOT NULL,
                source_format VARCHAR NOT NULL,
                source_version VARCHAR NOT NULL,
                file_size_bytes BIGINT NOT NULL,
                sha256 VARCHAR NOT NULL,
                field_name VARCHAR NOT NULL
            )
            """
        )
        source = result.source
        connection.execute(
            "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                result.document_id,
                source.filename,
                source.source_format.value,
                source.source_version,
                source.file_size_bytes,
                source.sha256,
                source.field_name,
            ],
        )
        connection.execute(
            """
            CREATE TABLE datasets(
                id VARCHAR PRIMARY KEY,
                position INTEGER NOT NULL,
                name VARCHAR NOT NULL,
                kind VARCHAR NOT NULL,
                well_name VARCHAR NOT NULL,
                wellbore_name VARCHAR NOT NULL,
                row_count BIGINT NOT NULL,
                index_mnemonic VARCHAR NOT NULL,
                index_unit VARCHAR NOT NULL,
                index_kind VARCHAR NOT NULL,
                index_minimum DOUBLE,
                index_maximum DOUBLE,
                native_metadata_json VARCHAR NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE channels(
                id VARCHAR PRIMARY KEY,
                dataset_id VARCHAR NOT NULL,
                position INTEGER NOT NULL,
                mnemonic VARCHAR NOT NULL,
                unit VARCHAR NOT NULL,
                description VARCHAR NOT NULL,
                minimum DOUBLE,
                maximum DOUBLE,
                sample_count BIGINT NOT NULL,
                null_count BIGINT NOT NULL,
                sample_shape_json VARCHAR NOT NULL,
                storage_kind VARCHAR NOT NULL,
                asset_path VARCHAR,
                native_metadata_json VARCHAR NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE preview_samples(
                channel_id VARCHAR NOT NULL,
                ordinal INTEGER NOT NULL,
                index_value DOUBLE NOT NULL,
                value DOUBLE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE dataset_view_settings(
                dataset_id VARCHAR PRIMARY KEY,
                time_display_mode VARCHAR NOT NULL,
                time_zone VARCHAR NOT NULL,
                manual_anchor_index DOUBLE,
                manual_anchor_timestamp DOUBLE
            )
            """
        )
        for dataset_position, dataset in enumerate(result.datasets):
            preview_rows: list[tuple[str, int, float, float | None]] = []
            connection.execute(
                "INSERT INTO datasets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    dataset.id,
                    dataset_position,
                    dataset.name,
                    dataset.kind,
                    dataset.well_name,
                    dataset.wellbore_name,
                    dataset.row_count,
                    dataset.index_mnemonic,
                    dataset.index_unit,
                    dataset.index_kind.value,
                    dataset.index_minimum,
                    dataset.index_maximum,
                    json.dumps(dataset.native_metadata, default=str, sort_keys=True),
                ],
            )
            time_reference = str(
                dataset.native_metadata.get("time_index_reference", "none")
            )
            default_mode = (
                TimeDisplayMode.CLOCK.value
                if time_reference == TimeIndexReference.ABSOLUTE_UTC.value
                else TimeDisplayMode.ELAPSED.value
            )
            connection.execute(
                "INSERT INTO dataset_view_settings VALUES (?, ?, ?, NULL, NULL)",
                [dataset.id, default_mode, TimeZoneMode.UTC.value],
            )
            for channel in dataset.channels:
                connection.execute(
                    "INSERT INTO channels VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        channel.id,
                        dataset.id,
                        channel.position,
                        channel.mnemonic,
                        channel.unit,
                        channel.description,
                        channel.minimum,
                        channel.maximum,
                        channel.sample_count,
                        channel.null_count,
                        json.dumps(channel.sample_shape),
                        channel.storage_kind.value,
                        channel.asset_path,
                        json.dumps(channel.native_metadata, default=str, sort_keys=True),
                    ],
                )
                if channel.preview_samples:
                    preview_rows.extend(
                        (channel.id, ordinal, sample.index, sample.value)
                        for ordinal, sample in enumerate(channel.preview_samples)
                    )
            if preview_rows:
                preview_table = pa.table(
                    {
                        "channel_id": pa.array(
                            [row[0] for row in preview_rows], type=pa.string()
                        ),
                        "ordinal": pa.array(
                            [row[1] for row in preview_rows], type=pa.int32()
                        ),
                        "index_value": pa.array(
                            [row[2] for row in preview_rows], type=pa.float64()
                        ),
                        "value": pa.array(
                            [row[3] for row in preview_rows], type=pa.float64()
                        ),
                    }
                )
                connection.register("preview_batch", preview_table)
                connection.execute(
                    "INSERT INTO preview_samples SELECT * FROM preview_batch"
                )
                connection.unregister("preview_batch")
        connection.execute(
            """
            CREATE TABLE preserved_objects(
                id VARCHAR PRIMARY KEY,
                object_type VARCHAR NOT NULL,
                native_id VARCHAR NOT NULL,
                name VARCHAR NOT NULL,
                parent_native_id VARCHAR,
                metadata_path VARCHAR NOT NULL
            )
            """
        )
        if result.objects:
            connection.executemany(
                "INSERT INTO preserved_objects VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (
                        item.id,
                        item.object_type,
                        item.native_id,
                        item.name,
                        item.parent_native_id,
                        item.metadata_path,
                    )
                    for item in result.objects
                ],
            )
        connection.execute(
            """
            CREATE TABLE relationships(
                source_object_id VARCHAR NOT NULL,
                target_native_id VARCHAR NOT NULL,
                relationship_type VARCHAR NOT NULL
            )
            """
        )
        if result.relationships:
            connection.executemany(
                "INSERT INTO relationships VALUES (?, ?, ?)",
                result.relationships,
            )
        connection.execute(
            "CREATE TABLE warnings(ordinal INTEGER NOT NULL, message VARCHAR NOT NULL)"
        )
        if result.warnings:
            connection.executemany(
                "INSERT INTO warnings VALUES (?, ?)",
                list(enumerate(result.warnings)),
            )
        connection.execute("COMMIT")
        connection.execute("CHECKPOINT")
    finally:
        connection.close()


def _read_view_settings(
    connection: duckdb.DuckDBPyConnection,
    dataset_id: str,
    time_index_reference: TimeIndexReference,
) -> DatasetViewSettings:
    table_exists = connection.execute(
        """
        SELECT count(*) FROM information_schema.tables
        WHERE table_name = 'dataset_view_settings'
        """
    ).fetchone()
    row = None
    if table_exists is not None and int(table_exists[0]) > 0:
        row = connection.execute(
            """
            SELECT time_display_mode, time_zone, manual_anchor_index,
                   manual_anchor_timestamp
            FROM dataset_view_settings WHERE dataset_id = ?
            """,
            [dataset_id],
        ).fetchone()
    if row is None:
        default_mode = (
            TimeDisplayMode.CLOCK
            if time_index_reference == TimeIndexReference.ABSOLUTE_UTC
            else TimeDisplayMode.ELAPSED
        )
        return DatasetViewSettings(time_display_mode=default_mode)
    return DatasetViewSettings(
        time_display_mode=TimeDisplayMode(str(row[0])),
        time_zone=TimeZoneMode(str(row[1])),
        manual_anchor_index=row[2],
        manual_anchor_timestamp=row[3],
    )


def _asset_kind(path: Path) -> str:
    suffix = path.suffix.casefold()
    if suffix == ".parquet":
        return "scalar"
    if any(part.casefold().endswith(".zarr") for part in path.parts):
        return "array"
    if path.name == CATALOG_PATH:
        return "catalog"
    return "metadata"


def _package_destination(destination_path: Path) -> Path:
    destination = destination_path.expanduser().resolve()
    if destination.suffix.casefold() != CXLOG_EXTENSION:
        destination = destination.with_suffix(CXLOG_EXTENSION)
    return destination


def _validated_members(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    members: dict[str, zipfile.ZipInfo] = {}
    for member in archive.infolist():
        name = member.filename
        path = PurePosixPath(name)
        if (
            not name
            or "\\" in name
            or path.is_absolute()
            or ".." in path.parts
            or member.is_dir()
            or name in members
        ):
            raise CxlogError(f"Unsafe or duplicate archive member: {name!r}")
        file_type = (member.external_attr >> 16) & 0o170000
        if file_type == 0o120000:
            raise CxlogError(f"Symbolic links are not allowed in CX Log packages: {name}")
        members[name] = member
    return members


def _validate_manifest(
    manifest: CxlogManifest,
    members: dict[str, zipfile.ZipInfo],
) -> None:
    if manifest.media_type != CXLOG_MEDIA_TYPE:
        raise CxlogError("The selected archive is not a CX Log package.")
    if manifest.package_version != CXLOG_PACKAGE_VERSION:
        raise CxlogError(
            f"CX Log package version {manifest.package_version} is not supported."
        )
    declared = {asset.path for asset in manifest.assets}
    if len(declared) != len(manifest.assets):
        raise CxlogError("The CX Log manifest contains duplicate asset paths.")
    missing = declared.difference(members)
    if missing:
        raise CxlogError(f"The CX Log package is missing assets: {sorted(missing)}")
    extras = set(members).difference(declared | {MANIFEST_PATH})
    if extras:
        raise CxlogError(f"The CX Log package contains undeclared assets: {sorted(extras)}")


def _extract_member(
    archive: zipfile.ZipFile,
    member: zipfile.ZipInfo,
    destination_root: Path,
) -> Path:
    relative = Path(PurePosixPath(member.filename))
    destination = destination_root / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    with archive.open(member, mode="r") as source, destination.open("wb") as target:
        shutil.copyfileobj(source, target, length=1024 * 1024)
    return destination
