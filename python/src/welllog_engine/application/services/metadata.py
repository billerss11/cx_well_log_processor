import json
from pathlib import Path

import duckdb  # type: ignore[import-untyped]

from welllog_engine.application.services.documents import (
    DocumentError,
    DocumentService,
    document_service,
)
from welllog_engine.contracts.documents import (
    MetadataObjectDetail,
    MetadataObjectPage,
    MetadataObjectSummary,
)

MAX_METADATA_DETAIL_BYTES = 256 * 1024


class MetadataService:
    def __init__(self, documents: DocumentService) -> None:
        self._documents = documents

    def list_objects(
        self,
        document_id: str,
        *,
        page: int,
        page_size: int,
        search: str | None,
    ) -> MetadataObjectPage:
        catalog_path = self._documents.catalog_path(document_id)
        connection = duckdb.connect(str(catalog_path), read_only=True)
        try:
            where = ""
            parameters: list[object] = []
            if search:
                where = "WHERE name ILIKE ? OR object_type ILIKE ? OR native_id ILIKE ?"
                term = f"%{search}%"
                parameters.extend([term, term, term])
            total_row = connection.execute(
                f"SELECT count(*) FROM preserved_objects {where}",
                parameters,
            ).fetchone()
            rows = connection.execute(
                f"""
                SELECT id, object_type, native_id, name, parent_native_id
                FROM preserved_objects {where}
                ORDER BY object_type, name, id
                LIMIT ? OFFSET ?
                """,
                [*parameters, page_size, page * page_size],
            ).fetchall()
        finally:
            connection.close()
        return MetadataObjectPage(
            page=page,
            page_size=page_size,
            total=int(total_row[0]) if total_row is not None else 0,
            items=[
                MetadataObjectSummary(
                    id=str(row[0]),
                    object_type=str(row[1]),
                    native_id=str(row[2]),
                    name=str(row[3]),
                    parent_native_id=str(row[4]) if row[4] is not None else None,
                )
                for row in rows
            ],
        )

    def get_object(self, document_id: str, object_id: str) -> MetadataObjectDetail:
        connection = duckdb.connect(
            str(self._documents.catalog_path(document_id)),
            read_only=True,
        )
        try:
            row = connection.execute(
                """
                SELECT id, object_type, native_id, name, parent_native_id, metadata_path
                FROM preserved_objects WHERE id = ?
                """,
                [object_id],
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise DocumentError(f"Metadata object {object_id} was not found.")
        metadata_path = str(row[5])
        path = self._documents.resolve_asset(document_id, metadata_path)
        size_bytes = path.stat().st_size
        content = _read_bounded(path, MAX_METADATA_DETAIL_BYTES)
        truncated = size_bytes > len(content)
        suffix = path.suffix.casefold()
        content_json: dict[str, object] | list[object] | None = None
        text: str | None = None
        content_type = "text/plain"
        if suffix == ".json" and not truncated:
            parsed = json.loads(content.decode("utf-8"))
            if isinstance(parsed, (dict, list)):
                content_json = parsed
                content_type = "application/json"
            else:
                text = str(parsed)
        else:
            text = content.decode("utf-8", errors="replace")
            if suffix == ".xml":
                content_type = "application/xml"
        return MetadataObjectDetail(
            id=str(row[0]),
            object_type=str(row[1]),
            native_id=str(row[2]),
            name=str(row[3]),
            parent_native_id=str(row[4]) if row[4] is not None else None,
            metadata_path=metadata_path,
            content_type=content_type,
            content_json=content_json,
            text=text,
            size_bytes=size_bytes,
            truncated=truncated,
        )


def _read_bounded(path: Path, maximum_bytes: int) -> bytes:
    with path.open("rb") as stream:
        return stream.read(maximum_bytes)


metadata_service = MetadataService(document_service)
