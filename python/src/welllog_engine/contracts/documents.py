from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SourceFormat(StrEnum):
    LAS = "LAS"
    DLIS = "DLIS"
    WITSML = "WITSML"


class IndexKind(StrEnum):
    MEASURED_DEPTH = "measured_depth"
    TRUE_VERTICAL_DEPTH = "true_vertical_depth"
    TIME = "time"
    SAMPLE = "sample"
    OTHER = "other"


class StorageKind(StrEnum):
    PARQUET = "parquet"
    ZARR = "zarr"
    METADATA_ONLY = "metadata_only"


class JobState(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    CANCELLING = "CANCELLING"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"


class TimeIndexReference(StrEnum):
    NONE = "none"
    ELAPSED = "elapsed"
    ABSOLUTE_UTC = "absolute_utc"


class TimeDisplayMode(StrEnum):
    ELAPSED = "elapsed"
    CLOCK = "clock"


class TimeZoneMode(StrEnum):
    UTC = "utc"
    LOCAL = "local"


class DatasetViewSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time_display_mode: TimeDisplayMode = TimeDisplayMode.ELAPSED
    time_zone: TimeZoneMode = TimeZoneMode.UTC
    manual_anchor_index: float | None = None
    manual_anchor_timestamp: float | None = None


class IndexCandidateSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    mnemonic: str
    unit: str
    kind: IndexKind
    source_position: int
    valid_ratio: float
    monotonic_ratio: float
    reason: str


class CurvePreviewSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: float
    value: float | None


class DocumentCurveSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    mnemonic: str
    unit: str
    description: str
    minimum: float | None
    maximum: float | None
    sample_count: int
    null_count: int
    sample_shape: list[int]
    storage_kind: StorageKind
    preview_samples: list[CurvePreviewSample]


class DocumentDatasetSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    kind: str
    well_name: str
    wellbore_name: str
    row_count: int
    index_mnemonic: str
    index_unit: str
    index_kind: IndexKind
    index_minimum: float | None
    index_maximum: float | None
    time_index_reference: TimeIndexReference = TimeIndexReference.NONE
    view_settings: DatasetViewSettings = Field(default_factory=DatasetViewSettings)
    scalar_curve_count: int
    curves: list[DocumentCurveSummary]


class DocumentSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    source_file: str
    source_format: SourceFormat
    source_version: str
    field_name: str
    file_size_bytes: int
    scalar_curve_count: int
    saved: bool
    modified: bool
    datasets: list[DocumentDatasetSummary]
    preserved_object_count: int
    warnings: list[str]


class OpenDocumentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_path: str = Field(min_length=1)
    max_preview_points: int = Field(default=800, ge=100, le=2_000)
    index_candidate_id: str | None = None


class SaveDocumentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    destination_path: str = Field(min_length=1)


class VerifyPackageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    package_path: str = Field(min_length=1)


class JobAcceptedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str


class JobStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    operation: str
    state: JobState
    progress: float = Field(ge=0, le=1)
    message: str
    document: DocumentSummary | None = None
    saved_path: str | None = None
    exported_path: str | None = None
    error: str | None = None
    error_code: str | None = None
    error_details: dict[str, Any] | None = None


class ScalarVisibleRangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    curve_ids: list[str] = Field(min_length=1, max_length=32)
    index_minimum: float
    index_maximum: float
    viewport_height: int = Field(ge=100, le=10_000)
    point_budget: int = Field(default=8_000, ge=100, le=100_000)


class ScalarPreviewPageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    curve_ids: list[str] = Field(default_factory=list, max_length=32)
    page: int = Field(default=0, ge=0)
    page_size: int = Field(default=100, ge=1, le=100)


class CursorValueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    curve_ids: list[str] = Field(min_length=1, max_length=64)
    index: float


class CursorCurveValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    curve_id: str
    value: float | None
    sample_index: float | None
    status: Literal["exact", "interpolated", "nearest", "no_data"]


class CursorValueResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requested_index: float
    values: list[CursorCurveValue]


class MetadataObjectSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    object_type: str
    native_id: str
    name: str
    parent_native_id: str | None


class MetadataObjectPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int
    page_size: int
    total: int
    items: list[MetadataObjectSummary]


class MetadataObjectDetail(MetadataObjectSummary):
    metadata_path: str
    content_type: str
    content_json: dict[str, Any] | list[Any] | None = None
    text: str | None = None
    size_bytes: int
    truncated: bool


class DatasetViewSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time_display_mode: TimeDisplayMode
    time_zone: TimeZoneMode
    manual_anchor_index: float | None = None
    manual_anchor_timestamp: float | None = None


class CsvExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    destination_path: str = Field(min_length=1)
    all_scalar_curves: bool = False
    curve_ids: list[str] = Field(default_factory=list)


class PackageVerificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valid: bool
    package_version: str | None
    asset_count: int
    errors: list[str]
