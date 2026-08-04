from datetime import UTC, datetime
from pathlib import Path

import pyarrow.parquet as pq  # type: ignore[import-untyped]

from welllog_engine.adapters.formats.las.converter import convert_las
from welllog_engine.adapters.formats.las.reader import read_las_preview


def test_time_indexed_las_preview_uses_date_and_time(tmp_path: Path) -> None:
    source = _write_time_indexed_las(tmp_path)

    result = read_las_preview(source, max_preview_points=100)

    assert result.depth_mnemonic == "TIME"
    assert result.depth_unit == "s"
    assert result.depth_minimum == _timestamp(2009, 3, 24, 23, 59, 50)
    assert result.depth_maximum == _timestamp(2009, 3, 25, 0, 0, 10)
    assert [curve.mnemonic for curve in result.curves] == ["DEPT", "GR"]
    assert result.curves[0].null_count == 1
    assert "UTC was assumed" in result.warnings[0]


def test_time_indexed_las_conversion_preserves_source_date_and_time(tmp_path: Path) -> None:
    source = _write_time_indexed_las(tmp_path)
    staging = tmp_path / "staging"

    result = convert_las(source, staging, max_preview_points=100)

    dataset = result.datasets[0]
    assert dataset.index_kind == "time"
    assert dataset.index_mnemonic == "TIME"
    assert dataset.index_unit == "s"
    assert [channel.mnemonic for channel in dataset.channels] == ["DEPT", "GR"]
    assert dataset.native_metadata["source_index_columns"] == {
        "TIME": "source_time",
        "DATE": "source_date",
    }

    asset_path = dataset.channels[0].asset_path
    assert asset_path is not None
    table = pq.read_table(staging / asset_path)
    assert table.column_names == ["index", "source_time", "source_date", "dept", "gr"]
    assert table.column("source_time").to_pylist() == ["23:59:50", "00:00:00", "00:00:10"]
    assert table.column("source_date").to_pylist() == [
        "24-Mar-09",
        "25-Mar-09",
        "25-Mar-09",
    ]
    assert table.column("index").to_pylist() == [
        _timestamp(2009, 3, 24, 23, 59, 50),
        _timestamp(2009, 3, 25, 0, 0, 0),
        _timestamp(2009, 3, 25, 0, 0, 10),
    ]


def _write_time_indexed_las(tmp_path: Path) -> Path:
    source = tmp_path / "time-indexed.las"
    source.write_text(
        """~Version Information
VERS. 2.0 : CWLS log ASCII standard - Version 2.0
WRAP. NO : One line per index step
~Well Information Block
STRT. 24-MAR-2009 23:59:50 : START INDEX
STOP. 25-MAR-2009 00:00:10 : STOP INDEX
STEP.SEC 10.0000 : STEP
NULL. -999.25 : NULL VALUE
WELL. Time Test : WELL
~Curve Information Block
TIME.HHMMSS : Time
DATE.D : Date
DEPT.M : Bit depth
GR.GAPI : Gamma ray
~A TIME DATE DEPT GR
23:59:50 24-Mar-09 100.0 50.0
00:00:00 25-Mar-09 -999.25 51.0
00:00:10 25-Mar-09 101.0 52.0
""",
        encoding="utf-8",
    )
    return source


def _timestamp(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
    second: int,
) -> float:
    return datetime(year, month, day, hour, minute, second, tzinfo=UTC).timestamp()
