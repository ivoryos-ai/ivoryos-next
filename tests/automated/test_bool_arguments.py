"""A bool argument is True or False, not a field with choices.

The schema gives a bool `options: ["True", "False"]` so a form can offer a dropdown. The agent
validator (and with it the Library's compatibility verdict) matched a step's value against those
as if they were an Enum's choices, so a step holding True itself, or "true", was refused:
"'verify_weight' must be one of ['True', 'False'], not True". The edge's cast takes a bool, or
True/False as text in any case (`_cast_bool`), and the validator now asks the same.
"""

from typing import Dict, List, Optional

import pytest

from ivoryos_edge.agent.validate import validate_body
from ivoryos_edge.introspection import CastError, cast_value, inspect_device_module


class Balance:
    def weigh(self, verify_weight: bool = True) -> float:
        return 1.0

    def tare(self, settle: bool) -> None:
        pass

    def calibrate(self, check: Optional[bool] = None) -> None:
        pass

    def flags(self, channels: List[bool]) -> None:
        pass

    def switches(self, named: Dict[str, bool]) -> None:
        pass


@pytest.fixture
def schema():
    return {"balance": inspect_device_module(Balance())}


def _errors(schema, method, args):
    body = {"prep": [], "script": [{"instrument": "balance", "action": method, "args": args}], "cleanup": []}
    return [i["message"] for i in validate_body(body, schema) if i["severity"] == "error"]


def test_the_schema_still_offers_true_and_false(schema):
    assert schema["balance"]["weigh"]["parameters"]["verify_weight"]["options"] == ["True", "False"]


@pytest.mark.parametrize("value", [True, False, "True", "true", "FALSE", " false "])
def test_a_bool_the_cast_takes_is_not_refused(schema, value):
    assert _errors(schema, "weigh", {"verify_weight": value}) == []
    assert _errors(schema, "tare", {"settle": value}) == []
    assert _errors(schema, "calibrate", {"check": value}) == []
    # And the cast agrees.
    assert cast_value(bool, value) is (str(value).strip().lower() == "true")


@pytest.mark.parametrize("value", ["maybe", 1, "yes"])
def test_anything_else_is_refused_as_not_true_or_false(schema, value):
    errors = _errors(schema, "weigh", {"verify_weight": value})
    assert len(errors) == 1 and "expects True or False" in errors[0]
    with pytest.raises(CastError):
        cast_value(bool, value)


def test_a_bool_inside_a_list_or_a_dict(schema):
    assert _errors(schema, "flags", {"channels": [True, False]}) == []
    assert _errors(schema, "flags", {"channels": '["True", false]'}) == []
    assert _errors(schema, "switches", {"named": {"a": True, "b": "false"}}) == []
    bad = _errors(schema, "switches", {"named": {"a": "maybe"}})
    assert len(bad) == 1 and "is not True or False" in bad[0]


def test_a_reference_and_the_markers_are_left_alone(schema):
    assert _errors(schema, "tare", {"settle": "#settle"}) == []
    assert _errors(schema, "calibrate", {"check": "<None>"}) == []
