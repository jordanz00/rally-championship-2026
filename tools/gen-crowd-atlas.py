#!/usr/bin/env python3
"""
gen-crowd-atlas.py — skin / clothing / face atlas for trackside biped humans.

Writes assets/props/Textures/hd/crowd_atlas.png and copies to
assets/props/Textures/colormap.png so CrowdField + UV paths stay in sync.

Layout (1024², v grows down in image space — Blender/GLTF flipY=false uses
same panel rects as tools/build-crowd-humans.py):
  Row 0 (y 0–256):   4 skin tones
  Row 1–2 (256–512): 8 shirt / jacket fabrics
  Row 3–4 (512–768): 8 pants / jeans
  Row 5 (768–896):   hair (4) + shoes + accent
  Row 6 (896–1024):  face panels (skin0–3 with eyes / brows / lips)
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


def clamp_rgb(r, g, b):
    return (
        max(0, min(255, int(r))),
        max(0, min(255, int(g))),
        max(0, min(255, int(b))),
    )


def fill_noise(img: Image.Image, base, amount: float, seed: int) -> None:
    rng = random.Random(seed)
    px = img.load()
    w, h = img.size
    br, bg, bb = base
    for y in range(h):
        for x in range(w):
            n = rng.uniform(-amount, amount)
            # Soft low-frequency blotches (skin pores / dye variance).
            blot = math.sin(x * 0.07 + seed) * math.cos(y * 0.05 + seed * 0.3) * amount * 0.45
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
    # Occasional stitch / logo blot
    for _ in range(3):
        cx, cy = rng.randint(20, w - 20), rng.randint(20, h - 20)
        r = rng.randint(6, 14)
        blot = clamp_rgb(color[0] + 18, color[1] + 14, color[2] + 10)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=blot)


def panel(img: Image.Image, box, color, seed: int, fabric: bool = False, skin: bool = False) -> None:
    x0, y0, x1, y1 = box
    tile = Image.new("RGB", (x1 - x0, y1 - y0), color)
    fill_noise(tile, color, 11 if skin else (16 if fabric else 9), seed)
    if fabric:
        fabric_weave(tile, color, seed + 3)
    if skin:
        # Soft vertical lighting — forehead lighter, jaw slightly cooler.
        px = tile.load()
        tw, th = tile.size
        for y in range(th):
            t = y / max(1, th - 1)
            lift = (0.5 - t) * 18
            cool = t * 6
            for x in range(tw):
                r, g, b = px[x, y]
                px[x, y] = clamp_rgb(r + lift, g + lift * 0.9, b + lift * 0.75 - cool)
    tile = tile.filter(ImageFilter.GaussianBlur(0.55 if skin else 0.4))
    img.paste(tile, (x0, y0))


def paint_face(tile: Image.Image, skin, seed: int) -> None:
    """Simple but readable human face — eyes, brows, nose, mouth (not emoji dots)."""
    rng = random.Random(seed)
    draw = ImageDraw.Draw(tile)
    w, h = tile.size
    # Cheek warmth
    warm = clamp_rgb(skin[0] + 22, skin[1] + 4, skin[2] - 4)
    draw.ellipse([int(w * 0.12), int(h * 0.42), int(w * 0.38), int(h * 0.72)], fill=warm)
    draw.ellipse([int(w * 0.62), int(h * 0.42), int(w * 0.88), int(h * 0.72)], fill=warm)

    eye_y = int(h * 0.38)
    eye_w, eye_h = int(w * 0.11), int(h * 0.09)
    lx = int(w * 0.30)
    rx = int(w * 0.70)
    white = (245, 242, 238)
    iris = [(55, 90, 120), (70, 110, 70), (90, 60, 40), (40, 40, 45)][seed % 4]
    pupil = (18, 16, 14)
    for cx in (lx, rx):
        draw.ellipse([cx - eye_w, eye_y - eye_h, cx + eye_w, eye_y + eye_h], fill=white)
        draw.ellipse(
            [cx - eye_w // 2, eye_y - eye_h // 2, cx + eye_w // 2, eye_y + eye_h // 2],
            fill=iris,
        )
        draw.ellipse(
            [cx - eye_w // 4, eye_y - eye_h // 4, cx + eye_w // 4, eye_y + eye_h // 4],
            fill=pupil,
        )
        # Soft brow
        brow = clamp_rgb(skin[0] * 0.45, skin[1] * 0.4, skin[2] * 0.35)
        draw.arc(
            [cx - eye_w - 4, eye_y - eye_h - 10, cx + eye_w + 4, eye_y + 2],
            start=200,
            end=340,
            fill=brow,
            width=2,
        )

    # Nose bridge / tip
    nose = clamp_rgb(skin[0] - 18, skin[1] - 22, skin[2] - 20)
    nx, ny = int(w * 0.5), int(h * 0.52)
    draw.polygon(
        [(nx, ny - 10), (nx - 6, ny + 8), (nx + 6, ny + 8)],
        fill=nose,
    )

    # Mouth
    lip = clamp_rgb(skin[0] * 0.75 + 40, skin[1] * 0.45 + 20, skin[2] * 0.45 + 25)
    my = int(h * 0.72)
    draw.arc([int(w * 0.38), my - 4, int(w * 0.62), my + 10], start=20, end=160, fill=lip, width=2)

    # Soft vignette so the face panel reads when wrapped on a head
    overlay = Image.new("RGBA", tile.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([8, 4, w - 8, h - 4], outline=(0, 0, 0, 28), width=6)
    tile_rgba = tile.convert("RGBA")
    tile_rgba = Image.alpha_composite(tile_rgba, overlay)
    tile.paste(tile_rgba.convert("RGB"))


def main() -> None:
    OUT_HD.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (SIZE, SIZE), (36, 36, 40))

    skins = [
        (238, 198, 172),  # fair
        (214, 162, 128),  # light-medium
        (160, 112, 84),   # medium-deep
        (88, 56, 40),     # deep
    ]
    for i, c in enumerate(skins):
        panel(img, (i * 256, 0, i * 256 + 256, 256), c, 10 + i, skin=True)

    shirts = [
        (52, 78, 148),   # rally blue
        (168, 44, 48),   # team red
        (40, 118, 78),   # forest green
        (228, 228, 232), # white tee
        (32, 32, 36),    # black
        (196, 118, 42),  # orange
        (96, 56, 128),   # purple
        (44, 96, 118),   # teal
    ]
    for i, c in enumerate(shirts):
        x = (i % 4) * 256
        y = 256 + (i // 4) * 128
        panel(img, (x, y, x + 256, y + 128), c, 40 + i, fabric=True)
        # Collar / hem stripe
        draw = ImageDraw.Draw(img)
        stripe = clamp_rgb(c[0] * 0.65, c[1] * 0.65, c[2] * 0.65)
        draw.rectangle([x + 8, y + 8, x + 248, y + 22], fill=stripe)

    pants = [
        (48, 56, 86),    # jeans blue
        (58, 58, 62),    # charcoal
        (78, 64, 48),    # khaki
        (34, 62, 98),    # deep denim
        (96, 96, 94),    # grey
        (52, 40, 34),    # brown
        (40, 78, 62),    # olive
        (86, 42, 44),    # maroon
    ]
    for i, c in enumerate(pants):
        x = (i % 4) * 256
        y = 512 + (i // 4) * 128
        panel(img, (x, y, x + 256, y + 128), c, 80 + i, fabric=True)

    hairs = [
        (32, 24, 18),
        (96, 64, 34),
        (188, 168, 128),
        (14, 14, 16),
    ]
    for i, c in enumerate(hairs):
        panel(img, (i * 128, 768, i * 128 + 128, 896), c, 120 + i)
        # Strand suggestion
        draw = ImageDraw.Draw(img)
        for k in range(6):
            xx = i * 128 + 16 + k * 16
            shade = clamp_rgb(c[0] + 20, c[1] + 16, c[2] + 12)
            draw.line([(xx, 776), (xx + 4, 888)], fill=shade, width=2)

    panel(img, (512, 768, 768, 896), (34, 30, 28), 140, fabric=True)  # shoes
    panel(img, (768, 768, 1024, 896), (210, 210, 214), 141)  # light accent / hat

    # Four face panels matching skin tones — head UVs sample these.
    for i, skin in enumerate(skins):
        face = Image.new("RGB", (256, 128), skin)
        fill_noise(face, skin, 5, 200 + i)
        paint_face(face, skin, 210 + i)
        face = face.filter(ImageFilter.GaussianBlur(0.35))
        img.paste(face, (i * 256, 896))

    img = ImageEnhance.Contrast(img).enhance(1.06)
    img = ImageEnhance.Color(img).enhance(1.04)
    path = OUT_HD / "crowd_atlas.png"
    img.save(path, optimize=True)
    img.save(OUT_COL, optimize=True)
    print("wrote", path)
    print("wrote", OUT_COL)


if __name__ == "__main__":
    main()
