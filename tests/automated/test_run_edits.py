"""Changing a run while it runs (run_edits.py, queue.edit_step / replan_active_run).

* A failed step can be given different arguments before it is retried, so a retry is not the
  same failure again. "This and every later run of it" changes the same step on the samples (or
  optimization trials) still to come, except where a later sample takes that argument from its
  own table column: the table says what each sample gets.
* The samples still to come can be changed, added or removed while the run goes; the samples
  already started cannot, and are kept exactly as they were.
* The same two changes arrive from Cloud on `task-control`, and the outcome goes back with the
  run's progress.
"""

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from ivoryos_edge import queue as queue_module
from ivoryos_edge import run_edits, server
from ivoryos_edge.optimizer.base_optimizer import OptimizerBase
from ivoryos_edge.optimizer.registry import OPTIMIZER_REGISTRY
from ivoryos_edge.server import app, queue_manager

from test_cloud_dispatch import RecordingBroker


async def until(check, tries=200, every=0.05):
    for _ in range(tries):
        if check():
            return True
        await asyncio.sleep(every)
    return False


async def decision_for(run_id, after=None):
    fresh = lambda: queue_manager.awaiting_decision == run_id and queue_manager.decision \
        and queue_manager.decision["key"] != (after or {}).get("key")
    assert await until(fresh), "the run did not stop for a decision"
    return queue_manager.decision


async def finished(ac, run_id):
    for _ in range(200):
        run = (await ac.get(f"/api/queue/runs/{run_id}")).json()
        if run.get("end_time") and run["status"] in ("completed", "error", "cancelled") \
                and queue_manager.active_run_id != run_id:
            return run
        await asyncio.sleep(0.05)
    raise AssertionError(f"the run did not end: {run['status']}")


def failed_step(run):
    return next(s for s in run["steps"] if s["status"] == "error")


def spreadsheet(name, rows, measure=lambda i, row: {"value": row["v"], "_vars": {"value": "v"}}, batch_size=1, extra=None):
    """A run as the Iterate page sends it (shared-ui expandSpreadsheet + toSubmittedStep): two
    blocks per row, the first taking `v` from the row unless `measure` says otherwise."""
    sequence = []
    for i, row in enumerate(rows):
        sequence.append({"instrument": "dummy", "method": "strict_echo",
                         "params": {**measure(i, row), "_row": i, "_block": 0}})
        sequence.append({"instrument": "dummy", "method": "echo_method",
                         "params": {"value": f"done {i}", "_row": i, "_block": 1}})
    return {
        "name": name,
        "parameters": {"type": "Spreadsheet", "variables": ["v"], "rows": rows, "batch_size": batch_size, **(extra or {})},
        "sequence": sequence,
    }


async def submit(ac, payload):
    resp = await ac.post("/api/queue/runs", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()["run_id"]


@pytest.fixture(autouse=True)
def running_queue():
    queue_manager.resume()
    yield
    queue_manager.resume()


def measured(run):
    """What each sample's strict_echo ran with, in the order they ran."""
    return [(s["parameters"]["_row"], s["parameters"].get("value"), s["status"])
            for s in run["steps"] if s["method"] == "strict_echo"]


# --- a failed step, changed and retried ---------------------------------------------------------

@pytest.mark.asyncio
async def test_a_failed_steps_fixed_value_is_changed_for_it_and_every_later_sample():
    literal = lambda i, row: {"value": 50}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, spreadsheet("Fix the dose", [{"v": "1"}, {"v": "2"}, {"v": "3"}], literal))
        await decision_for(run_id)
        run = (await ac.get(f"/api/queue/runs/{run_id}")).json()
        step = failed_step(run)

        info = (await ac.get(f"/api/queue/runs/{run_id}/steps/{step['id']}")).json()
        assert info["editable"] is True and info["args"] == {"value": 50} and info["columns"] == {}
        assert info["later"] == 2  # the same step on the two samples still to come
        assert "value" in info["schema"]["parameters"]

        resp = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}",
                              json={"args": {"value": 5}, "scope": "later", "then": "retry", "by": "tester"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["later"] == 2 and resp.json()["retried"] is True

        run = await finished(ac, run_id)
        assert run["status"] == "completed"
        assert measured(run) == [(0, 5, "completed"), (1, 5, "completed"), (2, 5, "completed")]
        first = next(s for s in run["steps"] if s["method"] == "strict_echo")
        assert first["parameters"]["_edited"] == ["value"]
        assert len(first["outputs"]["attempts"]) == 1  # the failure is still on its record
        edits = run["parameters"]["_edits"]
        assert edits[-1]["kind"] == "step" and edits[-1]["changes"] == {"value": [50, 5]} and edits[-1]["by"] == "tester"
        assert run["parameters"]["_overrides"][0]["args"] == {"value": 5}


@pytest.mark.asyncio
async def test_this_step_only_leaves_the_later_samples_as_they_were():
    literal = lambda i, row: {"value": 50}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, spreadsheet("One-off fix", [{"v": "1"}, {"v": "2"}], literal))
        first = await decision_for(run_id)
        step = failed_step((await ac.get(f"/api/queue/runs/{run_id}")).json())
        resp = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}",
                              json={"args": {"value": 5}, "scope": "step", "then": "retry"})
        assert resp.status_code == 200, resp.text

        await decision_for(run_id, after=first)  # sample 2 fails the old way
        again = failed_step((await ac.get(f"/api/queue/runs/{run_id}")).json())
        assert again["parameters"]["_row"] == 1 and again["parameters"]["value"] == 50
        await ac.post(f"/api/queue/runs/{run_id}/resolve", json={"action": "skip"})
        run = await finished(ac, run_id)
        assert measured(run)[0] == (0, 5, "completed")


@pytest.mark.asyncio
async def test_a_value_from_the_table_is_changed_for_that_sample_only():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, spreadsheet("Column fix", [{"v": 50}, {"v": 3}, {"v": 60}]))
        first = await decision_for(run_id)
        step = failed_step((await ac.get(f"/api/queue/runs/{run_id}")).json())
        info = (await ac.get(f"/api/queue/runs/{run_id}/steps/{step['id']}")).json()
        assert info["columns"] == {"value": "v"}

        # "Every later run" still leaves a later sample's own column value alone.
        resp = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}",
                              json={"args": {"value": 5}, "scope": "later", "then": "retry"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["later"] == 0

        await decision_for(run_id, after=first)  # sample 3's own 60 fails
        run = (await ac.get(f"/api/queue/runs/{run_id}")).json()
        assert measured(run)[:2] == [(0, 5, "completed"), (1, 3, "completed")]
        own = next(s for s in run["steps"] if s["method"] == "strict_echo")
        assert "_vars" not in own["parameters"]  # no longer claims the column gave it
        third = failed_step(run)
        assert third["parameters"]["value"] == 60 and third["parameters"]["_vars"] == {"value": "v"}
        await ac.post(f"/api/queue/runs/{run_id}/resolve", json={"action": "stop"})
        await finished(ac, run_id)


@pytest.mark.asyncio
async def test_what_cannot_be_changed_is_refused_with_why():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, spreadsheet("Refusals", [{"v": "1"}, {"v": 50}]))
        await decision_for(run_id)
        run = (await ac.get(f"/api/queue/runs/{run_id}")).json()
        done = next(s for s in run["steps"] if s["status"] == "completed")
        step = failed_step(run)

        ran = await ac.patch(f"/api/queue/runs/{run_id}/steps/{done['id']}", json={"args": {"value": 2}})
        assert ran.status_code == 409 and "already run" in ran.json()["error"]
        typo = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}", json={"args": {"valeu": 2}})
        assert typo.status_code == 409 and "valeu" in typo.json()["error"]
        hidden = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}", json={"args": {"_row": 0}})
        assert hidden.status_code == 409
        unknown = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}", json={"args": {"value": "#nothing"}})
        assert unknown.status_code == 409 and "#nothing" in unknown.json()["error"]
        same = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}", json={"args": {"value": 50}})
        assert same.status_code == 409

        await ac.post(f"/api/queue/runs/{run_id}/resolve", json={"action": "stop"})
        await finished(ac, run_id)
        late = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}", json={"args": {"value": 2}})
        assert late.status_code == 409 and "ended" in late.json()["error"]


# --- the samples still to come ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_samples_still_to_come_are_changed_added_and_removed_while_it_runs():
    rows = [{"v": 50}, {"v": "2"}, {"v": "3"}]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, spreadsheet("Change the rest", rows))
        await decision_for(run_id)  # sample 1 failed, so it has started; 2 and 3 have not
        run = (await ac.get(f"/api/queue/runs/{run_id}")).json()
        assert run["editable_from"] == 1

        started = await ac.put(f"/api/queue/runs/{run_id}", json=spreadsheet("x", [{"v": 4}, {"v": "2"}, {"v": "3"}]))
        assert started.status_code == 409 and "Sample 1 has started" in started.json()["error"]
        resized = await ac.put(f"/api/queue/runs/{run_id}", json=spreadsheet("x", rows, batch_size=2))
        assert resized.status_code == 409

        # Sample 2 changed, sample 3 removed, two more added.
        new_rows = [{"v": 50}, {"v": "7"}, {"v": "8"}, {"v": "9"}]
        resp = await ac.put(f"/api/queue/runs/{run_id}", json=spreadsheet("x", new_rows))
        assert resp.status_code == 200, resp.text
        assert resp.json()["running"] is True and resp.json()["from_row"] == 2

        await ac.post(f"/api/queue/runs/{run_id}/resolve", json={"action": "skip"})
        run = await finished(ac, run_id)
        assert run["status"] == "completed"
        assert run["parameters"]["rows"] == new_rows
        assert measured(run) == [(0, 50, "skipped"), (1, "7", "completed"), (2, "8", "completed"), (3, "9", "completed")]
        assert [s["outputs"]["result"] for s in run["steps"] if s["method"] == "echo_method"] == \
            ["done 0", "done 1", "done 2", "done 3"]
        record = run["parameters"]["_edits"][-1]
        assert record["kind"] == "rows" and record["from_row"] == 2 and record["rows"] == 4


@pytest.mark.asyncio
async def test_samples_change_while_a_prompt_waits_and_the_run_goes_on_with_them():
    ask = {"instrument": "Flow_Control", "method": "User_Input",
           "params": {"variable_name": "", "prompt": "Load the vials", "_row": 0, "_block": 2}}
    payload = spreadsheet("Prompted", [{"v": "1"}, {"v": "2"}])
    payload["sequence"].insert(2, ask)  # after sample 1's two steps
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, payload)
        assert await until(lambda: run_id in queue_manager.pending_input_event)

        changed = spreadsheet("Prompted", [{"v": "1"}, {"v": "6"}, {"v": "4"}])
        changed["sequence"].insert(2, ask)
        resp = await ac.put(f"/api/queue/runs/{run_id}", json=changed)
        assert resp.status_code == 200, resp.text

        await ac.post(f"/api/queue/runs/{run_id}/input", json={"value": ""})
        run = await finished(ac, run_id)
        assert run["status"] == "completed"
        assert measured(run) == [(0, "1", "completed"), (1, "6", "completed"), (2, "4", "completed")]


@pytest.mark.asyncio
async def test_a_changed_value_for_every_later_run_survives_a_change_of_rows():
    literal = lambda i, row: {"value": 50}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, spreadsheet("Both", [{"v": "1"}, {"v": "2"}], literal))
        await decision_for(run_id)
        step = failed_step((await ac.get(f"/api/queue/runs/{run_id}")).json())
        resp = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}", json={"args": {"value": 5}, "scope": "later"})
        assert resp.status_code == 200

        # Re-planned from the table and the workflow, which still say 50: the kept change wins.
        resp = await ac.put(f"/api/queue/runs/{run_id}", json=spreadsheet("Both", [{"v": "1"}, {"v": "2"}, {"v": "3"}], literal))
        assert resp.status_code == 200, resp.text
        await ac.post(f"/api/queue/runs/{run_id}/resolve", json={"action": "retry"})
        run = await finished(ac, run_id)
        assert [v for _, v, _ in measured(run)] == [5, 5, 5]


@pytest.mark.asyncio
async def test_a_started_batch_is_kept_whole():
    rows = [{"v": "1"}, {"v": 50}, {"v": "3"}, {"v": "4"}]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Batch of two: both samples' strict_echo run before either's echo (block-major).
        payload = spreadsheet("Batched", rows, batch_size=2)
        seq = payload["sequence"]
        payload["sequence"] = [seq[0], seq[2], seq[1], seq[3], seq[4], seq[6], seq[5], seq[7]]
        run_id = await submit(ac, payload)
        await decision_for(run_id)  # sample 2 failed inside batch 1
        run = (await ac.get(f"/api/queue/runs/{run_id}")).json()
        assert run["editable_from"] == 2

        refused = await ac.put(f"/api/queue/runs/{run_id}", json={**payload, "parameters": {**payload["parameters"], "rows": [rows[0], {"v": 2}, *rows[2:]]}})
        assert refused.status_code == 409 and "Sample 2" in refused.json()["error"]
        await ac.post(f"/api/queue/runs/{run_id}/resolve", json={"action": "stop"})
        await finished(ac, run_id)


def test_the_samples_already_started_decide_where_changes_may_begin():
    steps = [
        {"id": 1, "instrument": "d", "method": "m", "status": "completed", "parameters": {"_row": 0, "_block": 0}},
        {"id": 2, "instrument": "d", "method": "m", "status": "pending", "parameters": {"_row": 1, "_block": 0}},
        {"id": 3, "instrument": "d", "method": "m", "status": "pending", "parameters": {"_row": 2, "_block": 0}},
    ]
    run = {"status": "running", "parameters": {"type": "Spreadsheet", "rows": [{}, {}, {}], "batch_size": 1}, "steps": steps}
    assert run_edits.editable_from(run) == 1
    run["parameters"]["batch_size"] = 2
    assert run_edits.editable_from(run) == 2
    steps[2]["status"] = "running"
    # The last batch has started without being full: nothing can join it.
    assert run_edits.editable_from(run) is None
    assert run_edits.editable_from({**run, "parameters": {"type": "Simple"}}) is None


# --- an optimization's later trials -------------------------------------------------------------

class Steady(OptimizerBase):
    observed = []

    def suggest(self, n=1):
        return [{"x": 0.5} for _ in range(n)]

    def observe(self, results):
        Steady.observed.extend(results)

    def append_existing_data(self, existing_data, file_path=None):
        pass

    def get_plots(self, plot_type):
        return None

    @staticmethod
    def get_schema():
        return {"parameter_types": ["range"], "multiple_objectives": False, "optimizer_config": {}}


@pytest.mark.asyncio
async def test_a_change_for_every_later_trial_reaches_the_trials_not_yet_made():
    OPTIMIZER_REGISTRY["steady"] = Steady
    Steady.observed = []
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            run_id = await submit(ac, {
                "name": "Optimize with a bad dose",
                "parameters": {
                    "type": "Optimization", "optimizer": "steady", "budget": 3, "optimizer_config": {},
                    "parameter_space": [{"name": "x", "type": "range", "bounds": [0.0, 1.0], "value_type": "float"}],
                    "objective_config": [{"name": "y", "minimize": False}],
                    "sequence_template": [
                        {"instrument": "dummy", "method": "strict_echo", "params": {"value": 50}, "returnVar": "y"},
                    ],
                },
            })
            await decision_for(run_id)
            step = failed_step((await ac.get(f"/api/queue/runs/{run_id}")).json())
            info = (await ac.get(f"/api/queue/runs/{run_id}/steps/{step['id']}")).json()
            assert info["later_trials"] is True
            resp = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}",
                                  json={"args": {"value": 4}, "scope": "later", "then": "retry"})
            assert resp.status_code == 200, resp.text
            run = await finished(ac, run_id)
            assert run["status"] == "completed"
            values = [s["parameters"]["value"] for s in run["steps"] if s["method"] == "strict_echo"]
            assert values == [4, 4, 4]
            assert [o["y"] for o in Steady.observed] == [4.0, 4.0, 4.0]
    finally:
        del OPTIMIZER_REGISTRY["steady"]


# --- from Cloud ---------------------------------------------------------------------------------

@pytest.fixture
def broker(monkeypatch):
    b = RecordingBroker()
    monkeypatch.setattr(server, "global_broker", b)
    monkeypatch.setattr(server, "global_topic_prefix", "ivoryos/edge")
    monkeypatch.setattr(queue_module, "PROGRESS_MIN_INTERVAL_S", 0.0)
    return b


async def progress_where(broker, node_id, check, timeout_s=5.0):
    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        found = [p for p in broker.progress_for(node_id) if check(p)]
        if found:
            return found[-1]
        await asyncio.sleep(0.05)
    raise AssertionError(f"{node_id}: no progress matched: {broker.progress_for(node_id)[-3:]}")


@pytest.mark.asyncio
async def test_cloud_changes_a_failed_step_and_retries_it(broker):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        body = spreadsheet("From Cloud", [{"v": 50}, {"v": "2"}])
        await server.handle_cloud_task({"runId": "c_fix", "nodeId": "n_fix", "run": body})
        paused = await progress_where(broker, "n_fix", lambda p: str(p.get("pause", "")).startswith("error:"))
        edit = paused["edit"]
        assert edit["args"] == {"value": 50} and edit["columns"] == {"value": "v"} and edit["method"] == "strict_echo"
        assert paused["editable_from"] == 1

        message = {"runId": "c_fix", "nodeId": "n_fix", "pause": paused["pause"], "action": "retry", "id": "cmd-1",
                   "edit": {"step_id": edit["step_id"], "args": {"value": 99}, "scope": "step"}}
        await server.handle_broker_message("ivoryos/edge/test-device/task-control", message)
        refused = await progress_where(broker, "n_fix", lambda p: (p.get("edit_result") or {}).get("id") == "cmd-1")
        assert refused["edit_result"]["ok"] is True  # 99 is a value; the instrument refuses it on retry

        again = await progress_where(broker, "n_fix", lambda p: str(p.get("pause", "")).startswith("error:")
                                     and p["pause"] != paused["pause"])
        message = {**message, "pause": again["pause"], "id": "cmd-2",
                   "edit": {"step_id": edit["step_id"], "args": {"value": 3}, "scope": "step"}}
        await server.handle_broker_message("ivoryos/edge/test-device/task-control", message)
        run_id = queue_manager.active_run_id
        run = await finished(ac, run_id)
        assert run["status"] == "completed"
        assert measured(run) == [(0, 3, "completed"), (1, "2", "completed")]


@pytest.mark.asyncio
async def test_cloud_changes_the_samples_still_to_come(broker):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        await server.handle_cloud_task({"runId": "c_rows", "nodeId": "n_rows",
                                        "run": spreadsheet("Cloud rows", [{"v": 50}, {"v": "2"}])})
        paused = await progress_where(broker, "n_rows", lambda p: str(p.get("pause", "")).startswith("error:"))
        run_id = queue_manager.active_run_id

        edit = {"runId": "c_rows", "nodeId": "n_rows", "action": "edit_rows", "id": "rows-1",
                "run": spreadsheet("Cloud rows", [{"v": 50}, {"v": "6"}, {"v": "7"}])}
        await server.handle_broker_message("ivoryos/edge/test-device/task-control", edit)
        answered = await progress_where(broker, "n_rows", lambda p: (p.get("edit_result") or {}).get("id") == "rows-1")
        assert answered["edit_result"] == {"id": "rows-1", "ok": True}

        bad = {**edit, "id": "rows-2", "run": spreadsheet("Cloud rows", [{"v": 1}, {"v": "6"}])}
        await server.handle_broker_message("ivoryos/edge/test-device/task-control", bad)
        refused = await progress_where(broker, "n_rows", lambda p: (p.get("edit_result") or {}).get("id") == "rows-2")
        assert refused["edit_result"]["ok"] is False and "Sample 1" in refused["edit_result"]["error"]

        await server.handle_broker_message("ivoryos/edge/test-device/task-control", {
            "runId": "c_rows", "nodeId": "n_rows", "pause": paused["pause"], "action": "skip"})
        run = await finished(ac, run_id)
        assert measured(run) == [(0, 50, "skipped"), (1, "6", "completed"), (2, "7", "completed")]


# --- an agent proposes, a person applies --------------------------------------------------------

@pytest.mark.asyncio
async def test_an_agent_proposes_a_step_fix_and_nothing_changes_until_a_person_applies_it():
    literal = lambda i, row: {"value": 50}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        payload = spreadsheet("Agent fix", [{"v": "1"}, {"v": "2"}], literal)
        payload["parameters"]["_source"] = {"page": "iterate"}
        run_id = await submit(ac, payload)
        await decision_for(run_id)

        seen = (await ac.get(f"/api/agent/runs/{run_id}/steps")).json()
        step_id = seen["waiting_on"]["failed_step_id"]
        assert seen["samples_that_can_change_from"] == 2
        assert next(s for s in seen["steps"] if s["step_id"] == step_id)["args"] == {"value": 50}
        assert any(r["run_id"] == run_id for r in (await ac.get("/api/agent/live")).json()["runs"])

        typo = await ac.post(f"/api/agent/runs/{run_id}/propose-step-fix", json={"step_id": step_id, "args": {"valeu": 5}})
        assert typo.status_code == 400 and "valeu" in typo.json()["error"]
        filed = await ac.post(f"/api/agent/runs/{run_id}/propose-step-fix", json={
            "step_id": step_id, "args": {"value": 5}, "summary": "50 is above the limit; 5 is in range.", "source": "test-agent"})
        assert filed.status_code == 200, filed.text
        proposal = filed.json()
        assert proposal["kind"] == "step_edit" and proposal["payload"]["then"] == "retry"
        assert queue_manager.awaiting_decision == run_id  # nothing happened yet
        step = next(s for s in (await ac.get(f"/api/queue/runs/{run_id}")).json()["steps"] if s["id"] == step_id)
        assert step["parameters"]["value"] == 50

        accepted = await ac.post(f"/api/agent/proposals/{proposal['id']}/accept", json={})
        assert accepted.status_code == 200, accepted.text
        run = await finished(ac, run_id)
        assert [v for _, v, _ in measured(run)] == [5, 5]
        assert "test-agent" in run["parameters"]["_edits"][-1]["by"]


@pytest.mark.asyncio
async def test_an_agent_proposes_samples_and_they_are_applied_from_the_table():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        payload = spreadsheet("Agent samples", [{"v": 50}, {"v": "2"}])
        payload["parameters"]["_source"] = {"page": "iterate"}
        run_id = await submit(ac, payload)
        await decision_for(run_id)

        started = await ac.post(f"/api/agent/runs/{run_id}/propose-samples", json={"samples": [{"v": 1}, {"v": "3"}]})
        assert started.status_code == 409 and "have started" in started.json()["error"]
        column = await ac.post(f"/api/agent/runs/{run_id}/propose-samples", json={"samples": [{"v": 50}, {"w": 3}]})
        assert column.status_code == 400 and "w" in column.json()["error"]
        filed = await ac.post(f"/api/agent/runs/{run_id}/propose-samples", json={
            "samples": [{"v": 50}, {"v": "3"}, {"v": "4"}], "summary": "Add a fourth point.", "source": "test-agent"})
        assert filed.status_code == 200, filed.text
        proposal = filed.json()

        # Accepting it here points at the table, where it is reviewed and saved.
        direct = await ac.post(f"/api/agent/proposals/{proposal['id']}/accept", json={})
        assert direct.status_code == 409 and direct.json()["review"] == f"/execution?edit={run_id}&proposal={proposal['id']}"

        body = spreadsheet("Agent samples", [{"v": 50}, {"v": "3"}, {"v": "4"}])
        body["parameters"]["_source"] = {"page": "iterate"}
        saved = await ac.put(f"/api/queue/runs/{run_id}", json={**body, "proposal": proposal["id"]})
        assert saved.status_code == 200, saved.text
        closed = (await ac.get(f"/api/agent/proposals/{proposal['id']}")).json()
        assert closed["status"] == "accepted" and closed["decided_note"] == "Applied as proposed."

        await ac.post(f"/api/queue/runs/{run_id}/resolve", json={"action": "skip"})
        run = await finished(ac, run_id)
        assert measured(run) == [(0, 50, "skipped"), (1, "3", "completed"), (2, "4", "completed")]


@pytest.mark.asyncio
async def test_only_the_run_under_way_says_which_samples_can_still_change():
    """A queued run is changed whole (replace_pending_run), so it carries no `editable_from`: the
    Iterate page reads that field to tell a run under way from a queued one."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        running = await submit(ac, spreadsheet("Under way", [{"v": 50}, {"v": "2"}]))
        await decision_for(running)
        queued = await submit(ac, spreadsheet("Waiting", [{"v": "1"}]))
        assert (await ac.get(f"/api/queue/runs/{running}")).json()["editable_from"] == 1
        assert "editable_from" not in (await ac.get(f"/api/queue/runs/{queued}")).json()
        await ac.post(f"/api/queue/runs/{running}/resolve", json={"action": "stop"})
        await finished(ac, running)
        await ac.post(f"/api/queue/runs/{queued}/cancel")


# --- an optimization's budget -------------------------------------------------------------------

def optimization_run(name, budget, extra=None):
    return {
        "name": name,
        "parameters": {
            "type": "Optimization", "optimizer": "steady", "budget": budget, "optimizer_config": {},
            "parameter_space": [{"name": "x", "type": "range", "bounds": [0.0, 1.0], "value_type": "float"}],
            "objective_config": [{"name": "y", "minimize": False}],
            "sequence_template": [
                {"instrument": "dummy", "method": "strict_echo", "params": {"value": 50}, "returnVar": "y"},
            ],
            **(extra or {}),
        },
        "cleanup": [{"instrument": "dummy", "method": "echo_method", "params": {"value": "teardown"}}],
    }


@pytest.fixture
def steady():
    OPTIMIZER_REGISTRY["steady"] = Steady
    Steady.observed = []
    yield
    del OPTIMIZER_REGISTRY["steady"]


async def fix_and_retry(ac, run_id):
    step = failed_step((await ac.get(f"/api/queue/runs/{run_id}")).json())
    resp = await ac.patch(f"/api/queue/runs/{run_id}/steps/{step['id']}",
                          json={"args": {"value": 4}, "scope": "later", "then": "retry"})
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_an_optimization_can_be_given_more_trials_while_it_runs(steady):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, optimization_run("More trials", 2))
        await decision_for(run_id)  # trial 1 failed: under way, one trial begun
        assert (await ac.get(f"/api/queue/runs/{run_id}")).json()["trials_begun"] == 1

        resp = await ac.patch(f"/api/queue/runs/{run_id}/budget", json={"budget": 4, "by": "tester"})
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "updated", "budget": 4, "before": 2, "begun": 1}
        await fix_and_retry(ac, run_id)
        run = await finished(ac, run_id)
        assert run["status"] == "completed" and len(Steady.observed) == 4
        assert run["parameters"]["budget"] == 4
        assert run["parameters"]["_edits"][0] == {**run["parameters"]["_edits"][0], "kind": "budget", "before": 2, "after": 4}


@pytest.mark.asyncio
async def test_an_optimization_can_be_cut_short_but_not_below_the_trials_begun(steady):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, optimization_run("Fewer trials", 5))
        await decision_for(run_id)
        below = await ac.patch(f"/api/queue/runs/{run_id}/budget", json={"budget": 0})
        assert below.status_code == 409 and "cannot be less than 1" in below.json()["error"]
        word = await ac.patch(f"/api/queue/runs/{run_id}/budget", json={"budget": "many"})
        assert word.status_code == 409
        assert (await ac.patch(f"/api/queue/runs/{run_id}/budget", json={"budget": 1})).status_code == 200

        await fix_and_retry(ac, run_id)
        run = await finished(ac, run_id)
        # The trial in progress finishes, then the run ends as one that used its budget: cleanup runs.
        assert run["status"] == "completed" and len(Steady.observed) == 1
        assert [s["outputs"]["result"] for s in run["steps"] if s["method"] == "echo_method"] == ["teardown"]
        late = await ac.patch(f"/api/queue/runs/{run_id}/budget", json={"budget": 3})
        assert late.status_code == 409


@pytest.mark.asyncio
async def test_only_an_optimization_has_a_budget():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        run_id = await submit(ac, spreadsheet("No budget", [{"v": 50}]))
        await decision_for(run_id)
        refused = await ac.patch(f"/api/queue/runs/{run_id}/budget", json={"budget": 3})
        assert refused.status_code == 409 and "optimization" in refused.json()["error"]
        await ac.post(f"/api/queue/runs/{run_id}/resolve", json={"action": "stop"})
        await finished(ac, run_id)


@pytest.mark.asyncio
async def test_cloud_changes_an_optimizations_budget(broker, steady):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        await server.handle_cloud_task({"runId": "c_budget", "nodeId": "n_budget", "run": optimization_run("Cloud budget", 2)})
        await progress_where(broker, "n_budget", lambda p: str(p.get("pause", "")).startswith("error:"))
        run_id = queue_manager.active_run_id

        message = {"runId": "c_budget", "nodeId": "n_budget", "action": "set_budget", "budget": 3, "id": "b-1"}
        await server.handle_broker_message("ivoryos/edge/test-device/task-control", message)
        answered = await progress_where(broker, "n_budget", lambda p: (p.get("edit_result") or {}).get("id") == "b-1")
        assert answered["edit_result"] == {"id": "b-1", "ok": True} and answered["budget"] == 3

        await server.handle_broker_message("ivoryos/edge/test-device/task-control", {**message, "budget": 0, "id": "b-2"})
        refused = await progress_where(broker, "n_budget", lambda p: (p.get("edit_result") or {}).get("id") == "b-2")
        assert refused["edit_result"]["ok"] is False

        await fix_and_retry(ac, run_id)
        run = await finished(ac, run_id)
        assert len(Steady.observed) == 3
