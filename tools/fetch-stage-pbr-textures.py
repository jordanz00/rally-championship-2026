#!/usr/bin/env python3
"""Download Poly Haven CC0 1k + 2k PBR textures for Mountain + Lakeside road / land.

Mountain sets live in assets/env/mountain; Lakeside shares tarmac/gravel/dirt from there
and owns cobble / land / sand in assets/env/lakeside.
"""

from __future__ import annotations

import json
import ssl
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / "assets" / "env"
API = "https://api.polyhaven.com/files/{id}"
UA = "RallyChampionship2026/stage-pbr"
CTX = ssl._create_unverified_context()

# (folder, stem, polyhaven id)
SETS = [
    ("mountain", "tarmac", "asphalt_02"),
    ("mountain", "cobble", "cobblestone_floor_08"),
    ("mountain", "gravel", "rocky_trail"),
    ("mountain", "dirt", "rocky_trail_02"),
    ("mountain", "land", "forrest_ground_01"),
    ("lakeside", "cobble", "cobblestone_floor_05"),
    ("lakeside", "land", "brown_mud_leaves_01"),
    ("lakeside", "sand", "coast_sand_01"),
]

MAPS = [
    ("Diffuse", "diff"),
    ("nor_gl", "nor_gl"),
    ("Rough", "rough"),
    ("AO", "ao"),
]
# Runtime streams 2k after 1k albedo. Skip AO at 2k (boot already dropped AO).
HI_MAPS = [
    ("Diffuse", "diff"),
    ("nor_gl", "nor_gl"),
    ("Rough", "rough"),
]


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60, context=CTX) as res:
        return json.loads(res.read().decode("utf-8"))


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1024:
        print(f"  skip {dest.name}")
        return
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180, context=CTX) as res, dest.open("wb") as fh:
        fh.write(res.read())
    print(f"  {dest.name}  {dest.stat().st_size / 1024:.0f} KB")


def main() -> None:
    for folder, stem, ph_id in SETS:
        out = ENV / folder
        out.mkdir(parents=True, exist_ok=True)
        meta = get_json(API.format(id=ph_id))
        print(folder, stem, ph_id)
        for api_name, suffix in MAPS:
            block = ((meta.get(api_name) or {}).get("1k") or {}).get("jpg") or {}
            url = block.get("url")
            if not url:
                print(f"  skip {api_name}")
                continue
            download(url, out / f"{stem}_{suffix}_1k.jpg")
        for api_name, suffix in HI_MAPS:
            block = ((meta.get(api_name) or {}).get("2k") or {}).get("jpg") or {}
            url = block.get("url")
            if not url:
                print(f"  skip 2k {api_name}")
                continue
            download(url, out / f"{stem}_{suffix}_2k.jpg")


if __name__ == "__main__":
    main()
