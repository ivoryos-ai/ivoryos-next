---
title: Writing this documentation
description: How the docs site is built, how screenshots are regenerated, and the house style.
sidebar:
  order: 3
---

The site is [Astro Starlight](https://starlight.astro.build) in `docs-site/`: Markdown and MDX
pages under `src/content/docs/`, built to static HTML with search included, deployable to any
static host.
`.github/workflows/docs.yml` builds it on every pull request that touches `docs-site/`, so a
broken page or link fails the check, and publishes `main` to GitHub Pages at docs.ivoryos.ai.

```bash
cd docs-site
npm install
npm run dev          # http://localhost:4321, live reload
npm run build        # dist/
```

## Where pages go

| Folder | Sidebar group |
|---|---|
| `start/` | Start here |
| `guide/` | User guide: the pages |
| `run/` | User guide: running experiments |
| `desktop/`, `cloud/` | User guide: desktop app, Cloud |
| `dev/instruments/`, `dev/extend/`, `dev/internals/` | Developer guide |
| `reference/` | Reference |

Order within a group is `sidebar.order` in the frontmatter. Use `.mdx` when a page needs
`<Steps>`, `<Tabs>` or `<Aside>`; plain `.md` otherwise (`:::note` / `:::tip` / `:::caution`
asides work in both).

## Screenshots are generated, not pasted

Every picture under `src/assets/screenshots/` comes from `scripts/screenshots.mjs`, which drives
the installed Google Chrome against a dedicated example deck and captures each documented state
of the app at 1440×900, light theme, 2×. After an interface change, regenerate rather than
retouch:

```bash
# 1. a fresh deck, in its own data folder (docs-site/.deck-data, ignored by git)
rm -rf docs-site/.deck-data
uv run --project edge_server --with baybe==0.15.0 --with plotly python docs-site/scripts/docs-deck.py

# 2. in docs-site/, every scene (about five minutes; starts several runs on the deck)
npm run screenshots
npm run screenshots -- designer-workflow once      # only these scenes
```

Start from a fresh data folder so run numbers and history match the text (the Data History pages
select *Run #1*). The scenes are ordered so that the runs they start come out in the order the
prose expects. Add a scene for a new state rather than a one-off capture, so the next person can
regenerate it.

## House style

- Say what the person does and what they see, in the words the interface uses, bold for things
  they click (**Load to Designer**).
- One idea per sentence. Lead with the outcome. No marketing.
- A screenshot shows one thing; crop with `clip` in the scene when the whole window is noise.
- Explain the *why* when a behaviour would otherwise look like a bug (why Stop skips cleanup, why
  a batch step reads the first row only). `AGENTS.md` has the reasons.
- Keep the developer pages exact: if a rule is in the code, name the function so it can be
  checked.
