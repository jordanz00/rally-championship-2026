#!/usr/bin/env python3
"""
gen-hd-textures.py — bake 2K procedural PBR-style atlases for trackside props.

WHO THIS IS FOR: art pipeline before Blender prop rebuild.
WHAT IT DOES: writes 2048² bark / leaf / rock / cactus / skin / cloth PNGs under
  assets/props/Textures/hd/ for embedding in denser GLBs.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "props" / "Textures" / "hd"
SIZE = 2048
WORK = 512  # author at 512, Lanczos upscale → crisp HD without O(n²) pixel loops


def _up(img: Image.Image) -> Image.Image:
    return img.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def _noise(img: Image.Image, amount: float = 18.0, seed: int = 1) -> Image.Image:
    rng = random.Random(seed)
    px = img.load()
    w, h = img.size
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            n = int(rng.uniform(-amount, amount))
            r, g, b = px[x, y][:3]
            c = (
                max(0, min(255, r + n)),
                max(0, min(255, g + n)),
                max(0, min(255, b + n)),
            )
            for dy in (0, 1):
                for dx in (0, 1):
                    if x + dx < w and y + dy < h:
                        px[x + dx, y + dy] = c
    return img


def bark(path: Path) -> None:
    img = Image.new("RGB", (WORK, WORK), (92, 58, 32))
    draw = ImageDraw.Draw(img)
    rng = random.Random(7)
    for i in range(70):
        x = int(i * WORK / 70 + rng.uniform(-4, 4))
        c = 40 + rng.randint(0, 50)
        draw.line([(x, 0), (x + rng.randint(-20, 20), WORK)], fill=(c, c // 2, c // 3), width=rng.randint(2, 8))
    for _ in range(1200):
        x, y = rng.randint(0, WORK - 1), rng.randint(0, WORK - 1)
        r = rng.randint(1, 5)
        shade = rng.randint(30, 110)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(shade, shade // 2, shade // 3))
    img = _noise(img, 22, 7)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    ImageEnhance.Contrast(_up(img)).enhance(1.25).save(path, quality=88, optimize=True)


def leaves(path: Path) -> None:
    img = Image.new("RGB", (WORK, WORK), (28, 72, 24))
    draw = ImageDraw.Draw(img)
    rng = random.Random(11)
    for _ in range(2800):
        x, y = rng.randint(0, WORK - 1), rng.randint(0, WORK - 1)
        w, h = rng.randint(3, 14), rng.randint(5, 20)
        g = rng.randint(50, 160)
        r = rng.randint(10, 70)
        b = rng.randint(10, 50)
        ang = rng.uniform(0, math.pi)
        pts = [
            (x + math.cos(ang) * w, y + math.sin(ang) * h),
            (x - math.sin(ang) * w * 0.4, y + math.cos(ang) * h * 0.4),
            (x - math.cos(ang) * w, y - math.sin(ang) * h),
            (x + math.sin(ang) * w * 0.4, y - math.cos(ang) * h * 0.4),
        ]
        draw.polygon(pts, fill=(r, g, b))
    img = _noise(img, 14, 11)
    ImageEnhance.Color(_up(img)).enhance(1.2).save(path, quality=88, optimize=True)


def rock(path: Path) -> None:
    img = Image.new("RGB", (WORK, WORK), (110, 105, 98))
    draw = ImageDraw.Draw(img)
    rng = random.Random(19)
    for _ in range(900):
        x, y = rng.randint(0, WORK - 1), rng.randint(0, WORK - 1)
        r = rng.randint(4, 28)
        s = rng.randint(70, 150)
        draw.ellipse([x - r, y - r // 2, x + r, y + r // 2], fill=(s, s - 4, s - 10))
    img = _noise(img, 28, 19)
    _up(img.filter(ImageFilter.DETAIL)).save(path, quality=88, optimize=True)


def cactus(path: Path) -> None:
    img = Image.new("RGB", (WORK, WORK), (52, 110, 48))
    draw = ImageDraw.Draw(img)
    rng = random.Random(23)
    for i in range(48):
        y = int(i * WORK / 48)
        c = 40 + (i % 7) * 8
        draw.line([(0, y), (WORK, y)], fill=(c, c + 40, c), width=2)
    for _ in range(900):
        x, y = rng.randint(0, WORK - 1), rng.randint(0, WORK - 1)
        draw.point((x, y), fill=(200, 210, 160))
    _up(_noise(img, 12, 23)).save(path, quality=88, optimize=True)


def skin(path: Path) -> None:
    img = Image.new("RGB", (WORK, WORK), (198, 152, 122))
    ImageEnhance.Color(_up(_noise(img, 10, 31))).enhance(1.05).save(path, quality=88, optimize=True)


def cloth(path: Path) -> None:
    img = Image.new("RGB", (WORK, WORK), (48, 72, 140))
    draw = ImageDraw.Draw(img)
    rng = random.Random(37)
    for y in range(0, WORK, 4):
        shade = 40 + (y // 4) % 3 * 12
        draw.line([(0, y), (WORK, y)], fill=(shade, shade + 20, shade + 90), width=2)
    for _ in range(250):
        x, y = rng.randint(0, WORK - 1), rng.randint(0, WORK - 1)
        draw.ellipse([x - 1, y - 1, x + 1, y + 1], fill=(220, 60, 50))
    _up(_noise(img, 8, 37)).save(path, quality=88, optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Prefer real Poly Haven bark when present (CC0).
    bark_src = Path("/tmp/hd-tex/bark_brown_02_diff_2k.jpg")
    if bark_src.is_file():
        Image.open(bark_src).convert("RGB").resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(
            OUT / "bark_diff.jpg", quality=88, optimize=True
        )
    else:
        bark(OUT / "bark_diff.jpg")
    leaves(OUT / "leaf_diff.jpg")
    rock(OUT / "rock_diff.jpg")
    cactus(OUT / "cactus_diff.jpg")
    skin(OUT / "skin_diff.jpg")
    cloth(OUT / "cloth_diff.jpg")
    print(f"wrote HD textures → {OUT}")
    for p in sorted(OUT.glob("*.jpg")):
        print(f"  {p.name:16s} {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
