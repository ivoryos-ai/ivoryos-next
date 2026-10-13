---
title: Concepts
description: The words IvoryOS uses, each explained once.
sidebar:
  order: 4
---

**Deck.** One set of instruments, with its own workflows, run history and settings. In the desktop
app each deck is a profile you start and stop; underneath, it is one Python process (the *edge
server*) serving one web page.

**Instrument.** One Python object on the deck, usually one device: `pump_1`, `reactor`, `hplc`.
Its public methods are the steps you can use. Which objects count as instruments, and which methods
show, is in [What IvoryOS reads from a class](/dev/instruments/what-ivoryos-reads/).

**Step.** One call of one method, with its arguments: *Pump 1 · Dispense · volume_ml=0.2*. The
Designer also has built-in steps that are not instrument calls: Wait, User input, If / else, While
loop and Comment.

**Workflow.** An ordered list of steps in three phases. **Prep** runs once at the start,
**Main** is the experiment itself, **Cleanup** runs once at the end. When a workflow is iterated or
optimized, only Main repeats.

**`#variable`.** A value left open in a step, written with a leading `#`: `setpoint_c=#temperature_c`.
Open values are what the Once tab asks for, what each spreadsheet column on Iterate holds, and what
the optimizer searches over. A step can also **save** what it returns under a name, and a later step
can read it back as `#name`.

**Run.** One execution of a workflow, with the values it was given. A run has a name, a status
(queued, running, waiting for input, completed, failed, cancelled), and one record per step.

**Queue.** Runs execute one at a time, in order. Starting a run while another is going adds it to
the queue; the queue drawer lets you rename, reorder, edit or remove what waits.

**Library.** The deck's saved workflows. Saving is append-only: every save is a new version, and a
workflow can be reused inside another as a **copy** (its steps become yours) or a **link** (one step
that follows the saved version).

**Safety guard.** Limits, trays, states and rules you configure on the Safety page, checked before a
run starts and again as each step is sent, outside the drivers. A refused step pauses the run like
a failed one.

**Deck version.** The shape of the deck, instruments and their methods, recorded whenever it
changes. Every run and every saved workflow is stamped with the version it ran on, so an old result
can be read against the drivers of its day.

**Cloud.** The hosted or self-hosted web app that watches several decks and sends them work. A deck
pairs with it by showing a code you approve; it keeps working on its own if the connection drops.
