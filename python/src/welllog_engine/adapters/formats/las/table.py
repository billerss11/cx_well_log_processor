from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import numpy as np
from numpy.typing import NDArray

from welllog_engine.adapters.formats.las.errors import LasImportError, LasIndexSelectionRequired
from welllog_engine.contracts.documents import IndexKind, TimeIndexReference

DEPTH_MNEMONICS = {"dept", "depth", "md", "mdepth"}
TVD_MNEMONICS = {"tvd", "tvdss", "tvdepth"}
TIME_MNEMONICS = {"time", "etime", "elapsed", "seconds", "sec"}


@dataclass(frozen=True)
class LasCurveData:
    source_position: int
    curve: Any
    values: NDArray[Any]
    numeric_values: NDArray[np.float64] | None


@dataclass(frozen=True)
class LasIndexCandidate:
    id: str
    source_position: int
    source_positions: frozenset[int]
    mnemonic: str
    unit: str
    kind: IndexKind
    values: NDArray[np.float64]
    valid_ratio: float
    monotonic_ratio: float
    reason: str
    source_index_columns: dict[str, NDArray[Any]]
    time_index_reference: TimeIndexReference
    warnings: tuple[str, ...] = ()

    def public_details(self) -> dict[str, object]:
        return {
            "id": self.id,
            "mnemonic": self.mnemonic,
            "unit": self.unit,
            "kind": self.kind.value,
            "source_position": self.source_position,
            "valid_ratio": self.valid_ratio,
            "monotonic_ratio": self.monotonic_ratio,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class LasTable:
    row_count: int
    index_mnemonic: str
    index_unit: str
    index_kind: IndexKind
    index_values: NDArray[np.float64]
    time_index_reference: TimeIndexReference
    curves: tuple[LasCurveData, ...]
    source_index_columns: dict[str, NDArray[Any]]
    warnings: tuple[str, ...]


def normalize_las_table(las: Any, index_candidate_id: str | None = None) -> LasTable:
    if not las.curves:
        raise LasImportError("The LAS file does not define any curves.")

    raw_curves = [np.asarray(curve.data) for curve in las.curves]
    row_count = len(raw_curves[0])
    if row_count == 0 or any(len(values) != row_count for values in raw_curves):
        raise LasImportError("The LAS file does not contain a readable data table.")

    candidates = _index_candidates(las, raw_curves)
    if not candidates:
        raise LasImportError(
            "The LAS file does not contain a credible numeric or DATE/TIME index."
        )

    if index_candidate_id is None and len(candidates) > 1:
        raise LasIndexSelectionRequired(
            [candidate.public_details() for candidate in candidates]
        )

    selected = candidates[0]
    if index_candidate_id is not None:
        matched = next(
            (candidate for candidate in candidates if candidate.id == index_candidate_id),
            None,
        )
        if matched is None:
            raise LasImportError(
                "The selected LAS index candidate is no longer available. Reopen the file."
            )
        selected = matched

    return LasTable(
        row_count=row_count,
        index_mnemonic=selected.mnemonic,
        index_unit=selected.unit,
        index_kind=selected.kind,
        index_values=selected.values,
        time_index_reference=selected.time_index_reference,
        curves=_curve_data(
            las,
            raw_curves,
            excluded_positions=set(selected.source_positions),
        ),
        source_index_columns=selected.source_index_columns,
        warnings=selected.warnings,
    )


def _index_candidates(
    las: Any,
    raw_curves: list[NDArray[Any]],
) -> list[LasIndexCandidate]:
    candidates: list[LasIndexCandidate] = []
    date_positions = [
        position
        for position, curve in enumerate(las.curves)
        if _mnemonic(curve, "").casefold() == "date"
    ]

    for position, curve in enumerate(las.curves):
        mnemonic = _mnemonic(curve, f"INDEX_{position}")
        lowered = mnemonic.casefold()
        raw_values = raw_curves[position]

        if lowered == "time" and date_positions and _numeric_values(raw_values) is None:
            date_position = date_positions[0]
            values, invalid_count = _date_time_index(
                raw_curves[date_position],
                raw_values,
            )
            valid_ratio, monotonic_ratio = _candidate_quality(values)
            if valid_ratio >= 0.8 and monotonic_ratio >= 0.95:
                date_warnings = [
                    "The LAS DATE and TIME values do not specify a timezone; UTC was "
                    "assumed for deterministic timestamp normalization."
                ]
                if invalid_count:
                    date_warnings.append(
                        f"{invalid_count} LAS DATE/TIME rows could not be parsed and have "
                        "a null index."
                    )
                candidates.append(
                    LasIndexCandidate(
                        id=f"date-time:{position}:{date_position}",
                        source_position=position,
                        source_positions=frozenset({position, date_position}),
                        mnemonic="TIME",
                        unit="s",
                        kind=IndexKind.TIME,
                        values=values,
                        valid_ratio=valid_ratio,
                        monotonic_ratio=monotonic_ratio,
                        reason="Paired DATE and TIME columns form a monotonic timestamp index.",
                        source_index_columns={
                            "TIME": raw_values,
                            "DATE": raw_curves[date_position],
                        },
                        time_index_reference=TimeIndexReference.ABSOLUTE_UTC,
                        warnings=tuple(date_warnings),
                    )
                )
            continue

        numeric_values = _numeric_values(raw_values)
        if numeric_values is None:
            continue
        valid_ratio, monotonic_ratio = _candidate_quality(numeric_values)
        recognized = (
            lowered in DEPTH_MNEMONICS
            or lowered in TVD_MNEMONICS
            or lowered in TIME_MNEMONICS
        )
        if valid_ratio < 0.8 or monotonic_ratio < 0.95 or not (recognized or position == 0):
            continue

        kind = _numeric_index_kind(mnemonic)
        unit = str(curve.unit or "").strip()
        source_columns: dict[str, NDArray[Any]] = {}
        time_reference = TimeIndexReference.NONE
        normalized_values = numeric_values
        numeric_warnings: tuple[str, ...] = ()
        if kind == IndexKind.TIME:
            factor, assumed_seconds = _time_unit_factor(unit)
            normalized_values = numeric_values * factor
            source_columns[mnemonic] = raw_values
            unit = "s"
            time_reference = TimeIndexReference.ELAPSED
            if assumed_seconds:
                numeric_warnings = (
                    f"The numeric {mnemonic} index unit was not recognized; seconds were assumed.",
                )

        reason = "The first numeric curve is monotonic."
        if recognized:
            reason = f"{mnemonic} has a recognized index mnemonic and monotonic values."
        candidates.append(
            LasIndexCandidate(
                id=f"curve:{position}",
                source_position=position,
                source_positions=frozenset({position}),
                mnemonic=mnemonic,
                unit=unit,
                kind=kind,
                values=normalized_values,
                valid_ratio=valid_ratio,
                monotonic_ratio=monotonic_ratio,
                reason=reason,
                source_index_columns=source_columns,
                time_index_reference=time_reference,
                warnings=numeric_warnings,
            )
        )

    return sorted(candidates, key=lambda candidate: candidate.source_position)


def _candidate_quality(values: NDArray[np.float64]) -> tuple[float, float]:
    finite = values[np.isfinite(values)]
    valid_ratio = float(finite.size / values.size) if values.size else 0.0
    if finite.size < 2:
        return valid_ratio, 0.0
    differences = np.diff(finite)
    nondecreasing = float(np.count_nonzero(differences >= 0) / differences.size)
    nonincreasing = float(np.count_nonzero(differences <= 0) / differences.size)
    return valid_ratio, max(nondecreasing, nonincreasing)


def _curve_data(
    las: Any,
    raw_curves: list[NDArray[Any]],
    *,
    excluded_positions: set[int],
) -> tuple[LasCurveData, ...]:
    return tuple(
        LasCurveData(
            source_position=position,
            curve=curve,
            values=raw_curves[position],
            numeric_values=_numeric_values(raw_curves[position]),
        )
        for position, curve in enumerate(las.curves)
        if position not in excluded_positions
    )


def _numeric_values(values: NDArray[Any]) -> NDArray[np.float64] | None:
    try:
        return np.asarray(values, dtype=float)
    except (TypeError, ValueError):
        return None


def _date_time_index(
    dates: NDArray[Any],
    times: NDArray[Any],
) -> tuple[NDArray[np.float64], int]:
    result = np.full(len(times), np.nan, dtype=float)
    invalid_count = 0
    for position, (date_value, time_value) in enumerate(zip(dates, times, strict=True)):
        parsed = _parse_date_time(str(date_value).strip(), str(time_value).strip())
        if parsed is None:
            invalid_count += 1
            continue
        result[position] = parsed.replace(tzinfo=UTC).timestamp()
    return result, invalid_count


def _parse_date_time(date_text: str, time_text: str) -> datetime | None:
    value = f"{date_text} {time_text}"
    for pattern in (
        "%d-%b-%y %H:%M:%S",
        "%d-%b-%y %H:%M:%S.%f",
        "%d-%b-%Y %H:%M:%S",
        "%d-%b-%Y %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(value, pattern)
        except ValueError:
            continue
    return None


def _numeric_index_kind(mnemonic: str) -> IndexKind:
    lowered = mnemonic.casefold()
    if lowered in DEPTH_MNEMONICS:
        return IndexKind.MEASURED_DEPTH
    if lowered in TVD_MNEMONICS:
        return IndexKind.TRUE_VERTICAL_DEPTH
    if lowered in TIME_MNEMONICS:
        return IndexKind.TIME
    return IndexKind.OTHER


def _time_unit_factor(unit: str) -> tuple[float, bool]:
    lowered = unit.strip().casefold()
    factors = {
        "s": 1.0,
        "sec": 1.0,
        "second": 1.0,
        "seconds": 1.0,
        "ms": 0.001,
        "millisecond": 0.001,
        "milliseconds": 0.001,
        "min": 60.0,
        "minute": 60.0,
        "minutes": 60.0,
        "h": 3600.0,
        "hr": 3600.0,
        "hour": 3600.0,
        "hours": 3600.0,
        "d": 86_400.0,
        "day": 86_400.0,
        "days": 86_400.0,
    }
    factor = factors.get(lowered)
    return (factor, False) if factor is not None else (1.0, True)


def _mnemonic(curve: Any, fallback: str) -> str:
    return str(curve.mnemonic or fallback).strip()
