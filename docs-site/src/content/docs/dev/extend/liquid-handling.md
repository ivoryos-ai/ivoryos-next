---
title: Liquid handling and labware
description: "How a liquid handler fits IvoryOS: PyLabRobot through plr-ivoryos, wells as text, and one call per batch."
sidebar:
  order: 5
---

A liquid handler is driven through the separate `plr-ivoryos` package, which wraps
[PyLabRobot](https://pylabrobot.org) (its labware, worktables and robot backends) as an IvoryOS
instrument. The deck itself has no PyLabRobot code: steps keep PyLabRobot's names and arguments,
and the worktable is a file, so which robot it is stays configuration.

```python
transfer(source="reservoir[A1]", targets="assay_plate[A1:H3]", target_vols=100, tip_rack="tips_300")
```

**Wells are text**: `plate[A1]`, `plate[A1:H1]` (down a column), `plate[A1:A12]` (along a row), a
rectangle column by column, `plate[all]`, several separated by commas, or a bare labware name for
the whole thing. The Run tabs give such a field a picker that chooses the plate and the wells, and
every labware on the worktable is also a tray to the safety guard, so a well that is not on the
plate is refused with nothing configured.

**One call per batch**: mark the transfer *once per batch* in the Designer and set the batch size
to the head's channel count; each call then carries one well and one volume per row. Per sample,
the same workflow is one single-channel call per well. The adapter plans channels itself.

A driver of your own can speak the same vocabulary with the markers in `ivoryos_edge.labware`
(`Labware`, `Wells`, `PerWell`, `Site`) on `Annotated` parameters, and report its worktable with
`__ivoryos_labware__()`. The **Labware view** plugin draws any instrument that reports a deck,
with live editing of the layout.

The worked example is `example/liquid_handler/demo.py` (simulated, no robot needed). The full
design, what each robot supports and what is not done yet are in the repository's `AGENTS.md`,
section 17b.
