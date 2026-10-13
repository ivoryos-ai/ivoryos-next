# IvoryOS documentation

The user guide and developer guide, built with [Astro Starlight](https://starlight.astro.build).

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # static site in dist/, deployable to any static host
npm run screenshots  # regenerate every screenshot from the example deck (see below)
```

Pages live in `src/content/docs/` (`start/`, `guide/`, `run/`, `desktop/`, `cloud/`, `dev/*`,
`reference/`); the sidebar is generated from those folders in `astro.config.mjs`.

Screenshots are generated, not pasted: `scripts/screenshots.mjs` drives the installed Google
Chrome against `scripts/docs-deck.py` (the example lab in a data folder of its own) and captures
each documented state. To regenerate after an interface change:

```bash
rm -rf .deck-data
uv run --project edge_server --with baybe==0.15.0 --with plotly python docs-site/scripts/docs-deck.py   # from the repo root
npm run screenshots                                                                                      # in docs-site/
```

The page "Writing this documentation" (`src/content/docs/dev/internals/documentation.md`) has the
house style and the rest.
