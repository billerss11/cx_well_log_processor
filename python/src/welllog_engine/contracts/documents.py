from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class SourceFormat(StrEnum):
    LAS = "LAS"
    DLIS = "DLIS"
    WITSML = "WITSML"


class IndexKind(StrEnum):
    MEASURED_DEPTH = "measured_depth"
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
    curves: list[DocumentCurveSummary]


class DocumentSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    source_file: str
    source_format: SourceFormat
    source_version: str
    field_name: str
    saved: bool
    datasets: list[DocumentDatasetSummary]
    preserved_object_count: int
    warnings: list[str]


class OpenDocumentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_path: str = Field(min_length=1)
    max_preview_points: int = Field(default=800, ge=100, le=2_000)


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
    error: str | None = None


class PackageVerificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valid: bool
    package_version: str | None
    asset_count: int
    errors: list[str]
