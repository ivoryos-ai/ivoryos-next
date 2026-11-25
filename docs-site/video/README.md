# The getting-started video

A narrated walk through IvoryOS on the real desktop app: the Automation Hub, a simulated lab
installed as a deck, a workflow built in the Designer, the lab's 3D view, a run, a run over a
table, and the results. About four minutes, 1920×1080.

Everything here is generated. Nothing is edited by hand, so after an interface change the video is
made again the same way the screenshots are:

```bash
# from the repository root
uv run -q --python 3.12 --with kokoro-onnx --with soundfile python docs-site/video/voice.py   # 1. speak the lines
node docs-site/video/record.mjs                                                              # 2. record the app (about 6 minutes)
node docs-site/video/compose.mjs                                                             # 3. make the film (about 2 minutes)
```

The result is `out/ivoryos-tutorial.mp4`, with `out/ivoryos-tutorial.srt` (subtitles) beside it and
`script.md` (the narration with times) in this folder. `out/` and `.work/` are not committed: the
film and its audio stay on the computer that made them, and no page of the documentation shows the
film yet.

## The pieces

| File | What it is |
|---|---|
| `voiceover.json` | The narration: one line per beat (`say`), what is on screen meanwhile (`screen`), the voice, and words to pronounce differently from how they are written. **Change the words here.** |
| `voice.py` | Speaks each line into `out/vo/<id>.wav` with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), an open-source voice that runs on this computer, and measures it (`out/vo/timing.json`). |
| `tutorial.mjs` | What happens on screen, beat by beat: the pointer's clicks, typing and drags, by the app's own labels. **Change the actions here.** |
| `record.mjs`, `lib/recorder.mjs` | Starts the real app (`desktop/`) in a home folder of its own, runs the tutorial, and keeps what each page painted, the pointer's path and when each line began (`.work/take/`). Each beat is held for as long as its line lasts. |
| `compose.mjs` | Puts the film together from the take: the launcher and the deck's page as one window, the pointer, zooms, chapter titles, the title and closing cards, and the narration mixed in. Writes the subtitles and `script.md`. |
| `script.md` | The narration as a table, generated. Read it there; edit it in `voiceover.json`. |

## What it needs

- macOS with a Retina display (the picture is recorded at twice the window's size and scaled to
  1080p), Node, [uv](https://docs.astral.sh/uv/), and `npm install` done in `docs-site/` and
  `desktop/`. `frontend/out` must be built (`npm run build` in `frontend/`).
- Kokoro's two model files (`kokoro-v1.0.onnx`, `voices-v1.0.bin`, from the kokoro-onnx releases
  page) in `docs-site/video/.models/`, or `KOKORO_MODELS` pointing at the folder that has them.
- A network connection: the app reads the Automation Hub and installs the simulated lab's package
  (`colour-match-sdl`) from PyPI. ffmpeg is fetched by `uv` (the `imageio-ffmpeg` package); set
  `FFMPEG` to use your own.

The app's window appears on screen while recording and is driven through its pages, not through
the mouse, so the computer can be used meanwhile; leave the window uncovered and unminimized.
Recording uses `docs-site/.desktop-home/video`, never your own IvoryOS folder. A new take removes
that home's decks first, so the film shows a first install; its Python environment is kept, which
is why the install takes seconds on camera rather than the minute or two a real first install does
(the narration says so).

## Changing it

- **The words.** Edit a line in `voiceover.json`, run `voice.py` (only changed lines are spoken
  again), then record and compose: a line's length decides how long its beat is held.
- **Your own voice.** Record each line and save it over `out/vo/<id>.wav`, run
  `voice.py --measure`, then record and compose. `script.md` is the reading copy.
- **Another voice.** `voice` in `voiceover.json` is a Kokoro voice name (`af_heart`, `af_bella`,
  `bf_emma`, `am_michael`, …); `speed` is its pace.
- **What is shown.** Edit `tutorial.mjs`. `node docs-site/video/record.mjs --dry --resume` runs it
  quickly on the deck from the last take without waiting for the lines; when it stops, it says in
  which beat and saves what the window showed (`.work/failed.png`).
- **The look** (pointer, click ring, chapter titles, cards) is `LOOK` and the drawing functions in
  `compose.mjs`, in the documentation's colours. Recompose; there is no need to record again.
- **Checking a take.** `node docs-site/video/compose.mjs --sheets` writes a frame from every beat,
  six to a sheet, into `out/sheets/`; `--from 60 --to 80` renders those seconds; `--still 72.5`
  one frame.

## What is not real

The lab is simulated (the SDL Education Package's instruments), and two waits are shortened: the
install is cut, and runs are played fast (the pointer's own actions while adding the later steps
too). Everything else is the app as it is.
