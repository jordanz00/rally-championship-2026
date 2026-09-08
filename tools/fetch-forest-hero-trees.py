#!/usr/bin/env python3
"""
Download Poly Haven CC0 1k tree glTFs and pack browser-ready GLBs.

WHO THIS IS FOR: Forest hero canopy (0–20 m). pine_tree_01 / fir_tree_01 are
  skipped — hundreds of MB / millions of tris, no game LOD as shipped.
RUN: python3 tools/fetch-forest-hero-trees.py
THEN: node tools/pack-forest-hero-trees.mjs
"""

from __future__ import annotations

import json
import ssl
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "props" / "hd-src" / "polyhaven"
API = "https://api.polyhaven.com/files/{id}"
UA = "RallyChampionship2026/forest-hero-trees (local build; CC0)"
CTX = ssl._create_unverified_context()

# dest_stem, polyhaven_id
TREES = [
    ("forest_hero_tree_a", "island_tree_01"),
    ("forest_hero_tree_b", "island_tree_02"),
    ("forest_hero_tree_c", "island_tree_03"),
    ("forest_hero_tree_d", "fir_sapling_medium"),
    ("forest_hero_tree_e", "tree_small_02"),
    ("forest_hero_tree_f", "fir_sapling"),
    ("forest_hero_tree_g", "pine_sapling_small"),
    ("forest_hero_tree_h", "searsia_lucida"),
]


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90, context=CTX) as res:
        return json.loads(res.read().decode("utf-8"))


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1024:
        print(f"  skip exists {dest.name} ({dest.stat().st_size / 1e6:.2f} MB)")
        return
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=600, context=CTX) as res, tmp.open("wb") as fh:
        while True:
            chunk = res.read(1024 * 256)
            if not chunk:
                break
            fh.write(chunk)
    tmp.replace(dest)
    print(f"  wrote {dest.name} ({dest.stat().st_size / 1e6:.2f} MB)")


def fetch_one(stem: str, ph_id: str) -> Path:
    folder = SRC / ph_id
    folder.mkdir(parents=True, exist_ok=True)
    meta = get_json(API.format(id=ph_id))
    g = ((meta.get("gltf") or {}).get("1k") or {}).get("gltf") or {}
    if not g.get("url"):
        raise SystemExit(f"no gltf 1k for {ph_id}")
    gltf_name = Path(g["url"]).name
    gltf_path = folder / gltf_name
    print(f"{ph_id} → {stem}")
    download(g["url"], gltf_path)
    for rel, info in (g.get("include") or {}).items():
        download(info["url"], folder / rel)
    marker = folder / f".ready-{stem}"
    marker.write_text(stem + "\n", encoding="utf-8")
    return gltf_path


def main() -> None:
    for stem, ph_id in TREES:
        path = fetch_one(stem, ph_id)
        print(f"  source {path}")


if __name__ == "__main__":
    main()
