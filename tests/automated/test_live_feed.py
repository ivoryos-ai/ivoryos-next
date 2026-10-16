"""A page's one socket, /api/ws (ivoryos_edge/live.py).

Pages used to ask /api/agent/proposals every five seconds from up to three places at once, which
filled the deck's log; now a change to any proposal is pushed as a `{pending, version}` hint, and
the list is fetched only when it changed.
"""
import asyncio
import logging

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from ivoryos_edge import live
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
        messages = [ws.receive_json(), ws.receive_json()]
    topics = {m["topic"]: m["data"] for m in messages}
    assert set(topics) == {"queue", "proposals"}
    # The same status /api/ws/queue sends.
    assert "runs" in topics["queue"] and "queue_paused" in topics["queue"]["status"]
    assert topics["proposals"]["pending"] == 0 and topics["proposals"]["version"]


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
