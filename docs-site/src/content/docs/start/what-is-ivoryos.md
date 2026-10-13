---
title: What is IvoryOS
description: IvoryOS turns the Python code that controls your instruments into an app for designing, running and optimizing experiments.
sidebar:
  order: 1
---

IvoryOS turns the Python code that controls your instruments into an app. It reads each
instrument's methods, their arguments and their types, and builds the interface from them. There is
no interface code to write and no configuration file to fill in: a scientist designs and runs
experiments by pointing and clicking, and anyone who can write a Python class can bring a new
instrument.

It sits between point-and-click lab software and writing your own scripts: as easy to use as the
first, as open as the second. It runs on the computer next to your instruments and keeps working
without an internet connection.

## The pieces

| | What it is | Where it runs |
|---|---|---|
| **Deck** | One set of instruments with its own workflows and data. The app you spend your day in: Designer, Run, Data History, Instruments, Safety. | On the computer beside the hardware (the *edge server*, a Python process). |
| **Desktop app** | Starts and watches your decks, installs drivers, and shows every deck's page in one window. | Your computer (Windows, macOS, Linux). |
| **Automation Hub** | A public catalog of instrument drivers, whole platforms, plugins and workflow templates, installable from inside the app. | [ivoryos.ai](https://ivoryos.ai) |
| **Cloud** *(early access)* | Watches and dispatches workflows to the decks in every lab from one place. | A web app, hosted or self-hosted. |

If you only ever run one bench, the deck and the desktop app are all you need. This guide is
mostly about them.

## How a run happens

1. You bring instruments: a Python class per device, written by you, a vendor, or found on the
   Hub. IvoryOS **introspects** each class at startup, so every public method becomes a step with a
   form built from its type hints.
2. In the **Designer** you drag those steps into a workflow, fill in values, or leave a value
   open as a `#variable` to decide at run time.
3. You run it **Once** with the values typed in, **Iterate** it over a spreadsheet of samples, or
   **Optimize** it with Bayesian optimization over the open values.
4. The deck runs the steps one at a time, pauses for you when a step fails or asks a question, and
   records every step and value in **Data History**.

## Who this documentation is for

- **The user guide** is for the people who run experiments. It walks through each page of the app
  with screenshots and step-by-step instructions. Start with [Try the example](/start/try-the-example/).
- **The developer guide** is for the people who bring instruments or extend IvoryOS: what it reads
  from a Python class and what it hides, how to decide what to expose, how to add safeguards,
  plugins and agents, and how to work on IvoryOS itself. Start with
  [Write a driver](/dev/instruments/write-a-driver/).
