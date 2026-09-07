#!/usr/bin/env python3
"""
Download Poly Haven CC0 1k glTF packs for Forest hero props, pack to GLB.

WHO THIS IS FOR: Forest close-range rocks / logs / ferns. Not full canopy trees
  (pine_tree_01 is ~949 MB / millions of tris — not a browser instance).
RUN: python3 tools/fetch-forest-hero-polyhaven.py
THEN: npx @gltf-transform/cli copy … (invoked by this script)
"""

from __future__ import annotations

import json
import shutil
import ssl
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "props" / "hd-src" / "polyhaven"
OUT = ROOT / "assets" / "props"

# dest_glb_stem, polyhaven_id
HEROES = [
    ("forest_hero_boulder_a", "boulder_01"),
    ("forest_hero_boulder_b", "rock_07"),
    ("forest_hero_moss_set_a", "rock_moss_set_01"),
    ("forest_hero_moss_set_b", "rock_moss_set_02"),
    ("forest_hero_log", "dead_tree_trunk"),
    ("forest_hero_fern", "fern_02"),
]

API = "https://api.polyhaven.com/files/{id}"
UA = "RallyChampionship2026/forest-hero (local build; CC0)"
CTX = ssl._create_unverified_context()


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60, context=CTX) as res:
        return json.loads(res.read().decode("utf-8"))


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180, context=CTX) as res, dest.open("wb") as fh:
        shutil.copyfileobj(res, fh)


def fetch_one(stem: str, ph_id: str) -> Path:
    folder = SRC / ph_id
    folder.mkdir(parents=True, exist_ok=True)
    meta = get_json(API.format(id=ph_id))
    g = ((meta.get("gltf") or {}).get("1k") or {}).get("gltf") or {}
    if not g.get("url"):
        raise SystemExit(f"no gltf 1k for {ph_id}")
    gltf_name = Path(g["url"]).name
    gltf_path = folder / gltf_name
    print(f"  {ph_id}: {gltf_name}")
    download(g["url"], gltf_path)
    for rel, info in (g.get("include") or {}).items():
        download(info["url"], folder / rel)
    out_glb = OUT / f"{stem}.glb"
    cmd = [
        "npx",
        "--yes",
        "@gltf-transform/cli@4.4.2",
        "copy",
        str(gltf_path),
        str(out_glb),
    ]
    print(f"  pack → {out_glb.name}")
    subprocess.check_call(cmd, cwd=str(ROOT))
    return out_glb


def main() -> None:
    for stem, ph_id in HEROES:
        glb = fetch_one(stem, ph_id)
        print(f"  wrote {glb} ({glb.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
