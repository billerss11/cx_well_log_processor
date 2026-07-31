from pydantic import BaseModel, ConfigDict, Field


class ImportErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str


class LasImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_path: str = Field(min_length=1)
    max_preview_points: int = Field(default=800, ge=100, le=2_000)


class LasPreviewSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    depth: float
    value: float | None


class LasCurveSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    mnemonic: str
    unit: str
    description: str
    minimum: float | None
    maximum: float | None
    sample_count: int
    null_count: int
    preview_samples: list[LasPreviewSample]


class LasImportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_file: str
    file_size_bytes: int
    las_version: str
    well_name: str
    field_name: str
    depth_mnemonic: str
    depth_unit: str
    depth_minimum: float
    depth_maximum: float
    row_count: int
    curves: list[LasCurveSummary]
    warnings: list[str]
