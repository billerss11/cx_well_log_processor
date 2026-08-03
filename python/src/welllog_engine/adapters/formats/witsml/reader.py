import copy
import json
import math
import tempfile
import zipfile
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path, PurePosixPath
from uuid import uuid4

import h5py  # type: ignore[import-untyped]
import numpy as np
import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.parquet as pq  # type: ignore[import-untyped]
import zarr  # type: ignore[import-untyped]
from lxml import etree  # type: ignore[import-untyped]
from numpy.typing import NDArray

from welllog_engine.adapters.formats.common import (
    build_preview,
    numeric_statistics,
    slug,
)
from welllog_engine.adapters.storage.cxlog import sha256_file
from welllog_engine.contracts.documents import IndexKind, SourceFormat, StorageKind
from welllog_engine.domain.documents import (
    ConversionResult,
    ImportedChannel,
    ImportedDataset,
    ImportedPreviewSample,
    ImportedSource,
    PreservedObject,
)


class WitsmlImportError(ValueError):
    pass


def convert_witsml(
    source_path: Path,
    staging_path: Path,
    max_preview_points: int,
) -> ConversionResult:
    source = source_path.expanduser().resolve()
    if not source.is_file() or source.suffix.casefold() not in {".xml", ".epc"}:
        raise WitsmlImportError("The selected WITSML XML or EPC file is not accessible.")

    document_id = uuid4().hex
    datasets: list[ImportedDataset] = []
    objects: list[PreservedObject] = []
    relationships: list[tuple[str, str, str]] = []
    warnings: list[str] = []
    versions: set[str] = set()
    well_names: list[str] = []

    with tempfile.TemporaryDirectory(prefix="cx-witsml-") as temporary_directory:
        temporary_root = Path(temporary_directory)
        if source.suffix.casefold() == ".epc":
            xml_paths, hdf_paths = _extract_epc(source, temporary_root)
        else:
            xml_paths = [source]
            hdf_paths = _find_sibling_hdf_files(source)

        if not xml_paths:
            raise WitsmlImportError("The WITSML input does not contain any XML objects.")
        for xml_index, xml_path in enumerate(xml_paths):
            try:
                root = _parse_xml(xml_path)
            except Exception as error:
                warnings.append(f"Could not parse {xml_path.name}: {error}")
                continue
            namespace = _namespace(root.tag)
            if "witsml" not in namespace.casefold():
                warnings.append(f"{xml_path.name} is not a recognized WITSML XML document.")
                continue
            version = _witsml_version(root, namespace)
            versions.add(version)
            xml_datasets, xml_objects, xml_relationships, xml_wells, xml_warnings = (
                _convert_xml_root(
                    root=root,
                    xml_index=xml_index,
                    staging_path=staging_path,
                    document_id=document_id,
                    max_preview_points=max_preview_points,
                )
            )
            datasets.extend(xml_datasets)
            objects.extend(xml_objects)
            relationships.extend(xml_relationships)
            well_names.extend(xml_wells)
            warnings.extend(xml_warnings)

        for hdf_index, hdf_path in enumerate(hdf_paths):
            try:
                hdf_dataset = _convert_hdf5(
                    hdf_path,
                    staging_path,
                    document_id,
                    hdf_index,
                    well_names[0] if well_names else source.stem,
                )
            except Exception as error:
                warnings.append(f"Could not convert companion HDF5 file {hdf_path.name}: {error}")
            else:
                if hdf_dataset is not None:
                    datasets.append(hdf_dataset)

    if not objects and not datasets:
        raise WitsmlImportError("The input does not contain readable WITSML objects.")
    source_version = ", ".join(sorted(versions)) if versions else "unknown"
    well_name = next((name for name in well_names if name), source.stem)
    return ConversionResult(
        document_id=document_id,
        source=ImportedSource(
            filename=source.name,
            source_format=SourceFormat.WITSML,
            source_version=source_version,
            file_size_bytes=source.stat().st_size,
            sha256=sha256_file(source),
            field_name=well_name,
        ),
        datasets=datasets,
        objects=objects,
        relationships=relationships,
        warnings=warnings,
    )


def _convert_xml_root(
    *,
    root: etree._Element,
    xml_index: int,
    staging_path: Path,
    document_id: str,
    max_preview_points: int,
) -> tuple[
    list[ImportedDataset],
    list[PreservedObject],
    list[tuple[str, str, str]],
    list[str],
    list[str],
]:
    root_name = _local_name(root.tag)
    children = list(root) if root_name.casefold().endswith("s") else [root]
    datasets: list[ImportedDataset] = []
    objects: list[PreservedObject] = []
    relationships: list[tuple[str, str, str]] = []
    well_names: list[str] = []
    warnings: list[str] = []
    for object_index, element in enumerate(children):
        object_type = _local_name(element.tag)
        native_id = _native_id(element, f"{object_type}-{object_index + 1}")
        name = _first_descendant_text(
            element,
            ("name", "Name", "Title", "title"),
            native_id,
        )
        well_name = _first_descendant_text(
            element,
            ("nameWell", "WellName", "Name"),
            "",
        )
        if well_name:
            well_names.append(well_name)
        object_id = f"witsml-object-{xml_index + 1}-{object_index + 1}-{document_id[:8]}"
        metadata_relative = (
            Path("metadata")
            / "witsml"
            / "objects"
            / f"{xml_index + 1:03d}-{object_index + 1:03d}-{slug(object_type)}.xml"
        )
        _write_preserved_xml(staging_path / metadata_relative, element)
        parent_id = _parent_native_id(element)
        objects.append(
            PreservedObject(
                id=object_id,
                object_type=object_type,
                native_id=native_id,
                name=name,
                parent_native_id=parent_id,
                metadata_path=metadata_relative.as_posix(),
            )
        )
        if parent_id:
            relationships.append((object_id, parent_id, "parent"))
        relationships.extend(_object_references(object_id, element))

        lowered = object_type.casefold()
        try:
            if lowered == "log":
                datasets.extend(
                    _convert_log(
                        element,
                        staging_path,
                        document_id,
                        object_index,
                        max_preview_points,
                    )
                )
            elif lowered == "trajectory":
                trajectory = _convert_trajectory(
                    element,
                    staging_path,
                    document_id,
                    object_index,
                    max_preview_points,
                )
                if trajectory is not None:
                    datasets.append(trajectory)
        except Exception as error:
            warnings.append(f"WITSML {object_type} {name} could not be normalized: {error}")
    return datasets, objects, relationships, well_names, warnings


def _convert_log(
    log: etree._Element,
    staging_path: Path,
    document_id: str,
    object_index: int,
    max_preview_points: int,
) -> list[ImportedDataset]:
    if _find_descendant(log, "mnemonicList") is not None:
        return [
            _convert_v1411_log(
                log,
                staging_path,
                document_id,
                object_index,
                max_preview_points,
            )
        ]
    return _convert_v2_log(
        log,
        staging_path,
        document_id,
        object_index,
        max_preview_points,
    )


def _convert_v1411_log(
    log: etree._Element,
    staging_path: Path,
    document_id: str,
    object_index: int,
    max_preview_points: int,
) -> ImportedDataset:
    mnemonic_text = _element_text(_find_descendant(log, "mnemonicList"))
    unit_text = _element_text(_find_descendant(log, "unitList"))
    mnemonics = [item.strip() for item in mnemonic_text.split(",")]
    units = [item.strip() for item in unit_text.split(",")]
    if not mnemonics or not mnemonics[0]:
        raise WitsmlImportError("The WITSML log does not define a mnemonic list.")

    curve_info: dict[str, dict[str, str]] = {}
    for info in _find_descendants(log, "logCurveInfo"):
        mnemonic = _first_descendant_text(info, ("mnemonic",), "")
        if not mnemonic:
            continue
        curve_info[mnemonic] = {
            "description": _first_descendant_text(
                info, ("curveDescription",), "Imported WITSML curve"
            ),
            "unit": _first_descendant_text(info, ("unit",), ""),
            "null": _first_descendant_text(info, ("nullValue",), ""),
        }

    rows: list[list[object | None]] = []
    for data_element in _find_descendants(log, "data"):
        cells = (_element_text(data_element)).split(",")
        rows.append(
            [
                _parse_witsml_cell(cells[index] if index < len(cells) else "")
                for index in range(len(mnemonics))
            ]
        )
    if not rows:
        raise WitsmlImportError("The WITSML log does not contain data rows.")

    columns = list(map(list, zip(*rows, strict=True)))
    for position, mnemonic in enumerate(mnemonics):
        null_text = curve_info.get(mnemonic, {}).get("null", "")
        if null_text:
            null_value = _parse_witsml_cell(null_text)
            columns[position] = [
                None if value == null_value else value for value in columns[position]
            ]
    index_values = _as_numeric_index(columns[0])
    dataset_id = f"dataset-witsml-log-{object_index + 1}-{document_id[:10]}"
    arrow_columns: dict[str, pa.Array] = {"index": _arrow_values(columns[0])}
    channels: list[ImportedChannel] = []
    used_columns = {"index"}
    for position, mnemonic in enumerate(mnemonics[1:], start=1):
        values = columns[position]
        column_name = _unique_column_name(mnemonic, position, used_columns)
        arrow_columns[column_name] = _arrow_values(values)
        numeric_values = _optional_numeric(values)
        minimum, maximum, null_count = numeric_statistics(numeric_values)
        info = curve_info.get(mnemonic, {})
        channels.append(
            ImportedChannel(
                id=f"curve-{dataset_id}-{position}-{slug(mnemonic)}",
                position=position - 1,
                mnemonic=mnemonic,
                unit=info.get("unit") or (units[position] if position < len(units) else ""),
                description=info.get("description", "Imported WITSML curve"),
                minimum=minimum,
                maximum=maximum,
                sample_count=len(rows),
                null_count=null_count,
                sample_shape=[],
                storage_kind=StorageKind.PARQUET,
                asset_path=f"data/scalar/{dataset_id}.parquet",
                preview_samples=build_preview(
                    index_values,
                    numeric_values,
                    max_preview_points,
                ),
                native_metadata={"parquet_column": column_name},
            )
        )
    _write_parquet(staging_path, dataset_id, arrow_columns)
    finite_index = index_values[np.isfinite(index_values)]
    index_type = _first_descendant_text(log, ("indexType",), "").casefold()
    return ImportedDataset(
        id=dataset_id,
        name=_first_descendant_text(log, ("name",), "WITSML log"),
        kind="log",
        well_name=_first_descendant_text(log, ("nameWell",), "Unknown well"),
        wellbore_name=_first_descendant_text(
            log, ("nameWellbore",), "Imported wellbore"
        ),
        row_count=len(rows),
        index_mnemonic=mnemonics[0],
        index_unit=units[0] if units else "",
        index_kind=IndexKind.TIME if "time" in index_type else IndexKind.MEASURED_DEPTH,
        index_minimum=float(np.min(finite_index)) if finite_index.size else None,
        index_maximum=float(np.max(finite_index)) if finite_index.size else None,
        channels=channels,
        native_metadata={"uid": _native_id(log, "")},
    )


def _convert_v2_log(
    log: etree._Element,
    staging_path: Path,
    document_id: str,
    object_index: int,
    max_preview_points: int,
) -> list[ImportedDataset]:
    datasets: list[ImportedDataset] = []
    channel_sets = [
        item for item in log.iter() if _local_name(item.tag).casefold() == "channelset"
    ]
    for set_index, channel_set in enumerate(channel_sets):
        data_element = next(
            (
                item
                for item in channel_set.iter()
                if _local_name(item.tag).casefold() in {"data", "channeldata"}
                and _element_text(item)
            ),
            None,
        )
        if data_element is None:
            continue
        payload = json.loads(_element_text(data_element))
        if not isinstance(payload, list) or not payload:
            continue
        channel_elements = [
            item
            for item in channel_set.iter()
            if _local_name(item.tag).casefold() == "channel"
        ]
        channel_names = [
            _first_descendant_text(item, ("Mnemonic", "mnemonic"), f"CHANNEL_{i + 1}")
            for i, item in enumerate(channel_elements)
        ]
        first_row = payload[0]
        if not isinstance(first_row, list) or len(first_row) != 2:
            raise WitsmlImportError("WITSML 2.x ChannelData rows have an unsupported shape.")
        valid_rows = [
            row
            for row in payload
            if isinstance(row, list)
            and len(row) == 2
            and isinstance(row[0], list)
            and row[0]
            and isinstance(row[1], list)
        ]
        if not valid_rows:
            continue
        raw_index_values = [row[0][0] for row in valid_rows]
        index_values = _as_numeric_index(raw_index_values)
        channel_values = [row[1] for row in valid_rows]
        channel_count = max((len(row) for row in channel_values), default=0)
        if len(channel_names) < channel_count:
            channel_names.extend(
                f"CHANNEL_{index + 1}"
                for index in range(len(channel_names), channel_count)
            )
        dataset_id = (
            f"dataset-witsml2-log-{object_index + 1}-{set_index + 1}-{document_id[:8]}"
        )
        scalar_columns: dict[str, pa.Array] = {
            "index": _arrow_values(raw_index_values)
        }
        used_columns = {"index"}
        channels: list[ImportedChannel] = []
        array_group: object | None = None
        for channel_position in range(channel_count):
            values = [
                row[channel_position] if channel_position < len(row) else None
                for row in channel_values
            ]
            mnemonic = channel_names[channel_position]
            sample_shape = _infer_sample_shape(values)
            channel_id = f"curve-{dataset_id}-{channel_position + 1}-{slug(mnemonic)}"
            metadata = (
                channel_elements[channel_position]
                if channel_position < len(channel_elements)
                else None
            )
            unit = (
                _first_descendant_text(metadata, ("Uom", "uom"), "")
                if metadata is not None
                else ""
            )
            if sample_shape:
                if array_group is None:
                    array_path = staging_path / "data" / "arrays" / f"{dataset_id}.zarr"
                    array_path.parent.mkdir(parents=True, exist_ok=True)
                    array_group = zarr.open_group(str(array_path), mode="w")
                    array_group.create_array(  # type: ignore[attr-defined]
                        "index", data=index_values, overwrite=True
                    )
                array_values = np.asarray(values, dtype=float)
                array_group.create_array(  # type: ignore[attr-defined]
                    channel_id,
                    data=array_values,
                    chunks=(min(len(values), 256), *array_values.shape[1:]),
                    overwrite=True,
                )
                minimum, maximum, _ = numeric_statistics(array_values)
                storage_kind = StorageKind.ZARR
                asset_path = f"data/arrays/{dataset_id}.zarr/{channel_id}"
                preview: list[ImportedPreviewSample] = []
                null_count = int(
                    np.count_nonzero(
                        ~np.isfinite(array_values).reshape(len(values), -1).all(axis=1)
                    )
                )
            else:
                column_name = _unique_column_name(
                    mnemonic, channel_position + 1, used_columns
                )
                scalar_columns[column_name] = _arrow_values(values)
                numeric_values = _optional_numeric(values)
                minimum, maximum, null_count = numeric_statistics(numeric_values)
                storage_kind = StorageKind.PARQUET
                asset_path = f"data/scalar/{dataset_id}.parquet"
                preview = build_preview(
                    index_values, numeric_values, max_preview_points
                )
            channels.append(
                ImportedChannel(
                    id=channel_id,
                    position=channel_position,
                    mnemonic=mnemonic,
                    unit=unit,
                    description="Imported WITSML 2.x channel",
                    minimum=minimum,
                    maximum=maximum,
                    sample_count=len(values),
                    null_count=null_count,
                    sample_shape=sample_shape,
                    storage_kind=storage_kind,
                    asset_path=asset_path,
                    preview_samples=preview,
                    native_metadata={},
                )
            )
        _write_parquet(staging_path, dataset_id, scalar_columns)
        finite_index = index_values[np.isfinite(index_values)]
        index_metadata = _find_first_named(channel_set, ("Index", "ChannelIndex"))
        index_type = _first_descendant_text(
            index_metadata,
            ("IndexType", "indexType", "TimeDepth"),
            "Depth",
        )
        index_mnemonic = _first_descendant_text(
            index_metadata,
            ("Mnemonic", "mnemonic"),
            "INDEX",
        )
        index_unit = _first_descendant_text(
            index_metadata,
            ("Uom", "uom"),
            "",
        )
        datasets.append(
            ImportedDataset(
                id=dataset_id,
                name=_first_descendant_text(
                    channel_set, ("Title", "Name"), f"Channel set {set_index + 1}"
                ),
                kind="log",
                well_name=_first_descendant_text(log, ("Well", "WellName"), "Unknown well"),
                wellbore_name="Imported wellbore",
                row_count=len(index_values),
                index_mnemonic=index_mnemonic,
                index_unit=index_unit,
                index_kind=(
                    IndexKind.TIME
                    if "time" in index_type.casefold()
                    else IndexKind.MEASURED_DEPTH
                ),
                index_minimum=float(np.min(finite_index)) if finite_index.size else None,
                index_maximum=float(np.max(finite_index)) if finite_index.size else None,
                channels=channels,
                native_metadata={"uuid": _native_id(log, "")},
            )
        )
    return datasets


def _convert_trajectory(
    trajectory: etree._Element,
    staging_path: Path,
    document_id: str,
    object_index: int,
    max_preview_points: int,
) -> ImportedDataset | None:
    stations = [
        item
        for item in trajectory.iter()
        if _local_name(item.tag).casefold() in {"trajectorystation", "station"}
    ]
    if not stations:
        return None
    field_candidates = {
        "MD": ("md", "MeasuredDepth"),
        "INCL": ("incl", "Inclination"),
        "AZI": ("azi", "Azimuth"),
        "TVD": ("tvd", "TrueVerticalDepth"),
        "NS": ("dispNs", "NorthSouth"),
        "EW": ("dispEw", "EastWest"),
    }
    values_by_field: dict[str, list[float | None]] = {}
    units_by_field: dict[str, str] = {}
    for key, names in field_candidates.items():
        values: list[float | None] = []
        unit = ""
        for station in stations:
            element = _find_first_named(station, names)
            text = _element_text(element)
            try:
                values.append(float(text))
            except (TypeError, ValueError):
                values.append(None)
            if element is not None:
                unit = element.get("uom", unit)
        if any(value is not None for value in values):
            values_by_field[key] = values
            units_by_field[key] = unit
    if "MD" not in values_by_field:
        return None
    dataset_id = f"dataset-witsml-trajectory-{object_index + 1}-{document_id[:8]}"
    index_values = _optional_numeric(values_by_field.pop("MD"))
    columns: dict[str, pa.Array] = {"index": pa.array(index_values, from_pandas=True)}
    channels: list[ImportedChannel] = []
    for position, (mnemonic, values) in enumerate(values_by_field.items()):
        numeric = _optional_numeric(values)
        columns[mnemonic.casefold()] = pa.array(numeric, from_pandas=True)
        minimum, maximum, null_count = numeric_statistics(numeric)
        channels.append(
            ImportedChannel(
                id=f"curve-{dataset_id}-{position + 1}-{mnemonic.casefold()}",
                position=position,
                mnemonic=mnemonic,
                unit=units_by_field.get(mnemonic, ""),
                description=f"Trajectory {mnemonic}",
                minimum=minimum,
                maximum=maximum,
                sample_count=len(stations),
                null_count=null_count,
                sample_shape=[],
                storage_kind=StorageKind.PARQUET,
                asset_path=f"data/scalar/{dataset_id}.parquet",
                preview_samples=build_preview(index_values, numeric, max_preview_points),
                native_metadata={"parquet_column": mnemonic.casefold()},
            )
        )
    _write_parquet(staging_path, dataset_id, columns)
    finite_index = index_values[np.isfinite(index_values)]
    return ImportedDataset(
        id=dataset_id,
        name=_first_descendant_text(trajectory, ("name", "Title"), "Trajectory"),
        kind="trajectory",
        well_name=_first_descendant_text(
            trajectory, ("nameWell", "WellName"), "Unknown well"
        ),
        wellbore_name=_first_descendant_text(
            trajectory, ("nameWellbore",), "Imported wellbore"
        ),
        row_count=len(stations),
        index_mnemonic="MD",
        index_unit=units_by_field.get("MD", ""),
        index_kind=IndexKind.MEASURED_DEPTH,
        index_minimum=float(np.min(finite_index)) if finite_index.size else None,
        index_maximum=float(np.max(finite_index)) if finite_index.size else None,
        channels=channels,
        native_metadata={"native_id": _native_id(trajectory, "")},
    )


def _convert_hdf5(
    source_path: Path,
    staging_path: Path,
    document_id: str,
    hdf_index: int,
    well_name: str,
) -> ImportedDataset | None:
    dataset_id = f"dataset-witsml-hdf-{hdf_index + 1}-{document_id[:8]}"
    relative_group = Path("data") / "arrays" / f"{dataset_id}.zarr"
    group_path = staging_path / relative_group
    group_path.parent.mkdir(parents=True, exist_ok=True)
    target_group = zarr.open_group(str(group_path), mode="w")
    channels: list[ImportedChannel] = []
    with h5py.File(source_path, mode="r") as hdf_file:
        discovered: list[tuple[str, h5py.Dataset]] = []

        def collect(name: str, item: object) -> None:
            if isinstance(item, h5py.Dataset):
                discovered.append((name, item))

        hdf_file.visititems(collect)
        for position, (name, dataset) in enumerate(discovered):
            values = dataset[()]
            array = np.asarray(values)
            channel_id = f"array-{dataset_id}-{position + 1}-{slug(name)}"
            target_group.create_array(
                channel_id,
                data=array,
                chunks=dataset.chunks or "auto",
                overwrite=True,
            )
            minimum, maximum, null_count = numeric_statistics(array)
            channels.append(
                ImportedChannel(
                    id=channel_id,
                    position=position,
                    mnemonic=name,
                    unit=str(dataset.attrs.get("unit", "")),
                    description="Imported WITSML companion array",
                    minimum=minimum,
                    maximum=maximum,
                    sample_count=int(array.shape[0]) if array.ndim else 1,
                    null_count=null_count,
                    sample_shape=list(array.shape[1:]) if array.ndim else [],
                    storage_kind=StorageKind.ZARR,
                    asset_path=f"{relative_group.as_posix()}/{channel_id}",
                    preview_samples=[],
                    native_metadata={
                        "hdf5_path": name,
                        "attributes": {key: str(value) for key, value in dataset.attrs.items()},
                    },
                )
            )
    if not channels:
        return None
    return ImportedDataset(
        id=dataset_id,
        name=source_path.name,
        kind="array_collection",
        well_name=well_name,
        wellbore_name="Imported wellbore",
        row_count=max(channel.sample_count for channel in channels),
        index_mnemonic="SAMPLE",
        index_unit="",
        index_kind=IndexKind.SAMPLE,
        index_minimum=0,
        index_maximum=float(max(channel.sample_count for channel in channels) - 1),
        channels=channels,
        native_metadata={"companion_file": source_path.name},
    )


def _parse_xml(path: Path) -> etree._Element:
    parser = etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        recover=False,
        huge_tree=True,
        remove_comments=False,
    )
    tree = etree.parse(str(path), parser)
    return tree.getroot()


def _extract_epc(source: Path, destination: Path) -> tuple[list[Path], list[Path]]:
    xml_paths: list[Path] = []
    hdf_paths: list[Path] = []
    with zipfile.ZipFile(source, mode="r") as archive:
        for member in archive.infolist():
            path = PurePosixPath(member.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in member.filename:
                raise WitsmlImportError(f"Unsafe EPC member: {member.filename}")
            if member.is_dir():
                continue
            suffix = path.suffix.casefold()
            if suffix not in {".xml", ".h5", ".hdf5"}:
                continue
            target = destination / Path(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as input_stream, target.open("wb") as output_stream:
                while chunk := input_stream.read(1024 * 1024):
                    output_stream.write(chunk)
            if suffix == ".xml":
                xml_paths.append(target)
            else:
                hdf_paths.append(target)
    return xml_paths, hdf_paths


def _find_sibling_hdf_files(xml_path: Path) -> list[Path]:
    try:
        text = xml_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []
    names: set[str] = set()
    for suffix in (".h5", ".hdf5"):
        start = 0
        while (position := text.casefold().find(suffix, start)) >= 0:
            left = max(text.rfind(">", 0, position), text.rfind('"', 0, position)) + 1
            candidate_name = text[left : position + len(suffix)].strip()
            if candidate_name and "://" not in candidate_name:
                names.add(candidate_name)
            start = position + len(suffix)
    result: list[Path] = []
    for name in names:
        candidate_path = (xml_path.parent / name).resolve()
        try:
            candidate_path.relative_to(xml_path.parent.resolve())
        except ValueError:
            continue
        if candidate_path.is_file():
            result.append(candidate_path)
    return result


def _write_preserved_xml(path: Path, element: etree._Element) -> None:
    preserved = copy.deepcopy(element)
    for data_element in list(preserved.iter()):
        name = _local_name(data_element.tag).casefold()
        parent = data_element.getparent()
        parent_name = _local_name(parent.tag).casefold() if parent is not None else ""
        if name in {"channeldata", "logdata"} or (
            name == "data" and parent_name == "channelset"
        ):
            if parent is not None:
                parent.remove(data_element)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        etree.tostring(
            preserved,
            encoding="utf-8",
            xml_declaration=True,
            pretty_print=True,
        )
    )


def _write_parquet(
    staging_path: Path,
    dataset_id: str,
    columns: dict[str, pa.Array],
) -> None:
    path = staging_path / "data" / "scalar" / f"{dataset_id}.parquet"
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        pa.table(columns),
        path,
        compression="zstd",
        row_group_size=65_536,
    )


def _arrow_values(values: Sequence[object | None]) -> pa.Array:
    try:
        return pa.array(values, from_pandas=True)
    except (pa.ArrowInvalid, pa.ArrowNotImplementedError, TypeError):
        return pa.array([None if value is None else str(value) for value in values])


def _optional_numeric(values: Sequence[object | None]) -> NDArray[np.float64]:
    result = np.empty(len(values), dtype=float)
    for index, value in enumerate(values):
        try:
            numeric = float(str(value)) if value is not None else math.nan
            result[index] = numeric if math.isfinite(numeric) else math.nan
        except (TypeError, ValueError):
            result[index] = math.nan
    return result


def _as_numeric_index(values: Sequence[object | None]) -> NDArray[np.float64]:
    numeric = _optional_numeric(values)
    if np.isfinite(numeric).any():
        return numeric
    for index, value in enumerate(values):
        if not isinstance(value, str):
            continue
        try:
            numeric[index] = datetime.fromisoformat(
                value.replace("Z", "+00:00")
            ).timestamp()
        except ValueError:
            continue
    if np.isfinite(numeric).any():
        return numeric
    return np.arange(len(values), dtype=float)


def _parse_witsml_cell(value: str) -> object | None:
    text = value.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return text


def _infer_sample_shape(values: list[object | None]) -> list[int]:
    for value in values:
        if isinstance(value, list):
            return list(np.asarray(value).shape)
    return []


def _unique_column_name(mnemonic: str, position: int, used: set[str]) -> str:
    candidate = slug(mnemonic).replace("-", "_")
    if candidate in used:
        candidate = f"{candidate}_{position}"
    used.add(candidate)
    return candidate


def _namespace(tag: object) -> str:
    text = str(tag)
    return text[1:].split("}", 1)[0] if text.startswith("{") else ""


def _local_name(tag: object) -> str:
    return str(tag).rsplit("}", 1)[-1]


def _witsml_version(root: etree._Element, namespace: str) -> str:
    explicit = root.get("version") or root.get("schemaVersion")
    if explicit:
        return explicit
    return "2.x" if "witsmlv2" in namespace.casefold() else "1.4.1.1"


def _native_id(element: etree._Element, fallback: str) -> str:
    for key in ("uuid", "uid", "uidWell", "uidWellbore"):
        value = element.get(key)
        if value:
            return value
    uuid_element = _find_descendant(element, "Uuid")
    return _element_text(uuid_element) or fallback


def _parent_native_id(element: etree._Element) -> str | None:
    for key in ("uidWellbore", "uidWell"):
        value = element.get(key)
        if value:
            return value
    for name in ("Wellbore", "Well"):
        reference = _find_descendant(element, name)
        if reference is not None:
            for key in ("uuid", "uidRef", "uid"):
                value = reference.get(key)
                if value:
                    return value
    return None


def _object_references(
    object_id: str,
    element: etree._Element,
) -> list[tuple[str, str, str]]:
    relationships: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in element.iter():
        for key, value in item.attrib.items():
            lowered = _local_name(key).casefold()
            if value and ("uidref" in lowered or lowered == "uuid"):
                relationship = (_local_name(item.tag), value)
                if relationship not in seen:
                    seen.add(relationship)
                    relationships.append((object_id, value, relationship[0]))
    return relationships


def _find_descendant(element: etree._Element, name: str) -> etree._Element | None:
    return next((item for item in element.iter() if _local_name(item.tag) == name), None)


def _find_descendants(element: etree._Element, name: str) -> list[etree._Element]:
    return [item for item in element.iter() if _local_name(item.tag) == name]


def _find_first_named(
    element: etree._Element,
    names: tuple[str, ...],
) -> etree._Element | None:
    accepted = {name.casefold() for name in names}
    return next(
        (item for item in element.iter() if _local_name(item.tag).casefold() in accepted),
        None,
    )


def _first_descendant_text(
    element: etree._Element | None,
    names: tuple[str, ...],
    fallback: str,
) -> str:
    if element is None:
        return fallback
    found = _find_first_named(element, names)
    return _element_text(found) or fallback


def _element_text(element: etree._Element | None) -> str:
    return "" if element is None else (element.text or "").strip()
