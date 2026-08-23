#!/usr/bin/env bash
#
# build-car-lods.sh — rebuild the car assets in assets/<car>/ from their heroes.
#
# WHO THIS IS FOR: whoever replaces or re-tunes a car model.
# WHAT IT DOES: for each chassis, decimates the hero GLB into a rival LOD and
#   strips material extensions the renderer should not pay for.
# HOW IT CONNECTS: cars/celica.js loads assets/<car>/<hero>.glb for the player
#   and assets/<car>/rival.glb for the AI pack.
#
# WHY LODs EXIST: a full Sega Rally grid is 15 cars. At hero detail that is
# ~670k triangles a frame, which will not hold 60 fps. AM3 hit the same wall on
# Saturn and thinned the on-screen pack (docs/AM3-RESEARCH.md section 5).
#
# WHY WE DO NOT RUN `join`: it implicitly flattens the node hierarchy, which
# deletes the transform-only WHEEL_* hub nodes even with --keepNamed. cars/
# celica.js locates wheels by node name, so joining here stops wheels turning.
# Body panels are merged at load time in JS instead, where wheels can be
# excluded explicitly.
#
# Usage:  bash tools/build-car-lods.sh
# Requires network on first run (fetches the gltf-transform CLI via npx).

set -euo pipefail
cd "$(dirname "$0")/.."

GT=(npx --yes @gltf-transform/cli@4.4.2)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Extensions that promote a material to MeshPhysicalMaterial in three.js. A 1995
# rally game had no clearcoat sheen and we do not want the extra pixel cost.
DROP_EXT="KHR_materials_clearcoat,KHR_materials_specular,KHR_materials_ior"

# chassis|hero file|rival simplify ratio
CARS=(
  "celica|gt4.glb|0.16"
  "delta|integrale.glb|0.22"
  "stratos|stratos.glb|0.55"
  "jaguar|etype.glb|0.2"
  "focus|focus.glb|0.18"
  "accord|accord.glb|0.32"
)

for entry in "${CARS[@]}"; do
  IFS='|' read -r car hero ratio <<<"$entry"
  src="assets/$car/$hero"
  [ -f "$src" ] || { echo "skip $car — no $src"; continue; }
  echo "=== $car ==="

  node tools/glbedit.mjs strip-ext "$src" "$TMP/$car-hero.glb" "$DROP_EXT" >/dev/null
  "${GT[@]}" prune "$TMP/$car-hero.glb" "$src" 2>&1 | grep -E '→' || true

  if [ "$ratio" = "1.0" ]; then
    # Already inside the rival budget; ship it unchanged.
    cp "$src" "assets/$car/rival.glb"
  else
    "${GT[@]}" weld "$src" "$TMP/$car-w.glb" 2>&1 | grep -E '→' || true
    "${GT[@]}" simplify "$TMP/$car-w.glb" "$TMP/$car-s.glb" --ratio "$ratio" --error 0.05 2>&1 | grep -E '→' || true
    "${GT[@]}" resize "$TMP/$car-s.glb" "assets/$car/rival.glb" --width 512 --height 512 2>&1 | grep -E '→' || true
  fi
done

echo
echo "=== inventory ==="
node tools/glbstats.mjs assets/*/*.glb
