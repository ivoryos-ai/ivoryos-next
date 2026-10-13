---
title: Automation Hub
description: Install drivers, whole platforms, plugins and workflow templates from inside the app.
sidebar:
  order: 2
---

The [Automation Hub](https://ivoryos.ai) is the public catalog of instrument drivers, platforms,
plugins and workflow templates. The app reads it directly and installs from it; nothing is
installed without asking, and a deck file is only changed once every package installed, so a
failed install leaves the deck as it was.

Open it from the sidebar's **Automation Hub** entry, or from a deck's **Add from Hub**. Either way,
what you add goes onto the deck it was opened from; with no deck yet, the first thing you add asks
for a deck name and starts one.

| Kind | What adding it does |
|---|---|
| **Instrument** | installs the driver package and adds one instrument with the settings you fill in (port, address, …). A driver's Hub entry decides which settings are asked for. |
| **Platform** | a whole deck's worth: its drivers, each with its own name and settings, its plugins and its workflows. Onto this deck, or into a new deck of its own on the next free port. Its install also offers the optimizers at a tested version. |
| **Plugin** | installs the package and lists it in the deck's plugins. Only plugins written for this IvoryOS; a plugin for the original IvoryOS cannot run here and says so. |
| **Workflow template** | saves it into the deck's Library, never replacing one (a name in use gets a number). A template that calls instruments this deck does not have is allowed after a warning, and the Library marks its steps until they are pointed at this deck's instruments. |

**Public and private.** The switch at the top lists public entries, or the private hub: what only
you, or an organization you belong to, can see. It needs you signed in. Private GitHub or GitLab
repositories sit on the private side too: connect them by signing in on GitHub or GitLab, or with
a token.

**Add installed driver** (under a deck's Instruments) writes an entry for any class the app's
Python can already import, for a driver that is not on the Hub.

If the Hub is unreachable the panel says why: no internet connection, something in the way (a
firewall or proxy), or the Hub down for the moment, with **Try again**.

Drivers are programs with access to your instruments, so only install from sources you trust.
Listing your own driver is described in [Publish on the Hub](/dev/extend/publish-on-the-hub/).
