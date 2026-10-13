---
title: Environment variables
description: Every setting the edge server reads from its environment, and the desktop app's own.
sidebar:
  order: 2
---

## The edge server

| Variable | Default | Meaning |
|---|---|---|
| `IVORYOS_PORT` | `8080` | port, when a script does not pass one to `run()` |
| `IVORYOS_HOST` | `0.0.0.0` | interface to listen on |
| `IVORYOS_DATA_DIR` | legacy locations | the data folder: database, workflows, safety config, Cloud pairing, schema dump. `IVORYOS_EDGE_HOME` is the same setting under its older name. |
| `IVORYOS_ALLOWED_HOSTS` | this machine's names | extra host names the page may be reached by, comma separated; `*` disables the check |
| `IVORYOS_FRONTEND_DIR` | `frontend/out` | the built interface to serve |
| `IVORYOS_SUPERVISED` | unset | set by the desktop app: a restart exits with code 75 instead of re-executing |
| `IVORYOS_CLOUD_URL` | the hosted Cloud | the Cloud to pair with |
| `CLOUD_TOKEN`, `CLOUD_DEVICE_ID`, `CLOUD_PAUSED`, `CLOUD_SYNC_WORKFLOWS` | written to `.env` by pairing | the pairing; `CLOUD_SYNC_WORKFLOWS=always\|manual` is the workflow sync mode |
| `IVORYOS_STATUS_INTERVAL_S` | `300` | how often a quiet deck re-sends its status to Cloud |
| `IVORYOS_CLOUD_COMING_SOON` | unset | hide Cloud links in the interface (release mode) |
| `IVORYOS_DEMO_TEST_DRIVERS` | unset | load the synthetic test drivers into `example/demo.py` |
| `ANTHROPIC_API_KEY` | unset | read by the Claude provider of the assistant |

## The desktop app

| Variable | Meaning |
|---|---|
| `IVORYOS_DESKTOP_HOME` | a separate home folder for decks and settings (development) |
| `IVORYOS_ENABLE_CLOUD` | `1` turns Cloud on in a packaged build |
| `IVORYOS_CLOUD_COMING_SOON` | `1` shows the coming-soon state in development |
| `IVORYOS_HUB_URL` | a different Automation Hub address (development) |
| `IVORYOS_GITHUB_CLIENT_ID`, `IVORYOS_GITLAB_CLIENT_ID` | OAuth app ids for signing in to private repositories |

## Cloud

Documented in `cloud_frontend/.env.local.example`. The mode is inferred: `SUPABASE_URL` set means
hosted (Supabase + AWS IoT), unset means LAN (SQLite + built-in broker); `IVORYOS_CLOUD_MODE`
overrides it.
