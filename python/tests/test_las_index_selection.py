from pathlib import Path

import pytest

from welllog_engine.adapters.formats.las.converter import convert_las
from welllog_engine.adapters.formats.las.errors import LasIndexSelectionRequired

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_LAS_PATH = REPOSITORY_ROOT / "files" / "test.las"


def test_md_and_tvd_require_an_explicit_index_choice(tmp_path: Path) -> None:
    with pytest.raises(LasIndexSelectionRequired) as error:
        convert_las(SAMPLE_LAS_PATH, tmp_path / "ambiguous", 100)

    candidates = error.value.details["candidates"]
    assert isinstance(candidates, list)
    assert [candidate["mnemonic"] for candidate in candidates[:2]] == ["DEPT", "TVD"]


def test_selected_tvd_is_canonical_and_md_remains_a_curve(tmp_path: Path) -> None:
    result = convert_las(
        SAMPLE_LAS_PATH,
        tmp_path / "selected",
        100,
        index_candidate_id="curve:1",
    )

    dataset = result.datasets[0]
    assert dataset.index_mnemonic == "TVD"
    assert dataset.index_kind == "true_vertical_depth"
    assert dataset.channels[0].mnemonic == "DEPT"


def test_numeric_time_index_is_normalized_to_elapsed_seconds(tmp_path: Path) -> None:
    source = tmp_path / "elapsed.las"
    source.write_text(
        """~Version Information
VERS. 2.0 : Version
WRAP. NO : No wrap
~Well Information Block
NULL. -999.25 : Null
WELL. Elapsed : Well
~Curve Information Block
TIME.MS : Elapsed time
GR.GAPI : Gamma ray
~A TIME GR
0 10
1000 11
2000 12
""",
        encoding="utf-8",
    )

    result = convert_las(source, tmp_path / "elapsed", 100)
    dataset = result.datasets[0]

    assert dataset.index_unit == "s"
    assert dataset.index_minimum == 0
    assert dataset.index_maximum == 2
    assert dataset.native_metadata["time_index_reference"] == "elapsed"
    assert dataset.native_metadata["source_index_columns"] == {"TIME": "source_time"}
