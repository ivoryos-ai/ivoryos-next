---
title: What IvoryOS reads from a class
description: The exact rules for which objects become instruments, which methods become steps, and how type hints become fields.
sidebar:
  order: 2
---

Introspection runs **once, at startup**, against each instrument *instance*. It reads signatures,
annotations and docstrings; it never calls a method, and it reads properties off the class so no
getter runs. The result is the schema every form in the app is built from (`ivoryos_schema.json`
in the data folder is a copy).

## Which objects are instruments

**In a deck file**, each entry under `instruments` is one, by name.

**In a script** that ends with `ivoryos_edge.run(__name__)`, every module-level object is one,
except:

| Skipped | Why |
|---|---|
| names starting with `_` | hidden on purpose |
| classes, functions, modules | what the script imports and defines, not devices |
| `Plugin` objects | `run()` takes those itself |
| values of a built-in type (`str`, `int`, `dict`, …) | settings, not devices |
| values of a type from Python's standard library (`Path`, `Lock`, a logger, a `timedelta`) | said in the startup log, in case it hides an instrument |
| enum members (`MODE = Mode.FAST`) | values, not devices |
| names listed in `run(exclude_names=[...])` | the script's own objects that are not instruments, the one case no rule can tell |

A capitalised name **is** an instrument (`HPLC = HPLC()`): IvoryOS Classic skipped those, NextGen
does not.

## Which attributes become steps

Every attribute that is **callable** and whose name does **not** start with `_`:

- plain methods, in any case (`measure` and `Measure` both show), including inherited ones;
- `@staticmethod` and `@classmethod`;
- a class nested in the driver, because a class is callable (so keep nested helpers and enums at
  module level, or prefix them);
- a method with no readable signature (a C extension, a `ctypes` or pybind11 binding) is listed
  with no fields and marked *signature unavailable*; the Instruments page says whether arguments
  can be sent to it.

A `@property` becomes up to two steps: `name` (reads it) and `name_(setter)` (sets it, with one
`value` field typed from the setter or the getter). Properties inherited from a modelling library
such as Pydantic are left out; their methods are not.

## How parameters become fields

| Annotation | Field | Cast before the call |
|---|---|---|
| `float`, `int` | number | `float()` / `int()` |
| `str` | text | as typed |
| `bool` | True / False | `bool` |
| `Enum` subclass | dropdown of the members' values | the member |
| `Literal["a", "b"]` | dropdown of the values | the value |
| a dataclass or Pydantic model | nested form, one field per attribute, recursively | the object |
| `Optional[X]` / `X | None` | the field for `X` | as `X` |
| `List[...]`, `Dict[...]`, other typing forms | text (JSON) | parsed |
| no annotation | text | as typed |

Also:

- A parameter **with a default** is optional and pre-filled; one **without** is required. Nothing
  else decides this.
- `*args` is left out (a step stores named arguments, and a variadic is never required).
- `**kwargs` is left out as a field, but the step is marked as accepting extra arguments: the
  Designer and the Instruments page offer name/value rows for them, typed from the annotation on
  `**kwargs` if there is one. A `**kwargs: Unpack[SomeTypedDict]` (PEP 692) is expanded into
  ordinary fields instead.
- Keyword-only parameters (after `*`) are ordinary fields. Positional-only ones (before `/`) are
  too, and are passed by position at the call.
- `from __future__ import annotations` (string annotations) is resolved; the rules above apply to
  the real types.
- A decorator that forgot `functools.wraps` hands introspection a `(*args, **kwargs)` signature.
  When the original function can be found in the wrapper's closure, its signature is shown
  instead, and the wrapper is still what gets called.
- A docstring (`inspect.getdoc`) is the description.
- `Annotated[float, Unit("°C")]` adds a unit to the field; `Annotated[str, Wells(...)]` marks a
  labware/well argument. Both are optional; see [Safeguards](/dev/extend/safeguards/) and
  [Liquid handling](/dev/extend/liquid-handling/).

## What a step can save

The return annotation is flattened into **return paths**, the leaves a later step or the
optimizer can read:

| Annotation | Paths |
|---|---|
| `-> float`, `-> str`, `-> dict` | one, the result itself |
| `-> MyDataclass` / a Pydantic model | one per field, nested fields dotted (`composition.yield_percent`) |
| `-> Tuple[float, str]` | `0`, `1` |
| `-> None` | none: nothing to save |
| no annotation | one, typed `Any` |

Numeric leaves (`int`, `float`, never `bool`) are what the Optimize page offers as objectives.
[Return values](/dev/instruments/return-values/) shows how a step binds them to names.

## When it runs

- An exception in the constructor of one instrument (a deck file) is recorded and the others
  still load; the Instruments page lists it under *Not loaded* with the error. In a script, an
  exception stops the script, as it would from a terminal.
- A step calls the method with keyword arguments, cast as in the table above. An argument the
  signature does not have is an error, not silently dropped.
- `async def` methods are awaited; synchronous ones run in a worker thread so the server stays
  responsive. A sync wrapper around an async method is detected and awaited too.
- A raised exception becomes a failed step: the run pauses for a decision.

## Where this lives

`edge_server/ivoryos_edge/introspection.py` (`inspect_device_module`, `extract_type_info`,
`build_return_paths`, `cast_arguments`). The Hub's schema extractor
(`schema_worker/introspection.py`) applies the same rules to a class without instantiating it.
