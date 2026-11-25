"""A page's one socket, /api/ws (ivoryos_edge/live.py).

Pages used to ask /api/agent/proposals every five seconds from up to three places at once, which
filled the deck's log; now a change to any proposal is pushed as a `{pending, version}` hint, and
the list is fetched only when it changed.
"""
import asyncio
import logging

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from ivoryos_edge import live
from ivoryos_edge.models import WorkflowRun, async_session
from ivoryos_edge.server import app, queue_manager

DRAFT = {"name": "Pushed Draft", "prep": [], "cleanup": [],
         "script": [{"instrument": "dummy", "action": "test_method", "args": {"duration": 0}}]}


class Page:
    """Stands in for a browser's socket: what the hub sends it, in order."""

    def __init__(self):
        self.sent = []

    async def send_json(self, message):
        self.sent.append(message)

    def topic(self, name):
        return [m["data"] for m in self.sent if m["topic"] == name]


async def until(check, tries=100, every=0.02):
    for _ in range(tries):
        if check():
            return True
        await asyncio.sleep(every)
    return False


def test_a_page_is_sent_every_topic_as_it_connects():
    with TestClient(app).websocket_connect("/api/ws") as ws:
        messages = [ws.receive_json(), ws.receive_json(), ws.receive_json()]
    topics = {m["topic"]: m["data"] for m in messages}
    assert set(topics) == {"queue", "proposals", "workflows"}
    # The same status /api/ws/queue sends.
    assert "runs" in topics["queue"] and "queue_paused" in topics["queue"]["status"]
    assert topics["proposals"]["pending"] == 0 and topics["proposals"]["version"]
    assert topics["workflows"]["version"]


@pytest.mark.asyncio
async def test_proposal_changes_reach_open_pages_and_reading_them_does_not(api_workflows_dir):
    page = Page()
    await live.hub.connect(page)
    try:
        [start] = page.topic("proposals")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/agent/propose", json={"name": "Pushed Draft", "body": DRAFT})
            assert resp.status_code == 200, resp.text
            assert await until(lambda: len(page.topic("proposals")) == 2)
            filed = page.topic("proposals")[-1]
            assert filed["pending"] == start["pending"] + 1
            assert filed["version"] != start["version"]

            rejected_resp = await ac.post(f"/api/agent/proposals/{resp.json()['id']}/reject", json={})
            assert rejected_resp.status_code == 200
            assert await until(lambda: len(page.topic("proposals")) == 3)
            rejected = page.topic("proposals")[-1]
            assert rejected["pending"] == start["pending"]
            assert rejected["version"] not in (start["version"], filed["version"])

            # Reading the list, or refusing a second answer, changes nothing and says nothing.
            await ac.get("/api/agent/proposals?status=pending")
            again = await ac.post(f"/api/agent/proposals/{resp.json()['id']}/reject", json={})
            assert again.status_code == 409
            await asyncio.sleep(0.1)
            assert len(page.topic("proposals")) == 3
    finally:
        live.hub.disconnect(page)


@pytest.mark.asyncio
async def test_workflow_changes_reach_open_pages_from_every_door(api_workflows_dir):
    """An open Designer's toolbox follows saved workflows (issue 92): every write announces itself,
    whichever way it came in, and a save that changed nothing does not."""
    page = Page()
    await live.hub.connect(page)
    versions = lambda: [m["version"] for m in page.topic("workflows")]
    try:
        assert len(versions()) == 1
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            # A save from the Designer (or Cloud's editor): announced, and the stored body comes back.
            resp = await ac.post("/api/workflows/Wash", json=DRAFT)
            assert resp.status_code == 200, resp.text
            saved = resp.json()
            assert saved["body"]["version"] == saved["version"] == 1
            assert saved["body"]["body_hash"] == saved["body_hash"]
            assert saved["body"]["script"] == DRAFT["script"]
            assert await until(lambda: len(versions()) == 2)

            # The same body again is not an edit, and says nothing.
            again = await ac.post("/api/workflows/Wash", json=DRAFT)
            assert again.json()["created_version"] is False
            await asyncio.sleep(0.1)
            assert len(versions()) == 2

            # Re-filing it.
            await ac.put("/api/workflows/Wash/tags", json={"tags": ["cleaning"]})
            assert await until(lambda: len(versions()) == 3)

            # A proposal accepted into the library.
            filed = await ac.post("/api/agent/propose", json={"name": "Pushed Draft", "body": DRAFT})
            accepted = await ac.post(f"/api/agent/proposals/{filed.json()['id']}/accept", json={})
            assert accepted.status_code == 200 and accepted.json()["saved"], accepted.text
            assert await until(lambda: len(versions()) == 4)

            # Deleting runs in a worker thread (a plain `def` route), off the server's loop.
            gone = await ac.delete("/api/workflows/Wash")
            assert gone.status_code == 200, gone.text
            assert await until(lambda: len(versions()) == 5)

        assert len(set(versions())) == 5
    finally:
        live.hub.disconnect(page)


@pytest.mark.asyncio
async def test_a_workflow_pushed_from_cloud_is_announced(api_workflows_dir):
    from ivoryos_edge.server import handle_sequence_push

    page = Page()
    await live.hub.connect(page)
    try:
        await handle_sequence_push({"name": "From Cloud", "body": DRAFT})
        assert await until(lambda: len(page.topic("workflows")) == 2)
    finally:
        live.hub.disconnect(page)


@pytest.mark.asyncio
async def test_queue_changes_reach_open_pages():
    page = Page()
    await live.hub.connect(page)
    try:
        await queue_manager.broadcast_global_queue()
        assert len(page.topic("queue")) == 2
        assert page.sent[-1]["topic"] == "queue"
    finally:
        live.hub.disconnect(page)


@pytest.mark.asyncio
async def test_a_page_that_has_gone_is_dropped():
    class Gone:
        async def send_json(self, message):
            raise RuntimeError("closed")

    page = Gone()
    await live.hub.connect(page)
    assert page not in live.hub.connections


@pytest_asyncio.fixture
async def finished_run():
    """A run for /api/ws/runs/{id} to send the state of."""
    async with async_session() as session:
        run = WorkflowRun(name="Socket test", status="completed", parameters={})
        session.add(run)
        await session.commit()
        run_id = run.id
    yield run_id
    async with async_session() as session:
        await session.delete(await session.get(WorkflowRun, run_id))
        await session.commit()


async def connect_and(path, *, leave_at_once):
    """One connection to the app as uvicorn makes it. TestClient cannot stand in for this: its
    sends never fail, and a client that has gone is exactly a send that fails. uvicorn then raises
    ClientDisconnected (an OSError) from send and reports the disconnect to receive."""
    scope = {"type": "websocket", "asgi": {"version": "3.0"}, "scheme": "ws", "http_version": "1.1",
             "path": path, "raw_path": path.encode(), "root_path": "", "query_string": b"",
             "headers": [(b"host", b"testserver")], "client": ("127.0.0.1", 50000),
             "server": ("testserver", 80), "subprotocols": [], "state": {}}
    inbox = asyncio.Queue()
    inbox.put_nowait({"type": "websocket.connect"})
    if not leave_at_once:
        # Stays for its opening state, then closes as a page does.
        inbox.put_nowait({"type": "websocket.disconnect", "code": 1000})
    sent = []

    async def send(message):
        sent.append(message["type"])
        if leave_at_once and message["type"] == "websocket.send":
            inbox.put_nowait({"type": "websocket.disconnect", "code": 1006})
            raise OSError("client disconnected")

    await asyncio.wait_for(app(scope, inbox.get, send), timeout=10)
    return sent


@pytest.mark.asyncio
@pytest.mark.parametrize("leave_at_once", [True, False], ids=["leaves-while-sent-its-state", "closes-later"])
@pytest.mark.parametrize("path", ["/api/ws", "/api/ws/queue", "/api/ws/runs/{run}"])
async def test_a_client_leaving_ends_its_socket_quietly_and_is_dropped(path, leave_at_once, finished_run):
    """A page closed or reloaded while the edge was still sending it the current state (React's
    development mode connects and closes at once, and a busy deck reads that state slowly) used to
    reach the server log as 'Exception in ASGI application ... WebSocket is not connected'."""
    def held():
        return (len(live.hub.connections), len(queue_manager.global_connections),
                len(queue_manager.active_connections.get(finished_run, [])))

    before = held()
    sent = await connect_and(path.format(run=finished_run), leave_at_once=leave_at_once)

    assert sent[:2] == ["websocket.accept", "websocket.send"]
    assert held() == before


def test_the_launchers_cloud_poll_is_left_out_of_the_log_unless_it_fails():
    quiet = next(f for f in logging.getLogger("uvicorn.access").filters if type(f).__name__ == "_QuietPolls")

    def logged(method, path, status):
        record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                                   ("127.0.0.1:5000", method, path, "1.1", status), None)
        return quiet.filter(record)

    assert not logged("GET", "/api/cloud-settings", 200)
    assert logged("GET", "/api/cloud-settings", 500)
    assert logged("POST", "/api/cloud-settings/pause", 200)
    assert logged("GET", "/api/agent/proposals?status=pending", 200)
