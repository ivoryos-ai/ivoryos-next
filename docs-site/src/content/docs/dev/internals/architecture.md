---
title: Architecture
description: The repository's pieces, how a deck is built at runtime, and where the shared logic lives.
sidebar:
  order: 1
---

```
ivoryos-nextgen/
├── edge_server/        the edge server: Python package ivoryos_edge (FastAPI, SQLite)
├── frontend/           the deck's web interface (Next.js, static export served by the edge)
├── packages/shared-ui/ React code shared by the deck UI and Cloud
├── cloud_frontend/     IvoryOS Cloud: Next.js app + a daemon that talks MQTT to decks
├── desktop/            the desktop app (Electron): decks, Python, Hub installs
├── example/            the demo deck and example drivers
├── schema_worker/      a sandboxed schema extractor for the Hub (prototype)
├── docs/               design notes and guides
├── docs-site/          this documentation (Astro Starlight)
└── tests/              automated/ (pytest) and manual/
```

## The edge server

One process per deck. At startup it builds the instruments (from a script's module or a deck
file), **introspects** each one into a schema (`introspection.py`), records the deck version
(`deck.py`), loads the safety guard (`safety.py`) and serves:

- the REST API and websockets (`server.py`): status and schema, execute one method, the run queue,
  workflows, safety, plugins, agent tools, Cloud pairing;
- the built web interface from `frontend/out` as static files;
- plugins' pages and routes.

Runs are executed one at a time by `WorkflowQueueManager` (`queue.py`): a plain run walks prep,
main and cleanup; a spreadsheet run arrives already expanded into per-sample and per-batch calls;
an optimization run loops suggest → build trial steps → execute → observe. `#variable`
substitution, Flow Control steps, failed-step decisions, graceful stop and the Cloud progress
reports all live there. Runs, steps and results are in SQLite (`models.py`); saved workflows are
JSON files with append-only versions (`workflows.py`).

The web interface talks to it over `/api/*` and `/api/ws/queue`, from the same origin in
production (the edge serves the build) or from `next dev` on another port in development. An
origin guard refuses commands from any other origin and any host name that is not the machine's
own.

## The deck interface and the shared package

`frontend/` is a Next.js app exported statically. Everything that must mean the same thing on the
bench and on Cloud lives in `packages/shared-ui/` and is imported by both apps:

| Module | What it owns |
|---|---|
| `WorkflowEditor`, `Toolbox`, `flowControl.ts` | the drag-and-drop editor and the built-in steps |
| `workflowBody.ts` | saved-JSON ↔ editor blocks, `#variable` scanning, copy/link reuse, which names are inputs |
| `runConfig.ts` | the one `#variable` resolution walker |
| `spreadsheetRun.ts`, `SpreadsheetTable` | the per-sample / per-batch walk and the table that draws its groups from it |
| `optimizerConfig.ts` | search space and objectives → run parameters |
| `runRecord.ts`, `RunDataTable` | a run record as its flattened data table (Data History and Cloud's results) |
| `generatePythonCode` | the Python view |
| `safety.ts`, `returnValues.ts`, `runNaming.ts`, `serverTime.ts` | guard hints, reading named outputs, run names, naive-UTC timestamps |

The rule that follows: **do not re-implement a shared walk in one app.** Validation and codegen
drifted twice before the package existed. Workflow expansion (linked workflows into steps) exists
only in Python (`expand_workflow_blocks`), and the preview panel asks the edge for it rather than
computing it, so the preview cannot disagree with what the hardware will do.

## Cloud

`cloud_frontend/` is a Next.js app plus `daemon.js`, a long-lived Node process that holds the
MQTT connection: it mirrors every deck's retained status, schema and workflows into Cloud's
store, dispatches tasks (one per device at a time), and advances runs as task statuses come back.
The store is SQLite on a LAN or Supabase when hosted, behind one interface; the broker is a
built-in one on a LAN or AWS IoT Core when hosted. The DAG rules (`src/lib/dag.js`) are plain
CommonJS so the daemon and the app share them. `docs/edge_cloud_sync.md` walks through the
topics, pairing, presence and dispatch with diagrams.

## The desktop app

`desktop/` is an Electron shell: profiles are saved command lines, `supervisor.js` keeps a deck's
process alive and restarts it on exit code 75, `runtime.js` manages a uv-created Python
environment in the user's data folder, `hubCatalog.js` reads the Automation Hub's database and
converts rows into deck entries. The launcher page itself is part of the `frontend/` build, served
over the app's own scheme. Decks' pages are web views in the same window.

## Decisions that are easy to undo by accident

`AGENTS.md` at the repository root is the long-form record of every design decision and the bug
that motivated it. Read the section for the area you are changing before changing it; most of the
rules there exist because the obvious alternative shipped and broke.
