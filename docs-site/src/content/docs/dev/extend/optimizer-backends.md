---
title: Optimizer backends
description: How Ax, BayBE and NIMO are wired, and what adding another one means.
sidebar:
  order: 6
---

The Optimize tab talks to an optimizer through one small interface,
`OptimizerBase` in `edge_server/ivoryos_edge/optimizer/`:

| Method | Contract |
|---|---|
| `get_schema()` (class) | what the Optimize page shows for this backend: its strategy steps and their settings |
| `__init__(parameter_space, objective_config, ...)` | build it from the run's search space and objectives |
| `suggest(n)` | a **list** of `n` per-trial parameter dicts |
| `observe(results)` | a **list**, one entry per suggested trial in suggestion order, each holding the parameters it ran with and, unless it failed, its objectives |
| `append_existing_data(df)` | seed it with prior results before the first `suggest` |
| `check_constraints(text)` | validate the constraint form for this backend |
| `get_plots(plot_type)` | `{name: html}` fragments (Plotly) for Data History |

Backends are registered in `OPTIMIZER_REGISTRY`. One whose package is installed but whose adapter
will not import is left out of the list, and the reason is printed at startup
(`[optimizer] <name> is installed but could not be loaded: …`).

Three rules of the contract came out of shipped faults, so keep them:

- `observe` receives **every** suggested trial, in order. Ax and NIMO pair results with trials by
  position; dropping a failed trial shifted every later result onto the wrong one. A failed trial
  arrives without objectives, and an objective that is absent, `None` or NaN counts as missing.
- `suggest` may return fewer than `n` (a model that cannot generate yet); the loop handles it. Ax
  cuts a batch at every strategy-node change, and the adapter asks again for the rest.
- The optimizer failing to suggest or observe does not end the run: the queue pauses for a person.

The three adapters are shared with the original IvoryOS (`ivoryos/optimizer/` in that repository)
and kept identical apart from the import line; port a fix to both. Constraints, stepped ranges,
substances, stopping rules and suggest-only campaigns are described in `docs/optimizers.md`, and
what the user sees in [How the optimizers behave](/reference/optimizers/).
