"""The casting ground truth as a deck: one method per annotation shape, each recording what it got.

`docs/argument_casting_ground_truth.md` says what a driver must receive for each kind of typed
input, and `tests/fixtures/casting_ground_truth.json` holds those rows as data. This is the
instrument the rows are run against. Every method takes one argument called `value`, keeps the
exact Python object it received in `self.received[<method>]`, and returns a one-line
description of it (`"int 3"`), so the Instruments page and a run's Data History show what
arrived without a debugger:

    IVORYOS_DEMO_TEST_DRIVERS=1 python example/demo.py

Nothing here converts, strips or guesses: the whole point is to see what the edge hands over.
`tests/automated/test_casting_ground_truth.py` drives every fixture row through this class, and
the legacy repo's copy of the fixture is run against the same class on that side.
"""

import ctypes
import dataclasses
from enum import Enum, IntEnum
from typing import Dict, List, Literal, Optional, Tuple, Union


class Speed(Enum):
    """Number values: the <select> on a form hands over text, and `Speed("3")` is not a member."""
    SLOW = 1
    FAST = 3


class Port(IntEnum):
    A = 1
    B = 2
    C = 3


class Plate(Enum):
    """Tuple values: nothing a person can type or JSON can hold, so the member's name is what a
    workflow stores (E6)."""
    WELL_96 = (8, 12)
    WELL_384 = (16, 24)


class Solvent(Enum):
    ETHANOL = "ethanol"
    WATER = "water"


class Tricky(Enum):
    """A name that is another member's value. The lookup order (member, name, value, text of
    value) is what decides `"ON"` (E5)."""
    ON = "OFF"
    OFF = "ON"


@dataclasses.dataclass
class Settings:
    speed: Speed = Speed.SLOW
    gain: float = 1.0


@dataclasses.dataclass(frozen=True)
class Window:
    gain: float
    width: int


class Preset(Enum):
    """Values that are objects: nothing a form can show or JSON can hold as they are (E12). The
    member's name is the choice; the schema shows the object's fields beside it."""
    LOW = Window(1.0, 10)
    HIGH = Window(4.0, 50)


class Address(Enum):
    """Values that are pointers: the name is the choice, the schema shows the repr."""
    DEV0 = ctypes.c_void_p(0x1000)
    DEV1 = ctypes.c_void_p(0x2000)


class EdgeCaseSDL:
    """One parameter called `value` per method; the method name says the annotation."""

    def __init__(self):
        self.received: Dict[str, object] = {}
        self._speed: Speed = Speed.SLOW

    def _keep(self, name: str, value) -> str:
        self.received[name] = value
        return f"{type(value).__name__} {value!r}"

    # --- Primitives ---------------------------------------------------------------------

    def take_int(self, value: int) -> str:
        return self._keep("take_int", value)

    def take_float(self, value: float) -> str:
        return self._keep("take_float", value)

    def take_int_or_float(self, value: Union[int, float]) -> str:
        return self._keep("take_int_or_float", value)

    def take_untyped(self, value) -> str:
        return self._keep("take_untyped", value)

    def take_optional_float(self, value: Optional[float]) -> str:
        """Optional with no default: not required, blank is None (P9)."""
        return self._keep("take_optional_float", value)

    def take_optional_int(self, value: Optional[int] = None) -> str:
        return self._keep("take_optional_int", value)

    def take_bool(self, value: bool) -> str:
        return self._keep("take_bool", value)

    def take_optional_bool(self, value: Optional[bool] = None) -> str:
        return self._keep("take_optional_bool", value)

    # --- Enum and Literal -----------------------------------------------------------------

    def take_speed(self, value: Speed) -> str:
        return self._keep("take_speed", value)

    def take_speed_keyword_only(self, *, value: Speed) -> str:
        return self._keep("take_speed_keyword_only", value)

    def take_optional_speed(self, value: Optional[Speed] = None) -> str:
        return self._keep("take_optional_speed", value)

    @property
    def speed(self) -> Speed:
        return self._speed

    @speed.setter
    def speed(self, value: Speed):
        self.received["speed_(setter)"] = value
        self._speed = value

    def take_speed_dict(self, value: Dict[str, Speed]) -> str:
        return self._keep("take_speed_dict", value)

    def take_settings(self, value: Settings) -> str:
        return self._keep("take_settings", value)

    def take_preset(self, value: Preset = Preset.LOW) -> str:
        return self._keep("take_preset", value)

    def take_address(self, value: Address) -> str:
        return self._keep("take_address", value)

    def take_port(self, value: Port) -> str:
        return self._keep("take_port", value)

    def take_plate(self, value: Plate = Plate.WELL_96) -> str:
        return self._keep("take_plate", value)

    def take_solvent(self, value: Solvent) -> str:
        return self._keep("take_solvent", value)

    def take_tricky(self, value: Tricky) -> str:
        return self._keep("take_tricky", value)

    def take_literal_float(self, value: Literal[0.5, 1.0, 2.0] = 1.0) -> str:
        return self._keep("take_literal_float", value)

    def take_literal_int(self, value: Literal[1, 2, 4, 8]) -> str:
        return self._keep("take_literal_int", value)

    def take_literal_bool(self, value: Literal[True, False]) -> str:
        return self._keep("take_literal_bool", value)

    def take_literal_comma(self, value: Literal["a,b", "c"]) -> str:
        return self._keep("take_literal_comma", value)

    def take_literal_text(self, value: Literal["fast", "slow"] = "slow") -> str:
        return self._keep("take_literal_text", value)

    # --- Dicts, lists and tuples ----------------------------------------------------------

    def take_dict_str_float(self, value: Dict[str, float]) -> str:
        return self._keep("take_dict_str_float", value)

    def take_dict_int_float(self, value: Dict[int, float]) -> str:
        return self._keep("take_dict_int_float", value)

    def take_optional_dict(self, value: Optional[Dict[str, float]] = None) -> str:
        return self._keep("take_optional_dict", value)

    def take_tuple(self, value: Tuple[float, float] = (1.0, 2.0)) -> str:
        return self._keep("take_tuple", value)

    def take_list_str(self, value: List[str]) -> str:
        return self._keep("take_list_str", value)

    def take_list_int(self, value: List[int]) -> str:
        return self._keep("take_list_int", value)

    def take_list(self, value: list) -> str:
        return self._keep("take_list", value)

    # --- Text -----------------------------------------------------------------------------

    def take_text(self, value: str) -> str:
        return self._keep("take_text", value)

    def take_text_empty_default(self, value: str = "") -> str:
        return self._keep("take_text_empty_default", value)

    def take_text_none_default(self, value: str = None) -> str:  # noqa: RUF013  (as real drivers write it)
        return self._keep("take_text_none_default", value)

    def take_optional_text(self, value: Optional[str] = None) -> str:
        return self._keep("take_optional_text", value)

    def take_text_with_default(self, value: str = "water") -> str:
        return self._keep("take_text_with_default", value)
