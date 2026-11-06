# Argument casting: ground truth and fix list

What a driver receives for what a person typed, for legacy IvoryOS (the Flask app in the
`ivoryos` repo) and NextGen (this repo). Written 2026-10-30 from the 59-case comparison run
against both versions with the `edge_case_sdl.py` test deck, plus a reading of both code paths.
**This is the plan. Nothing in it is implemented yet.**

Status of each row: **agreed** is what the comparison's "Your call" column said; **proposed** is
a row that column left blank, filled in here and marked so it can be overruled before any code
is written. Section 6 records what was settled and when.

---

## 1. The rule

One sentence covers nearly every row: **the annotation decides what the driver gets, that
decision is made in one place per app at call time, and every surface obeys it.**

- A saved workflow keeps what was typed (text, or a `#name`). Nothing is cast when a step is
  saved, so a workflow is portable between decks and Python versions.
- The cast happens on the edge, immediately before the call, from the resolved annotation. A
  value that cannot be the annotated type is **refused with a message**, never truncated and never
  passed through as text. The same cast is run as a dry run when a run is prepared, so a bad
  literal refuses the run before anything moves (the way `check_run` already does for limits).
- Every check made earlier (the Designer's step warnings, the Instruments page, the Iterate
  cell, the agent validator, the safety guard) compares **the cast value** against the declared
  type, choices and limits. Comparing text against text is what produced most of the Enum and
  Literal regressions.
- A blank **field** means "no value": the default applies, None for an Optional with none, the
  empty string for a text argument, and a refusal for any other required argument. A blank
  **cell** means "not configured", and a row with one is refused. None and the default are said
  with the bracketed markers `<None>` and `<default>`, never with a word typed into a field;
  `<None>` is always allowed. There is no marker for an empty string (dropped as too rare): a
  blank text field with no default is `''`, and an empty string over a non-empty default cannot
  be asked for.
- A `#name` is a whole value. Inside an instrument's text argument it is sent as written; only a
  Comment's message and a User input's prompt fill it in.

Python version matters because both apps branch on how a type prints, and that changed in 3.14
(`Optional[float]` and `float | None` became one object printing as the latter). NextGen's
`type_name` and `_is_union` already carry the branches; the fixture in section 5 must run on
3.10 (CI), 3.11 (the launcher's venv) and 3.14. Legacy records a type it does not
recognise as `str(annotation)` in a saved step's `arg_types` and later `eval`s that text, so a
workflow saved on one Python can fail to cast on another (L8).

---

## 2. Ground truth

"Driver gets" is the Python object the method is called with. "Refused" means refused where it
is typed and again by the edge before the call, with a message naming the value and the type.

### 2.1 Primitives

| # | Case | Driver gets | Status | Note |
|---|---|---|---|---|
| P1 | `int` given `2.5` | refused: not a whole number | agreed | NextGen sends `Number("2.5")` as JSON 2.5 and `int(2.5)` truncates to 2. |
| P2 | `float` given `x` | refused: not a number | agreed | Same message on the Instruments page and in a workflow. |
| P3 | `Union[int, float]` given `2.5` | `2.5` (float) | agreed | |
| P4 | `Union[int, float]` given `3` | `3` (int) | agreed | A number written with a decimal point is a float, one without is an int. Legacy gives `3.0`, NextGen the text `'3'`. |
| P5 | `Union[int, float]` given `3.0` | `3.0` (float) | proposed | Follows from P4. |
| P6 | No type hint, given `1.5` / `7` | the text `'1.5'` / `'7'` | agreed (revised 2026-10-30) | **An untyped parameter gets the text as typed**, on both sides. There is nothing to parse against, and the comma case (P8) is where a guess goes wrong. Legacy's `convert_guess` stops guessing (L9); `coerceArgumentLiteral` on NextGen's `**kwargs` rows stops too (N4). A `#name` is still substituted. |
| P7 | No type hint, given `True` / `None` / `[1, 2]` / `{"a": 1}` | the text as typed | agreed (follows from P6) | No guessing for an untyped parameter. A driver that wants a list or a dict annotates it (C1-C7); `<None>` sends None. Legacy's `ast.literal_eval` guess goes with L9. |
| P8 | No type hint, given `a, b` | the text `'a, b'` | agreed | Legacy splits any comma into a list today and stops (L9). A list wants a `List` annotation (C6). |
| P9 | `Optional[float]`, no default, left blank | `None` | agreed | Not marked required anywhere. NextGen's schema says `required: true` because required means "has no default". |
| P10 | `Optional[int]` given the word `None` | refused: "to send None, choose None" | proposed (revised) | The typed word is never None: None is the `<None>` choice, blank is the default. This is what the Iterate cell already says in strict mode (`resolveBlockParams`). A legacy workflow's None (JSON null, or the word) becomes `<None>` on import (I6). See T5 for text fields. |
| P11 | `Optional[bool] = None`, untouched | `None` | agreed | Legacy gives False on the Instruments page and True in a workflow (legacy bug #11). |
| P12 | `bool` | the bool | agreed | A bool is a **dropdown** everywhere (True, False, None for an Optional, and a `#variable` typed in), the Designer step included (today only the Instruments page has one). The edge still reads `true`/`false` in any case from a spreadsheet cell or a CSV, and refuses anything else. Legacy accepts `f`, `n`, `` as False and everything else as True. |
| P13 | A `#name` whose value arrives as text (a spreadsheet cell, an optimizer suggestion) | cast by the annotation like a typed value | proposed | Already the intent; stated so the per-trial and per-row paths are covered by the same tests. |

### 2.2 Enum and Literal

| # | Case | Driver gets | Status | Note |
|---|---|---|---|---|
| E1 | Enum with number values (`Speed.FAST = 3`), picked | `Speed.FAST` | agreed | Also keyword-only, `Optional[Enum]`, a property setter, and an Enum inside a dict or dataclass. NextGen sends the `<select>`'s string `"3"`, which `Speed("3")` refuses, and falls back to the text. |
| E2 | `IntEnum` (`Port.C = 3`) picked | `Port.C` | agreed | |
| E3 | Enum with tuple values (`Plate.WELL_96 = (8, 12)`), untouched or picked | `Plate.WELL_96` | agreed | NextGen's guard turns the default into a list and checks each element against the choices as text, so every call is refused. |
| E4 | Member **name** in a saved workflow (`"FAST"`, `"ETHANOL"`, as legacy saves them) | the member | agreed | The edge accepts a member's name, its value, or its value as text (legacy's `find_member`). |
| E5 | A name that is another member's value (`Tricky.ON = "OFF"`, given `"ON"` or `"OFF"`) | `Tricky.ON` for `"ON"`, `Tricky.OFF` for `"OFF"` | agreed | Lookup order: the member itself, then the **name**, then the value, then the value as text. NextGen today gives `Tricky.OFF` for `"OFF"` correctly but has no name lookup at all. |
| E6 | What a NextGen workflow **stores** for an Enum | the member's **name** | agreed | The name is stored because the value may be nothing a person can type or JSON can hold (a tuple, a plate object); the edge turns the name back into the member at call time. The schema carries `choices: [{label, value}]` (`options` stays the values for older frontends); the UI shows the label and, when the value prints, the value beside it (`FAST (3)`). |
| E7 | `Literal[0.5, 1.0, 2.0] = 1.0`, untouched or set to `2.0` | `1.0` / `2.0` (float) | agreed | The driver gets the option object itself. The schema lists each option as a `{label, value}` pair (label `"1.0"`, value `1.0`), the workflow stores the **label**, and the edge resolves the label to the option, so JSON turning `1.0` into `1` can no longer lose the match. A raw value is still accepted (older workflows, Cloud). Legacy stores and renders the text; NextGen's guard compares `"1"` with `"1.0"` and refuses the untouched default. |
| E8 | `Literal[1, 2, 4, 8]` picked `4` | `4` (int) | agreed | Same rule. |
| E9 | `Literal[True, False]` picked `False` | `False` (bool) | agreed | Same rule. |
| E10 | `Literal["a,b", "c"]` picked `a,b` | the text `'a,b'` | agreed | Legacy records choices as `Literal:a,b,c` and splits on the comma (legacy bug #6). |
| E12 | An Enum whose values are objects (a dataclass of settings, a `ctypes` pointer, a callable), picked or untouched | the member, by its name | agreed (2026-11-02) | The cast resolved these by name all along; the schema did not survive them: `json.dump` failed on the value, so the schema file, the deck version and the MQTT publish were lost, and `/api/status` showed `{}` for every option. `extract_type_info` now publishes a JSON-safe copy of each value (`_published_value`: a dataclass as its fields, anything else as its repr) beside the name, and `choices_of` keeps the real values for the cast. A value typed as text matches only when its `str` equals the text; a Classic workflow holding such a value cannot name the member. |
| E11 | A value outside the Enum or Literal | refused, listing the choices | proposed | NextGen does this through the guard's `declared_choices`; it must compare the cast value, not text. |

Same in both today and kept: text-valued Enums, an Enum with an alias, an untouched
`Optional[Enum]` (None), text Literals, `Optional[Literal]`.

### 2.3 Dicts, lists and tuples

| # | Case | Driver gets | Status | Note |
|---|---|---|---|---|
| C1 | `Dict[str, float]` given `{"a": 1}` or `{"a": "1.5"}` | `{'a': 1.0}` / `{'a': 1.5}` | proposed (NextGen marked better) | Values cast by the annotation, nested dicts and lists of dicts included. |
| C2 | `Dict[int, float]` given `{"1": 10}` | `{1: 10.0}` | proposed (NextGen marked better) | Keys cast too (legacy bug #7). |
| C3 | Enum values inside a dict | the members | proposed (NextGen marked better) | Legacy bug #8. |
| C4 | `Tuple[float, float]` | a tuple | proposed (NextGen marked better) | Legacy gives a list, in a workflow even for the untouched default (legacy bug #9). |
| C5 | A dict typed as JSON or as a Python literal; a dict default; keys with spaces, quotes or `#`; an `Optional` dict left blank (None) | same in both today | kept | |
| C5a | `Dict[str, float]` with a value `#ki`, a column or a search-space entry holding `0.25` | `{'ki': 0.25}` | NextGen, 2026-11-03 (issue 61) | The dict field (`DictInput`) keeps the dict as an object, so the `#name` is found, typed by `value_type` and substituted; as text it stayed text. A key is never a reference (C5). |
| C5b | A `TypedDict` | a dict, each key cast by its own type; a required key missing is refused | NextGen, 2026-11-03 | Was passed through as it came. |
| C6 | `List[str]` typed without brackets, `a, b` | `['a', 'b']` | agreed | `List[int]` typed `1, 2` gives `[1, 2]`: split on commas, each element cast by the element type. Bracketed JSON works as before. |
| C7 | Bare `list` (no element type) | the literal if it parses, else split on commas | proposed | |

### 2.4 Text and `#variables`

| # | Case | Driver gets | Status | Note |
|---|---|---|---|---|
| T1 | `str = ""` default, untouched | `''`, and the step can be added | agreed (NextGen) | Legacy's `InputRequired` reads `""` as missing (legacy bug #12). |
| T2 | Padded text, `"  two spaces  "` | kept as typed | agreed (NextGen) | Legacy's Instruments page strips it (bug #13). |
| T3 | `str = None`, untouched | `None` | agreed (NextGen) | Legacy's Instruments page gives the text `'None'` (bug #13). |
| T4 | `str = None`, cleared in a workflow step | `None` | agreed (legacy) | Cleared means "no value", so the default. NextGen sends `''`. An empty string over a None default cannot be asked for in a field (no marker for it; too rare to be worth one). |
| T9 | `str` with no default, left blank **in a field** (the Designer step, the Once form, Instruments, an Optimize fixed value, a Cloud single value) | `''` | agreed | Blank in a text field is the empty string, so a required text argument is never refused as missing (legacy's Designer allows it too; its `InputRequired` on the Instruments form is bug #12, L6). A blank **cell** means something else (T10). |
| T10 | A spreadsheet cell left blank (Iterate, the Optimize per-iteration table, a Cloud spreadsheet), text column or not | missing: a row with nothing in it is not a sample; a row with some cells blank is refused as missing a value | agreed | Blank in a cell is "not configured", as in legacy's iteration config: a table cannot tell an unfilled cell from an empty string. Same on both sides. |
| T11 | `<None>` or `<default>` in a cell or a field | `None` / the argument is left out, so the driver's default applies | agreed | The two markers are text (bracketed, so no real value collides), written by a cell's buttons, the Designer step's ∅ button, typed by hand, or carried in a CSV, which is how a spreadsheet says None at all. `<None>` is always offered, in a field and in a cell, Optional or not (the driver gets None); `<default>` where the argument has a default (an Optional with no default counts: its default is None). Same on both sides for None. An `<empty>` marker for a purposely empty string was planned and dropped (2026-11-02): too rare for a third button. **Two forms**: stored and typed (a workflow's params, a row, a CSV, a Cloud field) the marker is the text `<None>`; on the wire to the edge `resolveBlockParams` sends JSON null for it, as today, and the edge's `cast_value` also accepts the text itself, for a value that reaches it without the resolver (a CSV posted by an agent, a Cloud payload, a test). `<default>` has no JSON form, so it is resolved by whoever builds the call, the edge last. |
| T5 | The word `None` typed into `Optional[str]` | the text `'None'` | agreed (NextGen) | A text field can hold the word, so it is text; None is the `<None>` choice. Legacy gives None. |
| T6 | `#n` inside text, `sample_#n` | the text `'sample_#n'` | agreed (NextGen, revised 2026-11-02) | An instrument's text argument is sent as written; only a Comment's message and a User input's prompt interpolate `#name`, as today. Interpolating inside every text argument was agreed on 2026-10-30 and withdrawn as too much. Legacy interpolates; the legacy fixture copy marks T6 a known difference. |
| T7 | `#` before something that is not a variable, `sample #1` | `'sample #1'` | agreed (NextGen) | Follows from T6: NextGen never reads a `#` inside an instrument's text argument. Legacy ends the run before the call (bug #2). |
| T8 | A whole-value `#name` nothing saves and nothing supplies | refused before the run starts | agreed (NextGen) | Legacy passes None. |

### 2.5 Legacy workflow JSON imported into NextGen

| # | Case | Expected | Status |
|---|---|---|---|
| I1 | `wait`, `pause`, `variable`, `math_variable` | `Sleep`, `User_Input` (no name), `Set_Variable` | done today |
| I2 | `if` / `else` / `endif`, `while` / `endwhile` | `If` / `Else` / `End_If`, `While` / `End_While` | proposed |
| I3 | `input` (with a variable), `comment` | `User_Input` with `variable_name` and `input_type`, `Comment` | proposed |
| I4 | `repeat` | the steps inside are imported once, and the import shows **one warning** that repeat is not supported | agreed; the body is kept rather than dropped so nothing disappears unannounced |
| I5 | Enum arguments saved as member names, `arg_types` entries like `Enum:deck.Solvent` | the names are accepted as values (E4); `arg_types` is dropped | follows from E4 |
| I6 | An argument legacy saved as None (JSON null) or as the word `None` on a non-text field | the `<None>` choice | agreed |

Legacy features marked not needed (building blocks, Repeat, locking, `.py` import) are out of
scope. Hiding and reordering an instrument's methods and the interactive console are wanted but
are UI work, not casting, and stay on `legacy-ux-backlog.md`.

---

## 3. Why NextGen is where it is

Pointers for whoever does the work; each is one cause behind several rows.

- **The frontends cast, the edge forgives.** `handleParamChange` in `WorkflowEditor.tsx` and
  the Instruments page's `onChange` turn any numeric-looking text into `Number(value)`, so the
  edge sees JSON `2.5` for an `int` and `int(2.5)` is `2` (P1). `cast_value` wraps every
  conversion in `try/except: return val`, so a value that will not cast reaches the driver as
  text (P2, P4, P6). `cast_arguments` has no refusal path at all.
- **Choices are strings on the wire.** `extract_type_info` lists an Enum's `options` as the
  members' values; a `<select>` or `SuggestInput` hands back `String(o)`; `Speed("3")` is not
  `Speed(3)` (E1, E2). There is no name lookup (E4, E5) and no typed Literal match (E7, E8, E9).
- **The guard compares text.** `check_value` compares `_position_text(item)` with
  `str(option)`, so `1` (what JSON made of `1.0`) misses `"1.0"` (E7), and a tuple default is
  iterated element by element (E3). It must compare the cast value with the matched choice.
- **`required` means "has no default".** An `Optional[float]` with no default is therefore
  required on the Instruments page and sent as `''` from a workflow (P9). The schema already
  carries `optional: true`, which the agent validator honours and the pages do not.
- **Interpolation lives in one place, and stays there.** `interpolate_message` is called only
  by the Comment and User input steps; instrument arguments go through
  `substitute_workflow_vars`, which is whole-value only. The comparison counted this a gap; T6
  now says it is the rule.
- **A multi-arm Union is passed through** (`cast_value`: `if len(arms) == 1 ... return val`),
  and an untyped parameter likewise (P3, P4, P6).

---

## 4. Fix lists

### 4.1 NextGen (this repo), in order

| # | Change | Where | Rows |
|---|---|---|---|
| N1 | **Done 2026-11-02.** **`cast_value` becomes strict and total.** It parses text by the annotation and raises a `CastError` (value, parameter, type, message) instead of `return val`. Unions try each arm in order with the P4 rule for numbers; `Optional` maps blank and None to None; Enum by member, name, value, text of value, name first; Literal by typed match returning the option object; bool by case-insensitive True/False; `List[X]` and bare `list` from brackets or commas; an untyped parameter gets the text as typed (P6, P8), a `#name` substituted first. Must behave the same on 3.10 and 3.14 (`_is_union` already does; `cast_value`'s own `UnionType` check should use it). | `edge_server/ivoryos_edge/introspection.py` | P1-P13, E1-E11, C1-C7 |
| N2 | **Done 2026-11-02** (`_refuse_uncastable` in `prepare_run`, a 400 from `/api/execute`). **A refused cast is a refused step, and a refused run when it is a literal.** `cast_arguments` lets `CastError` through; the run loop and `/api/execute` report it as a failed step with the message (the usual retry/skip/stop pause); `prepare_run` runs a dry cast over every literal argument (`#names` skipped, as `check_run` does) and refuses the run with 400 before queueing. | `queue.py`, `server.py` (`prepare_run`, `/api/execute`) | all |
| N3 | **Done 2026-11-02 on the edge** (`choices`, `required`, the guard and the agent validator match through `match_choice`); the frontends still read `options` and store values (N4). **The schema says what a choice is and when None is allowed.** `extract_type_info` adds `choices: [{label, value}]` for an Enum (label the name) and a Literal (label the option's spelling), keeping `options` as the values for older frontends; `required` becomes false for an `Optional` with no default (already `optional: true`). `declared_choices` and `check_value` resolve the stored label (or a raw value) to the member or option and compare that, never `str()`. | `introspection.py`, `safety.py` | E1-E11, P9 |
| N4 | **Partly done 2026-11-02**: Enum and Literal fields offer and store the label (`choiceLabels` in `runConfig.ts`: the Designer card's suggestions, with the value beside a name when it differs; the Instruments field; the Iterate and Once dropdowns; the step editor), the schema publishes an Enum default by its member's name and a Literal default by its label, and one `isNumericType` (whole type name: `int`, `float`, an Optional of one, `Union[int, float]`) replaced the "contains int" tests that drew `Dict[int, float]`, `List[int]` and `Tuple[float, float]` as number inputs and refused their JSON (the Designer, the Designer gate, the Instruments page, `SpreadsheetTable`, `stepEdits`, the agent validator, Cloud's gate). The Designer card also warns on a value outside the choices. Still to do: `Number()` coercion, the bool dropdown in the Designer card, `coerceArgumentLiteral`. **The frontends stop casting and start saying.** `handleParamChange` and the Instruments page keep the typed text (no `Number()`); the step warning and the Instruments field report what the edge will refuse using a small shared check (`argumentChecks.ts` in shared-ui: is a number, is a whole number, is one of the choices by label or value) that mirrors N1's refusals only, not its results, so there is nothing to drift on the value side. Enum and Literal fields pick from `choices` and store the label; a bool is a dropdown on every surface (P12). `resolveBlockParams`'s `strict`/`lenient` numeric policy goes through the same check. `coerceArgumentLiteral` stops typing `**kwargs` rows (a bare `20` no longer becomes a number, and the quoting rule goes): untyped is text (P6), and a driver that annotates its `**kwargs` is still cast by N1. This reverses the rule in AGENTS.md section 12, which should be updated with it. | `packages/shared-ui/src/WorkflowEditor.tsx`, `runConfig.ts`, `ExtraArguments.tsx`, `frontend/src/app/instruments/page.tsx`, new `packages/shared-ui/src/argumentChecks.ts` | P1, P2, P12, E1, E6-E9 |
| N5 | **Done 2026-11-02 on the edge and the bench pages** (`cast_arguments`: blank, `<None>`, `<default>`, an Optional left out; `blankChoicesFor` offers None on every column; the Designer card's ∅ button writes `<None>` into any field and the folded line reads `None`; the Designer gate, the step warnings, the Instruments page and the agent validator take a blank text argument as `''` and the markers as values). `<empty>` was dropped. **Not done: Cloud's single-value fields** (`RunConfigPanel`) offer no marker and read `options` rather than `choices`, so an Enum default now published by name does not match its value list there; a `<None>` typed there already reaches the edge and works. Kept documented, deferred on purpose. **Blank, None and empty: one rule, two kinds of surface.** In a **field** (the Designer step, Instruments, the Once form, Optimize fixed values, Cloud single values) blank is "no value": the default, None for an Optional with none, `''` for a text argument with no default (T9), a refusal for any other required argument. In a **cell** (Iterate, the Optimize per-iteration table, Cloud's spreadsheet node) blank is "not configured": a row with nothing in it is not a sample, a row with a blank cell is refused (T10; already so). Three bracketed markers say otherwise and are accepted everywhere a value is typed, by button, by hand or from a CSV (T11): `<None>` (`NONE_VALUE`; always offered, so `blankChoicesFor` stops gating it on Optional), `<default>` (`DEFAULT_VALUE`; where the argument has a default), and `<empty>` (new, `EMPTY_VALUE`; text arguments). `BlankChoice` is offered in every field, not only cells. The typed word `None` is text in a text field (T5) and refused elsewhere with "choose None" (P10). `resolveBlockParams` and `cast_value` resolve the markers the same way, Data History shows them as words. Legacy import maps null and the word to `<None>` (I6). | `runConfig.ts`, `BlankChoice.tsx`, `WorkflowEditor.tsx`, Instruments page, `optimize` page, Cloud `RunConfigPanel`, `cast_value`, `runRecord.ts` | P9, P10, P11, T3, T4, T5, T9, T10, T11, I6 |
| N6 | **Dropped (2026-11-02).** In-text `#name` stays as it is: `interpolate_message` for Comment and User input only, `substitute_workflow_vars` whole-value only. Nothing changes for T6 and T7. Optional, and small: the step warning in N4 could say that a `#name` inside an instrument's text argument is sent as written, since someone coming from legacy will expect `sample_#n` to be filled in. | | T6, T7 |
| N7 | **Legacy workflow import.** `fromLegacyBuiltIn` (shared-ui `flowControl.ts`), the launcher's `builtInStep` (`desktop/src/hubCatalog.js`) and `classic.py` learn `if`/`else`/`endif`, `while`/`endwhile`, `input`, `comment`; `repeat` imports its steps once, with one warning per import that repeat is not supported (I4). `tests/fixtures/legacy_steps.json` grows the cases, since it already holds the two copies to one answer. | `packages/shared-ui/src/flowControl.ts`, `desktop/src/hubCatalog.js`, `edge_server/ivoryos_edge/classic.py` | I2-I6 |
| N8 | **The agent validator and the Library's compatibility check use the cast.** `_check_params` calls N1's dry cast for literal values instead of its own `_numeric_ok`; `check_fields` keeps the limits. | `agent/validate.py`, `compatibility.py` | all |
| N9 | **Python versions.** CI adds a 3.14 job beside 3.10 for the casting and introspection tests (the `UV_PROJECT_ENVIRONMENT=.venv314` recipe in AGENTS.md section 12); the fixture (section 5) is the test that runs on all three. | `.github/workflows/test.yml` | |

What N1 through N3 do not touch: `serialize_result`, return pointers, the labware markers,
units, SiLA's own `to_sila` (which converts before `cast_value` sees anything).

### 4.2 Legacy (`ivoryos` repo), in order

| # | Change | Where | Rows / bugs |
|---|---|---|---|
| L1 | **Literal values keep their type.** `FlexibleLiteralField` matches the typed text against each option by the option's type and stores the option object; the renderer writes it with `repr`, so `1.0` is `1.0` and not `'1.0'`. Choices are recorded as a JSON list in `arg_types`, not `Literal:a,b`, so a value with a comma survives (the `Literal:` string form is read for old steps). | `forms/dynamic_forms.py`, `parsers/introspection.py` (`_literal_type_string`), `script/renderer.py` (`_literal_annotation`, `_process_dict_args`) | E7-E10, bugs #4, #6 |
| L2 | **`Optional[bool] = None` untouched is None.** `VariableOrBoolField.process_data(None)` sets None rather than falling into "not a false value, so True". | `forms/dynamic_forms.py` | P11, bug #11 |
| L3 | **`Union[int, float]` keeps an int.** The form picks the float field whenever `float` is among the arms; a union of numbers wants a field that gives `3` for `3` and `2.5` for `2.5` (P4). `_convert_by_str` gets the same rule for config rows. | `forms/dynamic_forms.py` (`create_form_for_method`), `parsers/type_conversions.py` | P4, P5 |
| L4 | **Untyped parameters are accepted in the Designer.** `validate_variables` refuses the step for an untyped `1.5` or `7` (the empty `arg_types` entry); any text is valid for an untyped parameter (P6). | `script/editor.py`, `routes/design/design.py` | P6, bug #12 |
| L5 | **Dicts and tuples cast by their annotation.** `parse_structured_value` / `validate_structured_value` cast keys and values (`Dict[int, float]`, Enum values inside), and a `Tuple[...]` is a tuple in a workflow as on the Instruments page. | `parsers/structured_types.py`, `script/renderer.py` | C1-C4, bugs #7, #8, #9 |
| L6 | **Text.** `str = ""` is a value, not a missing one (`InputRequired` → `Optional()` when the default is a string); the Instruments page stops stripping text and stops sending the word `None` for an untouched `str = None`; `sample #1` in text stays literal (today the run ends before the call; where `#1` is taken for a variable still has to be traced). | `forms/dynamic_forms.py`, `routes/control/*`, `script/renderer.py` | T1, T2, T3, T7, bugs #2, #12, #13 |
| L7 | **Dropped (2026-10-30).** Legacy keeps reading the typed word `None` as None in a text field; T5 is NextGen's rule only, and the legacy fixture copy marks T5 as a known difference rather than a failure. | | T5 |
| L8 | **Type strings are version-independent and never `eval`ed.** `arg_types_meta` falls back to `str(annotation)`, which is `typing.Optional[int]` before 3.14 and `int | None` from 3.14, and `_convert_by_str` runs `eval(f'{arg_type}("{args}")')` on it. Record the NextGen `type_name` spelling (one form on every version) and cast with a lookup of builtins and the recorded Enum/Literal, not `eval`. | `forms/dynamic_forms.py`, `parsers/introspection.py`, `parsers/type_conversions.py`, `script/editor.py` (`_convert_type`) | the Python-version note |
| L9 | **Untyped is text.** `convert_guess` stops guessing for a parameter with no annotation: no `ast.literal_eval`, no comma split; the text goes to the driver as typed. | `runtime/task_runner.py` | P6, P8 |

Legacy already matches the ground truth on E1-E6, C5, C6, T4 and T8; those rows need no legacy
change. T6 is a known difference kept on both sides: legacy interpolates `#name` inside text,
NextGen does not.

---

## 5. One fixture, two test suites, one test deck

The ground truth is kept as data so both repos test the same thing and neither table above
has to be read by a test.

- **`tests/fixtures/casting_ground_truth.json`** (this repo; the legacy repo takes a copy, the
  way `legacy_steps.json` and `run_datasheets.json` already work): one entry per row above,
  `{id, annotation (source text), default (source text or absent), typed (what the person
  entered, as text; or the JSON a legacy workflow holds), surface: "field" (a single value: Instruments, the Designer step, Once) |
  "cell" (a spreadsheet cell) | "both", expect: {value: <Python repr>} | {refused: <substring of the message>}, status}`. The
  Python version it was last checked on is recorded per run, not per entry.
- **`example/edge_case_sdl.py`** is rebuilt from the fixture's annotations (one method per
  annotation shape, each returning exactly what it received, as the comparison deck did) and
  loaded by `IVORYOS_DEMO_TEST_DRIVERS=1` beside `dummy_driver.py` and `variadic_driver.py`.
- **`tests/automated/test_casting_ground_truth.py`** drives every entry through `cast_arguments`
  directly and, for `surface` including `workflow`, through a one-step run on the in-process
  edge, asserting the driver's recorded argument. Runs under the 3.10 and 3.14 recipes (N9).
- **Legacy**: a `tests/unit/test_casting_ground_truth.py` reading the same file, posting the
  forms as the comparison did.

The comparison's own harness (forms read from rendered pages, the real edge sent what its pages
send) is the model for the "surface" dimension; the fixture is what lets the next comparison be
a test run instead of a 59-row spreadsheet.

**Written 2026-11-02.** The fixture holds 90 entries (the rows above, several with more than one
input), the deck is `example/edge_case_sdl.py` (`EdgeCaseSDL`, `test_edge_cases` on the demo
deck), and the test runs every entry through `cast_arguments`, through `POST /api/execute` and,
for the `run` rows, through `POST /api/queue/runs`. On that day the edge met 104 of the 239
checks; the other 135 are listed in the test's `NOT_YET` table, keyed `<test>:<id>[<input>]`,
each with the fix that closes it (N1, N3 or N5), as **strict xfails**: a fix that lands makes its
rows pass, the xfail fails, and the entries come out. The table is the to-do list for N1-N5 in
executable form. `cell` rows (T10, P13's cell half) wait for a node test over `runConfig.ts`,
and `import` rows for N7's converters.

---

## 6. Decisions

Settled on 2026-10-30; nothing is open:

- E6: an Enum is stored by the member's name, since the value may not be typeable; the edge
  resolves the member.
- E7-E9: a Literal is label/value pairs in the schema, the label stored, the edge resolves it.
- P12: bool is a dropdown everywhere; the edge reads `true`/`false` in any case from a cell or CSV.
- None: blank is the default (None for an Optional with none); `<None>` is None on every surface;
  the typed word is text in a text field and refused elsewhere; legacy's None imports as `<None>`.
- T9: a text field left blank with no default is `''`, so a required `str` is never missing, and
  `<None>` is offered on text fields whether or not they are Optional.
- P6, P8: an untyped parameter gets the text as typed, on both sides. Legacy stops guessing (L9),
  NextGen stops typing `**kwargs` rows (N4).
- I4: a legacy `repeat` imports its steps once with one warning that repeat is not supported.
- L7 dropped: legacy keeps its meaning of the typed word `None`; the legacy fixture marks T5 as a
  known difference.

The rows still marked **proposed** (P5, P10, P13, E11, C1-C4, C7, I2, I3) are consequences of the
decisions above or carried the comparison's own "NextGen better" mark; they are taken as agreed and
go into the fixture as such.

Settled on 2026-11-02:

- T6 revised, N6 dropped: a `#name` inside an instrument's text argument is sent as written on
  NextGen; only Comment and User input interpolate. Legacy keeps interpolating; the fixture marks
  the difference.
- Fields and cells differ on blank (T9, T10): in a field a blank text argument is `''`; in a cell
  blank is "not configured", a row with a blank cell is refused, as in legacy's iteration config.
- Markers (T11): `<None>` is always allowed, in a field or a cell, Optional or not, and is how a
  spreadsheet or a CSV says None.

Settled later on 2026-11-02:

- Merged with main's container work (b9d4ba9, closes #35), which had landed in parallel: the
  schema's `is_mapping` / `is_list` / `key_type` / `value_type` / `items` and shared-ui's
  `paramTypes.ts` (`isNumericType`, `isBoolType`, `containerProblem`) are the one place every page
  decides a field's kind, and `isTextType` joined them; main's lenient container cast (text the
  edge could not read went to the driver) gave way to the strict one here, with one rule kept
  from it (C6.word). A dict given text that is not a dict is refused (two of main's tests said
  otherwise and were changed).

- `<empty>` dropped: too rare for a third button. A blank text field with no default is `''`
  (T9); an empty string over a non-empty default cannot be asked for, and the T4 leftover stays.
- The step card: blank means the default where there is one, or None for an Optional (the schema
  says `required: false`, and its default is None); everything else is required. A tiny ∅ button
  on the open card writes `<None>` for a None over a default.
- Enum choices are the member **names** on every surface (the value may be nothing a form can
  show, a tuple or an object), and the schema publishes an Enum default by its name, a Literal
  default by its label, so an untouched default is one of the listed choices.
- Cloud is not touched now: its single-value fields and `options` readers are listed under N5.
- Checked by hand on the test deck (`example/edge_cases_demo.py`): a workflow of every
  `edge_cases` step run from the Designer with typed values, and the same workflow with a `#name`
  on every step run from Iterate with one row of values, markers included; every step received
  the object the ground truth says. A workflow name holding `#` cannot be loaded from the Library
  (the page's fetch URL is not encoded, so `#` starts a fragment): pre-existing, not fixed here.

Order of work: the fixture and test deck (section 5), then N1-N3 (the
Enum, Literal, Union and Optional regressions are edge-only), then N4-N5, then N7, with the
legacy list in its own order alongside.
