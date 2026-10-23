---
title: Development setup
description: Run every piece from source, build what the edge serves, and run the tests.
sidebar:
  order: 2
---

Requirements: Python 3.10+, Node.js 22+, and [uv](https://docs.astral.sh/uv/).

## Edge server and the demo deck

```bash
uv run --project edge_server python example/demo.py      # http://localhost:8080
```

or with a plain virtual environment:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ./edge_server
python example/demo.py
```

The demo serves the built interface from `frontend/out`, so build it once first (next section).
The server runs without auto-reload: restart it after a Python change. Static files are read from
disk per request, so a rebuilt interface is picked up without a restart.

`ivoryos-edge --deck example/deck.json` runs the same deck from a deck file.

## The deck interface

```bash
npm install                              # once, from the repository root (npm workspaces)
npm --prefix frontend run dev            # hot reload on :3000, talking to the edge on :8080
npm --prefix frontend run build          # the static export the edge serves (frontend/out)
npm run build:edge                       # the edge's sdist and wheel, with that interface inside
```

Type-check before building: `npx tsc --noEmit -p .` in `frontend/`, `cloud_frontend/` or
`packages/shared-ui/`, whichever you touched. Tailwind only sees `packages/shared-ui` because each
app's `globals.css` names it with `@source`; a class used only in shared-ui that renders in one
app and not the other means that line is missing.

## Cloud

```bash
npm --prefix cloud_frontend run dev:all   # web app + daemon together, LAN mode, nothing to configure
npm --prefix cloud_frontend test          # the DAG, store and agent-graph suites
```

Cloud mode (Supabase + AWS IoT) is inferred from `SUPABASE_URL`; `.env.local.example` documents
every variable. Pair the demo deck with a LAN Cloud using the machine's LAN address, never
`localhost`.

## The desktop app

```bash
cd desktop && npm install && npm start    # needs frontend/out built first
npm test                                   # plain Node tests
```

`IVORYOS_DESKTOP_HOME=/some/folder npm start` keeps a separate set of decks and settings.

## Tests

```bash
cd edge_server && uv run --extra test pytest ../tests/automated/ -q
```

The suite runs in a temporary data folder of its own, so it never touches a real deck's database
and runs beside a running demo. `tests/manual/` holds checks that need real backends (optimizer
smoke test with all three installed).

## Conventions worth knowing

- Timestamps from the edge are naive UTC; parse them with `serverTime.ts`, never `new Date(str)`.
- No native dialogs (`alert`, `confirm`, `prompt`): they do nothing in the desktop app's web view.
  Use `dialogs.tsx` in shared-ui.
- No `<datalist>`; use `SuggestInput`.
- Colour: Steel is the accent; hues are for meanings only (purple once-per-batch, green
  run/success, amber warnings, red errors, emerald links, and the built-in step kinds).
- Every page frames itself as a row of `<Sidebar />` and the page; the nav placement switches it
  to a column with one CSS rule.
