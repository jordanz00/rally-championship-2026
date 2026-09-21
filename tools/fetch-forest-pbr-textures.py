#!/usr/bin/env python3
"""Download Poly Haven CC0 1k + 2k PBR textures for Forest road / floor / gravel."""

from __future__ import annotations

import json
import ssl
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "env" / "forest"
API = "https://api.polyhaven.com/files/{id}"
UA = "RallyChampionship2026/forest-pbr"
CTX = ssl._create_unverified_context()

# dest_stem, polyhaven_id
SETS = [
    ("dirt_floor", "dirt_floor"),
    ("gravel_road", "gravel_road"),
    ("forest_floor", "forest_floor"),
]
TUNNEL = ("tunnel_rock", "boulder_01")

# Poly Haven map name → local suffix
MAPS = [
    ("Diffuse", "diff"),
    ("nor_gl", "nor_gl"),
    ("Rough", "rough"),
    ("AO", "ao"),
]
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
        for api_name, suffix in HI_MAPS:
            block = ((meta.get(api_name) or {}).get("2k") or {}).get("jpg") or {}
            url = block.get("url")
            if not url:
                print(f"  skip 2k {api_name}")
                continue
            dest = OUT / f"{stem}_{suffix}_2k.jpg"
            download(url, dest)
    stem, ph_id = TUNNEL
    meta = get_json(API.format(id=ph_id))
    print(ph_id)
    for api_name, suffix in (("Diffuse", "diff"), ("nor_gl", "nor_gl")):
        block = ((meta.get(api_name) or {}).get("2k") or {}).get("jpg") or {}
        url = block.get("url")
        if not url:
            print(f"  skip 2k {api_name}")
            continue
        download(url, OUT / f"{stem}_{suffix}_2k.jpg")
    arm_url = None
    for key in ("arm", "ARM"):
        arm_url = (((meta.get(key) or {}).get("2k") or {}).get("jpg") or {}).get("url")
        if arm_url:
            break
    if arm_url:
        download(arm_url, OUT / f"{stem}_arm_2k.jpg")
    else:
        print("  skip 2k arm")


if __name__ == "__main__":
    main()
