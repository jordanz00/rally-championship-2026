"""Finish densifying any props still at Kenney low-poly sizes. Blender --python this file."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure sibling module import works when Blender runs this file.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

# Import by loading build-hd-props without running main
import importlib.util

spec = importlib.util.spec_from_file_location("hdprops", ROOT / "tools" / "build-hd-props.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

PROPS = ROOT / "assets" / "props"


def needs_character(p: Path) -> bool:
    return p.stat().st_size < 400_000


def main() -> None:
    n = 0
    for ch in sorted(PROPS.glob("character-*.glb")):
        if needs_character(ch):
            print("densify", ch.name, ch.stat().st_size)
            mod.densify_existing(ch, ch, subdiv=1)
            n += 1
        else:
            print("ok", ch.name, ch.stat().st_size)
    for an, subdiv, min_size in (
        ("animal-zebra.glb", 2, 40_000),
        ("animal-elephant.glb", 2, 40_000),
        ("animal-gazelle.glb", 2, 40_000),
        ("tent_detailedClosed.glb", 1, 80_000),
        ("house-alpine.glb", 2, 40_000),
    ):
        src = PROPS / an
        if src.is_file() and src.stat().st_size < min_size:
            print("densify", an, src.stat().st_size)
            mod.densify_existing(src, src, subdiv=subdiv)
            n += 1
    print("done remaining", n)


if __name__ == "__main__":
    main()
