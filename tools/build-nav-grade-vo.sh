#!/usr/bin/env bash
# Render all navigator VO with one voice + radio EQ (turn grades, jump, countdown).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/sfx/nav"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VOICE="${NAV_VOICE:-Daniel}"
RATE="${NAV_RATE:-205}"

render() {
  local key="$1"
  local phrase="$2"
  say -v "$VOICE" -r "$RATE" -o "$TMP/${key}.aiff" "$phrase"
  ffmpeg -hide_banner -loglevel error -y -i "$TMP/${key}.aiff" -ac 1 -ar 44100 \
    -af "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.03:detection=peak,highpass=f=520,lowpass=f=3400,acompressor=threshold=-20dB:ratio=4.5:attack=5:release=50:makeup=9,volume=1.15" \
    -codec:a libmp3lame -q:a 4 "$OUT/${key}.mp3"
}

render easy-left "easy left"
render easy-right "easy right"
render medium-left "medium left"
render medium-right "medium right"
render hard-left "hard left"
render hard-right "hard right"
render hairpin-left "hairpin left"
render hairpin-right "hairpin right"
render jump "jump"
render long "long"
render maybe "maybe"
render finish "finish!"
render count-3 "three"
render count-2 "two"
render count-1 "one"
render count-go "go"

echo "wrote 16 navigator clips in $OUT (${VOICE})"
