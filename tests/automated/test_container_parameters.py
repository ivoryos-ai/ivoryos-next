"""A dict or a list parameter is described with what it holds, and a value typed as text reaches
the driver as the container it names (GitHub issue 35: the Designer did not recognise a Dict).

`Dict[str, float]` used to be a type string and nothing else, so the pages decided "a number" by
whether the name contained "int" (a dict got a number box), and `cast_value` passed the typed
text straight to the driver (a bare `list` got the text's characters). The driver under test is
`SettingsStore` in example/dummy_driver.py, one method per shape, each returning what reached it.
"""

import asyncio
import dataclasses
import importlib.util
import os
import sys
import typing
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "example"))
from dummy_driver import PumpDirection, SettingsStore  # noqa: E402

from ivoryos_edge.agent.validate import validate_body  # noqa: E402
from ivoryos_edge.introspection import (  # noqa: E402
    cast_arguments,
    cast_value,
    extract_type_info,
    inspect_device_module,
    parse_container_text,
    resolve_callable,
)
from ivoryos_edge.server import app  # noqa: E402


@pytest.fixture
def store_schema():
    return inspect_device_module(SettingsStore())


# --------------------------------------------------------------------------------------
# What the schema says
# --------------------------------------------------------------------------------------

def test_a_dict_parameter_says_what_it_holds(store_schema):
    offsets = store_schema["set_offsets"]["parameters"]["offsets"]
    assert offsets["type"] == "Dict[str, float]"
    assert offsets["is_mapping"] is True
    assert offsets["key_type"] == {"type": "str"}
    assert offsets["value_type"] == {"type": "float", "numeric": True}
    # A dict of numbers is not a number, and has no choices of its own.
    assert "numeric" not in offsets and "options" not in offsets

    channels = store_schema["set_channels"]["parameters"]["channels"]
    assert channels["type"] == "dict[int, str]"
    assert channels["key_type"] == {"type": "int", "numeric": True}
    assert channels["value_type"] == {"type": "str"}

    # A bare dict: a mapping, with nothing said about its keys or values.
    assert store_schema["set_any"]["parameters"]["settings"] == {"type": "dict", "required": True, "is_mapping": True}
    assert extract_type_info(typing.Mapping[str, int])["is_mapping"] is True
    assert extract_type_info(typing.Dict)["is_mapping"] is True

    # An optional dict is still a dict, and may be left as None.
    extra = store_schema["set_optional"]["parameters"]["extra"]
    assert extra["type"] == "Optional[Dict[str, int]]"
    assert extra["optional"] is True and extra["is_mapping"] is True
    assert extra["value_type"] == {"type": "int", "numeric": True}
    assert extra["default"] is None


def test_a_list_parameter_is_neither_a_number_nor_a_dropdown(store_schema):
    levels = store_schema["set_levels"]["parameters"]["levels"]
    assert levels["is_list"] is True
    assert levels["item_type"] == {"type": "float", "numeric": True}
    assert "numeric" not in levels, "a list of floats is not an objective"

    directions = store_schema["set_directions"]["parameters"]["directions"]
    assert "options" not in directions, "a list of an enum is not one choice"
    assert directions["item_type"]["options"] == ["forward", "backward", "oscillating"]

    window = store_schema["set_window"]["parameters"]["window"]
    assert window["is_list"] is True
    assert window["items"] == [{"type": "int", "numeric": True}, {"type": "int", "numeric": True}]

    assert store_schema["set_names"]["parameters"]["names"] == {"type": "list", "required": True, "is_list": True}

    @dataclasses.dataclass
    class Point:
        x: float = 0.0

    info = extract_type_info(typing.List[Point])
    assert "is_object" not in info, "a list of objects is not one object's fields"
    assert info["item_type"]["is_object"] is True

    assert extract_type_info(typing.Set[int])["is_list"] is True
    assert "numeric" not in extract_type_info(typing.Set[int])
    assert extract_type_info(typing.Tuple[float, ...])["item_type"] == {"type": "float", "numeric": True}
    # str is a Sequence to Python; it is text here.
    assert "is_list" not in extract_type_info(str)
    # An Optional of a number is still a number: the unwrap is for unions.
    assert extract_type_info(typing.Optional[float])["numeric"] is True


def test_the_hubs_class_level_copy_describes_a_dict_the_same_way():
    """schema_worker describes a class without building it (the Hub stores what it says), so a
    driver's dict argument has to read there as it reads on a running deck."""
    path = os.path.join(os.path.dirname(__file__), "..", "..", "schema_worker", "introspection.py")
    spec = importlib.util.spec_from_file_location("schema_worker_introspection", path)
    hub = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hub)
    for annotation in (typing.Dict[str, float], typing.List[float], typing.Optional[dict[int, str]],
                       typing.Tuple[int, str], typing.List[PumpDirection], dict, list):
        assert hub.extract_type_info(annotation) == extract_type_info(annotation), annotation


# --------------------------------------------------------------------------------------
# What reaches the driver
# --------------------------------------------------------------------------------------

def _call(store, name, **args):
    method = resolve_callable(store, name)
    return method(**cast_arguments(method, args))


def test_text_reaches_the_driver_as_the_container_it_names():
    store = SettingsStore()
    # JSON, with the values cast by the annotation.
    assert _call(store, "set_offsets", offsets='{"x": "1.5", "y": 2}') == {"offsets": {"x": 1.5, "y": 2.0}, "value_types": ["float"]}
    # Python's own literal, which is what someone who writes drivers types.
    assert _call(store, "set_offsets", offsets="{'x': 1}")["offsets"] == {"x": 1.0}
    # JSON keys are text; a dict keyed by int gets them back as ints.
    assert _call(store, "set_channels", channels='{"1": "pump", "2": "valve"}') == {"channels": {1: "pump", 2: "valve"}, "key_types": ["int"]}
    assert _call(store, "set_any", settings='{"a": [1, 2], "b": null}') == {"settings": {"a": [1, 2], "b": None}}
    assert _call(store, "set_levels", levels='["1", 2, 3.5]') == {"levels": [1.0, 2.0, 3.5], "item_types": ["float"]}
    # A bare list: the items, not the text's characters.
    assert _call(store, "set_names", names='["a", "b"]') == {"names": ["a", "b"]}
    assert _call(store, "set_directions", directions='["forward", "backward"]') == {"directions": ["forward", "backward"]}
    assert _call(store, "set_window", window="(10, 20)") == {"window": [10, 20], "kind": "tuple"}
    assert _call(store, "set_window", window='["10", "20"]')["window"] == [10, 20]
    assert _call(store, "set_optional", extra='{"n": "3"}') == {"extra": {"n": 3}}
    assert _call(store, "set_optional", extra=None) == {"extra": None}


def test_a_container_already_held_as_one_is_cast_too():
    # An assistant's proposal or an imported workflow holds a real dict; its values are cast.
    assert cast_value(typing.Dict[str, float], {"a": "2"}) == {"a": 2.0}
    assert cast_value(typing.List[int], ["1", 2]) == [1, 2]
    assert cast_value(dict, {"a": 1}) == {"a": 1}
    assert cast_value(typing.Set[int], ["1", "1"]) == {1}


def test_text_that_is_not_a_container_is_left_to_the_driver():
    store = SettingsStore()
    # A wells selection on a Sequence[str] only starts like a list.
    assert _call(store, "select", wells="plate[A1:H1]") == {"wells": "plate[A1:H1]"}
    assert cast_value(dict, "abc") == "abc"
    assert cast_value(list, "abc") == "abc", "was ['a', 'b', 'c']"
    # The wrong kind of container: the driver says so, as it would for any wrong value.
    assert cast_value(typing.Dict[str, int], "[1, 2]") == "[1, 2]"
    assert parse_container_text("[1, 2") is None
    assert parse_container_text("42") is None
    assert parse_container_text("") is None


# --------------------------------------------------------------------------------------
# End to end, through the server's own execute path
# --------------------------------------------------------------------------------------

@pytest.fixture
def settings_deck(setup_app_state):
    store = SettingsStore()
    app.state.instruments["settings"] = store
    app.state.instrument_schemas["settings"] = inspect_device_module(store)
    try:
        yield store
    finally:
        app.state.instruments.pop("settings", None)
        app.state.instrument_schemas.pop("settings", None)


async def _execute(ac, module, method, args=None):
    started = await ac.post("/api/execute", json={"module": module, "method": method, "args": args or {}})
    assert started.status_code == 200, started.text
    task_id = started.json()["task_id"]
    for _ in range(50):
        await asyncio.sleep(0.05)
        poll = await ac.get(f"/api/execute/{task_id}")
        if poll.json().get("status") in ("completed", "error"):
            return poll.json()
    raise AssertionError("the task never finished")


@pytest.mark.asyncio
async def test_a_dict_typed_in_a_form_runs(settings_deck):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        data = await _execute(ac, "settings", "set_offsets", {"offsets": '{"x": "1.5"}'})
        assert data["status"] == "completed", data
        assert data["result"] == {"offsets": {"x": 1.5}, "value_types": ["float"]}
        data = await _execute(ac, "settings", "set_names", {"names": '["a", "b"]'})
        assert data["result"] == {"names": ["a", "b"]}


# --------------------------------------------------------------------------------------
# What the agent validator makes of it
# --------------------------------------------------------------------------------------

def _body(steps):
    return {"prep": [], "script": steps, "cleanup": []}


def _step(instrument, method, args):
    return {"instrument": instrument, "action": method, "args": args}


def _errors(issues):
    return [i for i in issues if i["severity"] == "error"]


def test_the_validator_reads_a_dict_the_way_the_call_does(store_schema):
    schema = {"settings": store_schema}
    assert _errors(validate_body(_body([_step("settings", "set_offsets", {"offsets": '{"x": 1.5}'})]), schema)) == []
    # Not "expects a number": the dict holds numbers but is not one ("int" is in its name).
    assert _errors(validate_body(_body([_step("settings", "set_channels", {"channels": '{"1": "pump"}'})]), schema)) == []
    # A real dict, as an assistant writes one.
    assert _errors(validate_body(_body([_step("settings", "set_offsets", {"offsets": {"x": 1}})]), schema)) == []

    bad = _errors(validate_body(_body([_step("settings", "set_offsets", {"offsets": '{"x": "warm"}'})]), schema))
    assert len(bad) == 1
    assert "value 'warm' of 'x' is not a number (float)" in bad[0]["message"]

    text = _errors(validate_body(_body([_step("settings", "set_offsets", {"offsets": "warm"})]), schema))
    assert "expects a dict (Dict[str, float])" in text[0]["message"]

    items = _errors(validate_body(_body([_step("settings", "set_directions", {"directions": '["forward", "sideways"]'})]), schema))
    assert "item 2 ('sideways') is not one of" in items[0]["message"]
