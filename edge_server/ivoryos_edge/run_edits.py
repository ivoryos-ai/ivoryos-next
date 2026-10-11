"""Changing a run while it runs: one step's arguments, and the samples still to come.

Two edits, and nothing either of them does reaches what has already happened:

* **A step's arguments** (`plan_step_edit`), while the step waits (pending) or while it is the
  failed step its run waits on a decision about, so a retry runs with the corrected values rather
  than failing the same way again. With `scope="later"` the same arguments also go to every later
  run of that authored step: the same step on the samples still to come, or in the optimization
  trials still to come. They are kept on the run as an override (`parameters._overrides`), so a
  later change to the rows, which re-plans those samples from the table, keeps them. An argument
  a later step takes from a table column (`_vars`) is left alone on that step: the table says
  what each sample gets, and the table is changed by changing the rows.

* **The samples still to come** of a spreadsheet run (`plan_splice`). The run is re-planned by
  whoever built it (the Iterate page, Cloud) with the same shared walk a new run is built with
  (shared-ui expandSpreadsheet), so the edge never re-derives which steps a row has. The edge
  checks that every sample already started is unchanged, keeps those steps exactly as they are,
  and replaces the rest. Batch groups move as one: a group in which any step has started is kept
  whole, since its samples' steps are interleaved.

Both are recorded on the run (`parameters._edits`), so a record says which values were changed
during the run, when, and by whom.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# A step is "started" once it is anything but pending. Skipped counts: a step left out by a stop
# or an If has had its say.
_WAITING = ("pending",)
# How many edits a run keeps in its record.
MAX_EDITS = 200


class RunEditError(ValueError):
    """An edit that cannot be made. The message is shown to the person as it is."""


def _params(step) -> dict:
    if isinstance(step, dict):
        return step.get("params") if "params" in step else (step.get("parameters") or {})
    return getattr(step, "parameters", None) or {}


def _get(step, key: str):
    return step.get(key) if isinstance(step, dict) else getattr(step, key, None)


def _phase(step) -> str:
    return _params(step).get("_phase") or "main"


def _row(step) -> Optional[int]:
    row = _params(step).get("_row")
    return row if isinstance(row, int) and not isinstance(row, bool) else None


def authored_keys(steps: list) -> List[Optional[str]]:
    """For each step, which authored step it is a run of, or None when that cannot be said.

    A spreadsheet step carries `_block` (its place in the authored sequence) and `_row`; a linked
    workflow expands one block into several steps, told apart by their order within that row and
    block. An optimization's trial step carries `_tmpl`, its place in the trial template. Steps
    with the same key are the same step on different samples or trials.
    """
    keys: List[Optional[str]] = []
    seen: Dict[Tuple, int] = {}
    for step in steps:
        params = _params(step)
        phase = _phase(step)
        instrument, method = _get(step, "instrument"), _get(step, "method")
        if isinstance(params.get("_tmpl"), int):
            keys.append(json.dumps(["tmpl", phase, params["_tmpl"], instrument, method]))
            continue
        block = params.get("_block")
        if isinstance(block, int) and not isinstance(block, bool):
            where = (phase, _row(step), block)
            ordinal = seen.get(where, 0)
            seen[where] = ordinal + 1
            keys.append(json.dumps(["block", phase, block, ordinal, instrument, method]))
            continue
        keys.append(None)
    return keys


def later_runs(steps: list, index: int, keys: Optional[List[Optional[str]]] = None) -> List[int]:
    """The later steps, still waiting, that are runs of the same authored step as `steps[index]`."""
    keys = keys or authored_keys(steps)
    key = keys[index]
    if key is None:
        return []
    return [j for j in range(index + 1, len(steps))
            if keys[j] == key and _get(steps[j], "status") in _WAITING]


def column_arguments(step) -> Dict[str, str]:
    """`{argument: column}` for the arguments this step takes from a table column or the optimizer."""
    found = _params(step).get("_vars")
    return dict(found) if isinstance(found, dict) else {}


def _is_reference(value) -> bool:
    return isinstance(value, str) and value.strip().startswith("#") and len(value.strip()) > 1


def check_arguments(args: Any, schema: Optional[dict], is_flow: bool, current: dict) -> Dict[str, Any]:
    """The arguments as given, or RunEditError saying what is wrong with them.

    A name the method does not take is refused rather than passed on, unless the method forwards
    unlisted keyword arguments (`accepts_kwargs`): on real hardware a typo becoming a silently
    ignored setting is the wrong outcome. A built-in step (Sleep, If...) takes only what it has.
    """
    if not isinstance(args, dict) or not args:
        raise RunEditError("Nothing to change: give the arguments and their new values.")
    bad = [k for k in args if not isinstance(k, str) or not k or k.startswith("_")]
    if bad:
        raise RunEditError(f"Not an argument that can be changed: {', '.join(map(str, bad))}.")
    if is_flow:
        unknown = [k for k in args if k not in current]
    elif schema is None:
        unknown = []  # the deck no longer has it; the step fails again and says so
    elif schema.get("accepts_kwargs") or schema.get("signature_unavailable"):
        unknown = []
    else:
        known = set((schema.get("parameters") or {}).keys())
        unknown = [k for k in args if k not in known]
    if unknown:
        raise RunEditError(f"This step has no argument called {', '.join(repr(k) for k in unknown)}.")
    return dict(args)


def with_arguments(params: dict, args: Dict[str, Any], keep_columns: bool) -> Tuple[dict, Dict[str, list]]:
    """`params` with `args` put in, and what changed as `{argument: [before, after]}`.

    `keep_columns`: an argument the step takes from a table column is left as it is (a later
    sample's own value). Otherwise it takes the new value and stops counting as from the column,
    so the record does not claim the column gave it. Changed arguments are listed in `_edited`.
    """
    out = dict(params or {})
    columns = dict(out.get("_vars") or {})
    changes: Dict[str, list] = {}
    for name, value in args.items():
        if name in columns and keep_columns:
            continue
        before = out.get(name)
        if name in out and before == value:
            continue
        out[name] = value
        changes[name] = [before, value]
        columns.pop(name, None)
    if changes:
        if columns:
            out["_vars"] = columns
        else:
            out.pop("_vars", None)
        out["_edited"] = sorted(set(out.get("_edited") or []) | set(changes))
    return out, changes


def apply_overrides(steps: List[dict], overrides: Optional[list]) -> List[dict]:
    """New steps for a run (wire dicts, `params`) with the run's kept overrides put back.

    Used when the samples still to come are re-planned from the table: the table and the authored
    workflow know nothing of a value someone changed for "this and every later run" of a step.
    """
    if not overrides:
        return steps
    keys = authored_keys(steps)
    by_key: Dict[str, Dict[str, Any]] = {}
    for entry in overrides:
        if isinstance(entry, dict) and entry.get("key") and isinstance(entry.get("args"), dict):
            by_key.setdefault(entry["key"], {}).update(entry["args"])
    out = []
    for step, key in zip(steps, keys):
        args = by_key.get(key) if key else None
        if args:
            params, _ = with_arguments(_params(step), args, keep_columns=True)
            step = {**step, "params": params}
        out.append(step)
    return out


def template_overrides(overrides: Optional[list], phase: str, index: int, instrument: str, method: str) -> Dict[str, Any]:
    """What an optimization's kept overrides change in template step `index` of `phase`."""
    key = json.dumps(["tmpl", phase, index, instrument, method])
    args: Dict[str, Any] = {}
    for entry in overrides or []:
        if isinstance(entry, dict) and entry.get("key") == key and isinstance(entry.get("args"), dict):
            args.update(entry["args"])
    return args


def plan_step_edit(steps: list, index: int, args: Dict[str, Any], scope: str) -> Dict[str, Any]:
    """What editing `steps[index]` with `args` changes: `{target, later: {index: params}, changes,
    key}`. Nothing is written; the caller writes it."""
    if scope not in ("step", "later"):
        raise RunEditError("scope is 'step' (this step only) or 'later' (also every later run of it).")
    step = steps[index]
    target, changes = with_arguments(_params(step), args, keep_columns=False)
    if not changes:
        raise RunEditError("Those are already this step's values.")
    later: Dict[int, dict] = {}
    keys = authored_keys(steps)
    if scope == "later":
        for j in later_runs(steps, index, keys):
            params, changed = with_arguments(_params(steps[j]), args, keep_columns=True)
            if changed:
                later[j] = params
    return {"target": target, "later": later, "changes": changes, "key": keys[index] if scope == "later" else None}


def edit_record(kind: str, who: Optional[str], **details) -> Dict[str, Any]:
    return {"kind": kind, "time": datetime.utcnow().isoformat(), **({"by": who} if who else {}), **details}


def with_edit(parameters: Optional[dict], record: Dict[str, Any]) -> dict:
    params = dict(parameters or {})
    params["_edits"] = [*(params.get("_edits") or []), record][-MAX_EDITS:]
    return params


def with_override(parameters: Optional[dict], key: Optional[str], args: Dict[str, Any]) -> dict:
    """The run's parameters with `args` kept for every later run of the step `key` names."""
    params = dict(parameters or {})
    if not key:
        return params
    kept = [dict(o) for o in params.get("_overrides") or [] if isinstance(o, dict)]
    for entry in kept:
        if entry.get("key") == key:
            entry["args"] = {**(entry.get("args") or {}), **args}
            break
    else:
        kept.append({"key": key, "args": dict(args)})
    params["_overrides"] = kept
    return params


# --- the samples still to come --------------------------------------------------------------

def _same_value(a, b) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def started_groups(steps: list, batch_size: int) -> int:
    """How many leading batch groups have begun: every group up to the last one with a step that
    is not pending. Rows run group by group, so these are the samples that can no longer change."""
    size = max(1, int(batch_size or 1))
    last = -1
    for step in steps:
        row = _row(step)
        if _phase(step) == "main" and row is not None and _get(step, "status") not in _WAITING:
            last = max(last, row // size)
    return last + 1


def editable_from(run: Dict[str, Any]) -> Optional[int]:
    """The first row (0-based) whose values can still change in this run, or None when none can.

    Equal to the number of rows when every sample has started but more can still be added after
    them. None when the run is not over a table, its steps do not say which sample they belong to,
    it is in its cleanup or over, or its last batch has started without being full (a new sample
    would have to join a batch already under way).
    """
    params = run.get("parameters") or {}
    if params.get("type") != "Spreadsheet" or run.get("end_time") or run.get("status") in ("completed", "cancelled"):
        return None
    steps = run.get("steps") or []
    main = [s for s in steps if _phase(s) == "main"]
    if not main or any(_row(s) is None for s in main):
        return None
    if any(_get(s, "status") not in _WAITING for s in steps if _phase(s) == "cleanup"):
        return None
    size = max(1, int(params.get("batch_size") or 1))
    first = started_groups(main, size) * size
    return first if first <= len(params.get("rows") or []) else None


def plan_splice(old_steps: list, old_params: dict, new_steps: List[dict], new_params: dict) -> Dict[str, Any]:
    """How to replace the samples still to come of a running spreadsheet run.

    `old_steps` are the run's steps as they stand (with status), `new_steps` the whole re-planned
    run, expanded (prepare_run). Returns `{remove: [old step ids], add: [new main steps], rows,
    from_row, changed, added, removed}`, or raises RunEditError saying why not.
    """
    if (old_params or {}).get("type") != "Spreadsheet":
        raise RunEditError("Only a run over a table of samples has samples still to come to change.")
    if (new_params or {}).get("type") != "Spreadsheet":
        raise RunEditError("The changed run is not a run over a table of samples.")
    size = max(1, int(old_params.get("batch_size") or 1))
    if int(new_params.get("batch_size") or 1) != size:
        raise RunEditError("The batch size cannot change while the run is going.")
    if list(old_params.get("variables") or []) != list(new_params.get("variables") or []):
        raise RunEditError("The table's columns cannot change while the run is going.")

    old_main = [s for s in old_steps if _phase(s) == "main"]
    new_main = [s for s in new_steps if _phase(s) == "main"]
    if any(_row(s) is None for s in old_main) or any(_row(s) is None for s in new_main):
        raise RunEditError("This run does not record which steps belong to which sample, so its samples cannot be changed while it runs.")
    if any(_get(s, "status") not in _WAITING for s in old_steps if _phase(s) == "cleanup"):
        raise RunEditError("The run is in its cleanup: every sample has run.")

    frozen = started_groups(old_main, size)
    first_free = frozen * size
    old_rows = list(old_params.get("rows") or [])
    new_rows = list(new_params.get("rows") or [])
    if first_free > len(old_rows):
        raise RunEditError("The last batch has started, so no sample can be added to it or changed.")
    if len(new_rows) < first_free:
        raise RunEditError(f"Samples 1-{first_free} have started and cannot be removed.")
    for i in range(first_free):
        if not _same_value(old_rows[i], new_rows[i]):
            raise RunEditError(f"Sample {i + 1} has started; its values can no longer change.")

    def shape(steps):
        return [(_get(s, "instrument"), _get(s, "method"), _row(s), _params(s).get("_block")) for s in steps]

    old_kept = [s for s in old_main if _row(s) // size < frozen]
    new_kept = [s for s in new_main if _row(s) // size < frozen]
    if shape(old_kept) != shape(new_kept):
        raise RunEditError("The changed run does not match the samples already started, so it was not applied. Reload the run and make the change again.")

    old_rest = [s for s in old_main if _row(s) // size >= frozen]
    if any(_get(s, "status") not in _WAITING for s in old_rest):
        raise RunEditError("A sample started while the change was being made. Reload the run and make the change again.")
    new_rest = [s for s in new_main if _row(s) // size >= frozen]

    changed = [i for i in range(first_free, min(len(old_rows), len(new_rows))) if not _same_value(old_rows[i], new_rows[i])]
    if not changed and len(old_rows) == len(new_rows):
        raise RunEditError("Nothing changed in the samples still to come.")
    return {
        "remove": [_get(s, "id") for s in old_rest],
        "add": apply_overrides(new_rest, old_params.get("_overrides")),
        "rows": new_rows,
        "from_row": first_free,
        "changed": changed,
        "added": max(0, len(new_rows) - len(old_rows)),
        "removed": max(0, len(old_rows) - len(new_rows)),
    }
