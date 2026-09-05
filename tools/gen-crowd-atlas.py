#!/usr/bin/env python3
"""
gen-crowd-atlas.py — photoreal-leaning skin / clothing / face atlas for bipeds.

Writes assets/props/Textures/hd/crowd_atlas.png and copies to
assets/props/Textures/colormap.png so CrowdField + UV paths stay in sync.

Layout (2048², v grows down in image space — Blender/GLTF flipY=false uses
same panel rects as tools/build-crowd-humans.py):
  Row 0 (y 0–512):     4 skin tones (blended from skin_diff.jpg when present)
  Row 1–2 (512–1024):  8 shirt / jacket fabrics (cloth_diff.jpg tint)
  Row 3–4 (1024–1536): 8 pants / jeans
  Row 5 (1536–1792):   hair (4) + shoes + accent
  Row 6 (1792–2048):   face panels (skin0–3 with painted human faces)
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT_HD = ROOT / "assets" / "props" / "Textures" / "hd"
OUT_COL = ROOT / "assets" / "props" / "Textures" / "colormap.png"
SKIN_SRC = OUT_HD / "skin_diff.jpg"
CLOTH_SRC = OUT_HD / "cloth_diff.jpg"
SIZE = 2048
CELL = 512
HALF = 256


def clamp_rgb(r, g, b):
    return (
        max(0, min(255, int(r))),
        max(0, min(255, int(g))),
        max(0, min(255, int(b))),
    )


def load_albedo(path: Path, size: tuple[int, int]) -> Image.Image | None:
    if not path.is_file():
        return None
    img = Image.open(path).convert("RGB")
    return ImageOps.fit(img, size, Image.Resampling.LANCZOS)


def tint_map(base: Image.Image, color, amount: float = 0.55) -> Image.Image:
    """Multiply-tint an albedo toward a target color while keeping detail."""
    px = base.load()
    w, h = base.size
    tr, tg, tb = color
    out = Image.new("RGB", base.size)
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            # Preserve micro-contrast from source, shift hue toward target.
            nr = r * (1.0 - amount) + tr * lum * amount * 1.35
            ng = g * (1.0 - amount) + tg * lum * amount * 1.35
            nb = b * (1.0 - amount) + tb * lum * amount * 1.35
            op[x, y] = clamp_rgb(nr, ng, nb)
    return out


def fill_noise(img: Image.Image, base, amount: float, seed: int) -> None:
    rng = random.Random(seed)
    px = img.load()
    w, h = img.size
    br, bg, bb = base
    for y in range(h):
        for x in range(w):
            n = rng.uniform(-amount, amount)
            blot = math.sin(x * 0.045 + seed) * math.cos(y * 0.038 + seed * 0.3) * amount * 0.55
            px[x, y] = clamp_rgb(br + n + blot, bg + n * 0.85 + blot * 0.7, bb + n * 0.7 + blot * 0.5)


def fabric_weave(tile: Image.Image, color, seed: int) -> None:
    rng = random.Random(seed)
    draw = ImageDraw.Draw(tile)
    w, h = tile.size
    for y in range(0, h, 2):
        shade = clamp_rgb(color[0] - 10, color[1] - 9, color[2] - 8)
        draw.line([(0, y), (w, y)], fill=shade, width=1)
    for x in range(0, w, 4):
        shade = clamp_rgb(color[0] - 6, color[1] - 5, color[2] - 4)
        draw.line([(x, 0), (x, h)], fill=shade, width=1)
    for _ in range(5):
        cx, cy = rng.randint(20, w - 20), rng.randint(20, h - 20)
        r = rng.randint(8, 18)
        blot = clamp_rgb(color[0] + 18, color[1] + 14, color[2] + 10)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=blot)


def panel(img: Image.Image, box, color, seed: int, fabric: bool = False, skin: bool = False,
          albedo: Image.Image | None = None) -> None:
    x0, y0, x1, y1 = box
    tw, th = x1 - x0, y1 - y0
    if albedo is not None:
        tile = tint_map(ImageOps.fit(albedo, (tw, th), Image.Resampling.LANCZOS), color,
                        0.42 if skin else 0.62)
    else:
        tile = Image.new("RGB", (tw, th), color)
        fill_noise(tile, color, 14 if skin else (18 if fabric else 9), seed)
        if fabric:
            fabric_weave(tile, color, seed + 3)
    if skin:
        px = tile.load()
        for y in range(th):
            t = y / max(1, th - 1)
            lift = (0.5 - t) * 22
            cool = t * 8
            for x in range(tw):
                r, g, b = px[x, y]
                px[x, y] = clamp_rgb(r + lift, g + lift * 0.9, b + lift * 0.75 - cool)
    tile = tile.filter(ImageFilter.GaussianBlur(0.45 if skin else 0.35))
    img.paste(tile, (x0, y0))


def paint_face(tile: Image.Image, skin, seed: int) -> None:
    """Readable human face — eyes, brows, nose bridge, lips, soft shading."""
    rng = random.Random(seed)
    draw = ImageDraw.Draw(tile)
    w, h = tile.size

    # Forehead highlight / jaw cool
    overlay = Image.new("RGBA", tile.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    warm = (*clamp_rgb(skin[0] + 28, skin[1] + 8, skin[2] - 2), 55)
    od.ellipse([int(w * 0.08), int(h * 0.38), int(w * 0.42), int(h * 0.78)], fill=warm)
    od.ellipse([int(w * 0.58), int(h * 0.38), int(w * 0.92), int(h * 0.78)], fill=warm)
    cool = (*clamp_rgb(skin[0] - 20, skin[1] - 18, skin[2] - 8), 40)
    od.ellipse([int(w * 0.28), int(h * 0.72), int(w * 0.72), int(h * 0.98)], fill=cool)
    tile_rgba = Image.alpha_composite(tile.convert("RGBA"), overlay).convert("RGB")
    tile.paste(tile_rgba)

    draw = ImageDraw.Draw(tile)
    eye_y = int(h * 0.40)
    eye_w, eye_h = int(w * 0.10), int(h * 0.085)
    lx, rx = int(w * 0.32), int(w * 0.68)
    white = (248, 246, 242)
    iris_opts = [(55, 95, 125), (72, 112, 72), (98, 68, 42), (48, 48, 52)]
    iris = iris_opts[seed % 4]
    pupil = (16, 14, 12)
    brow = clamp_rgb(skin[0] * 0.4, skin[1] * 0.35, skin[2] * 0.3)

    for cx in (lx, rx):
        # Soft lid crease
        draw.arc([cx - eye_w - 2, eye_y - eye_h - 6, cx + eye_w + 2, eye_y + eye_h],
                 start=200, end=340, fill=clamp_rgb(skin[0] - 30, skin[1] - 35, skin[2] - 28), width=2)
        draw.ellipse([cx - eye_w, eye_y - eye_h, cx + eye_w, eye_y + eye_h], fill=white,
                     outline=clamp_rgb(skin[0] - 40, skin[1] - 45, skin[2] - 40))
        draw.ellipse([cx - eye_w // 2, eye_y - eye_h // 2, cx + eye_w // 2, eye_y + eye_h // 2], fill=iris)
        draw.ellipse([cx - eye_w // 4, eye_y - eye_h // 4, cx + eye_w // 4, eye_y + eye_h // 4], fill=pupil)
        # Spec highlight
        draw.ellipse([cx - eye_w // 5, eye_y - eye_h // 3, cx - eye_w // 10, eye_y - eye_h // 6],
                     fill=(235, 235, 240))
        draw.arc([cx - eye_w - 6, eye_y - eye_h - 14, cx + eye_w + 6, eye_y + 2],
                 start=200, end=340, fill=brow, width=3)

    # Nose
    nose = clamp_rgb(skin[0] - 22, skin[1] - 26, skin[2] - 24)
    nx, ny = int(w * 0.5), int(h * 0.54)
    draw.polygon([(nx, ny - 16), (nx - 7, ny + 10), (nx + 7, ny + 10)], fill=nose)
    draw.ellipse([nx - 8, ny + 6, nx - 2, ny + 12], fill=clamp_rgb(skin[0] - 35, skin[1] - 40, skin[2] - 30))
    draw.ellipse([nx + 2, ny + 6, nx + 8, ny + 12], fill=clamp_rgb(skin[0] - 35, skin[1] - 40, skin[2] - 30))

    # Mouth
    lip = clamp_rgb(skin[0] * 0.7 + 48, skin[1] * 0.42 + 22, skin[2] * 0.42 + 28)
    my = int(h * 0.74)
    draw.ellipse([int(w * 0.38), my - 3, int(w * 0.62), my + 8], fill=lip)
    draw.arc([int(w * 0.38), my - 2, int(w * 0.62), my + 10], start=10, end=170,
             fill=clamp_rgb(lip[0] - 25, lip[1] - 20, lip[2] - 15), width=2)

    # Soft vignette
    vignette = Image.new("RGBA", tile.size, (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    vd.ellipse([6, 2, w - 6, h - 2], outline=(0, 0, 0, 36), width=10)
    tile.paste(Image.alpha_composite(tile.convert("RGBA"), vignette).convert("RGB"))


def main() -> None:
    OUT_HD.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (SIZE, SIZE), (36, 36, 40))
    skin_alb = load_albedo(SKIN_SRC, (CELL, CELL))
    cloth_alb = load_albedo(CLOTH_SRC, (CELL, HALF))

    skins = [
        (238, 198, 172),
        (214, 162, 128),
        (160, 112, 84),
        (88, 56, 40),
    ]
    for i, c in enumerate(skins):
        panel(img, (i * CELL, 0, i * CELL + CELL, CELL), c, 10 + i, skin=True, albedo=skin_alb)

    shirts = [
        (52, 78, 148),
        (168, 44, 48),
        (40, 118, 78),
        (228, 228, 232),
        (32, 32, 36),
        (196, 118, 42),
        (96, 56, 128),
        (44, 96, 118),
    ]
    for i, c in enumerate(shirts):
        x = (i % 4) * CELL
        y = CELL + (i // 4) * HALF
        panel(img, (x, y, x + CELL, y + HALF), c, 40 + i, fabric=True, albedo=cloth_alb)
        draw = ImageDraw.Draw(img)
        stripe = clamp_rgb(c[0] * 0.65, c[1] * 0.65, c[2] * 0.65)
        draw.rectangle([x + 12, y + 10, x + CELL - 12, y + 28], fill=stripe)

    pants = [
        (48, 56, 86),
        (58, 58, 62),
        (78, 64, 48),
        (34, 62, 98),
        (96, 96, 94),
        (52, 40, 34),
        (40, 78, 62),
        (86, 42, 44),
    ]
    for i, c in enumerate(pants):
        x = (i % 4) * CELL
        y = CELL * 2 + (i // 4) * HALF
        panel(img, (x, y, x + CELL, y + HALF), c, 80 + i, fabric=True, albedo=cloth_alb)

    hairs = [
        (32, 24, 18),
        (96, 64, 34),
        (188, 168, 128),
        (14, 14, 16),
    ]
    hair_y0 = CELL * 3
    hair_y1 = hair_y0 + HALF
    for i, c in enumerate(hairs):
        panel(img, (i * HALF, hair_y0, i * HALF + HALF, hair_y1), c, 120 + i)
        draw = ImageDraw.Draw(img)
        for k in range(8):
            xx = i * HALF + 20 + k * 28
            shade = clamp_rgb(c[0] + 22, c[1] + 18, c[2] + 14)
            draw.line([(xx, hair_y0 + 12), (xx + 6, hair_y1 - 12)], fill=shade, width=3)

    panel(img, (CELL * 2, hair_y0, CELL * 3, hair_y1), (34, 30, 28), 140, fabric=True, albedo=cloth_alb)
    panel(img, (CELL * 3, hair_y0, CELL * 4, hair_y1), (210, 210, 214), 141)

    face_y0 = SIZE - HALF
    for i, skin in enumerate(skins):
        face = Image.new("RGB", (CELL, HALF), skin)
        if skin_alb is not None:
            face = tint_map(ImageOps.fit(skin_alb, (CELL, HALF), Image.Resampling.LANCZOS), skin, 0.5)
        else:
            fill_noise(face, skin, 6, 200 + i)
        paint_face(face, skin, 210 + i)
        face = face.filter(ImageFilter.GaussianBlur(0.4))
        img.paste(face, (i * CELL, face_y0))

    img = ImageEnhance.Contrast(img).enhance(1.08)
    img = ImageEnhance.Color(img).enhance(1.05)
    # Downsample display copy stays 2048 — CrowdField samples linearly.
    path = OUT_HD / "crowd_atlas.png"
    img.save(path, optimize=True)
    # Runtime colormap also 2048 for sharper close cams.
    img.save(OUT_COL, optimize=True)
    print("wrote", path, img.size)
    print("wrote", OUT_COL)


if __name__ == "__main__":
    main()
