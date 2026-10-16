"""One driver, several instruments: `__ivoryos_instruments__`.

Some machines are several things a person drives separately. An Opentrons Flex in PyLabRobot 1.0 is
one object with a pipette on each mount, a 96-channel head and a gripper as objects of their own
(`flex.left`, `flex.right`, `flex.head96`, `flex.gripper`), and each has its own steps. A driver
says so with a method named `__ivoryos_instruments__` that returns {part: object}; each part becomes
an instrument named after the driver's own, `<instrument>_<part>` (a Flex called `flex` gives
`flex_left`, `flex_gripper`), placed right after it. The driver stays an instrument too, with its
own steps. Duck-typed, like the labware hooks (labware.py): a driver imports nothing from IvoryOS.

Read once, when the deck starts, like everything else about the deck's instruments, so a driver
whose parts depend on configuration (what is mounted) reads that configuration when it is built,
not when it connects. A part that cannot be added (a name that is not an identifier, or one already
taken) is reported with the deck's other instrument errors, stage "parts", and left out; the rest of
the deck is unaffected.
"""

import keyword
import re
from typing import Any, Dict, List

PARTS_METHOD = "__ivoryos_instruments__"
# A part may have parts of its own; this deep and no deeper, so a cycle cannot hang startup.
MAX_DEPTH = 3


def _parts_of(instrument) -> Any:
    hook = getattr(type(instrument), PARTS_METHOD, None)
    return instrument.__ivoryos_instruments__() if callable(hook) else None


def expand(instruments: Dict[str, Any], errors: List[dict]) -> Dict[str, Any]:
    """The deck with every driver's parts added right after it. Problems go to `errors`."""
    out: Dict[str, Any] = {}

    def add(name: str, instrument: Any, depth: int) -> None:
        out[name] = instrument
        if depth >= MAX_DEPTH:
            return
        try:
            parts = _parts_of(instrument)
        except Exception as e:  # a driver that cannot say must not take the deck down
            errors.append({"name": name, "stage": "parts", "error": f"{PARTS_METHOD} failed: {type(e).__name__}: {e}"})
            return
        if parts is None:
            return
        if not isinstance(parts, dict):
            errors.append({"name": name, "stage": "parts",
                           "error": f"{PARTS_METHOD} returned {type(parts).__name__}, not {{part: object}}"})
            return
        for part, sub in parts.items():
            full = f"{name}_{part}"
            if not isinstance(part, str) or not re.fullmatch(r"[A-Za-z0-9]\w*", part) or keyword.iskeyword(full):
                errors.append({"name": full, "stage": "parts",
                               "error": f"'{part}' cannot be part of an instrument name (letters, digits and _)"})
                continue
            if full in out or full in instruments:
                errors.append({"name": full, "stage": "parts",
                               "error": f"'{full}' is already an instrument, so {name}'s part '{part}' is left out"})
                continue
            add(full, sub, depth + 1)

    for name, instrument in instruments.items():
        add(name, instrument, 0)
    return out
