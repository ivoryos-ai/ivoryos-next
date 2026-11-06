"""An argument that takes a dict: the schema says what its keys and values are, a step holds it as
an object, and a `#name` as one of its values is a reference like any other, at every door a run
comes through. A TypedDict names its keys, so it is an object with fields."""

import enum
from typing import Any, Dict, List, Mapping, Optional

import pytest
# typing's own TypedDict does not read NotRequired before Python 3.11.
from typing_extensions import NotRequired, TypedDict

from ivoryos_edge import workflows as wf
from ivoryos_edge.datasheet import _suggested_value
from ivoryos_edge.introspection import CastError, cast_arguments, cast_value, inspect_device_module
from ivoryos_edge.queue import substitute_workflow_vars, unproduced_references
from ivoryos_edge.run_edits import with_arguments
from ivoryos_edge.safety import check_value


class Speed(enum.Enum):
    SLOW = 1
    FAST = 3


class Lamp(TypedDict):
    slit_um: int
    on: NotRequired[bool]


class Driver:
    def tune(self, gains: Dict[str, float]): return gains
    def optional(self, gains: Optional[Dict[str, float]] = None): return gains
    def by_channel(self, gains: Dict[int, Speed]): return gains
    def nested(self, gains: Dict[str, List[float]]): return gains
    def mapping(self, gains: Mapping[str, int]): return gains
    def bare(self, settings: dict): return settings
    def anything(self, settings: Dict[str, Any]): return settings
    def lamp(self, lamp: Lamp): return lamp
    def returns(self) -> Dict[str, float]: return {}


@pytest.fixture(scope="module")
def schema():
    return inspect_device_module(Driver())


def test_a_typed_dict_says_what_its_keys_and_values_are(schema):
    gains = schema["tune"]["parameters"]["gains"]
    assert gains["is_mapping"] is True
    assert gains["type"] == "Dict[str, float]"
    assert gains["required"] is True
    assert gains["key_type"]["type"] == "str"
    assert gains["value_type"]["type"] == "float"
    assert gains["value_type"]["numeric"] is True


def test_an_optional_dict_keeps_it_and_is_not_required(schema):
    gains = schema["optional"]["parameters"]["gains"]
    assert gains["is_mapping"] is True
    assert gains["required"] is False
    assert gains["value_type"]["type"] == "float"


def test_choices_and_containers_reach_the_value_info(schema):
    by_channel = schema["by_channel"]["parameters"]["gains"]
    assert by_channel["key_type"]["type"] == "int"
    assert [c["label"] for c in by_channel["value_type"]["choices"]] == ["SLOW", "FAST"]
    assert schema["nested"]["parameters"]["gains"]["value_type"]["type"] == "List[float]"
    assert schema["mapping"]["parameters"]["gains"]["is_mapping"] is True


def test_a_bare_dict_is_a_dict_that_says_nothing_more(schema):
    settings = schema["bare"]["parameters"]["settings"]
    assert settings["is_mapping"] is True
    assert "value_type" not in settings


def test_a_returned_dict_is_still_one_output(schema):
    assert [p["path"] for p in schema["returns"]["return_paths"]] == [""]


def test_the_hubs_class_level_schema_agrees():
    import importlib.util
    import os
    path = os.path.join(os.path.dirname(__file__), "..", "..", "schema_worker", "introspection.py")
    spec = importlib.util.spec_from_file_location("schema_worker_introspection", path)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    hub = worker.inspect_class(Driver)
    assert hub["tune"]["parameters"]["gains"]["value_type"]["type"] == "float"
    assert hub["optional"]["parameters"]["gains"]["is_mapping"] is True
    assert hub["optional"]["parameters"]["gains"]["required"] is False
    assert set(hub["lamp"]["parameters"]["lamp"]["fields"]) == {"slit_um", "on"}


def test_a_typeddict_is_an_object_with_fields(schema):
    lamp = schema["lamp"]["parameters"]["lamp"]
    assert lamp["is_object"] is True
    assert lamp["type"] == "Lamp"
    assert lamp["fields"]["slit_um"]["required"] is True
    assert lamp["fields"]["on"]["required"] is False
    assert lamp["fields"]["on"]["type"] == "bool"


def test_a_typeddict_is_cast_by_its_keys():
    assert cast_value(Lamp, {"slit_um": "5", "on": "true"}) == {"slit_um": 5, "on": True}
    assert cast_value(Lamp, '{"slit_um": 5}') == {"slit_um": 5}
    with pytest.raises(CastError, match="needs slit_um"):
        cast_value(Lamp, {"on": True})
    with pytest.raises(CastError):
        cast_value(Lamp, {"slit_um": "wide"})


def test_a_dict_filled_in_from_a_table_is_cast_as_one_written_as_json():
    method = Driver().tune
    assert cast_arguments(method, {"gains": {"kp": "1.5", "ki": 2}}) == {"gains": {"kp": 1.5, "ki": 2.0}}
    assert cast_arguments(method, {"gains": '{"kp": 1.5}'}) == {"gains": {"kp": 1.5}}
    assert cast_arguments(Driver().by_channel, {"gains": {"1": "FAST"}}) == {"gains": {1: Speed.FAST}}
    with pytest.raises(CastError):
        cast_arguments(method, {"gains": {"kp": "fast"}})


def test_a_reference_in_a_dict_is_substituted_and_cast():
    params = {"gains": {"kp": 1.5, "ki": "#ki"}}
    filled = substitute_workflow_vars(params, {"ki": "0.25"})
    assert cast_arguments(Driver().tune, filled) == {"gains": {"kp": 1.5, "ki": 0.25}}


def test_a_reference_in_a_dict_nothing_saves_refuses_the_run():
    steps = [{"instrument": "pid", "method": "tune", "params": {"gains": {"ki": "#ki"}}}]
    assert any("ki" in p for p in unproduced_references(steps))


def test_a_key_is_not_a_reference():
    assert substitute_workflow_vars({"gains": {"#x": 1}}, {}) == {"gains": {"#x": 1}}


def test_a_linked_workflow_fills_in_a_reference_inside_a_dict():
    out = wf._substitute({"gains": {"ki": "#ki", "kp": 1}, "items": ["#ki"], "rate": "#rate"}, {"ki": 0.5})
    assert out == {"gains": {"ki": 0.5, "kp": 1}, "items": [0.5], "rate": "#rate"}


def test_the_record_finds_a_value_inside_a_dict():
    steps = [{"parameters": {"gains": {"ki": 0.3}, "_vars": {"gains.ki": "ki"}}}]
    assert _suggested_value("ki", steps) == 0.3


def test_a_change_for_later_trials_leaves_a_dict_the_optimizer_fills():
    params = {"gains": {"ki": 0.3}, "_vars": {"gains.ki": "ki"}}
    out, changes = with_arguments(params, {"gains": {"ki": 9}}, keep_columns=True)
    assert out["gains"] == {"ki": 0.3} and not changes
    out, changes = with_arguments(params, {"gains": {"ki": 9}}, keep_columns=False)
    assert out["gains"] == {"ki": 9} and "_vars" not in out


def test_a_limit_on_a_dict_holds_for_each_value():
    assert check_value({"max": 5}, {"a": 1, "b": "#x"}, {}) == []
    assert [shown for shown, _ in check_value({"max": 5}, {"a": 9, "b": 1}, {})] == ["9"]
