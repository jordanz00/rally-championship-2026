#!/usr/bin/env python3
"""Download Poly Haven CC0 1k PBR textures for Desert road / sand / rock."""

from __future__ import annotations

import json
import ssl
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "env" / "desert"
API = "https://api.polyhaven.com/files/{id}"
UA = "RallyChampionship2026/desert-pbr"
CTX = ssl._create_unverified_context()

SETS = [
    ("sand", "aerial_sand"),
    ("dirt", "brown_mud_dry"),
    ("gravel", "aerial_rocks_02"),
    ("tarmac", "asphalt_track"),
]

MAPS = [
    ("Diffuse", "diff"),
    ("nor_gl", "nor_gl"),
    ("Rough", "rough"),
    ("AO", "ao"),
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
    OUT.mkdir(parents=True, exist_ok=True)
    for stem, ph_id in SETS:
        meta = get_json(API.format(id=ph_id))
        print(ph_id)
        for api_name, suffix in MAPS:
            block = ((meta.get(api_name) or {}).get("1k") or {}).get("jpg") or {}
            url = block.get("url")
            if not url:
                print(f"  skip {api_name}")
                continue
            dest = OUT / f"{stem}_{suffix}_1k.jpg"
            download(url, dest)


if __name__ == "__main__":
    main()
