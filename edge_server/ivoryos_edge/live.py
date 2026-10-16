"""A page's live feed: one WebSocket per page (`/api/ws`), carrying topics.

Every message is `{"topic": name, "data": ...}`. A page keeps one connection however many parts of
it listen (frontend/src/edgeSocket.ts), and is sent the current state of every topic as it connects,
so a page that reconnects after the edge restarted or the network dropped is current again without
asking for anything. Topics:

  queue      the queue status /api/ws/queue sends (queue.py global_payload), after every step and
             every change to the queue. /api/ws/queue stays as it was for the desktop app.
  proposals  `{pending, version}`: how many agent proposals wait for a person, and a token that
             changes whenever any proposal is filed, accepted or rejected. A hint, not the data: a
             page that shows the list fetches it from /api/agent/proposals when the version is new,
             so that endpoint stays the one place the list is read from.

Before this, three parts of every page asked /api/agent/proposals every five seconds, which filled
the deck's log, and each of a page's ten-odd queue listeners held a socket of its own that never
reconnected after a restart.
"""
import asyncio
import itertools
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from .models import AgentProposal, async_session


class LiveHub:
    def __init__(self) -> None:
        self.connections: List[Any] = []
        self._snapshots: Dict[str, Callable[[], Awaitable[Any]]] = {}
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def topic(self, name: str, snapshot: Callable[[], Awaitable[Any]]) -> None:
        """Declare a topic and how to read its current state, which every new connection is sent."""
        self._snapshots[name] = snapshot

    async def connect(self, websocket: Any) -> None:
        self.loop = asyncio.get_running_loop()
        self.connections.append(websocket)
        for name, snapshot in list(self._snapshots.items()):
            try:
                data = await snapshot()
            except Exception as e:
                print(f"[live] Could not read '{name}' for a new page: {e}")
                continue
            if not await self._send(websocket, name, data):
                return

    def disconnect(self, websocket: Any) -> None:
        if websocket in self.connections:
            self.connections.remove(websocket)

    async def publish(self, name: str, data: Any) -> None:
        for websocket in list(self.connections):
            await self._send(websocket, name, data)

    async def _send(self, websocket: Any, name: str, data: Any) -> bool:
        try:
            await websocket.send_json({"topic": name, "data": data})
            return True
        except Exception:
            self.disconnect(websocket)
            return False


hub = LiveHub()


# --- proposals -------------------------------------------------------------------------------
# A new token each start, so a page that was open across a restart fetches the list again.
_BOOT = uuid.uuid4().hex[:8]
_changes = itertools.count(1)
_proposals_version = f"{_BOOT}.0"
# Publishing runs as a task; a task nothing refers to may be collected before it finishes.
_pending_sends: Set[asyncio.Task] = set()


async def proposals_state() -> Dict[str, Any]:
    async with async_session() as session:
        pending = (await session.execute(
            select(func.count()).select_from(AgentProposal).where(AgentProposal.status == "pending")
        )).scalar_one()
    return {"pending": pending, "version": _proposals_version}


def proposals_changed() -> None:
    """Note that a proposal changed, and tell every open page."""
    global _proposals_version
    _proposals_version = f"{_BOOT}.{next(_changes)}"
    if not hub.connections:
        return

    async def send() -> None:
        await hub.publish("proposals", await proposals_state())

    try:
        task = asyncio.get_running_loop().create_task(send())
    except RuntimeError:
        # Committed outside the server's loop (a worker thread's sync session).
        if hub.loop is not None and hub.loop.is_running():
            asyncio.run_coroutine_threadsafe(send(), hub.loop)
        return
    _pending_sends.add(task)
    task.add_done_callback(_pending_sends.discard)


# Proposals are written in a dozen places (filed by the agent routes, accepted or rejected there,
# closed by a saved Iterate table in server.py). Announcing from the commit itself means a new place
# cannot forget to, and nothing is announced for a write that was rolled back.
_FLAG = "ivoryos_proposals_changed"


@event.listens_for(Session, "after_flush")
def _note_proposal_writes(session: Session, flush_context: Any) -> None:
    if any(isinstance(obj, AgentProposal) for obj in itertools.chain(session.new, session.dirty, session.deleted)):
        session.info[_FLAG] = True


@event.listens_for(Session, "after_commit")
def _announce_proposal_writes(session: Session) -> None:
    if session.info.pop(_FLAG, False):
        proposals_changed()


@event.listens_for(Session, "after_rollback")
def _forget_proposal_writes(session: Session) -> None:
    session.info.pop(_FLAG, None)
