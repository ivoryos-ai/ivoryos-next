---
title: Devices, Orchestrator, results
description: "What the Cloud pages do: the device list, the multi-device canvas, run modes, schedules and results."
sidebar:
  order: 3
---

## Devices

One card per paired deck: online or busy, its deck version, its workflows and how many of them
are broken, the Cloud task it is running with its progress, what waits for it, its next schedule,
and its last result. Devices can be grouped into **platforms** (*Flow rig* = pump + collector) for
organization. A device's name can be changed from its card; its id cannot.

## Library

Every workflow of every device, as the devices published them, plus workflows authored on Cloud's
own editor. A Cloud-authored workflow is sent to its device at save time (or kept on Cloud only,
in which case it cannot be run until it is sent, since the device would run its own version).

## Orchestrator

A canvas where each node is a step on one device: a method call, or a saved workflow of that
device. Edges say what waits for what; a node with no incoming edge starts at once, a join waits
for every node feeding it. The same Logic steps as the Designer exist as **Cloud logic** nodes
(Wait, User input, If) that run on Cloud between devices.

Each node has a **run mode**: **single** (the step once, with its values), **spreadsheet** (the
device's workflow once per row, with the same per-sample/per-batch walk as the deck's Iterate
tab), or **optimization** (the device runs the budget loop with its own optimizer). A node can also
repeat *N* times with an interval. Every node is one task, dispatched on its own, one task per
device at a time; a device that is busy at the bench is not sent anything until it is free.

**Run** validates the graph (cycles, unreachable nodes, a missing device, an offline device) and
refuses it with the reasons rather than letting it hang. While it runs, each node shows its
progress (*sample 3/6 · uv_vis.measure_absorbance*); a failed task cancels what depended on it
and pauses nothing else.

The same **Assistant** as the Designer's can draft a graph from a description, for the devices
you choose; "Put on canvas" is the only way a draft reaches the canvas.

## Schedules

A planned run that fires on a recurring trigger, from one minute upward. A new schedule first
fires one interval from now, never immediately, and a paused one re-arms from the moment it is
resumed.

## Results

Every dispatched run's record, as the device recorded it, read with the same table Data History
uses, with CSV export. Very large records are trimmed on the way (the full record stays on the
device).
