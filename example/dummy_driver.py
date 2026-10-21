import time
import asyncio
import threading
from enum import Enum
from dataclasses import dataclass
from typing import Dict, List, Literal, Optional, Sequence, Tuple

class PumpDirection(Enum):
    FORWARD = "forward"
    BACKWARD = "backward"
    OSCILLATING = "oscillating"

@dataclass
class PumpConfig:
    target_speed: float
    direction: PumpDirection
    enable_safety_valves: bool = True

class SettingsStore:
    """Dicts and lists as arguments, one method per shape, each returning what reached it.

    A `Dict` argument used to be unrecognised (GitHub issue 35): the type's name was all the
    schema said, the pages took "int" in "Dict[str, int]" for a number, and the typed text
    reached the driver as text. Now a dict or list is described with what it holds
    (`is_mapping` / `is_list` in the schema), typed as JSON or Python's own literal, and cast
    at the call. Loaded with the other test drivers; tests/automated/test_container_parameters.py.
    """

    def set_offsets(self, offsets: Dict[str, float]) -> dict:
        """A dict of floats by name, e.g. {"x": 1.5, "y": -0.2}."""
        return {"offsets": offsets, "value_types": sorted({type(v).__name__ for v in offsets.values()})}

    def set_channels(self, channels: dict[int, str]) -> dict:
        """A dict keyed by channel number: {"1": "pump", "2": "valve"} (JSON keys are text; they arrive as ints)."""
        return {"channels": channels, "key_types": sorted({type(k).__name__ for k in channels})}

    def set_any(self, settings: dict) -> dict:
        """A dict of anything."""
        return {"settings": settings}

    def set_levels(self, levels: List[float]) -> dict:
        """A list of floats: [0.5, 1.0, 2.0]."""
        return {"levels": levels, "item_types": sorted({type(v).__name__ for v in levels})}

    def set_names(self, names: list) -> dict:
        """A bare list."""
        return {"names": names}

    def set_directions(self, directions: List[PumpDirection]) -> dict:
        """A list of an enum: ["forward", "backward"]."""
        return {"directions": [d.value for d in directions]}

    def set_window(self, window: Tuple[int, int]) -> dict:
        """A pair: [10, 20]."""
        return {"window": list(window), "kind": type(window).__name__}

    def set_optional(self, extra: Optional[Dict[str, int]] = None) -> dict:
        """A dict that may be left as None."""
        return {"extra": extra}

    def select(self, wells: Sequence[str]) -> dict:
        """Text that only starts like a list (plate[A1:H1]) stays text."""
        return {"wells": wells}


class PumpDriver:
    """A dummy pump driver for testing introspection and execution."""
    
    def __init__(self):
        self.flow_rate = 0.0
        self.is_running = False
        
    def set_flow_rate(self, rate: float):
        """Sets the flow rate of the pump."""
        print(f"[Pump] Setting flow rate to {rate}")
        self.flow_rate = rate
        return {"status": "success", "flow_rate": self.flow_rate}
        
    def start_pump(self) -> None:
        """Starts the pump at the current flow rate."""
        print("[Pump] Starting pump...")
        self.is_running = True
        
    def stop_pump(self):
        """Stops the pump."""
        print("[Pump] Stopping pump...")
        self.is_running = False
        return {"status": "success", "running": False}
        
    def long_running_task(self, duration: int):
        """A blocking task to test execution cancellation."""
        print(f"[Pump] Starting long task for {duration} seconds...")
        for i in range(duration):
            print(f"[Pump] Task running... {i+1}/{duration}")
            time.sleep(1)
        print("[Pump] Long task finished.")
        return {"status": "success", "duration": duration}

    def complex_initialization_sequence(self, target_temperature: float, solvent_name: str, enable_safety_checks: bool = True, retries: int = 3, timeout_seconds: float = 60.0):
        """
        A complex method with many parameters to stress test the UI.
        Requires temperature, solvent name, and optionally safety checks and timeout settings.
        """
        print(f"[Pump] Initializing with {solvent_name} at {target_temperature}C...")
        time.sleep(2)
        if enable_safety_checks:
            print("[Pump] Safety checks enabled, verifying pressure bounds...")
            time.sleep(1)
        return {
            "status": "success", 
            "message": f"Initialized {solvent_name}",
            "temp": target_temperature,
            "safety": enable_safety_checks
        }

    def very_long_module_method_name_to_test_truncation_issues_on_frontend(self, super_long_parameter_name_that_should_wrap: str = "default_val"):
        """Testing long names on the frontend display."""
        return {"result": super_long_parameter_name_that_should_wrap}

    def test_error_handling(self, should_fail: bool = True):
        """Throws an exception if should_fail is True."""
        if should_fail:
            raise ValueError("This is a simulated driver error!")
        else:
            return {"status": "success", "message": "Did not fail"}

    def test_enum_and_literal(self, direction: PumpDirection, mode: Literal["fast", "slow", "eco"] = "eco"):
        """Test method for Enum and Literal parsing."""
        return {"direction": direction.value, "mode": mode}

    def test_nested_dataclass(self, config: PumpConfig, duration: int = 5):
        """Test method for nested dataclass introspection."""
        print(f"[Pump] Running with config: speed={config.target_speed}, dir={config.direction}, safety={config.enable_safety_valves} for {duration}s")
        return {"status": "success", "config_used": str(config)}

    def test_optional_arguments(self, volume: float, rate: Optional[float] = 3.0,
                                mode: Optional[Literal["fast", "slow"]] = "slow", note: Optional[str] = None):
        """Test method for None vs the default: returns exactly what reached the driver.

        rate and mode take None and have a default that is not None; note's default is None.
        """
        return {"volume": volume, "rate": rate, "mode": mode, "note": note}

class DummyMathDriver:
    """A dummy driver for testing the optimizer with a simulated mathematical function."""
    
    def evaluate_function(self, x: float, y: float) -> float:
        """
        Evaluates a simulated objective function: -(x-3)^2 - (y-2)^2 + 10
        Optimal parameters are x=3, y=2, yielding max=10.
        """
        print(f"[MathDriver] Evaluating at x={x}, y={y}")
        result = -((x - 3) ** 2) - ((y - 2) ** 2) + 10
        print(f"[MathDriver] Result: {result}")
        return result

class AsyncPumpDriver:
    """A dummy pump driver with async methods to test async execution."""
    
    def __init__(self):
        self.flow_rate = 0.0
        self.is_running = False

    async def async_start_pump(self) -> dict:
        """Starts the pump asynchronously."""
        print("[AsyncPump] Starting pump asynchronously...")
        await asyncio.sleep(1)
        self.is_running = True
        print("[AsyncPump] Pump started.")
        return {"status": "success", "running": True}

    async def async_long_task(self, duration: int) -> dict:
        """An async long running task."""
        print(f"[AsyncPump] Starting async long task for {duration} seconds...")
        for i in range(duration):
            print(f"[AsyncPump] Async task running... {i+1}/{duration}")
            await asyncio.sleep(1)
        print("[AsyncPump] Async long task finished.")
        return {"status": "success", "duration": duration}

    def sync_to_async_thread_test(self) -> dict:
        """A regular synchronous method that runs an async function inside a new thread."""
        print("[AsyncPump] Running sync_to_async_thread_test...")
        
        result = {}
        def run_in_thread():
            async def inner_async():
                print("[AsyncPump Thread] Inside inner async function...")
                await asyncio.sleep(2)
                return "thread_success"
            
            # This creates a new event loop for this thread
            res = asyncio.run(inner_async())
            result["data"] = res
            print(f"[AsyncPump Thread] Finished with result: {res}")

        t = threading.Thread(target=run_in_thread)
        t.start()
        t.join()  # Wait for the thread to complete for the sake of returning a result

        return {"status": "success", "result": result.get("data")}