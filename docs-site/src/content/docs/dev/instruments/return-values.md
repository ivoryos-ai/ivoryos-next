---
title: "Return values and #variables"
description: How a step's result is saved, read by later steps, and offered to the optimizer.
sidebar:
  order: 5
---

A driver method rarely returns one number. It returns a reading, a report, a dictionary. IvoryOS
flattens the **return annotation** into the leaves a step can save, and a step binds **one name
per leaf** it cares about.

## From annotation to save fields

```python
@dataclass
class PeakComposition:
    yield_percent: float
    substrate_percent: float

@dataclass
class HPLCReport:
    composition: PeakComposition
    method: str
    runtime_s: float

class HPLC:
    def analyze(self) -> HPLCReport: ...
```

`analyze` publishes these return paths:

| Path | Type | Objective? |
|---|---|---|
| `composition.yield_percent` | float | yes |
| `composition.substrate_percent` | float | yes |
| `method` | str | no |
| `runtime_s` | float | yes |

In the Designer, the open step shows an output field per leaf (or one field, `→ name`, when the
return is a single value). Type a name to save that leaf under it. The Optimize page offers only
the numeric leaves as objectives and lists the rest as "also saved, but not numeric".

- `-> float` (or any single value): one field, the result itself.
- `-> Tuple[float, str]`: leaves `0` and `1`.
- `-> None`: nothing to save, no field.
- No annotation: one leaf typed `Any`; still savable, never an objective.
- A leaf that is not in the actual result (the method returned something else) is skipped, not
  recorded as `None`.

## Reading a value back: `#name`

A later step reads a saved value by writing `#name` in a field:

```
uv_vis.measure_absorbance(...)   → absorbance_312
hplc.measure_yield()             → yield_percent
If  absorbance_312 > 1.5
    Comment  "high absorbance: #absorbance_312, yield #yield_percent"
```

Two forms of substitution exist, and it helps to know which applies:

- **A field that is exactly `#name`** is replaced by the value, with its real type (a float stays a
  float). This is how instrument arguments read variables. A run whose `#name` nothing before it
  saves is refused before anything moves.
- **Free text** (a Comment message, a User input prompt, an If / While condition) replaces every
  `#name` inside the text. An unknown name is left as literal text.

A `#name` that only ever follows the step that saves it is a *reference*, not an input: the Once
form does not ask for it, Iterate has no column for it, and Optimize leaves it out of the search
space. A `#name` nothing saves is an *input*, and that is what the three run tabs ask for.

## What the record keeps

Every step record stores its arguments as sent (after substitution), its result, and `_vars`,
a map of which arguments came from a `#name`. Data History uses it to colour those arguments, to
build one column per input and one per saved output, and to attribute an optimizer's trial values
to the right column even when the argument has a different name from the variable.

## In the generated Python

The Designer's **Python** view renders the same thing as a script, which is the clearest
statement of the semantics:

```python
absorbance_312 = uv_vis.measure_absorbance(wavelength_nm=312, dilution_factor=1000)
report = hplc.analyze()
yield_percent = report.composition.yield_percent
```
