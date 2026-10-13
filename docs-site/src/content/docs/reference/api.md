---
title: The edge API
description: The HTTP and websocket endpoints a deck serves, for scripts, plugins and other tools.
sidebar:
  order: 3
---

Every page of the deck's interface is built on this API, and so can anything else on the same
computer (or on the network, once the deck is reachable). The interactive reference is served by
the deck itself at `/docs` (OpenAPI). The ones worth knowing:

| Endpoint | What |
|---|---|
| `GET /api/status` | the deck: instruments and their schema, safety view, deck version, what is running |
| `POST /api/execute` | call one method now: `{module, method, args}`. Goes through casting, the busy check and the safety guard. |
| `POST /api/queue/runs` | queue a run: `{name, parameters, prep, sequence, cleanup}`; a step is `{instrument, method, params}` |
| `GET /api/queue/runs?recent=N`, `GET /api/queue/history`, `GET /api/queue/runs/{id}` | live runs, paged history, one run with its steps |
| `PUT /api/queue/runs/{id}` | replace a queued run before it starts |
| `POST /api/queue/runs/{id}/input` | answer a User input step: `{value}` |
| `POST /api/queue/runs/{id}/resolve` | decide for a failed step: `{action: retry\|skip\|cleanup\|stop}` |
| `POST /api/queue/runs/{id}/graceful-stop` | `{cleanup, continue_queue}` |
| `POST /api/queue/resume` | release a held queue |
| `GET /api/workflows`, `POST /api/workflows/{name}`, `DELETE …` | the Library; `/api/workflows/{name}/versions`, `/dependents`, `/tags` |
| `POST /api/workflows/expand` | the step list a body will run, links expanded (what the preview shows) |
| `GET /api/safety`, `PUT /api/safety`, `POST /api/safety/check` | the guard's config |
| `GET /api/deck`, `/api/deck/versions/{v}`, `/api/deck/diff?frm=&to=` | deck versions |
| `GET /api/optimizers` | the installed backends and their schemas |
| `GET /api/plugins` | registered plugins and any that failed |
| `/api/agent/*` | the assistant's tools: describe, validate, propose |
| `POST /api/system/restart` | restart the process (409 while a run is active unless `force=true`) |
| `WS /api/ws/queue` | pushed after every step: every live run with its steps, the queue status, attention items and notices |

Commands (anything but GET) are accepted only from the deck's own origin, pages on the same
computer, the desktop app, or a client that sends no `Origin` header (curl, Python, the MCP
server). A request by a host name the deck does not recognise is refused; see
`IVORYOS_ALLOWED_HOSTS`.
