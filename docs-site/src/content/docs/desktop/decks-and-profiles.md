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

## A deck's instruments, plugins and packages

A deck profile's **Instruments** tab lists what is on the deck. Each instrument and each plugin has
an **on** switch, which keeps it in the deck file without loading it (an unplugged device, a plugin
you do not need today), and **Remove**.

**Nothing restarts a running deck for you.** Switching something on or off, editing or removing an
instrument, adding from the Hub, saving a setting or the script: each is saved at once, and the
deck goes on running what it started with, so a run under way is not interrupted and the deck
stays on Cloud. Whenever what is saved differs from what the deck is running, its header says
**Not applied yet: restart to apply** (hover it for what changed), the rows that differ say so
(*still loaded until restart*, *loads at restart*), and **Restart** is yours to press when nothing
is running. Undo the change and the notice goes away.

Installing never stops a running deck either. An install that only adds packages goes in while
the deck runs and waits for your restart. One that would replace a package already installed
(every package update, some optimizer changes) asks you to stop the deck first, because a running
Python holds those files open. And nothing is installed while a run is under way.

Under them, **Driver packages** lists the Python packages the deck asks for, each with the version
installed and what on the deck uses it. All decks share one Python environment, so **nothing is
ever uninstalled**; the list only says what this deck needs:

- Removing an instrument or plugin also takes off the list the packages only it needed (worked out
  from what the installed packages depend on). They stay installed.
- A package nothing on the deck uses (left from before this existed, or added by hand) says so.
  Remove it, or **Remove unused** for all of them.
- **Check for updates** looks for the newest version of each that still installs with the rest of
  the deck's packages. **Update** installs it and pins the deck to it (stop the deck first: it is
  not stopped for you); if it cannot be installed, the deck is left as it was. Optimizers are chosen in the deck's Settings instead, from versions
  tested together, and a private repository moves to a newer commit by importing it again.

## Start, Open, Stop, Restart

**Start** checks the Python environment (the first time it downloads Python and installs the edge),
checks the port is free, starts the process and waits until it answers `/api/status`. The deck
then opens in a tab on its own, unless you have moved on to something else meanwhile; a deck whose
instruments did not all load opens on its Instruments tab instead, with the failures in red.

**Open** shows the page in a tab; the arrow beside it opens the same page in your normal browser.
Closing a tab does not stop the deck. Other computers on your network can open it too, at
`http://<this computer's address>:<port>`: a profile's **Reachable from other computers** setting
is on unless you turn it off. Anyone who can reach the port can drive the instruments, so turn it
off for a deck only this computer should open.

**Stop** asks the process to shut down and forces it after a few seconds. **Restart** is always a
new process (Python cannot reliably let go of a serial port otherwise): it re-reads the deck file,
re-imports the drivers and reconnects every instrument. With a run under way the app asks first,
naming the run: restarting ends it where it is, without its cleanup. Restart on the deck's
Instruments page does the same through the deck itself, and is refused while a run is going unless
you confirm.

## A script's instruments

Every object a script makes at the top of the file is an instrument, except what clearly is not:
a pandas table, a numpy array, a plot, a web app, Python's own objects (a `Path`, a lock, a
logger), and objects with nothing to call. A script profile's **Overview** lists what the running
script put on the deck and, folded under it, what it left out, each with an **on** switch. A switch
is saved with the profile and applies when you restart the script. Switched off, an object is only
kept off the deck: the script still makes it, so a port it opened stays open. The choice is the
app's: the same script run from a terminal or PyCharm uses `exclude_names` and `include_names` in
its `run()` call instead, and an object those name is shown as "set in the script", with no switch.

## Script profile settings

A script profile needs its Python file and nothing else. The rest is under **Advanced** in its
**Configuration** tab, and can stay empty:

- **Python interpreter.** Empty, the script runs in the app's own Python, which has IvoryOS and
  every driver installed from the Hub. A script from a project of your own usually needs that
  project's packages: choose the project's interpreter (its `.venv/bin/python`, or
  `.venv\Scripts\python.exe` on Windows). The line under the field says whether IvoryOS is
  installed there, and offers to install it when it is not.
- **Working folder.** Where the script runs, its own folder by default. Imports are found in the
  script's folder, the working folder, and the project above the script (the folders holding
  `pyproject.toml`, `setup.py`, `requirements.txt`, `.git` or `.idea`, and their `src/`), as
  PyCharm does.
- **Environment variables.** For changing something, usually a port, without editing the script:

```python
import os
pump_1 = SyringePump(port=os.environ.get("PUMP_PORT", "COM3"))   # COM3 unless set
```

Add `PUMP_PORT = COM4` and restart. The same script can have two profiles, *Bench A* with COM3
and *Bench B* with COM4. A `PYTHONPATH` variable adds a folder to the imports. The app also sets
`IVORYOS_PORT`, `IVORYOS_HOST` and `IVORYOS_DATA_DIR` for the script, which
`ivoryos_edge.run(__name__)` reads; that is how a script lands on its profile's port without
being changed.

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

The app's Settings, under **Python**, shows the interpreter the app's decks run in, with **Copy
path**. Point your editor at it and it has the same packages (IvoryOS and every driver installed
from the Hub): in PyCharm, Settings → Python Interpreter → Add → Existing; in VS Code, "Python:
Select Interpreter" → Enter path. The other way round, a script profile can run in your project's
own interpreter (above).
