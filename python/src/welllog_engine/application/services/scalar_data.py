import csv
import math
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import duckdb  # type: ignore[import-untyped]
import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.ipc as ipc  # type: ignore[import-untyped]

from welllog_engine.application.services.documents import (
    DocumentError,
    DocumentService,
    document_service,
)
from welllog_engine.contracts.documents import (
    CursorCurveValue,
    CursorValueResponse,
    ScalarPreviewPageRequest,
    ScalarVisibleRangeRequest,
)

ARROW_STREAM_MEDIA_TYPE = "application/vnd.apache.arrow.stream"


class ExportCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class ScalarChannel:
    id: str
    mnemonic: str
    parquet_column: str
    asset_path: str


@dataclass(frozen=True)
class ScalarDataset:
    index_mnemonic: str
    channels: tuple[ScalarChannel, ...]


@dataclass(frozen=True)
class LodSample:
    ordinal: int
    index: float
    value: float | None


@dataclass
class LodBucket:
    first: LodSample | None = None
    last: LodSample | None = None
    minimum: LodSample | None = None
    maximum: LodSample | None = None
    null_sample: LodSample | None = None

    def add(self, sample: LodSample) -> None:
        if self.first is None:
            self.first = sample
        self.last = sample
        if sample.value is None:
            if self.null_sample is None:
                self.null_sample = sample
            return
        if self.minimum is None or sample.value < self.minimum.value:  # type: ignore[operator]
            self.minimum = sample
        if self.maximum is None or sample.value > self.maximum.value:  # type: ignore[operator]
            self.maximum = sample

    def samples(self) -> list[LodSample]:
        unique: dict[int, LodSample] = {}
        for sample in (
            self.first,
            self.minimum,
            self.maximum,
            self.null_sample,
            self.last,
        ):
            if sample is not None:
                unique[sample.ordinal] = sample
        return sorted(unique.values(), key=lambda sample: sample.ordinal)


class ScalarDataService:
    def __init__(self, documents: DocumentService) -> None:
        self._documents = documents

    def visible_range_arrow(
        self,
        document_id: str,
        dataset_id: str,
        request: ScalarVisibleRangeRequest,
    ) -> bytes:
        dataset = self._resolve_dataset(
            document_id,
            dataset_id,
            request.curve_ids,
        )
        asset_path = self._single_asset(document_id, dataset.channels)
        minimum = min(request.index_minimum, request.index_maximum)
        maximum = max(request.index_minimum, request.index_maximum)
        effective_budget = min(request.point_budget, max(100, request.viewport_height * 2))
        buckets_per_curve = max(1, effective_budget // len(dataset.channels) // 5)
        curve_buckets = [
            [LodBucket() for _ in range(buckets_per_curve)] for _ in dataset.channels
        ]

        connection = duckdb.connect()
        try:
            selected_columns = ", ".join(
                _quote_identifier(channel.parquet_column) for channel in dataset.channels
            )
            query = f"""
                SELECT row_number() OVER () AS source_ordinal, index, {selected_columns}
                FROM read_parquet(?)
                WHERE index BETWEEN ? AND ?
            """
            connection.execute(
                query,
                [str(asset_path), minimum, maximum],
            )
            reader = connection.to_arrow_reader(batch_size=65_536)
            span = maximum - minimum
            for batch in reader:
                columns = batch.to_pydict()
                for row_position, raw_index in enumerate(columns["index"]):
                    if raw_index is None or not math.isfinite(float(raw_index)):
                        continue
                    index = float(raw_index)
                    bucket_position = (
                        0
                        if span <= 0
                        else min(
                            buckets_per_curve - 1,
                            max(
                                0,
                                int((index - minimum) / span * buckets_per_curve),
                            ),
                        )
                    )
                    ordinal = int(columns["source_ordinal"][row_position])
                    for curve_position, channel in enumerate(dataset.channels):
                        raw_value = columns[channel.parquet_column][row_position]
                        value = _finite_value(raw_value)
                        curve_buckets[curve_position][bucket_position].add(
                            LodSample(ordinal=ordinal, index=index, value=value)
                        )
        finally:
            connection.close()

        curve_ids: list[str] = []
        indexes: list[float] = []
        values: list[float | None] = []
        for channel, buckets in zip(dataset.channels, curve_buckets, strict=True):
            samples = sorted(
                (sample for bucket in buckets for sample in bucket.samples()),
                key=lambda sample: sample.ordinal,
            )
            for sample in samples:
                curve_ids.append(channel.id)
                indexes.append(sample.index)
                values.append(sample.value)
        return _arrow_stream(
            pa.table(
                {
                    "curve_id": pa.array(curve_ids, type=pa.string()),
                    "index": pa.array(indexes, type=pa.float64()),
                    "value": pa.array(values, type=pa.float64()),
                }
            )
        )

    def preview_page_arrow(
        self,
        document_id: str,
        dataset_id: str,
        request: ScalarPreviewPageRequest,
    ) -> bytes:
        dataset = self._resolve_dataset(
            document_id,
            dataset_id,
            request.curve_ids or None,
            default_limit=16,
        )
        asset_path = self._single_asset(document_id, dataset.channels)
        selections = [f'{_quote_identifier("index")} AS {_quote_identifier("__index")}']
        selections.extend(
            f"{_quote_identifier(channel.parquet_column)} AS {_quote_identifier(channel.id)}"
            for channel in dataset.channels
        )
        connection = duckdb.connect()
        try:
            connection.execute(
                f"SELECT {', '.join(selections)} FROM read_parquet(?) LIMIT ? OFFSET ?",
                [str(asset_path), request.page_size, request.page * request.page_size],
            )
            table = connection.to_arrow_table()
        finally:
            connection.close()
        return _arrow_stream(table)

    def cursor_values(
        self,
        document_id: str,
        dataset_id: str,
        curve_ids: list[str],
        index: float,
    ) -> CursorValueResponse:
        dataset = self._resolve_dataset(document_id, dataset_id, curve_ids)
        asset_path = self._single_asset(document_id, dataset.channels)
        selected_columns = ", ".join(
            _quote_identifier(channel.parquet_column) for channel in dataset.channels
        )
        connection = duckdb.connect()
        try:
            rows = connection.execute(
                f"""
                SELECT index, {selected_columns}
                FROM read_parquet(?)
                WHERE index IS NOT NULL
                ORDER BY abs(index - ?)
                LIMIT 32
                """,
                [str(asset_path), index],
            ).fetchall()
        finally:
            connection.close()

        values = []
        for position, channel in enumerate(dataset.channels, start=1):
            samples = [
                (float(row[0]), value)
                for row in rows
                if (value := _finite_value(row[position])) is not None
            ]
            values.append(_cursor_value(channel.id, index, samples))
        return CursorValueResponse(requested_index=index, values=values)

    def export_csv(
        self,
        document_id: str,
        dataset_id: str,
        destination_path: Path,
        *,
        curve_ids: list[str] | None,
        cancel_requested: Callable[[], bool],
    ) -> Path:
        dataset = self._resolve_dataset(
            document_id,
            dataset_id,
            curve_ids,
        )
        asset_path = self._single_asset(document_id, dataset.channels)
        destination = destination_path.expanduser().resolve()
        if destination.suffix.casefold() != ".csv":
            destination = destination.with_suffix(".csv")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
        headers = _unique_headers(
            [dataset.index_mnemonic, *[channel.mnemonic for channel in dataset.channels]]
        )
        connection = duckdb.connect()
        try:
            selected_columns = ", ".join(
                [_quote_identifier("index")]
                + [
                    _quote_identifier(channel.parquet_column)
                    for channel in dataset.channels
                ]
            )
            connection.execute(
                f"SELECT {selected_columns} FROM read_parquet(?)",
                [str(asset_path)],
            )
            reader = connection.to_arrow_reader(batch_size=65_536)
            with temporary.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(headers)
                for batch in reader:
                    if cancel_requested():
                        raise ExportCancelled("CSV export was cancelled.")
                    columns = batch.to_pydict()
                    for row_position in range(batch.num_rows):
                        writer.writerow(
                            [
                                "" if value is None else value
                                for value in (
                                    columns[name][row_position]
                                    for name in batch.schema.names
                                )
                            ]
                        )
            if cancel_requested():
                raise ExportCancelled("CSV export was cancelled.")
            os.replace(temporary, destination)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        finally:
            connection.close()
        return destination

    def _resolve_dataset(
        self,
        document_id: str,
        dataset_id: str,
        curve_ids: list[str] | None,
        *,
        default_limit: int | None = None,
    ) -> ScalarDataset:
        connection = duckdb.connect(
            str(self._documents.catalog_path(document_id)),
            read_only=True,
        )
        try:
            dataset_row = connection.execute(
                "SELECT index_mnemonic FROM datasets WHERE id = ?",
                [dataset_id],
            ).fetchone()
            if dataset_row is None:
                raise DocumentError(f"Dataset {dataset_id} was not found.")
            rows = connection.execute(
                """
                SELECT id, mnemonic, asset_path, native_metadata_json
                FROM channels
                WHERE dataset_id = ? AND storage_kind = 'parquet'
                ORDER BY position
                """,
                [dataset_id],
            ).fetchall()
        finally:
            connection.close()

        available: list[ScalarChannel] = []
        for row in rows:
            metadata = _metadata_dict(row[3])
            column = metadata.get("parquet_column")
            data_type = metadata.get("data_type", "numeric")
            if not isinstance(column, str) or not row[2] or data_type != "numeric":
                continue
            available.append(
                ScalarChannel(
                    id=str(row[0]),
                    mnemonic=str(row[1]),
                    asset_path=str(row[2]),
                    parquet_column=column,
                )
            )
        if curve_ids is None:
            selected = available[:default_limit] if default_limit is not None else available
        else:
            by_id = {channel.id: channel for channel in available}
            missing = [curve_id for curve_id in curve_ids if curve_id not in by_id]
            if missing:
                raise DocumentError(f"Scalar curves were not found: {', '.join(missing)}")
            selected = [by_id[curve_id] for curve_id in curve_ids]
        if not selected:
            raise DocumentError("The dataset does not contain selected scalar curves.")
        return ScalarDataset(index_mnemonic=str(dataset_row[0]), channels=tuple(selected))

    def _single_asset(
        self,
        document_id: str,
        channels: tuple[ScalarChannel, ...],
    ) -> Path:
        asset_paths = {channel.asset_path for channel in channels}
        if len(asset_paths) != 1:
            raise DocumentError("Selected curves do not share one scalar dataset asset.")
        return self._documents.resolve_asset(document_id, asset_paths.pop())


def _metadata_dict(value: object) -> dict[str, object]:
    import json

    parsed = json.loads(str(value))
    return parsed if isinstance(parsed, dict) else {}


def _finite_value(value: object) -> float | None:
    if value is None:
        return None
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _cursor_value(
    curve_id: str,
    requested_index: float,
    samples: list[tuple[float, float]],
) -> CursorCurveValue:
    if not samples:
        return CursorCurveValue(
            curve_id=curve_id,
            value=None,
            sample_index=None,
            status="no_data",
        )
    tolerance = max(1e-9, abs(requested_index) * 1e-12)
    exact = next(
        (sample for sample in samples if abs(sample[0] - requested_index) <= tolerance),
        None,
    )
    if exact is not None:
        return CursorCurveValue(
            curve_id=curve_id,
            value=exact[1],
            sample_index=exact[0],
            status="exact",
        )
    below = max((sample for sample in samples if sample[0] < requested_index), default=None)
    above = min((sample for sample in samples if sample[0] > requested_index), default=None)
    if below is not None and above is not None and above[0] != below[0]:
        fraction = (requested_index - below[0]) / (above[0] - below[0])
        return CursorCurveValue(
            curve_id=curve_id,
            value=below[1] + fraction * (above[1] - below[1]),
            sample_index=requested_index,
            status="interpolated",
        )
    nearest = min(samples, key=lambda sample: abs(sample[0] - requested_index))
    return CursorCurveValue(
        curve_id=curve_id,
        value=nearest[1],
        sample_index=nearest[0],
        status="nearest",
    )


def _unique_headers(headers: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    result: list[str] = []
    for header in headers:
        count = counts.get(header, 0) + 1
        counts[header] = count
        result.append(header if count == 1 else f"{header}_{count}")
    return result


def _quote_identifier(value: str) -> str:
    return f'"{value.replace(chr(34), chr(34) * 2)}"'


def _arrow_stream(table: pa.Table) -> bytes:
    sink = pa.BufferOutputStream()
    with ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue().to_pybytes()


scalar_data_service = ScalarDataService(document_service)
