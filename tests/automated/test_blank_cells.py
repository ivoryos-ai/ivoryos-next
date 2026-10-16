"""A table cell that says "no value on purpose" (shared-ui runConfig.ts NONE_VALUE / DEFAULT_VALUE).

The page turns the choice into the run it submits: None becomes a JSON null argument, and the
driver's default becomes an argument left out. This is the edge's half: a null must reach the
driver as None (not the text "None", and past a type that declares its choices), and a left-out
argument must take the driver's own default, not None. The walk's half is
packages/shared-ui/test/blankCells.test.mjs.
"""
import asyncio
from typing import Literal, Optional

import pytest
from httpx import ASGITransport, AsyncClient

from ivoryos_edge.server import app


class Pump:
    def dispense(self, volume: float, rate: Optional[float] = 3.0,
                 mode: Optional[Literal["fast", "slow"]] = "slow") -> dict:
        return {"volume": volume, "rate": rate, "mode": mode}


@pytest.fixture
def pump():
    from ivoryos_edge.introspection import inspect_device_module
    app.state.instruments["pump"] = Pump()
    app.state.instrument_schemas["pump"] = inspect_device_module(app.state.instruments["pump"])
    yield
    app.state.instruments.pop("pump")
    app.state.instrument_schemas.pop("pump")


@pytest.mark.asyncio
async def test_none_reaches_the_driver_and_a_left_out_argument_takes_its_default(pump):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Two rows as the Iterate page submits them: row 1 chose None for both, row 2 the default.
        sequence = [
            {"instrument": "pump", "method": "dispense",
             "params": {"volume": "1.5", "rate": None, "mode": None, "_row": 0, "_block": 0,
                        "_vars": {"rate": "rate", "mode": "mode"}}},
            {"instrument": "pump", "method": "dispense",
             "params": {"volume": "2", "_row": 1, "_block": 0, "_vars": {"rate": "rate", "mode": "mode"}}},
        ]
        posted = await ac.post("/api/queue/runs", json={"name": "Blank cells", "sequence": sequence})
        assert posted.status_code == 200, posted.text
        run_id = posted.json()["run_id"]
        for _ in range(50):
            detail = (await ac.get(f"/api/queue/runs/{run_id}")).json()
            if detail["status"] in ("completed", "error", "cancelled"):
                break
            await asyncio.sleep(0.1)
        assert detail["status"] == "completed", detail

        results = [s["outputs"]["result"] for s in detail["steps"]]
        assert results[0] == {"volume": 1.5, "rate": None, "mode": None}
        assert results[1] == {"volume": 2.0, "rate": 3.0, "mode": "slow"}
