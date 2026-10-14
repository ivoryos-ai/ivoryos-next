"""The Set variable step: `name = value`, where the value is a literal, a calculation over
earlier variables, a lone #name, or text.

The original IvoryOS had two steps for this (`variable` and `math`); here they are one. What is
pinned: what each kind of value means, that the expression is never handed to eval(), that later
steps read the variable as any other, that a run reading a variable nothing sets is refused
before anything moves, and that a value supplied for a #name is a value, not code.
"""

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from ivoryos_edge import expressions
from ivoryos_edge.agent.validate import unbound_variables, validate_body
from ivoryos_edge.queue import set_variable_value, unproduced_references
from ivoryos_edge.server import app
from ivoryos_edge.workflows import _substitute


def set_var(name, value, type_=None, **extra):
    params = {"variable_name": name, "value": value, **extra}
    if type_:
        params["type"] = type_
    return {"instrument": "Flow_Control", "method": "Set_Variable", "params": params}


def flow(method, **params):
    return {"instrument": "Flow_Control", "method": method, "params": params}


async def _finish(ac, run_id):
    run = {}
    for _ in range(100):
        run = (await ac.get(f"/api/queue/runs/{run_id}")).json()
        if run.get("status") in ["completed", "error", "cancelled"]:
            break
        await asyncio.sleep(0.05)
    return run


# -- what a value means ---------------------------------------------------------------------------

@pytest.mark.parametrize("value, type_, names, expected", [
    ("1", None, {}, 1),
    ("2.5", None, {}, 2.5),
    ("True", None, {}, True),
    ('"hello"', None, {}, "hello"),
    ("a * 2 + 1", None, {"a": 3}, 7),
    ("#x + 5 * (#y - 2)", None, {"x": 1, "y": 4}, 11),  # the original IvoryOS's math form
    ("round(mass / 3, 2)", None, {"mass": 10}, 3.33),
    ("sqrt(16) + pi * 0", "float", {}, 4.0),
    ("a > 1 and b", None, {"a": 2, "b": False}, False),
    ("reading['A1'] * 10", None, {"reading": {"A1": 0.5}}, 5.0),
    ('f"vial_{i:02d}"', None, {"i": 3}, "vial_03"),
    ("2.7", "int", {}, 2),
    ("1", "float", {}, 1.0),
    ("0", "bool", {}, False),
    ("3", "str", {}, "3"),
    ("sample #i done", "str", {"i": 4}, "sample 4 done"),
    ('"quoted"', "str", {}, "quoted"),
    ("#a", None, {"a": [1, 2]}, [1, 2]),
    ("#a", "float", {"a": 3}, 3.0),
])
def test_what_a_value_means(value, type_, names, expected):
    params = {"value": value, **({"type": type_} if type_ else {})}
    result = set_variable_value(params, names)
    assert result == expected and type(result) is type(expected)


def test_a_value_supplied_for_a_name_is_a_value_not_code():
    # A spreadsheet column holding `abc` must not be read as a variable called abc.
    supplied = {"_vars": {"value": "label"}}
    assert set_variable_value({"value": "abc", **supplied}, {}) == "abc"
    assert set_variable_value({"value": "3", **supplied}, {}) == 3
    assert set_variable_value({"value": "3", "type": "float", **supplied}, {}) == 3.0
    assert set_variable_value({"value": 4}, {}) == 4  # a number from the optimizer


@pytest.mark.parametrize("value, type_, message", [
    ("nope + 1", None, "'nope' is not set"),
    ("#nope", None, "'#nope' is not available yet"),
    ("1 / 0", None, "division by zero"),
    ('"a" + 1', None, "Could not compute"),
    ("abc", "int", "'abc' is not set"),
    ('"abc"', "int", "cannot be made a int"),
    ("", None, "no value"),
    ("1", "list", "not a type"),
])
def test_what_cannot_be_set_says_why(value, type_, message):
    with pytest.raises(Exception, match=message):
        set_variable_value({"value": value, **({"type": type_} if type_ else {})}, {})


@pytest.mark.parametrize("text", [
    "().__class__.__bases__",  # the way out of eval with no builtins
    "__import__('os').system('true')",
    "open('/etc/passwd')",
    "a.real",
    "[x for x in range(3)]",
    "(lambda: 1)()",
    "10 ** 10 ** 10",
    "'a' * 10 ** 9",
    "{**a}",
])
def test_an_expression_is_never_evaluated_as_python(text):
    with pytest.raises(expressions.ExpressionError):
        expressions.evaluate(text, {"a": {"b": 1}})


def test_the_names_an_expression_reads():
    assert expressions.expression_names("round(a / b, ndigits=2) + pi + max(c, 1)") == ["a", "b", "c"]
    assert expressions.expression_names("'#x' + #y") == ["y"]
    assert expressions.expression_names("not valid (") == []


# -- in a run -------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_later_steps_read_the_variable_and_a_loop_can_count():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.post("/api/queue/runs", json={
            "name": "Set variable run",
            "parameters": {"type": "Sequence"},
            "prep": [set_var("a", "1")],
            "sequence": [
                set_var("b", "a * 2 + 0.5", "float"),
                {"instrument": "dummy", "method": "echo_method", "params": {"value": "#b"}},
                set_var("i", "0"),
                flow("While", condition="i < 3"),
                set_var("i", "i + 1"),
                flow("End_While"),
                flow("If", condition="i == 3 and b > 2"),
                set_var("label", "done after #i", "str"),
                flow("End_If"),
            ],
            "cleanup": [],
        })
        assert resp.status_code == 200, resp.text
        run = await _finish(ac, resp.json()["run_id"])
        assert run["status"] == "completed", run
        # In step order, so the counter ends on its last pass (a While's body reads "skipped"
        # once the condition fails, but each pass recorded what it set).
        by_name = {}
        for step in run["steps"]:
            if step["method"] == "Set_Variable" and "result" in (step.get("outputs") or {}):
                by_name[step["parameters"]["variable_name"]] = step["outputs"]["result"]
        assert by_name == {"a": 1, "b": 2.5, "i": 3, "label": "done after 3"}
        echo = next(s for s in run["steps"] if s["method"] == "echo_method")
        assert echo["outputs"]["result"] == "2.5"
        # What it read is on the record, as an If records its condition's values.
        counted = [s for s in run["steps"] if s["method"] == "Set_Variable" and s["parameters"]["value"] == "i + 1"]
        assert counted[0]["outputs"]["variables"] == {"i": 2}


@pytest.mark.asyncio
async def test_a_run_whose_calculation_reads_nothing_set_is_refused_before_anything_moves():
    app.state.instruments["dummy"].counter = 0
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.post("/api/queue/runs", json={
            "name": "Set variable refused",
            "parameters": {"type": "Sequence"},
            "prep": [], "cleanup": [],
            "sequence": [
                {"instrument": "dummy", "method": "counting_method", "params": {}},
                set_var("b", "volume * 2"),
            ],
        })
        assert resp.status_code == 400
        assert "reads #volume, but no step before it saves 'volume'" in resp.json()["error"]
        assert app.state.instruments["dummy"].counter == 0


def test_what_counts_as_set_before_a_read():
    assert unproduced_references([set_var("a", "1"), set_var("b", "a + 1"),
                                  {"instrument": "dummy", "method": "echo_method", "params": {"value": "#b"}}]) == []
    # Text fills in what it can and is never refused.
    assert unproduced_references([set_var("t", "hello #nobody", "str")]) == []
    # A value the table supplied reads nothing.
    assert unproduced_references([set_var("t", "abc", _vars={"value": "col"})]) == []
    assert len(unproduced_references([set_var("t", "#missing")])) == 1


def test_a_linked_workflows_caller_supplies_a_value_not_code():
    params = {"variable_name": "label", "value": "#name"}
    out = _substitute(params, {"name": "abc"}, set_variable=True)
    assert out["value"] == "abc" and out["_vars"] == {"value": "name"}
    assert set_variable_value(out, {}) == "abc"
    # Not supplied by the caller: left for the run, unmarked.
    assert "_vars" not in _substitute(params, {}, set_variable=True)


# -- for an assistant -----------------------------------------------------------------------------

def _body(script):
    return {"prep": [], "script": script, "cleanup": []}


def test_the_validator_knows_the_variable_and_what_it_reads():
    schema = {"dummy": {"echo_method": {"parameters": {"value": {"type": "str", "required": False}}}}}
    good = _body([set_var("a", "1"), set_var("b", "a * 2"),
                  {"instrument": "dummy", "method": "echo_method", "params": {"value": "#b"}}])
    assert validate_body(good, schema) == []
    assert unbound_variables(good) == []

    issues = validate_body(_body([set_var("2x", "#a * 2"), set_var("c", "a.real")]), schema)
    messages = " | ".join(i["message"] for i in issues)
    assert "'2x' cannot be a variable name" in messages
    assert "starts with '#' but is not one variable name" in messages
    assert "'Attribute' is not allowed" in messages
    assert "reads 'a', which no earlier step produces" in messages

    # A lone #name is an input like any other: the run must be given it.
    assert unbound_variables(_body([set_var("copy", "#volume")])) == ["volume"]
