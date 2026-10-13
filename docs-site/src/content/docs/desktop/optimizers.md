---
title: Optimizers
description: Add Ax, BayBE or NIMO to a deck so its Optimize tab has an engine.
sidebar:
  order: 3
---

A deck's **Optimize** tab needs an optimizer backend installed in that deck's Python. The app
offers three, each at a version it was tested with:

| Backend | Package | Notes |
|---|---|---|
| **Ax** | `ax-platform` | Meta's Bayesian optimization platform, on BoTorch |
| **BayBE** | `baybe` | Merck's Bayesian back end; `[chem]` adds substance parameters (SMILES) |
| **NIMO** | `nimo` | NIMS orchestration; takes discrete candidate lists |

Open the deck's **Settings → Optimizers**, tick what you want, and the app installs it with the
deck's other packages in one go: a version conflict is refused before anything changes, and the
deck file is updated only once the install succeeded. Taking one out leaves it installed, since
decks share one Python environment. Every install uses the CPU build of PyTorch, so adding an
optimizer never swaps PyTorch for another build.

A platform installed from the Hub asks the same question on its way in, so a new deck is ready for
the Optimize page without a trip to Settings.

An optimizer that is installed but missing from the Optimize tab's dropdown failed to load; the
deck's Log tab says why at startup (`[optimizer] baybe is installed but could not be loaded: …`).
How the three behave differently is in [How the optimizers behave](/reference/optimizers/).
