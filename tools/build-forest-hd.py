"""
build-forest-hd.py — high-detail Forest trees & bushes for the rally browser build.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build-forest-hd.py

WHO THIS IS FOR: Forest Stage 2 scenery (trees + undergrowth).
WHAT IT DOES: replaces cone/sphere stand-ins with denser, species-varied GLBs
  that keep bark vs canopy mesh names so the runtime can paint vertex colours
  and map leaf/bark albedo. Writes the same filenames Track / prop-kit expect,
  plus extra bush variants.
"""

from __future__ import annotations

import math
import random
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
PROPS = ROOT / "assets" / "props"
TEX = PROPS / "Textures" / "hd"
BACKUP = PROPS / "_lowpoly_backup"


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        bpy.data.images.remove(block)
    for block in list(bpy.data.textures):
        bpy.data.textures.remove(block)


def mat_textured(name: str, tex_path: Path, roughness: float = 0.75):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    tex = nodes.new("ShaderNodeTexImage")
    if tex_path.is_file():
        tex.image = bpy.data.images.load(str(tex_path))
    bsdf.inputs["Roughness"].default_value = roughness
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def smart_uv(obj) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def shade_smooth(obj) -> None:
    for p in obj.data.polygons:
        p.use_smooth = True


def displace(obj, strength: float, tex_type: str = "CLOUDS", name: str = "Disp") -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_add(type="DISPLACE")
    tex = bpy.data.textures.new(f"{name}_{obj.name}", type=tex_type)
    if tex_type == "CLOUDS" and hasattr(tex, "noise_scale"):
        tex.noise_scale = 0.55
    obj.modifiers["Displace"].texture = tex
    obj.modifiers["Displace"].strength = strength
    bpy.ops.object.modifier_apply(modifier="Displace")


def subdivide(obj, levels: int = 1) -> None:
    if levels <= 0:
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_add(type="SUBSURF")
    obj.modifiers["Subdivision"].levels = levels
    obj.modifiers["Subdivision"].render_levels = levels
    bpy.ops.object.modifier_apply(modifier="Subdivision")


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_colors=False,
        export_cameras=False,
        export_lights=False,
    )
    print("  wrote", path.name, flush=True)


def backup(name: str) -> None:
    src = PROPS / name
    if src.is_file():
        BACKUP.mkdir(parents=True, exist_ok=True)
        bak = BACKUP / name
        if not bak.is_file():
            shutil.copy2(src, bak)


def add_trunk(bark_m, height: float, r_bot: float, r_top: float, verts: int = 28, name: str = "Trunk"):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts,
        radius1=r_bot,
        radius2=r_top,
        depth=height,
        location=(0, 0, height * 0.5),
    )
    trunk = bpy.context.active_object
    trunk.name = name
    trunk.data.materials.append(bark_m)
    smart_uv(trunk)
    shade_smooth(trunk)
    displace(trunk, 0.035, "CLOUDS", "BarkDisp")
    return trunk


def add_branch(bark_m, length: float, r0: float, loc, rot, name: str):
    bpy.ops.mesh.primitive_cone_add(
        vertices=12,
        radius1=r0,
        radius2=r0 * 0.35,
        depth=length,
        location=loc,
    )
    br = bpy.context.active_object
    br.name = name
    br.rotation_euler = rot
    bpy.ops.object.transform_apply(rotation=True)
    br.data.materials.append(bark_m)
    smart_uv(br)
    shade_smooth(br)
    return br


def canopy_lobe(leaf_m, radius: float, loc, scale, name: str, subdiv: int = 2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=loc)
    lobe = bpy.context.active_object
    lobe.name = name
    lobe.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    displace(lobe, 0.12 + radius * 0.04, "CLOUDS", "LeafDisp")
    lobe.data.materials.append(leaf_m)
    smart_uv(lobe)
    shade_smooth(lobe)
    return lobe


def make_pine(name: str, seed: int, levels: int = 8, lean: float = 0.0) -> None:
    """Irregular conifer — staggered whorls, not a perfect Christmas tree."""
    clear_scene()
    rng = random.Random(seed)
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.9)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.72)
    h = 7.2 + rng.uniform(-0.4, 0.8)
    add_trunk(bark_m, h * 0.92, 0.22 + rng.uniform(0, 0.06), 0.06, 32)
    for i in range(levels):
        t = i / max(1, levels - 1)
        # Lower whorls wider; tip tight. Slight spiral so silhouettes differ.
        base_r = (1.85 - t * 1.45) * (0.92 + rng.uniform(0, 0.16))
        zh = 1.15 + t * (h * 0.78) + rng.uniform(-0.08, 0.1)
        yaw = t * 2.4 + seed * 0.17
        for arm in range(3):
            ang = yaw + arm * (2 * math.pi / 3) + rng.uniform(-0.25, 0.25)
            r = base_r * (0.72 + rng.uniform(0, 0.35))
            lobe_h = 0.55 + (1.0 - t) * 0.55 + rng.uniform(0, 0.15)
            ox = math.cos(ang) * r * 0.22
            oy = math.sin(ang) * r * 0.22
            bpy.ops.mesh.primitive_cone_add(
                vertices=22,
                radius1=r,
                radius2=0.04,
                depth=lobe_h,
                location=(ox, oy, zh + lean * ox * 0.02),
            )
            cone = bpy.context.active_object
            cone.name = f"Canopy_{i}_{arm}"
            cone.rotation_euler = (rng.uniform(-0.12, 0.12), rng.uniform(-0.08, 0.08), ang)
            bpy.ops.object.transform_apply(rotation=True)
            subdivide(cone, 1)
            displace(cone, 0.07, "CLOUDS", f"Pine_{i}_{arm}")
            cone.data.materials.append(leaf_m)
            smart_uv(cone)
            shade_smooth(cone)
    export_glb(PROPS / name)


def make_cedar(name: str, seed: int) -> None:
    """Columnar cedar — flatter layered shelves."""
    clear_scene()
    rng = random.Random(seed)
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.9)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.7)
    h = 9.0
    add_trunk(bark_m, h * 0.88, 0.2, 0.05, 30)
    for i in range(10):
        t = i / 9
        zh = 1.0 + t * 7.2
        r = 0.55 + math.sin(t * math.pi) * 1.15
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=28, radius=r, depth=0.42 + (1 - t) * 0.25, location=(0, 0, zh)
        )
        shelf = bpy.context.active_object
        shelf.name = f"Canopy_{i}"
        shelf.scale = (1.0 + rng.uniform(-0.08, 0.1), 1.0 + rng.uniform(-0.08, 0.1), 0.55)
        bpy.ops.object.transform_apply(scale=True)
        displace(shelf, 0.09, "CLOUDS", f"Cedar_{i}")
        shelf.data.materials.append(leaf_m)
        smart_uv(shelf)
        shade_smooth(shelf)
    export_glb(PROPS / name)


def make_oak(name: str, seed: int, gold: bool = False) -> None:
    """Broadleaf with forked trunk and irregular canopy clumps."""
    clear_scene()
    rng = random.Random(seed)
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.88)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.68)
    add_trunk(bark_m, 3.6, 0.32, 0.16, 30)
    # Primary forks
    for i, (ang, elev) in enumerate(((0.4, 0.55), (2.2, 0.5), (4.0, 0.62), (5.2, 0.48))):
        length = 1.6 + rng.uniform(0, 0.5)
        loc = (
            math.cos(ang) * 0.25,
            math.sin(ang) * 0.25,
            3.1 + elev * 0.4,
        )
        add_branch(
            bark_m,
            length,
            0.1,
            loc,
            (elev, 0, ang),
            f"Trunk_fork_{i}",
        )
    # Canopy lobes — more than before, uneven radii
    n = 11 if not gold else 10
    for i in range(n):
        ang = i * (2 * math.pi / n) + rng.uniform(-0.2, 0.2)
        rad = 0.85 + rng.uniform(0, 0.55)
        dist = 0.35 + rng.uniform(0, 0.7)
        loc = (
            math.cos(ang) * dist,
            math.sin(ang) * dist,
            4.0 + rng.uniform(-0.35, 0.85),
        )
        scale = (
            1.05 + rng.uniform(0, 0.25),
            0.95 + rng.uniform(0, 0.2),
            0.75 + rng.uniform(0, 0.2),
        )
        canopy_lobe(leaf_m, rad, loc, scale, f"Canopy_{i}", subdiv=3)
    # Crown fill
    canopy_lobe(leaf_m, 1.15, (0, 0, 5.1), (1.2, 1.15, 0.9), "Canopy_top", subdiv=3)
    export_glb(PROPS / name)


def make_fir(name: str, seed: int) -> None:
    """Dense Alpine fir — tighter, darker silhouette for Forest variety."""
    clear_scene()
    rng = random.Random(seed)
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.9)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.74)
    h = 8.4
    add_trunk(bark_m, h * 0.9, 0.18, 0.045, 28)
    for i in range(14):
        t = i / 13
        zh = 0.95 + t * 7.0
        r = (1.55 - t * 1.35) * (0.95 + rng.uniform(0, 0.1))
        bpy.ops.mesh.primitive_cone_add(
            vertices=24, radius1=r, radius2=0.03, depth=0.7 + (1 - t) * 0.35, location=(0, 0, zh)
        )
        cone = bpy.context.active_object
        cone.name = f"Canopy_{i}"
        cone.rotation_euler = (0, 0, t * 0.9 + seed)
        bpy.ops.object.transform_apply(rotation=True)
        subdivide(cone, 1)
        displace(cone, 0.055, "CLOUDS", f"Fir_{i}")
        cone.data.materials.append(leaf_m)
        smart_uv(cone)
        shade_smooth(cone)
    export_glb(PROPS / name)


def make_bush(name: str, seed: int, style: str = "round") -> None:
    """Realistic undergrowth — multi-lobe clumps, not one ico-sphere."""
    clear_scene()
    rng = random.Random(seed)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.7)
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.92)
    if style == "large":
        clumps = 7
        base = 0.55
    elif style == "dense":
        clumps = 9
        base = 0.42
    elif style == "fern":
        clumps = 5
        base = 0.35
    else:
        clumps = 6
        base = 0.48

    # Tiny woody stems for large / dense bushes
    if style in ("large", "dense"):
        for i in range(3):
            ang = i * 2.1
            bpy.ops.mesh.primitive_cylinder_add(
                vertices=10,
                radius=0.04,
                depth=0.35,
                location=(math.cos(ang) * 0.12, math.sin(ang) * 0.12, 0.18),
            )
            stem = bpy.context.active_object
            stem.name = f"Trunk_stem_{i}"
            stem.data.materials.append(bark_m)
            smart_uv(stem)

    for i in range(clumps):
        ang = i * (2 * math.pi / clumps) + rng.uniform(-0.3, 0.3)
        dist = (0.15 + rng.uniform(0, 0.35)) * (1.35 if style == "large" else 1.0)
        r = base * (0.75 + rng.uniform(0, 0.55))
        z = r * (0.55 + rng.uniform(0, 0.35))
        if style == "fern":
            # Flattened / elongated frond-like lobes
            scale = (1.4, 0.55, 0.9 + rng.uniform(0, 0.3))
            z = 0.25 + rng.uniform(0, 0.2)
        else:
            scale = (
                1.0 + rng.uniform(0, 0.35),
                0.9 + rng.uniform(0, 0.3),
                0.7 + rng.uniform(0, 0.25),
            )
        canopy_lobe(
            leaf_m,
            r,
            (math.cos(ang) * dist, math.sin(ang) * dist, z),
            scale,
            f"Canopy_{i}",
            subdiv=3 if style != "fern" else 2,
        )
    export_glb(PROPS / name)


def make_cone_tree(name: str, seed: int) -> None:
    """Compact roadside spruce used as desert/generic fallback."""
    clear_scene()
    rng = random.Random(seed)
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.9)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.72)
    add_trunk(bark_m, 2.6, 0.14, 0.05, 24)
    for i in range(5):
        t = i / 4
        zh = 1.3 + t * 3.2
        r = 1.5 * (1.0 - t * 0.75)
        bpy.ops.mesh.primitive_cone_add(
            vertices=26, radius1=r, radius2=0.04, depth=1.1, location=(0, 0, zh)
        )
        cone = bpy.context.active_object
        cone.name = f"Canopy_{i}"
        subdivide(cone, 1)
        displace(cone, 0.06, "CLOUDS", f"Cone_{i}")
        cone.data.materials.append(leaf_m)
        smart_uv(cone)
        shade_smooth(cone)
    export_glb(PROPS / name)


def main() -> None:
    if not TEX.is_dir():
        print("ERROR: missing HD textures — run tools/gen-hd-textures.py first", file=sys.stderr)
        sys.exit(1)

    targets = [
        "tree_pineDefaultA.glb",
        "tree_pineDefaultB.glb",
        "tree_oak.glb",
        "tree_detailed.glb",
        "tree_default.glb",
        "tree_cone.glb",
        "tree_fir.glb",
        "plant_bushDetailed.glb",
        "plant_bushLarge.glb",
        "plant_bushDense.glb",
        "plant_bushRound.glb",
        "plant_bushFern.glb",
    ]
    for t in targets:
        backup(t)

    print("Building Forest HD trees…", flush=True)
    make_pine("tree_pineDefaultA.glb", seed=11, levels=9)
    make_cedar("tree_pineDefaultB.glb", seed=41)
    make_oak("tree_oak.glb", seed=7)
    make_oak("tree_detailed.glb", seed=19)
    make_oak("tree_default.glb", seed=53, gold=True)
    make_fir("tree_fir.glb", seed=67)
    make_cone_tree("tree_cone.glb", seed=3)

    print("Building Forest HD bushes…", flush=True)
    make_bush("plant_bushDetailed.glb", seed=101, style="round")
    make_bush("plant_bushLarge.glb", seed=131, style="large")
    make_bush("plant_bushDense.glb", seed=163, style="dense")
    make_bush("plant_bushRound.glb", seed=191, style="round")
    make_bush("plant_bushFern.glb", seed=211, style="fern")

    print("Forest HD complete →", PROPS, flush=True)


if __name__ == "__main__":
    main()
