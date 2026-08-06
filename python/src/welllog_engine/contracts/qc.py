from enum import StrEnum
from typing import TypeAlias

from pydantic import BaseModel, ConfigDict


class QcSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class QcScope(StrEnum):
    DATASET = "dataset"
    CURVE = "curve"


QcEvidenceValue: TypeAlias = bool | float | int | str | None


class QcIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    severity: QcSeverity
    scope: QcScope
    message: str
    evidence: dict[str, QcEvidenceValue]
    rule_version: str = "1.0.0"
    curve_id: str | None = None
    curve_mnemonic: str | None = None
    index_minimum: float | None = None
    index_maximum: float | None = None


class QcSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checks_run: int
    issue_count: int
    error_count: int
    warning_count: int
    info_count: int


class QcReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    dataset_id: str
    summary: QcSummary
    issues: list[QcIssue]
