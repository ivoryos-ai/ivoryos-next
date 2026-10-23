---
title: When something goes wrong
description: What the app shows, what it usually means, and how to send the details to the team.
sidebar:
  order: 4
---

| You see | Likely cause | What to do |
|---|---|---|
| "Port 8090 is in use by another program" | another deck or program on that port | stop it, or change the profile's port in Settings |
| "Port … is already used by …" | two profiles share a port | give one of them another port |
| An instrument is red: `No module named …` | its driver is not installed | Add from Hub, or install the package; then Restart |
| An instrument is red: `could not open port` | unplugged, powered off, wrong port | fix the cable or the `port`, then Restart |
| "Stopped unexpectedly" | the process crashed | read the Log tab; the last lines say why |
| "uv was not found" | a development build without uv | install uv, then Start again |
| The page in a tab is blank after a restart | it reloaded before the deck answered | click the tab and press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>R</kbd> |
| An optimizer is missing from the Optimize tab | it failed to import | the Log tab has a `[optimizer] …` line with the reason |
| Every page answers 403 | the deck was opened by a host name it does not know | open it by IP or computer name, or list the name in `IVORYOS_ALLOWED_HOSTS` |
| No notifications on macOS | the system refused them (unsigned build) | Settings → Notifications shows the refusal, with a button to the system settings and a test |

## Send to IvoryOS

Where something failed that you may not be able to fix (a deck that would not start or stopped,
an install that failed), the banner offers **Send to IvoryOS**. It gathers this session's log,
pip's output for an install, the deck as names and classes only (never arguments, which hold
addresses and serial numbers), the Python environment and installed packages, and redacts paths,
user names, keys, tokens and emails. You read and can edit the exact text; nothing is sent before
**Send**. The report goes to the IvoryOS team with an id you keep as a reference. If reports cannot
be taken at the moment, the dialog offers **Copy** and a prefilled GitHub issue instead.

For questions and ideas, the [Discord](https://discord.gg/3KdjhUmsYA); for bugs and requests,
[GitHub issues](https://github.com/ivoryos-ai/ivoryos-next/issues).
