#!/usr/bin/env python3
"""Copy a Sketchfab Celica GLB/zip from Downloads into assets/celica/."""

from __future__ import annotations

import shutil
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets" / "celica"
DEST.mkdir(parents=True, exist_ok=True)
TARGET = DEST / "gt4.glb"

WATCH_DIRS = [
    Path.home() / "Downloads",
    Path.home() / "Desktop",
]


def looks_like_celica(path: Path) -> bool:
    name = path.name.lower()
    if name.endswith(".glb") or name.endswith(".gltf"):
        return True
    if name.endswith(".zip") and any(k in name for k in ("celica", "gt4", "gt-4", "sketchfab", "toyota")):
        return True
    return False


def install(path: Path) -> bool:
    if path.suffix.lower() == ".glb":
        shutil.copy2(path, TARGET)
        print(f"copied {path} -> {TARGET}", flush=True)
        return True
    if path.suffix.lower() == ".gltf":
        shutil.copy2(path, DEST / "scene.gltf")
        print(f"copied {path} -> {DEST / 'scene.gltf'}", flush=True)
        return True
    if path.suffix.lower() == ".zip" and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            zf.extractall(DEST)
            names = zf.namelist()
        glbs = [n for n in names if n.lower().endswith(".glb")]
        if glbs:
            src = DEST / glbs[0]
            if src.resolve() != TARGET.resolve():
                shutil.copy2(src, TARGET)
        print(f"extracted {path} -> {DEST}", flush=True)
        return True
    return False


def newest_candidate(since: float) -> Path | None:
    found: list[Path] = []
    for folder in WATCH_DIRS:
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            if not path.is_file() or path.stat().st_mtime < since:
                continue
            if looks_like_celica(path):
                found.append(path)
    if not found:
        return None
    found.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return found[0]


def main() -> int:
    if len(sys.argv) > 1:
        return 0 if install(Path(sys.argv[1]).expanduser()) else 1
    since = time.time() - 30
    print("watching Downloads/Desktop for Celica GLB…", flush=True)
    deadline = time.time() + 15 * 60
    while time.time() < deadline:
        if TARGET.exists() and TARGET.stat().st_size > 64:
            print(f"already have {TARGET}", flush=True)
            return 0
        cand = newest_candidate(since)
        if cand:
            try:
                if install(cand):
                    return 0
            except OSError as err:
                print(err, flush=True)
        time.sleep(2)
    print("no GLB arrived", flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
