---
title: Stages
description: Give each saved workflow in a design its own run settings, and run them in order as one experiment.
sidebar:
  order: 4
---

A design whose steps are saved workflows is already an orchestration: *weigh the solids*, then
*add the solvents*, then *analyze*. Run from Once, Iterate or Optimize it has **one** configuration,
so the solids each sample gets and the solvents it gets must share one table. **Stages** gives each
linked workflow its own: one is run once, the next over its own table of any length, the third as
an optimization.

## Build a design in stages

1. In the Designer, drag saved workflows in from the toolbox as **links**, with any plain steps you
   want between them (a tare, a *swap the plate* prompt).
2. Open **Run → Stages**. The design is cut into stages: each link is one, each stretch of plain
   steps between links is one, the design's Prep goes with the first and its Cleanup with the last.
   An If or While that wraps a link cannot be cut, and the page says so.
3. Open a stage. It shows the same configurator its mode uses, in place: the Once form, the
   Iterate table or the Optimize settings. Each stage keeps separate settings for each mode, and
   the lit mode is how it will run. There is no Save: what you type is kept as you type it.
4. Each stage's line reads *Not set up yet*, *Not ready: missing value for 'rate' in row 2*, or
   *Iterate · 12 rows*. When every stage is ready, **Run**.

## How it runs

Every stage is checked, safety included, before any is queued. Then each is queued as its own run,
in order, named `<set> · <stage>`. A stage that has not started yet can still be edited from the
queue drawer like any queued run. If a stage ends in error or is stopped, the stages still waiting
are cancelled and marked *not run*: the set is one experiment. Data History shows the set's stages
as a strip above whichever one is selected.

Not yet: nothing passes between stages (a value one stage saved is asked for again by the next),
and an If cannot decide whether a later stage runs.
