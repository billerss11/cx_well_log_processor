from pydantic import BaseModel, ConfigDict

from welllog_engine.contracts.documents import IndexKind, SourceFormat, StorageKind


class ImportedPreviewSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: float
    value: float | None


class ImportedChannel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    position: int
    mnemonic: str
    unit: str
    description: str
    minimum: float | None
    maximum: float | None
    sample_count: int
    null_count: int
    sample_shape: list[int]
    storage_kind: StorageKind
    asset_path: str | None
    preview_samples: list[ImportedPreviewSample]
    native_metadata: dict[str, object]


class ImportedDataset(BaseModel):
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
    channels: list[ImportedChannel]
    native_metadata: dict[str, object]


class PreservedObject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    object_type: str
    native_id: str
    name: str
    parent_native_id: str | None
    metadata_path: str


class ImportedSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str
    source_format: SourceFormat
    source_version: str
    file_size_bytes: int
    sha256: str
    field_name: str


class ConversionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    source: ImportedSource
    datasets: list[ImportedDataset]
    objects: list[PreservedObject]
    relationships: list[tuple[str, str, str]]
    warnings: list[str]


class PackageAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    kind: str
    size_bytes: int
    sha256: str


class CxlogManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    media_type: str
    package_version: str
    package_id: str
    created_by: str
    source: ImportedSource
    assets: list[PackageAsset]
