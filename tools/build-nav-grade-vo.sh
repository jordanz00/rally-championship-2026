#!/usr/bin/env bash
# Render all navigator VO with a young cheerful actor + bright cabin EQ.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/Library/Python/3.13/bin:$PATH"

if python3 -c 'import edge_tts' >/dev/null 2>&1; then
  exec python3 "$ROOT/tools/render-nav-vo.py"
fi

# Offline fallback — Nicky is the youngest Siri compact voice on the box.
OUT="$ROOT/assets/sfx/nav"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VOICE="${NAV_SAY_VOICE:-Nicky}"
RATE="${NAV_SAY_RATE:-230}"

render() {
  local key="$1"
  local phrase="$2"
  say -v "$VOICE" -r "$RATE" -o "$TMP/${key}.aiff" "$phrase"
  ffmpeg -hide_banner -loglevel error -y -i "$TMP/${key}.aiff" -ac 1 -ar 44100 \
    -af "silenceremove=start_periods=1:start_threshold=-44dB:start_silence=0.015:detection=peak,highpass=f=140,equalizer=f=3200:t=q:w=1.15:g=3.4,acompressor=threshold=-16dB:ratio=2.6:attack=6:release=90:makeup=6,alimiter=limit=0.92:attack=5:release=50,areverse,silenceremove=start_periods=1:start_threshold=-34dB:start_silence=0.045:detection=peak,areverse" \
    -codec:a libmp3lame -q:a 2 "$OUT/${key}.mp3"
}

render easy-left "Easy left!"
render easy-right "Easy right!"
render medium-left "Medium left!"
render medium-right "Medium right!"
render hard-left "Hard left!"
render hard-right "Hard right!"
render hairpin-left "Hairpin left!"
render hairpin-right "Hairpin right!"
render jump "Jump!"
render long "Long"
render maybe "Maybe"
render finish "Finish!"
render count-3 "Three!"
render count-2 "Two!"
render count-1 "One!"
render count-go "Go!"

echo "wrote 16 navigator clips in $OUT (${VOICE} fallback)"
