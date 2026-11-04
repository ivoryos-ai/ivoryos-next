---
title: Argument types
description: Which Python types a driver can declare for a step's arguments, what the app shows for each, what the driver receives, and what is still uncertain.
sidebar:
  order: 3
---

A driver method's parameters are typed with ordinary Python annotations, and that annotation
decides three things: the field the app draws, what is accepted into it, and the Python object
the driver receives. This page is the contract for all three. The short version: **the edge
casts every value once, strictly, immediately before the call, and a value that cannot be the
annotated type is refused with a message**, never truncated and never passed through as text.

The same cast runs as a dry run when a run is prepared, so a bad literal refuses the run before
anything moves; a value that only exists at run time (a `#variable`, an optimizer's suggestion)
is checked when it is substituted. The Designer, the Instruments page, the Iterate table and the
assistant's validator warn earlier, but they only *say* what the edge will refuse; the cast is
the one place a value becomes a Python object.

## Dict arguments

A dict is written the way it reads, on one line among the step's other arguments:
`gains = {kp: 1.5, ki: #ki, +}`, each key and value a small box of its own, typed and checked by
the annotation (`Dict[str, float]` wants numbers, an Enum value offers its members). Enter in a
value goes on to the next entry, and an optional dict reads `None` until **Add**. **JSON** shows
the same value as text. Paste a dict from anywhere into either, as JSON or the way it looks in
Python (`{'kp': 1.5, 'on': True}`); rows copied from a spreadsheet, key then value, paste too.

A value can be a `#name`, which is a variable like any other. `{"kp": 1.5, "ki": "#ki"}` gives the
Iterate table one column, `ki`, typed `float`, and gives the Optimize page one thing to search, so
the rest of the dict stays fixed and a table never has to hold a dict in a cell. For the same
reason `#auto` leaves a dict argument alone when a step is dropped. A whole dict from a variable an
earlier step saved is written `#settings` in JSON. A key is never a reference: `{"#x": 1}` has a
key called `#x`.

## Supported types

| Annotation | Field | Typed | The driver receives |
|---|---|---|---|
| `int` | number | `3` | `3`. `2.5` is refused ("not a whole number"), never rounded. |
| `float` | number | `2.5`, `2` | `2.5`, `2.0` |
| `Union[int, float]` | number | `2`, `2.5` | `2` (int), `2.5` (float): the decimal point decides |
| `str` | text | anything | the text as typed. Blank with no default is `""`. |
| `bool` | True / False | `True`, `false` (any case in a cell or CSV) | `True` / `False`. Nothing else is accepted. |
| an `Enum` | dropdown of the **member names**, with each value shown beside it | `FAST` | the member, `Speed.FAST`. The value (`3`) and its text (`"3"`) are accepted too, the name first. |
| `Literal["a", "b"]` / `Literal[0.5, 1.0]` | dropdown of the options | `1.0` | the option itself, `1.0` as a float |
| `Optional[X]` / `X \| None` | the field for `X` | blank, or `<None>` | `None`; otherwise as `X` |
| a dataclass or Pydantic model | one field per attribute, nested | its fields, or JSON in a cell | the object, each field cast by its own type |
| a `TypedDict` | one field per key, nested | its fields | a dict, each key cast by its own type; a required key missing is refused |
| `List[X]`, `list` | text | `1, 2` or `[1, 2]` | `[1, 2]`, each element cast to `X`. One word with no comma into a list of text stays text (a wells selection). |
| `Tuple[X, Y]` | text | `[1, 2]` | `(1.0, 2.0)`; the wrong length is refused |
| `Dict[K, V]`, `Mapping[K, V]`, `dict` | its keys and values on one line, or JSON | an entry at a time, or `{"1": 10}` / `{'a': 1}` pasted (JSON or a Python literal); a value can be `#name` | `{1: 10.0}`, keys and values cast |
| `set`, `frozenset` | text | `a, b` | a set of the elements |
| no annotation | text | anything | the text exactly as typed, no guessing |
| `Annotated[X, ...]` | the field for `X`, plus what the marker adds (a unit, a labware or wells picker) | | as `X` |
| a class the edge cannot build (a vendor object, PyLabRobot's `Well`) | text | | the text as typed; the driver parses it |

Three rules hold across the table:

- **An Enum is stored by its member's name**, never its value. A value can be anything the
  driver likes (a tuple, a dataclass of settings, a pointer, a callable), the name is always text
  a form can show and JSON can hold. The schema lists the value beside the name so people see
  what it stands for: a dataclass as its fields, anything else as its `repr`.
- **The word `None` is never None.** In a text field it is the text `"None"`; anywhere else it is
  refused, and the message says to choose None instead.
- **A `#variable` is a whole value.** `#temperature` in a number field is substituted when the
  step runs. Inside a text argument (`sample_#n`) it is sent as written; only a Comment's message
  and a User input's prompt fill names into text.

## Blank, None and the default

What an empty field means depends on where it is.

**In a field** (a Designer step, the Instruments page, the Once form, an Optimize fixed value),
blank means *no value*: the driver's default where there is one, `None` for an Optional with no
default, `""` for a text argument with no default, and *missing* for anything else, which the
step card marks and the run refuses. A parameter is required only when it has no default and is
not Optional.

**In a cell** (the Iterate table, Optimize's per-iteration values), blank means *not
configured*: a row with nothing in it is not a sample, and a row with one blank cell is refused
before the run is built. Two markers say otherwise, chosen from the buttons that appear in an
empty cell or typed by hand (which is also how a CSV carries them):

- `<None>` sends `None`, for any parameter, Optional or not. The driver decides what to do with
  it.
- `<default>` leaves the argument out of the call, so the driver's own default applies. Offered
  where the argument has one (an Optional with no default counts; its default is `None`).

On a Designer step the same `<None>` is written by the ∅ button beside each field, for a `None`
over a non-None default; blank already means the default.

## Where a value is checked

| When | What is checked |
|---|---|
| as it is typed | the Designer card warns on a missing required argument, text in a number field, a value outside an Enum's or Literal's choices, and a value the safety guard will refuse; the Iterate cell marks text in a number column |
| when a run is prepared | every literal argument is cast against its type and against the safety limits; a failure refuses the whole run with the step and the reason |
| at the call | the cast runs again on the substituted values, after the safety guard; a failure is a failed step, and the run pauses for retry, skip or stop |
| from the Instruments page | the cast runs on the call; a refusal is the call's error, nothing is sent |
| in the assistant | the validator applies the same rules to what the model proposes and feeds the errors back to it |

## Uncertain or untested

These work in the simple cases, or are known limits. Treat them as places to check against your
own driver, and [tell us](https://github.com/ivoryzh/ivoryos-next/issues) what you find.

- **A `Union` with a text arm** (`Union[str, int]`): the arms are tried in order and `str`
  accepts everything, so the driver always gets text. Put the narrower type first.
- **A `Literal` mixing types** (`Literal[1, "1"]`): the options are matched by their spelling,
  so the first that reads the same wins.
- **An Enum whose values are objects**: picking by name is tested (a dataclass, a `ctypes`
  pointer). A value typed as text matches only when its `str` happens to equal the typed text,
  and a workflow saved by IvoryOS Classic with such a value in it cannot name the member.
- **A dataclass or object as a parameter's default** (`settings: Settings = Settings()`) is
  shown through `str()` and is not round-tripped through the schema the way an Enum default is.
- **Nested containers** (`List[Dict[str, float]]`, `Dict[str, List[int]]`, `Optional[List[int]]`)
  are cast recursively but only lightly tested. In a dict's field a list or a nested dict is one
  box, written as JSON.
- **The order of a dict with number-like keys**: a browser keeps `{"2": 1, "1": 2}` in numeric
  order, so the driver receives it as `{1: 2, 2: 1}`.
- **`datetime`, `Path`, `bytes`, `Decimal`, NumPy scalars and arrays, and any other class the
  edge does not know** are passed through as the text typed. The driver has to parse them.
- **`*args`** is not supported: a step stores named arguments and has no place for positional
  ones.
- **`**kwargs`**: a `**kwargs: Unpack[SomeTypedDict]` is expanded into real fields; a
  `**kwargs: float` casts each extra argument to float; a bare `**kwargs` receives the text typed
  into each name/value row.
- **Cloud's own single-value fields** (a step configured on the Orchestrator canvas) do not yet
  offer the markers and still list an Enum's values rather than its names. A dict there is still
  one box for JSON, with no `#name` inside it; Cloud's Edge Sequence editor has the new field.
- The rules are run on CPython 3.10, 3.12 and 3.14; a type that prints differently on another
  interpreter may be described differently.

## Try it

`example/edge_cases_demo.py` starts a deck with one instrument, `edge_cases`, holding one method
per annotation in the table. Each method returns a one-line description of the Python object it
received (`int 3`, `Speed <Speed.FAST: 3>`), so a value typed on the Instruments page, in a
Designer step or in an Iterate cell can be read back exactly. The same rows run as
`tests/automated/test_casting_ground_truth.py`, and the full contract with its history is
`docs/argument_casting_ground_truth.md` in the repository.
