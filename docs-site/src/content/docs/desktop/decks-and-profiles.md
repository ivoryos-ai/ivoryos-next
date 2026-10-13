---
title: Decks and profiles
description: "How the desktop app runs decks: profiles, Start, ports, logs, restarts, and where everything is on disk."
sidebar:
  order: 1
---

The desktop app is a manager and a window. Underneath, each deck is the same Python edge server
you could start from a terminal; the app starts it, watches it, captures its output, and shows its
page in a tab. The sidebar lists your decks: click a running one to open its page, a stopped one to
reach its launcher page, and the gear on any row for its instruments, log and settings. Drag rows
to reorder them; <kbd>Ctrl</kbd>+<kbd>B</kbd> hides the sidebar from anywhere.

## Two kinds of profile

| | **Deck profile** | **Python script profile** |
|---|---|---|
| What starts | `python -m ivoryos_edge --deck deck.json …` | `python your_script.py …` |
| Instruments come from | a deck file (data), edited in the app's **Instruments** tab | your script's own code |
| Change a COM port | Instruments → Edit → change `port` | an environment variable (below), or edit the script in the **Code** tab |
| One broken instrument | the others still load; the broken one is listed with its error | the script stops, unless it handles the error itself |
| Add a driver from the Hub | yes | no; install it and edit the script |
| Runs and workflows | its own data folder | the script's own data folder, if one is set |

Several profiles run at the same time, each on its own port.

## Start, Open, Stop, Restart

**Start** checks the Python environment (the first time it downloads Python and installs the edge),
checks the port is free, starts the process and waits until it answers `/api/status`. The deck
then opens in a tab on its own, unless you have moved on to something else meanwhile; a deck whose
instruments did not all load opens on its Instruments tab instead, with the failures in red.

**Open** shows the page in a tab; the arrow beside it opens the same page in your normal browser.
Closing a tab does not stop the deck. Other computers reach a deck only when its **Reachable from
other computers** setting is on, because anyone who can reach the port can drive the instruments.

**Stop** asks the process to shut down and forces it after a few seconds. **Restart** is always a
new process (Python cannot reliably let go of a serial port otherwise): it re-reads the deck file,
re-imports the drivers and reconnects every instrument. Restart on the deck's Instruments page
does the same through the deck itself, and is refused while a run is going unless you confirm.

## Script profiles: arguments and environment variables

Leave both empty unless your script reads them. They exist for one case: changing something
(usually a port) without editing the script.

```python
import os
pump_1 = SyringePump(port=os.environ.get("PUMP_PORT", "COM3"))   # COM3 unless set
```

Set `PUMP_PORT = COM4` under the profile's **Advanced** settings and restart. The same script can
have two profiles, *Bench A* with COM3 and *Bench B* with COM4. The app also sets `IVORYOS_PORT`,
`IVORYOS_HOST` and `IVORYOS_DATA_DIR` for the script, which `ivoryos_edge.run(__name__)` reads;
that is how a script lands on its profile's port without being changed.

A script written for IvoryOS Classic (`import ivoryos`) is offered a conversion when started; the
changed lines are kept above as comments so going back is uncommenting.

## The Log tab

Everything the process prints: driver output, the deck's own messages (which instrument loaded,
which optimizer failed to import and why), Python tracebacks. **Log file** opens the file that
holds every session's output. When a deck would not start or stopped unexpectedly, **Send to
IvoryOS** on its banner packages this log for the team; see
[When something goes wrong](/desktop/when-something-goes-wrong/).

## Where things are on disk

| Path (macOS: `~/Library/Application Support/IvoryOS/`; Windows: `%APPDATA%\IvoryOS`; Linux: `~/.config/IvoryOS`) | What |
|---|---|
| `profiles.json` | your profiles and the app's settings |
| `profiles/<id>/deck.json` | a deck profile's instruments (Settings → Show deck file) |
| `profiles/<id>/data/` | that deck's runs, workflows, safety config and Cloud pairing |
| `runtime/venv/` | the Python environment all decks share, managed by uv |
| `logs/<id>.log` | each profile's output |

Deleting `runtime/` is safe; it is rebuilt on the next start. Deleting `profiles/<id>/data/`
deletes that deck's run history.

## Python for your own editor

Each profile's Settings shows the interpreter path to paste into PyCharm or VS Code, whether
IvoryOS is importable there, and the Python version. A script profile can create a `.venv` in its
project folder with this app's edge installed, so your editor and the app run the same thing.
