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
broken page or link fails the check, and publishes `main` to GitHub Pages at docs.ivoryos.ai (at ivoryos-ai.github.io/ivoryos-next until
the custom domain is set). Write links between pages root-absolute, `/guide/designer/`: the build
prefixes the sub-path when there is one. The two hero buttons on the home page are the exception,
written relative, since Starlight does not run frontmatter links through that step.

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

## Pictures are generated, with their notes

Every picture under `src/assets/annotated/` comes from `scripts/screenshots.mjs`. It drives the
installed Google Chrome against a dedicated example deck, and for each documented state of the app
it draws the notes on the page itself (`scripts/annotate.mjs`: a ring round the real element, a
note beside it, an arrow between them) and photographs the result at 1180×760, light theme, 2×,
with the top-bar navigation the desktop app shows. Because a ring is placed from the element it
names, the notes follow the interface: after a change, regenerate rather than retouch.

```bash
# 1. a fresh deck, in its own data folder (docs-site/.deck-data, ignored by git)
rm -rf docs-site/.deck-data
uv run --project edge_server --with baybe==0.15.0 --with plotly python docs-site/scripts/docs-deck.py

# 2. in docs-site/, every scene (about five minutes; starts several runs on the deck)
npm run screenshots
npm run screenshots -- designer once      # only these scenes
```

Start from a fresh data folder so run numbers match (the Data History pictures open *Run #1*). The
deck's two workflows are the docs' own copies in `scripts/seed/`.

A scene is a state plus its notes:

```js
await shot('library', [
  { at: card.locator('[title="Version history"]'), title: 'Version history',
    text: 'Every save is kept. Open any of them in the Designer.', side: 'below', align: 'start' },
]);
```

`at` is a selector, a Playwright locator, or several (one ring round them all). `side` and `align`
say where the note sits; `dx`/`dy` nudge it; `clip` crops the picture; `keep` leaves a dialog
undimmed. A scene that cannot find what a note points at fails, which is how a renamed button is
noticed. `IVORYOS_DOCS_DEBUG_DIR=<folder>` saves what the page looked like when a scene failed.

A page shows a picture with the `Shot` component, which also writes the notes out as a list for
screen readers and search (`notes.json`, written beside the pictures), and opens the full-size
picture on a click:

```mdx
import Shot from '../../../components/Shot.astro';

<Shot name="library" alt="The Library with two saved workflows" />
```

The launcher's pictures (`launcher-*`) come from `scripts/desktop-shots.mjs`, which drives the real
desktop app in a data folder of its own.

## The tutorial video

A narrated tour of the app is generated too, from `docs-site/video/`: the
narration is data (`voiceover.json`), a synthetic voice speaks it, the real desktop app is driven
through the tour while its pages are recorded, and the film is put together with its subtitles.
`video/README.md` has the commands, and how to change a line, the voice, or what is shown.

The film and its narration are not in the repository (`video/out/` is ignored): they are made on
your computer, and no page of the documentation shows them yet. A page for the film needs somewhere
to serve it from first.

## House style

- **The picture carries the explanation.** A reader should get what a page is for from its
  pictures alone: ring the thing, say what it is in the note. Text under a picture is for what a
  picture cannot show: the reason, the exception, the table of choices.
- **A note is a title of two or three words and one short sentence**, in the words the interface
  uses, sentence case. Two to five notes a picture; crop with `clip` when the rest of the window
  is noise.
- The look is deliberately quiet: flat navy notes, the app's own font, thin teal rings and curved
  arrows, nothing tilted. Change it in `annotate.mjs`, once, never per picture.
- In text, bold what the person clicks (**Load to Designer**). One idea per sentence. No marketing.
- Explain the *why* when a behaviour would otherwise look like a bug (why Stop skips cleanup, why
  a batch step reads the first row only). `AGENTS.md` has the reasons.
- Keep the developer pages exact: if a rule is in the code, name the function so it can be
  checked.
