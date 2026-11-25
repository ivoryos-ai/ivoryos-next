# Video style kit

One style for every IvoryOS video (release videos, tutorials, promos), for both products.

| File | What it is |
|---|---|
| `style.json` | The style. `shared` is what both products have in common (frame, voice, loudness, pacing, subtitles, the kinds of on-screen text and their limits, the cover's inputs). `themes.classic` and `themes.next` are what tells them apart (colour, type, cards, captions, tags, pointer, ring, cover). **Change the look here.** |
| `cover.mjs` | Makes a cover from `style.json`: `--theme`, `--kind`, `--headline`, up to three `--point`s and a `--shot`. Refuses inputs that break a limit. |
| `cover-classic.html`, `cover-next.html` | The two cover layouts. The classic one is `COVER_HTML` from the classic repository's `record.py`, unchanged in what it draws. |
| `board.mjs` | Draws the whole style as one page (`out/style-board.html`): palette, title card, a moment in the app with every kind of on-screen text, closing card and cover, both themes side by side. |
| `samples/` | The classic screen and logo the board is drawn with. NextGen's come from this repository. |

```bash
node docs-site/video/kit/board.mjs
node docs-site/video/kit/cover.mjs --theme next --kind tutorial --headline "Getting started" \
  --point "A lab from the Automation Hub" --shot docs-site/src/assets/screenshots/designer-workflow.png --out cover.jpg
```

Both need Playwright's Chromium (`npx playwright install chromium` in `docs-site/`), or `CHROMIUM`
set to a Chromium that is already installed. The NextGen theme is set in Geist, loaded from Google
Fonts; without a network it falls back to the next font in the theme's list and says so.

## What reads it

Only `cover.mjs` and `board.mjs` so far. Still holding their own copies of these values:

- NextGen: `LOOK` and the card text in `../compose.mjs`, the voice in `../voiceover.json`.
- Classic: `OVERLAY_JS`, `COVER_HTML` and the pacing constants in `docs/release_videos/record.py`,
  the voice in `narration.py`.

`themes.classic` was copied from those files and draws the same cover. Two NextGen values differ
from today's film on purpose: the teal is the documentation's (`#45c4b5`; `compose.mjs` has
`#3bb8a8`), and captions, tags and the mark on the cards are new (the film has none yet).
