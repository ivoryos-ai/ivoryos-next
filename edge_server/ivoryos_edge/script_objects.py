"""Which of a script's objects `run(__name__)` puts on the deck (GitHub issue 88).

A deck script holds more than instruments: settings, a calibration table read with pandas, a numpy
array, a FastAPI router for a plugin, a logger. Every module-level object used to be an instrument
unless Python itself made it, so `calibration = pd.DataFrame(...)` became an "instrument" with 209
steps. The rules here say which objects are not, the script can override them by name
(`run(exclude_names=..., include_names=...)`), and so can the desktop app, per script profile,
through the environment (IVORYOS_EXCLUDE_NAMES / IVORYOS_INCLUDE_NAMES, comma separated), which is
how its "on" switches reach a script nobody wants to edit for it.

Leaving an object out only keeps it off the deck: the script has built it already, so whatever it
opened (a port, a file) stays open. That is all a script deck can do; a deck file's switched-off
entries (`"enabled": false`) are not built at all.

Order of the rules, for one module-level name:
  1. Never on the deck, and not reported: names starting with `_`; classes, functions and modules
     (what the script imports and defines); Plugin objects (run() takes those itself); values of a
     builtin type (every script's settings).
  2. Never on the deck, reported in the log only: typing constructs (`from typing import List`,
     `Optional[float]`), which are types, not objects. No name list can put one on the deck.
  3. Left out by name: the script's `exclude_names`, then the launcher's. A name excluded anywhere
     stays out, whatever includes it.
  4. On the deck by name: the script's `include_names`, then the launcher's.
  5. Left out by rule: an enum member; an object whose class is Python's own (`Path`, `Lock`, a
     logger); one whose class comes from a package in NON_INSTRUMENT_PACKAGES (data, plotting,
     web); one with nothing to call (no public method or property), unless it declares parts.
  6. Everything else is an instrument.

Kept in step with IvoryOS Classic's `generate_interface_schema` (ivoryos/parsers/introspection.py,
1.8.3), which has the same package list less what is NextGen's own (FastAPI, IvoryOS itself), and
skips capitalised names, which NextGen does not.
"""

import enum
import inspect
import os
import sys
import types
import typing
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .introspection import has_steps
from .parts import PARTS_METHOD
from .plugins import Plugin

# A module-level object whose class comes from one of these packages is data, a plot or part of a
# web app, not an instrument. Only the class's module name is compared, so none of these is
# imported. Classic's list, plus FastAPI/Starlette/uvicorn (a plugin's `router = APIRouter()` sits
# at the top of a NextGen script) and IvoryOS itself (a `Unit` or labware marker).
NON_INSTRUMENT_PACKAGES = frozenset({
    "numpy", "pandas", "polars", "pyarrow", "scipy", "xarray", "sympy",
    "matplotlib", "seaborn", "plotly", "bokeh", "PIL",
    "sklearn", "torch", "tensorflow", "jax",
    "flask", "flask_login", "flask_socketio", "flask_sqlalchemy", "flask_wtf",
    "werkzeug", "jinja2", "sqlalchemy", "socketio", "engineio",
    "requests", "httpx", "openai",
    "fastapi", "starlette", "uvicorn",
    "ivoryos_edge",
})

EXCLUDE_ENV = "IVORYOS_EXCLUDE_NAMES"
INCLUDE_ENV = "IVORYOS_INCLUDE_NAMES"


def names_from_env(variable: str) -> List[str]:
    """A comma-separated list of names from the environment, blanks dropped."""
    return [n.strip() for n in os.environ.get(variable, "").split(",") if n.strip()]


def from_standard_library(module_name: str) -> bool:
    """Whether a module is Python's own, judged by where it was loaded from, not only its name.

    The name alone is not enough: a driver file called `test.py` or `platform.py` beside the script
    shadows the standard module of that name, and its classes are the instruments. Built-in modules
    (`builtins`, `_thread`) have no file. `typing_extensions` is not standard but is only typing.
    """
    import sysconfig
    top = module_name.partition(".")[0]
    if top == "typing_extensions":
        return True
    if top not in sys.stdlib_module_names:
        return False
    mod = sys.modules.get(module_name) or sys.modules.get(top)
    path = getattr(mod, "__file__", None)
    if not path:
        return True
    path = os.path.normcase(os.path.realpath(path))
    if "site-packages" in path or "dist-packages" in path:
        return False
    # Not sysconfig's `platstdlib`: under a venv that is the venv's own Lib, site-packages included.
    roots = [sysconfig.get_paths()["stdlib"], os.path.join(sys.base_prefix, "DLLs")]
    return any(path.startswith(os.path.normcase(os.path.realpath(r)) + os.sep) for r in roots)


def _is_typing_construct(value: Any) -> bool:
    """`List`, `Optional[float]`, `int | None`, `list[float]`, a TypeVar: a type, not an object."""
    if isinstance(value, (types.GenericAlias, types.UnionType)):
        return True
    # Since 3.14 `typing.Union` is a class (types.UnionType) whose type is Python's own `type`.
    if value is getattr(typing, "Union", None):
        return True
    return type(value).__module__.partition(".")[0] in ("typing", "typing_extensions")


def _rule(value: Any) -> Optional[str]:
    """Why the rules leave this object off the deck, or None when it is an instrument."""
    value_type = type(value)
    module = getattr(value_type, "__module__", None) or ""
    if isinstance(value, enum.Enum):
        return f"a {value_type.__name__} value"
    if from_standard_library(module):
        return f"{module}.{value_type.__qualname__}, from Python itself"
    package = module.partition(".")[0]
    if package in NON_INSTRUMENT_PACKAGES:
        return f"{value_type.__qualname__}, from {package}"
    # A driver that is only the sum of its parts (parts.py) has nothing of its own to call.
    if not callable(getattr(value_type, PARTS_METHOD, None)) and not has_steps(value):
        return "nothing to call"
    return None


def sort_script_objects(module, exclude_names: Iterable[str] = (), include_names: Iterable[str] = (),
                        hidden: Iterable[str] = (), shown: Iterable[str] = ()) -> Tuple[Dict[str, Any], List[dict]]:
    """A script's instruments, and every candidate object with what was decided about it.

    `exclude_names` / `include_names` are the script's own (run()'s arguments); `hidden` / `shown`
    are the launcher's (the environment). Returns ({name: object}, entries), each entry
    `{name, type, kind, instrument, why, by, offered}`:
      kind        "object", or "type" for a typing construct (never on the deck, said in the log)
      instrument  whether it is on the deck
      why         the rule that would leave it off (None when no rule does), kept even when a name
                  list put it on, so a page can say "shown although: DataFrame, from pandas"
      by          what decided: "rule", "script" (its exclude/include_names) or "launcher"
      offered     whether a launcher may offer to change it: not a typing construct, and not
                  decided by the script, whose own lists win
    The order is the script's.
    """
    script_out, script_in = set(exclude_names or ()), set(include_names or ())
    launcher_out, launcher_in = set(hidden or ()), set(shown or ())
    found: Dict[str, Any] = {}
    entries: List[dict] = []
    for name, value in vars(module).items():
        if name.startswith("_") or isinstance(value, Plugin):
            continue
        typing_construct = _is_typing_construct(value)
        if not typing_construct:
            if (inspect.isclass(value) or inspect.isfunction(value) or inspect.ismodule(value)
                    or type(value).__module__ == "builtins"):
                continue
        value_type = type(value)
        entry = {"name": name, "type": f"{value_type.__module__}.{value_type.__qualname__}",
                 "kind": "type" if typing_construct else "object", "instrument": False, "why": None, "by": "rule", "offered": not typing_construct}
        if typing_construct:
            entry["why"] = f"{entry['type']}, from Python itself" if value is not getattr(typing, "Union", None) \
                else "typing.Union, from Python itself"
        else:
            entry["why"] = _rule(value)
            if name in script_out:
                entry.update(by="script", offered=False)
            elif name in launcher_out:
                entry.update(by="launcher")
            elif name in script_in:
                entry.update(instrument=True, by="script", offered=False)
            elif name in launcher_in:
                entry.update(instrument=True, by="launcher")
            else:
                entry["instrument"] = entry["why"] is None
        if entry["instrument"]:
            found[name] = value
        entries.append(entry)
    return found, entries


def reason(entry: dict) -> str:
    """One entry left off the deck, in words, for the startup log."""
    if entry["by"] == "script":
        return "exclude_names"
    if entry["by"] == "launcher":
        return "switched off in the desktop app"
    return entry["why"]


def script_instruments(module, exclude_names: Iterable[str] = (), include_names: Iterable[str] = ()) -> tuple:
    """The objects in a script that run(__name__) puts on the deck: ({name: object}, {name: why not})."""
    found, entries = sort_script_objects(module, exclude_names, include_names)
    return found, {e["name"]: reason(e) for e in entries if not e["instrument"]}
