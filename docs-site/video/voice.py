"""Speak the tutorial's narration (voiceover.json) with Kokoro, an open-source voice that runs on
this computer. One wav per line in out/vo/, and out/vo/timing.json with each line's length, which
is what the recording holds each step for.

    uv run -q --python 3.12 --with kokoro-onnx --with soundfile python docs-site/video/voice.py
    ... voice.py --all          every line again, not only the ones whose text or voice changed

The model files (kokoro-v1.0.onnx, voices-v1.0.bin, from github.com/thewh1teagle/kokoro-onnx
releases) are looked for in $KOKORO_MODELS, then docs-site/video/.models, then the promo video's
checkout beside this repository. To use a person's voice instead, record each line and save it
over out/vo/<id>.wav (any sample rate), then run voice.py --measure: it only re-reads the lengths.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
SCRIPT = json.loads((HERE / "voiceover.json").read_text())
OUT = HERE / "out" / "vo"
TIMING = OUT / "timing.json"
RATE = 24000


def models():
    places = [os.environ.get("KOKORO_MODELS"), HERE / ".models", HERE.parents[2] / "ivoryos-video" / ".models"]
    for place in places:
        if place and (Path(place) / "kokoro-v1.0.onnx").exists():
            return Path(place)
    sys.exit("Kokoro's model files were not found; see the top of voice.py.")


def trim(samples, threshold=0.01, keep=0.04):
    """Cut the silence Kokoro leaves at both ends, so a clip starts when the voice does."""
    loud = np.flatnonzero(np.abs(samples) > threshold)
    if not len(loud):
        return samples
    pad = int(keep * RATE)
    return samples[max(0, loud[0] - pad): loud[-1] + pad]


def measure():
    timing = {}
    for key in SCRIPT["lines"]:
        info = sf.info(OUT / f"{key}.wav")
        timing[key] = {"seconds": round(info.frames / info.samplerate, 3), "stamp": "recorded"}
    TIMING.write_text(json.dumps(timing, indent=2) + "\n")
    print(f"total speech: {sum(t['seconds'] for t in timing.values()):.1f}s")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if "--measure" in sys.argv:
        return measure()
    from kokoro_onnx import Kokoro

    where = models()
    kokoro = Kokoro(str(where / "kokoro-v1.0.onnx"), str(where / "voices-v1.0.bin"))
    voice, speed = SCRIPT["voice"], SCRIPT.get("speed", 1.0)
    lang = "en-gb" if voice[0] == "b" else "en-us"
    timing = json.loads(TIMING.read_text()) if TIMING.exists() else {}
    for key in list(timing):
        if key not in SCRIPT["lines"]:
            del timing[key]
            (OUT / f"{key}.wav").unlink(missing_ok=True)
    for key, line in SCRIPT["lines"].items():
        # What is said can differ from what is written (a word the voice reads badly).
        text = spoken = line["say"]
        for written, said in SCRIPT.get("pronounce", {}).items():
            spoken = spoken.replace(written, said)
        stamp = hashlib.sha1(f"{voice}|{speed}|{spoken}".encode()).hexdigest()[:12]
        wav = OUT / f"{key}.wav"
        if "--all" not in sys.argv and wav.exists() and timing.get(key, {}).get("stamp") == stamp:
            continue
        samples, _ = kokoro.create(spoken, voice=voice, speed=speed, lang=lang)
        samples = trim(samples)
        samples = samples / max(1e-6, np.abs(samples).max()) * 0.84
        sf.write(wav, samples, RATE, subtype="PCM_16")
        timing[key] = {"seconds": round(len(samples) / RATE, 3), "stamp": stamp}
        print(f"{key:22s} {timing[key]['seconds']:5.2f}s  {text}")
    TIMING.write_text(json.dumps(timing, indent=2) + "\n")
    print(f"total speech: {sum(t['seconds'] for t in timing.values()):.1f}s")


main()
