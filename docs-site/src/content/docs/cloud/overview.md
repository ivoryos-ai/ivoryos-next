---
title: What Cloud is
description: One place to watch and run the decks in every lab. Early access.
sidebar:
  order: 1
  badge:
    text: Early access
    variant: tip
---

IvoryOS Cloud watches several decks at once and sends them work: a dashboard of every device, its
instruments and saved workflows, an **Orchestrator** canvas where a workflow for one device is
one node and edges say what waits for what, schedules, and the results of every dispatched run.
Each deck keeps working on its own if the connection drops; Cloud is a replica that can request
work, never the source of truth for a bench.

It comes in two forms with one code base:

- **Hosted** (`cloud.ivoryos.ai`): sign in with your IvoryOS account, pair your decks, and your
  workspace (yours, or your organization's) sees them.
- **Self-hosted on a LAN**: one Docker Compose, a SQLite file and a built-in MQTT broker, with no
  accounts needed and no internet. For a lab that keeps everything inside.

In the desktop app, Cloud opens as a tab of the one window. In the current releases it is marked
**coming soon** with an early-access sign-up; a release build can turn it on with
`IVORYOS_ENABLE_CLOUD=1`.

The rest of this chapter covers [connecting a deck](/cloud/connect-a-deck/) and
[the Orchestrator](/cloud/orchestrator/). How a deck and Cloud talk underneath (MQTT topics,
presence, dispatch, failure handling) is a design document in the repository,
`docs/edge_cloud_sync.md`.
