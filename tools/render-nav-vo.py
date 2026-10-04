#!/usr/bin/env python3
"""
Render the navigator / start-grid VO pack.

WHO THIS IS FOR: tools/build-nav-grade-vo.sh
WHAT IT DOES: speaks original pace-note lines with a young, cheerful neural
  voice (Emma), then a bright in-car EQ. Falls back to macOS `say` Nicky
  if edge-tts is missing or the network is down.
HOW IT CONNECTS: writes assets/sfx/nav/*.mp3 that RallyAudio loads.

Not Sega audio. Original spoken lines only.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "sfx", "nav")

# Young cheerful US woman — personality tags: Cheerful, Clear, Conversational.
NAV_VOICE = os.environ.get("NAV_VOICE", "en-US-EmmaMultilingualNeural")
NAV_ACTOR = os.environ.get("NAV_ACTOR", "emma-cheerful")

# Extra punch on start-grid / jump / finish so those hits feel like a race.
PACE = {"rate": "+22%", "pitch": "+18Hz"}
HYPE = {"rate": "+26%", "pitch": "+22Hz"}
COUNT = {"rate": "+24%", "pitch": "+20Hz"}
QUAL = {"rate": "+18%", "pitch": "+14Hz"}

LINES = [
    ("easy-left", "Easy left!", PACE),
    ("easy-right", "Easy right!", PACE),
    ("medium-left", "Medium left!", PACE),
    ("medium-right", "Medium right!", PACE),
    ("hard-left", "Hard left!", PACE),
    ("hard-right", "Hard right!", PACE),
    ("hairpin-left", "Hairpin left!", PACE),
    ("hairpin-right", "Hairpin right!", PACE),
    ("jump", "Jump!", HYPE),
    ("long", "Long", QUAL),
    ("maybe", "Maybe", QUAL),
    ("finish", "Finish!", HYPE),
    ("count-3", "Three!", COUNT),
    ("count-2", "Two!", COUNT),
    ("count-1", "One!", COUNT),
    ("count-go", "Go!", HYPE),
]

# Bright cabin comms — not the old lecture-radio high-pass.
# Trim BOTH ends after EQ. loudnorm is avoided: it pads a silent tail
# that made "Easy left!" sit at 1.8 s and stacked into the next call.
FFMPEG_AF = (
    "silenceremove=start_periods=1:start_threshold=-44dB:start_silence=0.015:detection=peak,"
    "highpass=f=140,"
    "equalizer=f=3200:t=q:w=1.15:g=3.4,"
    "equalizer=f=200:t=q:w=0.85:g=-1.2,"
    "acompressor=threshold=-16dB:ratio=2.6:attack=6:release=90:makeup=6,"
    "alimiter=limit=0.92:attack=5:release=50,"
    "areverse,"
    "silenceremove=start_periods=1:start_threshold=-34dB:start_silence=0.045:detection=peak,"
    "areverse"
)


def have_edge_tts() -> bool:
    try:
        import edge_tts  # noqa: F401

        return True
    except ImportError:
        return False


async def speak_neural(text: str, rate: str, pitch: str, dest: str) -> None:
    import edge_tts

    comm = edge_tts.Communicate(text, NAV_VOICE, rate=rate, pitch=pitch, volume="+6%")
    await comm.save(dest)


def speak_say(text: str, dest_aiff: str) -> None:
    # Nicky is the youngest Siri compact voice on the box.
    voice = os.environ.get("NAV_SAY_VOICE", "Nicky")
    rate = os.environ.get("NAV_SAY_RATE", "230")
    subprocess.check_call(["say", "-v", voice, "-r", rate, "-o", dest_aiff, text])


def encode_mp3(src: str, dest: str) -> None:
    subprocess.check_call(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            src,
            "-ac",
            "1",
            "-ar",
            "44100",
            "-af",
            FFMPEG_AF,
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "2",
            dest,
        ]
    )


def duration_s(path: str) -> float:
    p = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(p.stdout.strip())


async def render_all() -> str:
    os.makedirs(OUT, exist_ok=True)
    neural = have_edge_tts()
    engine = "edge-tts" if neural else "say"
    with tempfile.TemporaryDirectory() as tmp:
        for key, phrase, tone in LINES:
            raw = os.path.join(tmp, f"{key}.raw")
            if neural:
                await speak_neural(phrase, tone["rate"], tone["pitch"], raw)
            else:
                aiff = os.path.join(tmp, f"{key}.aiff")
                speak_say(phrase, aiff)
                raw = aiff
            dest = os.path.join(OUT, f"{key}.mp3")
            encode_mp3(raw, dest)
            dur = duration_s(dest)
            size = os.path.getsize(dest)
            if dur < 0.22 or size < 2200:
                raise SystemExit(f"clip too short: {key} {dur:.3f}s {size}B")
            print(f"  {key:16} {size:6}B  {dur:.3f}s")
    actor = NAV_ACTOR if neural else "nicky-siri"
    print(f"wrote {len(LINES)} clips in {OUT} ({engine} {actor})")
    return actor


def main() -> int:
    if not shutil.which("ffmpeg"):
        print("ffmpeg required", file=sys.stderr)
        return 1
    actor = asyncio.run(render_all())
    print(actor)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
