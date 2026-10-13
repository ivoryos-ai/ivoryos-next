---
title: How the optimizers behave
description: What Ax, BayBE and NIMO do with the Optimize page's settings, and what happens when a trial fails.
sidebar:
  order: 1
---

The three backends differ in more places than the Optimize page suggests. Read the row for the
one you use.

## Which optimizers are offered

One appears in the engine dropdown when its package is installed on the deck (the desktop app's
**Settings → Optimizers**). Installed but missing means it failed to load; the deck's log says why
at startup: `[optimizer] baybe is installed but could not be loaded: ...`.

## Trials and rounds

**Evaluation budget** is the total number of trials. **Batch size** is how many the optimizer
suggests at once; every trial in a round runs, then the whole round is reported back together. The
last round is cut short so the budget is never exceeded.

| | Trials per round |
|---|---|
| **Ax** | Usually the batch size. Ax limits a batch to what its current strategy step has left, so where the random start hands over to the model IvoryOS asks again for the rest and a round can mix random and model trials. If the model cannot suggest yet, the round is shorter. |
| **BayBE** | Always the batch size, all from one stage; the random stage may run past its count to the end of a batch. |
| **NIMO** | The batch size, from its candidate list. |

## The random start

| | The number counts | Existing data counts | 0 or empty |
|---|---|---|---|
| **Ax** | trials; a failed one does not count, so another random trial takes its place | no | no random start: the model goes first and fails without data |
| **BayBE** | results on record | yes | 1 |
| **NIMO** | **rounds**, not trials: 2 with a batch of 3 is 6 random trials | no | no random start |

With no strategy configured, Ax uses its own default (the centre of the space, then 4 Sobol trials,
then its model once 2 results are in). BayBE needs a strategy; an empty one fails.

## A trial that gives no result

A trial fails when one of its objectives has no value: the step was skipped, or returned nothing,
NaN or something that is not a number.

| | A failed trial |
|---|---|
| **Ax** | marked failed in Ax; the run carries on and the model does not use it |
| **NIMO** | its candidate is left unmeasured; the run carries on |
| **BayBE** | left out of the model (the deck log says so); the rest of the round is recorded |

A failed trial still counts towards the budget. Tick **Pause and ask me when a trial gives no
result** to be asked instead: **Leave it out**, **Stop, run cleanup** or **Stop run**.

When the optimizer itself fails, the run pauses the same way:

| The optimizer… | You can |
|---|---|
| cannot suggest the next trials | **Ask again**, **Stop, run cleanup**, **Stop run** |
| refuses a round's results | **Record again**, **Go on without it**, **Stop, run cleanup**, **Stop run** |

## Existing data

| | |
|---|---|
| **Ax** | each row is a completed trial; does not shorten the random start |
| **BayBE** | each row is a measurement and counts towards the random start; every row needs every parameter and objective |
| **NIMO** | **not used** |

## Search space

- A range with a step becomes a list of values; without one it is continuous. NIMO takes only
  lists: a range with a step, or a choice.
- Ax refuses these objective names: `test`, `factor`, `range`, `product`, `prod`, `sum`, `type`,
  `yield`.
- Constraints are one text form for every backend (`a + b <= 1`, `a == 2 * b`), checked live on
  the page and again when the run is submitted. Ax keeps an equality by solving it for one
  parameter; BayBE keeps it itself but cannot mix plain ranges with stepped or choice parameters
  in one constraint.

## Plots

Data History's **Optimizer plots** shows plots for the most recent optimization since the deck
started; for an older run the optimizer object is gone, and the panel says so.

| | Plots |
|---|---|
| **Ax** | feature importance, contour (first objective) and slice, plus a Pareto frontier with two or more objectives; needs at least 2 completed trials |
| **BayBE** | parallel coordinates, plus objective trade-offs with two or more objectives; needs one result |
| **NIMO** | a phase-diagram image Data History cannot show yet; skipped above 2,000 candidates |
