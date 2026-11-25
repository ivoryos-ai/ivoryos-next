"""run(__name__) puts a script's instruments on the deck, and nothing else.

`from typing import List, Union, Optional` at the top of a driver script used to show up on the
Instruments page as three "instruments": typing's special forms are objects, not classes, and their
type is not a builtin. IvoryOS Classic avoided them by skipping every capitalised name; NextGen
skips values whose type is Python's own instead, so a capitalised instrument (`HPLC = HPLC()`)
stays on the deck.
"""
import collections
import collections.abc
import datetime
import enum
import functools
import logging
import os
import pathlib
import queue
import re
import sys
import threading
import types
import typing
import uuid
from typing import Callable, List, Optional, Union
from typing import List as seq  # a lowercase alias: no name rule would catch it

import pytest

from ivoryos_edge.plugins import Plugin
from ivoryos_edge.script_objects import names_from_env, sort_script_objects
from ivoryos_edge.server import _script_instruments


class Pump:
    def dispense(self, volume_ml: float):
        return volume_ml


class Mode(enum.Enum):
    FAST = 1


class LabConfig:
    def load(self):
        return {}


def _script(**names):
    module = types.ModuleType("deck_script")
    module.__dict__.update(names)
    return module


def test_typing_names_are_not_instruments():
    pump = Pump()
    found, skipped = _script_instruments(_script(
        pump=pump,
        List=List, Union=Union, Optional=Optional, Callable=Callable, seq=seq,
        vector=list[float], maybe_float=Optional[float], reading=Union[int, float],
        handler=collections.abc.Callable[[int], str], number=typing.TypeVar("number"),
    ))
    assert found == {"pump": pump}
    assert set(skipped) == {"List", "Union", "Optional", "Callable", "seq", "vector",
                            "maybe_float", "reading", "handler", "number"}


def test_capitalised_instruments_stay_on_the_deck():
    hplc, pump = Pump(), Pump()
    found, _ = _script_instruments(_script(HPLC=hplc, PUMP_2=pump))
    assert found == {"HPLC": hplc, "PUMP_2": pump}


def test_standard_library_values_and_enum_members_are_said_and_skipped():
    found, skipped = _script_instruments(_script(
        DATA_DIR=pathlib.Path("."), LOCK=threading.Lock(), EVENT=threading.Event(), Q=queue.Queue(),
        PATTERN=re.compile("x"), TIMEOUT=datetime.timedelta(seconds=5), START=datetime.datetime.now(),
        DEFAULTS=collections.OrderedDict(), COUNTS=collections.defaultdict(int), RUN_ID=uuid.uuid4(),
        PARTIAL=functools.partial(print), logger=logging.getLogger("pump"), MODE=Mode.FAST,
    ))
    assert found == {}
    assert skipped["DATA_DIR"].endswith("from Python itself")
    assert skipped["MODE"] == "a Mode value"


def test_exclude_names_leaves_out_the_scripts_own_objects():
    pump = Pump()
    found, skipped = _script_instruments(_script(pump=pump, CONFIG=LabConfig()), exclude_names=["CONFIG"])
    assert found == {"pump": pump}
    assert skipped == {"CONFIG": "exclude_names"}


def test_quiet_skips():
    found, skipped = _script_instruments(_script(
        _private=Pump(), Pump=Pump, helper=lambda: None, typing=typing,
        plugin=Plugin(id="viz", name="Viz"), speed=5, name="bench", PORT="COM3",
    ))
    assert found == {} and skipped == {}


def test_a_driver_file_named_like_a_standard_module_is_still_user_code(tmp_path, monkeypatch):
    # `test` is a standard module name; a driver called test.py beside the script shadows it.
    (tmp_path / "test.py").write_text("class Pump:\n    def dispense(self, v: float):\n        return v\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.delitem(sys.modules, "test", raising=False)
    import test as driver
    assert os.path.dirname(driver.__file__) == str(tmp_path)
    pump = driver.Pump()
    found, _ = _script_instruments(_script(pump=pump))
    assert found == {"pump": pump}


# --- GitHub issue 88: data, plots and web objects, empty objects, and choosing by name ---------


class Settings:
    """The script's own object with nothing to call."""
    def __init__(self):
        self.port = "COM3"


class Stage:
    @property
    def position(self) -> float:
        return 0.0


class Flex:
    """Only the sum of its parts (parts.py): nothing of its own to call, still an instrument."""
    def __ivoryos_instruments__(self):
        return {"left": Pump()}


def _by_name(entries):
    return {e["name"]: e for e in entries}


def test_data_and_web_objects_are_not_instruments():
    np = pytest.importorskip("numpy")
    pd = pytest.importorskip("pandas")
    fastapi = pytest.importorskip("fastapi")
    pump = Pump()
    found, skipped = _script_instruments(_script(
        pump=pump, calibration=pd.DataFrame({"a": [1]}), weights=np.array([1.0]),
        rng=np.random.default_rng(0), router=fastapi.APIRouter(),
    ))
    assert found == {"pump": pump}
    assert skipped["calibration"] == "DataFrame, from pandas"
    assert skipped["weights"] == "ndarray, from numpy"
    assert skipped["rng"] == "Generator, from numpy"
    assert skipped["router"] == "APIRouter, from fastapi"


def test_an_object_with_nothing_to_call_is_not_an_instrument():
    stage, flex = Stage(), Flex()
    found, skipped = _script_instruments(_script(settings=Settings(), stage=stage, flex=flex))
    assert found == {"stage": stage, "flex": flex}  # a property is a step; parts make an instrument
    assert skipped == {"settings": "nothing to call"}


def test_include_names_puts_on_the_deck_what_the_rules_leave_out():
    pd = pytest.importorskip("pandas")
    table, settings = pd.DataFrame({"a": [1]}), Settings()
    found, skipped = _script_instruments(
        _script(table=table, settings=settings, MODE=Mode.FAST),
        include_names=["table", "settings", "MODE", "missing"])
    assert found == {"table": table, "settings": settings, "MODE": Mode.FAST}
    assert skipped == {}


def test_exclude_wins_over_include():
    found, skipped = _script_instruments(_script(pump=Pump()), exclude_names=["pump"], include_names=["pump"])
    assert found == {} and skipped == {"pump": "exclude_names"}


def test_no_name_list_makes_a_type_an_instrument():
    found, entries = sort_script_objects(_script(List=List, maybe=Optional[float]),
                                         include_names=["List"], shown=["maybe"])
    assert found == {}
    assert [(e["kind"], e["offered"]) for e in entries] == [("type", False), ("type", False)]


def test_the_launchers_choices_and_who_decided():
    pump, settings, other = Pump(), Settings(), Pump()
    found, entries = sort_script_objects(
        _script(pump=pump, settings=settings, other=other, camera=Pump(), extra=Settings()),
        exclude_names=["camera"], include_names=["extra"],
        hidden=["pump", "camera"], shown=["settings", "extra"])
    assert found == {"settings": settings, "other": other, "extra": found["extra"]}
    e = _by_name(entries)
    # The launcher's choices, which it may change again.
    assert (e["pump"]["instrument"], e["pump"]["by"], e["pump"]["offered"]) == (False, "launcher", True)
    assert (e["settings"]["instrument"], e["settings"]["by"]) == (True, "launcher")
    assert e["settings"]["why"] == "nothing to call"  # kept: on the deck *although* the rule says not
    # The script's own lists win over the launcher's, and are not offered to change.
    assert (e["camera"]["by"], e["camera"]["offered"]) == ("script", False)
    assert (e["extra"]["instrument"], e["extra"]["by"], e["extra"]["offered"]) == (True, "script", False)
    # Nobody chose: the rules.
    assert (e["other"]["instrument"], e["other"]["by"], e["other"]["why"]) == (True, "rule", None)
    assert e["pump"]["type"].endswith(".Pump")


def test_names_from_the_environment(monkeypatch):
    monkeypatch.setenv("IVORYOS_EXCLUDE_NAMES", " pump, ,camera ")
    assert names_from_env("IVORYOS_EXCLUDE_NAMES") == ["pump", "camera"]
    monkeypatch.delenv("IVORYOS_INCLUDE_NAMES", raising=False)
    assert names_from_env("IVORYOS_INCLUDE_NAMES") == []


class Reader:
    def read(self, dtype=float, channels={1, 2}, scale: float = 1.5, wells=("A1", "B1"), mode: str = "fast",
             blank: float = float("nan"), limit: float = float("inf")):
        return 0.0


def test_a_default_json_cannot_hold_does_not_break_the_schema():
    # One such parameter used to make every /api/status a 500 (a DataFrame switched on, or
    # a driver with `dtype=float`).
    import json
    from ivoryos_edge.introspection import inspect_device_module
    params = inspect_device_module(Reader())["read"]["parameters"]
    json.dumps(params, allow_nan=False)  # as the response renders it
    assert (params["blank"]["default"], params["limit"]["default"]) == ("nan", "inf")
    assert params["dtype"]["default"] == repr(float)
    assert sorted(params["channels"]["default"]) == [1, 2]
    # What JSON could already hold is unchanged.
    assert (params["scale"]["default"], params["mode"]["default"]) == (1.5, "fast")
    assert params["wells"]["default"] == ["A1", "B1"]
    pd = pytest.importorskip("pandas")
    json.dumps(inspect_device_module(pd.DataFrame({"a": [1]})), allow_nan=False)
