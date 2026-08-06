import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb  # type: ignore[import-untyped]

from welllog_engine.application.services.documents import (
    DocumentError,
    DocumentService,
    document_service,
)
from welllog_engine.contracts.documents import DocumentCurveSummary, StorageKind
from welllog_engine.contracts.qc import (
    QcIssue,
    QcReport,
    QcScope,
    QcSeverity,
    QcSummary,
)

EXCESSIVE_NULL_RATIO = 0.2
IRREGULAR_STEP_TOLERANCE = 0.1
LARGE_GAP_FACTOR = 10.0
CURVE_CHECKS_PER_CURVE = 4
INDEX_CHECK_COUNT = 6


@dataclass(frozen=True)
class QcChannel:
    id: str
    mnemonic: str
    asset_path: str
    parquet_column: str


@dataclass(frozen=True)
class IndexProfile:
    invalid_count: int
    duplicate_count: int
    positive_count: int
    negative_count: int
    typical_step: float | None
    irregular_count: int
    large_gap_count: int
    duplicate_interval: tuple[float, float] | None
    positive_interval: tuple[float, float] | None
    negative_interval: tuple[float, float] | None
    irregular_interval: tuple[float, float] | None
    large_gap_interval: tuple[float, float] | None


class QualityControlService:
    def __init__(self, documents: DocumentService) -> None:
        self._documents = documents

    def run_dataset(self, document_id: str, dataset_id: str) -> QcReport:
        document = self._documents.get_document(document_id)
        dataset = next(
            (item for item in document.datasets if item.id == dataset_id),
            None,
        )
        if dataset is None:
            raise DocumentError(f"Dataset {dataset_id} was not found.")

        scalar_curves = [
            curve
            for curve in dataset.curves
            if curve.storage_kind == StorageKind.PARQUET and not curve.sample_shape
        ]
        if not scalar_curves:
            raise DocumentError("The dataset does not contain scalar curves.")

        issues: list[QcIssue] = []
        mnemonic_counts = Counter(curve.mnemonic.casefold() for curve in scalar_curves)
        for curve in scalar_curves:
            issues.extend(self._curve_catalog_issues(curve, mnemonic_counts))

        channels = self._load_channels(document_id, dataset_id)
        issues.extend(self._invalid_numeric_issues(document_id, channels))
        issues.extend(self._index_issues(document_id, channels))
        issues.sort(key=_issue_sort_key)

        counts = Counter(issue.severity for issue in issues)
        return QcReport(
            document_id=document_id,
            dataset_id=dataset_id,
            summary=QcSummary(
                checks_run=(len(scalar_curves) * CURVE_CHECKS_PER_CURVE)
                + INDEX_CHECK_COUNT,
                issue_count=len(issues),
                error_count=counts[QcSeverity.ERROR],
                warning_count=counts[QcSeverity.WARNING],
                info_count=counts[QcSeverity.INFO],
            ),
            issues=issues,
        )

    def _curve_catalog_issues(
        self,
        curve: DocumentCurveSummary,
        mnemonic_counts: Counter[str],
    ) -> list[QcIssue]:
        curve_id = curve.id
        mnemonic = curve.mnemonic
        unit = curve.unit
        sample_count = curve.sample_count
        null_count = curve.null_count
        minimum = curve.minimum
        maximum = curve.maximum
        issues: list[QcIssue] = []

        if not unit.strip():
            issues.append(
                QcIssue(
                    code="CURVE_UNIT_MISSING",
                    severity=QcSeverity.WARNING,
                    scope=QcScope.CURVE,
                    curve_id=curve_id,
                    curve_mnemonic=mnemonic,
                    message=f"{mnemonic} does not define a unit.",
                    evidence={"unit": unit},
                )
            )

        null_ratio = null_count / sample_count if sample_count else 0.0
        if sample_count and null_ratio >= EXCESSIVE_NULL_RATIO:
            issues.append(
                QcIssue(
                    code="CURVE_EXCESSIVE_NULLS",
                    severity=QcSeverity.WARNING,
                    scope=QcScope.CURVE,
                    curve_id=curve_id,
                    curve_mnemonic=mnemonic,
                    message=f"{mnemonic} contains {null_ratio:.1%} null samples.",
                    evidence={
                        "null_count": null_count,
                        "sample_count": sample_count,
                        "null_ratio": round(null_ratio, 6),
                    },
                )
            )

        non_null_count = sample_count - null_count
        if (
            non_null_count > 1
            and minimum is not None
            and maximum is not None
            and math.isclose(float(minimum), float(maximum), rel_tol=0.0, abs_tol=1e-12)
        ):
            issues.append(
                QcIssue(
                    code="CURVE_CONSTANT",
                    severity=QcSeverity.WARNING,
                    scope=QcScope.CURVE,
                    curve_id=curve_id,
                    curve_mnemonic=mnemonic,
                    message=f"{mnemonic} is constant across all non-null samples.",
                    evidence={"value": float(minimum), "non_null_count": non_null_count},
                )
            )

        duplicate_count = mnemonic_counts[mnemonic.casefold()]
        if duplicate_count > 1:
            issues.append(
                QcIssue(
                    code="CURVE_DUPLICATE_MNEMONIC",
                    severity=QcSeverity.WARNING,
                    scope=QcScope.CURVE,
                    curve_id=curve_id,
                    curve_mnemonic=mnemonic,
                    message=f"{mnemonic} is used by {duplicate_count} curves in this dataset.",
                    evidence={"duplicate_count": duplicate_count},
                )
            )
        return issues

    def _load_channels(self, document_id: str, dataset_id: str) -> list[QcChannel]:
        connection = duckdb.connect(
            str(self._documents.catalog_path(document_id)),
            read_only=True,
        )
        try:
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

        channels: list[QcChannel] = []
        for channel_id, mnemonic, asset_path, metadata_json in rows:
            metadata = _metadata_dict(metadata_json)
            parquet_column = metadata.get("parquet_column")
            if not asset_path or not isinstance(parquet_column, str):
                continue
            channels.append(
                QcChannel(
                    id=str(channel_id),
                    mnemonic=str(mnemonic),
                    asset_path=str(asset_path),
                    parquet_column=parquet_column,
                )
            )
        if not channels:
            raise DocumentError("The dataset does not contain readable scalar curves.")
        return channels

    def _invalid_numeric_issues(
        self,
        document_id: str,
        channels: list[QcChannel],
    ) -> list[QcIssue]:
        issues: list[QcIssue] = []
        by_asset: dict[str, list[QcChannel]] = {}
        for channel in channels:
            by_asset.setdefault(channel.asset_path, []).append(channel)

        for asset_name, asset_channels in by_asset.items():
            asset_path = self._documents.resolve_asset(document_id, asset_name)
            expressions = [
                (
                    "count(*) FILTER (WHERE "
                    f"{_quote_identifier(channel.parquet_column)} IS NOT NULL AND "
                    f"NOT isfinite({_quote_identifier(channel.parquet_column)}))"
                )
                for channel in asset_channels
            ]
            connection = duckdb.connect()
            try:
                counts = connection.execute(
                    f"SELECT {', '.join(expressions)} FROM read_parquet(?)",
                    [str(asset_path)],
                ).fetchone()
            finally:
                connection.close()
            if counts is None:
                continue
            for channel, count in zip(asset_channels, counts, strict=True):
                invalid_count = int(count)
                if invalid_count:
                    issues.append(
                        QcIssue(
                            code="CURVE_INVALID_NUMERIC",
                            severity=QcSeverity.ERROR,
                            scope=QcScope.CURVE,
                            curve_id=channel.id,
                            curve_mnemonic=channel.mnemonic,
                            message=(
                                f"{channel.mnemonic} contains {invalid_count} non-finite values."
                            ),
                            evidence={"invalid_count": invalid_count},
                        )
                    )
        return issues

    def _index_issues(
        self,
        document_id: str,
        channels: list[QcChannel],
    ) -> list[QcIssue]:
        asset_path = self._documents.resolve_asset(document_id, channels[0].asset_path)
        profile = _read_index_profile(asset_path)
        issues: list[QcIssue] = []

        if profile.invalid_count:
            issues.append(
                _index_issue(
                    "INDEX_INVALID",
                    QcSeverity.ERROR,
                    f"The canonical index contains {profile.invalid_count} invalid samples.",
                    {"invalid_count": profile.invalid_count},
                    None,
                )
            )
        if profile.duplicate_count:
            issues.append(
                _index_issue(
                    "INDEX_DUPLICATE",
                    QcSeverity.ERROR,
                    f"The canonical index contains {profile.duplicate_count} duplicate steps.",
                    {"duplicate_count": profile.duplicate_count},
                    profile.duplicate_interval,
                )
            )

        dominant_positive = profile.positive_count >= profile.negative_count
        non_monotonic_count = (
            profile.negative_count if dominant_positive else profile.positive_count
        )
        if profile.positive_count and profile.negative_count:
            interval = (
                profile.negative_interval if dominant_positive else profile.positive_interval
            )
            issues.append(
                _index_issue(
                    "INDEX_NON_MONOTONIC",
                    QcSeverity.ERROR,
                    f"The canonical index reverses direction {non_monotonic_count} times.",
                    {"reversal_count": non_monotonic_count},
                    interval,
                )
            )
        elif profile.negative_count and not profile.positive_count:
            issues.append(
                _index_issue(
                    "INDEX_REVERSED",
                    QcSeverity.INFO,
                    "The canonical index is stored in descending order.",
                    {"descending_step_count": profile.negative_count},
                    profile.negative_interval,
                )
            )

        if profile.irregular_count:
            issues.append(
                _index_issue(
                    "INDEX_IRREGULAR_STEP",
                    QcSeverity.WARNING,
                    f"The canonical index contains {profile.irregular_count} irregular steps.",
                    {
                        "irregular_step_count": profile.irregular_count,
                        "typical_step": profile.typical_step,
                    },
                    profile.irregular_interval,
                )
            )
        if profile.large_gap_count:
            issues.append(
                _index_issue(
                    "INDEX_LARGE_GAP",
                    QcSeverity.WARNING,
                    f"The canonical index contains {profile.large_gap_count} large gaps.",
                    {
                        "large_gap_count": profile.large_gap_count,
                        "typical_step": profile.typical_step,
                    },
                    profile.large_gap_interval,
                )
            )
        return issues


def _read_index_profile(asset_path: Path) -> IndexProfile:
    connection = duckdb.connect()
    try:
        row = connection.execute(
            """
            WITH numbered AS (
                SELECT row_number() OVER () AS ordinal, index
                FROM read_parquet(?)
            ),
            deltas AS (
                SELECT ordinal, index,
                       lag(index) OVER (ORDER BY ordinal) AS previous_index,
                       index - lag(index) OVER (ORDER BY ordinal) AS delta
                FROM numbered
            ),
            stats AS (
                SELECT median(abs(delta)) FILTER (
                    WHERE delta IS NOT NULL AND delta != 0 AND isfinite(delta)
                ) AS typical_step
                FROM deltas
            )
            SELECT
                count(*) FILTER (WHERE index IS NULL OR NOT isfinite(index)),
                count(*) FILTER (WHERE delta = 0),
                count(*) FILTER (WHERE delta > 0),
                count(*) FILTER (WHERE delta < 0),
                max(typical_step),
                count(*) FILTER (
                    WHERE typical_step > 0
                      AND delta != 0
                      AND abs(abs(delta) - typical_step) > typical_step * ?
                      AND abs(delta) <= typical_step * ?
                ),
                count(*) FILTER (
                    WHERE typical_step > 0 AND abs(delta) > typical_step * ?
                ),
                first(previous_index ORDER BY ordinal) FILTER (WHERE delta = 0),
                first(index ORDER BY ordinal) FILTER (WHERE delta = 0),
                first(previous_index ORDER BY ordinal) FILTER (WHERE delta > 0),
                first(index ORDER BY ordinal) FILTER (WHERE delta > 0),
                first(previous_index ORDER BY ordinal) FILTER (WHERE delta < 0),
                first(index ORDER BY ordinal) FILTER (WHERE delta < 0),
                first(previous_index ORDER BY ordinal) FILTER (
                    WHERE typical_step > 0
                      AND delta != 0
                      AND abs(abs(delta) - typical_step) > typical_step * ?
                      AND abs(delta) <= typical_step * ?
                ),
                first(index ORDER BY ordinal) FILTER (
                    WHERE typical_step > 0
                      AND delta != 0
                      AND abs(abs(delta) - typical_step) > typical_step * ?
                      AND abs(delta) <= typical_step * ?
                ),
                first(previous_index ORDER BY ordinal) FILTER (
                    WHERE typical_step > 0 AND abs(delta) > typical_step * ?
                ),
                first(index ORDER BY ordinal) FILTER (
                    WHERE typical_step > 0 AND abs(delta) > typical_step * ?
                )
            FROM deltas CROSS JOIN stats
            """,
            [
                str(asset_path),
                IRREGULAR_STEP_TOLERANCE,
                LARGE_GAP_FACTOR,
                LARGE_GAP_FACTOR,
                IRREGULAR_STEP_TOLERANCE,
                LARGE_GAP_FACTOR,
                IRREGULAR_STEP_TOLERANCE,
                LARGE_GAP_FACTOR,
                LARGE_GAP_FACTOR,
                LARGE_GAP_FACTOR,
            ],
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        return IndexProfile(0, 0, 0, 0, None, 0, 0, None, None, None, None, None)
    return IndexProfile(
        invalid_count=int(row[0]),
        duplicate_count=int(row[1]),
        positive_count=int(row[2]),
        negative_count=int(row[3]),
        typical_step=float(row[4]) if row[4] is not None else None,
        irregular_count=int(row[5]),
        large_gap_count=int(row[6]),
        duplicate_interval=_interval(row[7], row[8]),
        positive_interval=_interval(row[9], row[10]),
        negative_interval=_interval(row[11], row[12]),
        irregular_interval=_interval(row[13], row[14]),
        large_gap_interval=_interval(row[15], row[16]),
    )


def _index_issue(
    code: str,
    severity: QcSeverity,
    message: str,
    evidence: dict[str, bool | float | int | str | None],
    interval: tuple[float, float] | None,
) -> QcIssue:
    return QcIssue(
        code=code,
        severity=severity,
        scope=QcScope.DATASET,
        message=message,
        evidence=evidence,
        index_minimum=min(interval) if interval else None,
        index_maximum=max(interval) if interval else None,
    )


def _interval(previous: Any, current: Any) -> tuple[float, float] | None:
    if previous is None or current is None:
        return None
    return float(previous), float(current)


def _issue_sort_key(issue: QcIssue) -> tuple[int, str, str]:
    severity_order = {
        QcSeverity.ERROR: 0,
        QcSeverity.WARNING: 1,
        QcSeverity.INFO: 2,
    }
    return severity_order[issue.severity], issue.curve_mnemonic or "", issue.code


def _metadata_dict(value: object) -> dict[str, object]:
    import json

    parsed = json.loads(str(value))
    return parsed if isinstance(parsed, dict) else {}


def _quote_identifier(value: str) -> str:
    return f'"{value.replace(chr(34), chr(34) * 2)}"'


quality_control_service = QualityControlService(document_service)
