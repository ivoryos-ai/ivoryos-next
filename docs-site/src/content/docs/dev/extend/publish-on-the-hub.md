---
title: Publish on the Hub
description: List a driver, a platform, a plugin or a workflow template on the Automation Hub so any lab can install it from the app.
sidebar:
  order: 3
---

The [Automation Hub](https://ivoryos.ai) is where the desktop app installs from. An entry there is
install metadata: what to `pip install`, what to import, and what the constructor needs. The deck
reads the class itself once it is installed, so the entry never has to describe the methods.

## A driver

1. **Package it.** A `pyproject.toml` with the dependencies, published to PyPI or reachable as a
   git repository (the app turns a repository URL into a `git+` requirement).
2. **Contribute it** on the Hub (sign in, *Contribute*). The fields the app reads:

   | Field | Meaning |
   |---|---|
   | `pip_name` | the requirement: `vendor-pumps`, `vendor-pumps==1.4.2`, or a repository URL |
   | `module_path` / `module_name` | `from <module_path> import <module_name>`: the module and the class |
   | `init_args` | the constructor's arguments, each with a name, a type (`str`, `int`, `float`, `bool`, or `object` with its own `import_path`, `class_name` and nested args) and a default. These become the form the app shows when adding the instrument. |
   | `python_command` | an optional setup call run after construction (`connect()`), stored in the deck file as a `calls` entry |
   | `connection`, `os` | serial / USB / network, and which operating systems it runs on |
   | device | the instrument it drives: name, vendor, category |

3. **Test it from the app**: *Add from Hub*, find your entry, add it to a deck. A missing
   constructor argument shows up as `missing 1 required positional argument` on the deck's
   Instruments page; fix the entry's `init_args`.

A private hub (visible to you or your organization only) takes the same entries, for drivers that
are not public.

## A platform

A platform is a whole deck: a list of driver entries, each with a name and its settings, plus
plugins and workflow templates. Installing one creates a deck (or adds to one) with everything
wired, and offers the optimizers.

## A plugin

A pip-installable package with a `Plugin` object (see [Plugins](/dev/extend/plugins/)); the entry
carries `pip_name` and the `import_path` to the object (`my_pkg.plugin:plugin`). Only plugins
written for this IvoryOS are installable; a Flask-blueprint plugin for the original IvoryOS is
listed with the reason instead of an Add button.

## A workflow template

A saved workflow exported from the Designer (**Manage → Export JSON**), listed with the modules it
needs. The app saves it into a deck's Library on install; a template that calls instruments the
deck does not have is allowed after a warning, and the Library marks the steps to point at this
deck's instruments.
