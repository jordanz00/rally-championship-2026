#!/usr/bin/env python3
"""
gen-crowd-atlas.py — realistic skin / clothing atlas for trackside bipeds.

Writes assets/props/Textures/hd/crowd_atlas.png and copies to
assets/props/Textures/colormap.png so CrowdField + Kenney-era UV paths work.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT_HD = ROOT / "assets" / "props" / "Textures" / "hd"
OUT_COL = ROOT / "assets" / "props" / "Textures" / "colormap.png"
SIZE = 1024


def fill_noise(img: Image.Image, base, amount: float, seed: int) -> None:
    rng = random.Random(seed)
    px = img.load()
    w, h = img.size
    br, bg, bb = base
    for y in range(h):
        for x in range(w):
            n = rng.uniform(-amount, amount)
            px[x, y] = (
                max(0, min(255, int(br + n))),
                max(0, min(255, int(bg + n * 0.85))),
                max(0, min(255, int(bb + n * 0.7))),
            )


def panel(img: Image.Image, box, color, seed: int, fabric: bool = False) -> None:
    x0, y0, x1, y1 = box
    tile = Image.new("RGB", (x1 - x0, y1 - y0), color)
    fill_noise(tile, color, 14 if fabric else 9, seed)
    if fabric:
        draw = ImageDraw.Draw(tile)
        for y in range(0, tile.size[1], 3):
            shade = tuple(max(0, c - 8) for c in color)
            draw.line([(0, y), (tile.size[0], y)], fill=shade, width=1)
    tile = tile.filter(ImageFilter.GaussianBlur(0.4))
    img.paste(tile, (x0, y0))


def main() -> None:
    OUT_HD.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (SIZE, SIZE), (40, 40, 42))

    # Skin tones — row 0 (4 panels; diverse light→deep so UV picks vary)
    skins = [
        (242, 205, 178),  # fair / cool
        (220, 168, 132),  # light-medium warm
        (168, 118, 88),   # medium-deep
        (92, 58, 42),     # deep
    ]
    for i, c in enumerate(skins):
        panel(img, (i * 256, 0, i * 256 + 256, 256), c, 10 + i)

    # Shirt / jacket colours — row 1
    shirts = [
        (48, 72, 140),
        (180, 42, 42),
        (36, 110, 72),
        (220, 220, 224),
        (28, 28, 32),
        (200, 120, 40),
        (90, 50, 120),
        (40, 90, 110),
    ]
    for i, c in enumerate(shirts):
        x = (i % 4) * 256
        y = 256 + (i // 4) * 128
        panel(img, (x, y, x + 256, y + 128), c, 40 + i, fabric=True)

    # Pants — row spanning mid
    pants = [
        (42, 48, 72),
        (55, 55, 58),
        (70, 58, 42),
        (30, 55, 90),
        (90, 90, 88),
        (48, 38, 32),
        (35, 70, 55),
        (80, 40, 40),
    ]
    for i, c in enumerate(pants):
        x = (i % 4) * 256
        y = 512 + (i // 4) * 128
        panel(img, (x, y, x + 256, y + 128), c, 80 + i, fabric=True)

    # Hair — bottom-left
    hairs = [(28, 20, 14), (90, 60, 30), (200, 180, 140), (12, 12, 14)]
    for i, c in enumerate(hairs):
        panel(img, (i * 128, 768, i * 128 + 128, 896), c, 120 + i)

    # Shoes / accent
    panel(img, (512, 768, 768, 896), (28, 24, 22), 140, fabric=True)
    panel(img, (768, 768, 1024, 896), (200, 200, 205), 141)  # light accent / hat

    # Face detail strip — subtle cheek variation over skin0
    face = Image.new("RGB", (256, 128), skins[0])
    fill_noise(face, skins[0], 6, 200)
    draw = ImageDraw.Draw(face)
    draw.ellipse([90, 40, 115, 58], fill=(60, 45, 40))
    draw.ellipse([145, 40, 170, 58], fill=(60, 45, 40))
    img.paste(face, (0, 896))

    img = ImageEnhance.Contrast(img).enhance(1.08)
    img = ImageEnhance.Color(img).enhance(1.05)
    path = OUT_HD / "crowd_atlas.png"
    img.save(path, optimize=True)
    img.save(OUT_COL, optimize=True)
    print("wrote", path)
    print("wrote", OUT_COL)


if __name__ == "__main__":
    main()
