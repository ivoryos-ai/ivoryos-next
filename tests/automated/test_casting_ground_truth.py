"""The casting ground truth, row by row, against the edge's own doors.

`tests/fixtures/casting_ground_truth.json` says what a driver must receive for each kind of
typed input (the tables of docs/argument_casting_ground_truth.md as data), and
`example/edge_case_sdl.py` is the instrument that records what it received. Each row runs:

- through `cast_arguments` directly (the one place a value becomes a Python object), then the
  resolved method is called and what the driver kept is compared by `repr`;
- through `POST /api/execute`, the Instruments page's door: the safety guard, the cast, the
  call, the way a person running a method by hand gets it;
- for `surface: run`, through `POST /api/queue/runs`, which is where a `#name` is substituted
  or refused before anything moves.

A `cell` row is the spreadsheet walk's, which is client-side (shared-ui `runConfig.ts`); the
walk's half of this fixture is for a node test. `schema` rows check what `inspect_device_module`
publishes, `import` rows are the legacy converters' and are skipped here.

Rows the edge does not meet yet are listed in NOT_YET with the fix that closes them (the N
numbers in the doc). They are strict xfails: when a fix lands, the row passes, the xfail
fails, and the entry is removed. Nothing is skipped silently.

Run on more than one Python (the doc's section 1 says why):

    cd edge_server && uv run --extra test pytest ../tests/automated/test_casting_ground_truth.py
    UV_PROJECT_ENVIRONMENT=.venv310 uv run --python 3.10 --extra test pytest ../tests/automated/test_casting_ground_truth.py
    UV_PROJECT_ENVIRONMENT=.venv314 uv run --python 3.14 --extra test pytest ../tests/automated/test_casting_ground_truth.py
"""

import asyncio
import inspect
import json
import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "example"))

from edge_case_sdl import EdgeCaseSDL  # noqa: E402

from ivoryos_edge.introspection import cast_arguments, inspect_device_module, resolve_callable  # noqa: E402
from ivoryos_edge.server import app  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "casting_ground_truth.json"
GROUND_TRUTH = json.loads(FIXTURE.read_text(encoding="utf-8"))
INSTRUMENT = GROUND_TRUTH["instrument"]

# Rows the edge does not meet yet, keyed "<test>:<id>[<input>]" as the test ids below spell them,
# each with the doc's fix number. Keyed per test because a row can fail on one door and pass on
# another. Strict: a row that starts passing must be taken out. The table held 135 rows when the
# fixture was written (2026-11-02, before the strict cast) and emptied the same day with N1, the
# edge half of N3 and the edge half of N5; it stays so a new row can be filed before its fix.
NOT_YET = {
}


# --------------------------------------------------------------------------------------
# The rows as test parameters
# --------------------------------------------------------------------------------------

OMITTED = object()


def _inputs(case):
    """Every input a row is run with: `(label, value)`, OMITTED meaning the argument is left out."""
    out = []
    typed = case.get("typed")
    if isinstance(typed, str):
        out.append((_label(typed), typed))
    elif isinstance(typed, list):
        out.extend((_label(t), t) for t in typed)
    for value in case.get("json", []):
        out.append(("json:" + json.dumps(value), value))
    if case.get("omitted"):
        out.append(("omitted", OMITTED))
    return out


def _label(text: str) -> str:
    return "blank" if text == "" else text


def _rows(test, surfaces, values_only=()):
    """The rows for these surfaces; a `refused` row on a surface in `values_only` is left out
    (a cell's blank is refused by the walk, a run's #name by start_run: not by the cast)."""
    params = []
    for case in GROUND_TRUTH["cases"]:
        if case["surface"] not in surfaces:
            continue
        if case["surface"] in values_only and "refused" in case["expect"]:
            continue
        for label, value in _inputs(case):
            test_id = f"{case['id']}[{label}]"
            marks = []
            if f"{test}:{test_id}" in NOT_YET:
                marks.append(pytest.mark.xfail(strict=True, reason=NOT_YET[f"{test}:{test_id}"]))
            params.append(pytest.param(case, value, id=test_id, marks=marks))
    return params


def _args(value):
    return {} if value is OMITTED else {"value": value}


def _expect_value(case, received):
    assert repr(received) == case["expect"]["value"], (
        f"{case['id']}: the driver got {received!r} ({type(received).__name__}), "
        f"the ground truth says {case['expect']['value']}")


def _expect_refusal(case, message):
    assert message is not None, f"{case['id']}: expected a refusal, the call went through"
    assert case["expect"]["refused"].lower() in str(message).lower(), (
        f"{case['id']}: refused, but the message does not say why: {message!r}")


@pytest.fixture(scope="module")
def deck():
    """The ground-truth instrument on the in-process edge, beside the conftest's dummy."""
    instrument = EdgeCaseSDL()
    app.state.instruments[INSTRUMENT] = instrument
    app.state.instrument_schemas[INSTRUMENT] = inspect_device_module(instrument)
    # The guard reads schemas when it first needs them and caches the deck; forget that cache
    # so the new instrument's declared choices are seen.
    from ivoryos_edge import safety
    if hasattr(safety.guard, "_deck_cache"):
        safety.guard._deck_cache = None
    yield instrument
    app.state.instruments.pop(INSTRUMENT, None)
    app.state.instrument_schemas.pop(INSTRUMENT, None)


@pytest.fixture(autouse=True)
def forget(deck):
    deck.received.clear()
    yield


# --------------------------------------------------------------------------------------
# 1. cast_arguments, the one place a value becomes a Python object
# --------------------------------------------------------------------------------------

@pytest.mark.parametrize("case,value", _rows("test_the_cast", {"field", "both", "cell", "run"}, values_only={"cell", "run"}))
def test_the_cast(deck, case, value):
    method = resolve_callable(deck, case["method"])
    refusal = None
    try:
        casted = cast_arguments(method, _args(value))
        if inspect.iscoroutinefunction(method):
            asyncio.run(method(**casted))
        else:
            method(**casted)
    except Exception as e:  # a refused cast, or a call Python itself refused (missing argument)
        refusal = e
    if "refused" in case["expect"]:
        _expect_refusal(case, refusal)
    else:
        assert refusal is None, f"{case['id']}: refused where a value was expected: {refusal}"
        _expect_value(case, deck.received[case["method"]])


# --------------------------------------------------------------------------------------
# 2. The Instruments page's door: guard, cast, call
# --------------------------------------------------------------------------------------

async def _execute(ac, case, value):
    """What `POST /api/execute` ends in: `(error message or None)`."""
    posted = await ac.post("/api/execute", json={"module": INSTRUMENT, "method": case["method"], "args": _args(value)})
    if posted.status_code != 200:
        body = posted.json()
        return body.get("error") or body.get("detail") or posted.text
    task_id = posted.json()["task_id"]
    for _ in range(100):
        status = (await ac.get(f"/api/execute/{task_id}")).json()
        if status.get("status") != "running":
            break
        await asyncio.sleep(0.02)
    return status.get("error") if status.get("status") == "error" else None


@pytest.mark.asyncio
@pytest.mark.parametrize("case,value", _rows("test_through_the_instruments_page", {"field", "both"}))
async def test_through_the_instruments_page(deck, case, value):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        error = await _execute(ac, case, value)
    if "refused" in case["expect"]:
        _expect_refusal(case, error)
    else:
        assert error is None, f"{case['id']}: refused where a value was expected: {error}"
        _expect_value(case, deck.received[case["method"]])


# --------------------------------------------------------------------------------------
# 3. A queued run: where a #name is substituted, or the run refused before it starts
# --------------------------------------------------------------------------------------

async def _run_one_step(ac, case, value):
    step = {"instrument": INSTRUMENT, "method": case["method"], "params": _args(value)}
    posted = await ac.post("/api/queue/runs", json={"name": f"ground truth {case['id']}", "sequence": [step]})
    if posted.status_code != 200:
        body = posted.json()
        return body.get("error") or body.get("detail") or posted.text
    run_id = posted.json()["run_id"]
    detail = {}
    for _ in range(100):
        detail = (await ac.get(f"/api/queue/runs/{run_id}")).json()
        if detail["status"] in ("completed", "error", "cancelled"):
            return None if detail["status"] == "completed" else json.dumps(detail["steps"])
        if detail["status"] == "paused":
            # A failed step waits for a person; end it so the queue is free for the next test.
            await ac.post(f"/api/queue/runs/{run_id}/resolve", json={"action": "stop"})
            return (detail["steps"] or [{}])[0].get("error") or "step failed"
        await asyncio.sleep(0.05)
    return f"run did not finish: {detail.get('status')}"


@pytest.mark.asyncio
@pytest.mark.parametrize("case,value", _rows("test_through_a_run", {"run"}))
async def test_through_a_run(deck, case, value):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        error = await _run_one_step(ac, case, value)
    if "refused" in case["expect"]:
        _expect_refusal(case, error)
    else:
        assert error is None, f"{case['id']}: refused where a value was expected: {error}"
        _expect_value(case, deck.received[case["method"]])


# --------------------------------------------------------------------------------------
# 4. What the schema says
# --------------------------------------------------------------------------------------

SCHEMA_ROWS = [pytest.param(c, id=c["id"], marks=[pytest.mark.xfail(strict=True, reason=NOT_YET[k])] if (k := f"test_the_schema:{c['id']}") in NOT_YET else [])
               for c in GROUND_TRUTH["cases"] if c["surface"] == "schema"]


@pytest.mark.parametrize("case", SCHEMA_ROWS)
def test_the_schema(deck, case):
    entry = app.state.instrument_schemas[INSTRUMENT][case["method"]]["parameters"]["value"]
    for key, expected in case["expect"].items():
        assert entry.get(key) == expected, f"{case['id']}: schema {key} is {entry.get(key)!r}, expected {expected!r}"


# --------------------------------------------------------------------------------------
# The fixture itself
# --------------------------------------------------------------------------------------

def test_every_row_names_a_method_the_deck_has(deck):
    schema = app.state.instrument_schemas[INSTRUMENT]
    for case in GROUND_TRUTH["cases"]:
        if case["surface"] == "import":
            continue
        assert case["method"] in schema, f"{case['id']} names {case['method']}, which the deck does not have"
        assert "value" in schema[case["method"]]["parameters"], case["id"]


def test_ids_are_unique():
    ids = [c["id"] for c in GROUND_TRUTH["cases"]]
    assert len(ids) == len(set(ids))
