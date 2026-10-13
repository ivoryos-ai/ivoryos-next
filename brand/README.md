# Brand

`ivoryos-logo.ai` is the source of every logo asset in this repository: the elephant mark and the
IvoryOS wordmark, as vectors (Illustrator, saved PDF-compatible, which is the default). Nothing
else here is edited by hand. After changing it, regenerate everything with:

```bash
uv run --with pillow --with pymupdf python desktop/scripts/make-icon.py
```

That writes the app icons and the menu bar icon under `desktop/build/`, the mark as SVG for the
two web apps and the docs site, the browser tab icons, and the lockup (mark plus wordmark, light
and dark) in this folder for the README. The script's docstring lists each file and what it is for.
The name and the logo are covered by `TRADEMARKS.md`.
