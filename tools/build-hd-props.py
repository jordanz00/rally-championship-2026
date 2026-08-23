"""
build-hd-props.py — replace Kenney low-poly nature/crowd stand-ins with dense GLBs.

Run: Blender --background --python tools/build-hd-props.py

WHO THIS IS FOR: scenery pipeline (trees, rocks, bushes, cacti, animals, characters).
WHAT IT DOES: backs up tiny Kenney GLBs, builds denser meshes with 2K albedo maps,
  subdivides spectator characters, exports same filenames under assets/props/.
"""

from __future__ import annotations

import math
import os
import random
import shutil
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
PROPS = ROOT / "assets" / "props"
TEX = PROPS / "Textures" / "hd"
BACKUP = PROPS / "_lowpoly_backup"


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)
    for block in bpy.data.images:
        bpy.data.images.remove(block)


def mat_textured(name: str, tex_path: Path, roughness: float = 0.75, metal: float = 0.0):
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
        bsdf.inputs["Metallic"].default_value = metal
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
    mesh = obj.data
    for p in mesh.polygons:
        p.use_smooth = True


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


def make_pine(name: str, levels: int = 6) -> None:
    clear_scene()
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.85)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.7)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.18, depth=5.2, location=(0, 0, 2.6))
    trunk = bpy.context.active_object
    trunk.name = "Trunk"
    trunk.data.materials.append(bark_m)
    smart_uv(trunk)
    shade_smooth(trunk)
    for i in range(levels):
        t = i / max(1, levels - 1)
        r = 1.55 * (1.0 - t * 0.82)
        h = 1.35 * (1.0 - t * 0.35)
        z = 1.2 + t * 4.2
        bpy.ops.mesh.primitive_cone_add(vertices=28, radius1=r, radius2=0.05, depth=h, location=(0, 0, z))
        cone = bpy.context.active_object
        cone.name = f"Canopy_{i}"
        cone.data.materials.append(leaf_m)
        bpy.ops.object.modifier_add(type="SUBSURF")
        cone.modifiers["Subdivision"].levels = 1
        bpy.ops.object.modifier_apply(modifier="Subdivision")
        smart_uv(cone)
        shade_smooth(cone)
    export_glb(PROPS / name)


def make_oak(name: str) -> None:
    clear_scene()
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.85)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.65)
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=0.28, depth=3.4, location=(0, 0, 1.7))
    trunk = bpy.context.active_object
    trunk.data.materials.append(bark_m)
    smart_uv(trunk)
    shade_smooth(trunk)
    rng = random.Random(42)
    for i in range(7):
        ang = i * (2 * math.pi / 7)
        rad = 0.9 + rng.random() * 0.5
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=28,
            ring_count=16,
            radius=rad,
            location=(math.cos(ang) * 0.55, math.sin(ang) * 0.55, 3.6 + rng.uniform(-0.3, 0.4)),
        )
        ball = bpy.context.active_object
        ball.scale = (1.1, 1.0, 0.85)
        bpy.ops.object.transform_apply(scale=True)
        ball.data.materials.append(leaf_m)
        smart_uv(ball)
        shade_smooth(ball)
    export_glb(PROPS / name)


def make_palm(name: str) -> None:
    clear_scene()
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.9)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.55)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.22, depth=6.0, location=(0, 0, 3.0))
    trunk = bpy.context.active_object
    trunk.data.materials.append(bark_m)
    smart_uv(trunk)
    shade_smooth(trunk)
    for i in range(12):
        ang = i * (2 * math.pi / 12)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(math.cos(ang) * 1.2, math.sin(ang) * 1.2, 6.1))
        frond = bpy.context.active_object
        frond.scale = (0.12, 1.8, 0.05)
        frond.rotation_euler = (0.35, 0, ang)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        bpy.ops.object.modifier_add(type="SUBSURF")
        frond.modifiers["Subdivision"].levels = 2
        bpy.ops.object.modifier_apply(modifier="Subdivision")
        frond.data.materials.append(leaf_m)
        smart_uv(frond)
        shade_smooth(frond)
    export_glb(PROPS / name)


def make_cone_tree(name: str) -> None:
    clear_scene()
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.85)
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.7)
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.14, depth=2.4, location=(0, 0, 1.2))
    trunk = bpy.context.active_object
    trunk.data.materials.append(bark_m)
    smart_uv(trunk)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=1.4, depth=4.0, location=(0, 0, 3.4))
    cone = bpy.context.active_object
    cone.data.materials.append(leaf_m)
    bpy.ops.object.modifier_add(type="SUBSURF")
    cone.modifiers["Subdivision"].levels = 2
    bpy.ops.object.modifier_apply(modifier="Subdivision")
    smart_uv(cone)
    shade_smooth(cone)
    export_glb(PROPS / name)


def make_bush(name: str, large: bool = False) -> None:
    clear_scene()
    leaf_m = mat_textured("Leaf", TEX / "leaf_diff.jpg", 0.7)
    r = 0.95 if large else 0.65
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r, location=(0, 0, r * 0.85))
    bush = bpy.context.active_object
    bush.scale = (1.2, 1.0, 0.75)
    bpy.ops.object.transform_apply(scale=True)
    # Displace for foliage volume
    bpy.ops.object.modifier_add(type="DISPLACE")
    tex = bpy.data.textures.new("BushNoise", type="CLOUDS")
    bush.modifiers["Displace"].texture = tex
    bush.modifiers["Displace"].strength = 0.18
    bpy.ops.object.modifier_apply(modifier="Displace")
    bush.data.materials.append(leaf_m)
    smart_uv(bush)
    shade_smooth(bush)
    export_glb(PROPS / name)


def make_rock(name: str, scale=(1.2, 1.0, 0.8), segs: int = 4) -> None:
    clear_scene()
    rock_m = mat_textured("Rock", TEX / "rock_diff.jpg", 0.92)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=segs, radius=1.0, location=(0, 0, 0.55))
    rock = bpy.context.active_object
    rock.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.modifier_add(type="DISPLACE")
    tex = bpy.data.textures.new(f"RockNoise_{name}", type="VORONOI")
    rock.modifiers["Displace"].texture = tex
    rock.modifiers["Displace"].strength = 0.22
    bpy.ops.object.modifier_apply(modifier="Displace")
    rock.data.materials.append(rock_m)
    smart_uv(rock)
    shade_smooth(rock)
    export_glb(PROPS / name)


def make_cactus(name: str, tall: bool = True) -> None:
    clear_scene()
    mat = mat_textured("Cactus", TEX / "cactus_diff.jpg", 0.55)
    h = 3.2 if tall else 1.8
    r = 0.28 if tall else 0.32
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=r, depth=h, location=(0, 0, h * 0.5))
    body = bpy.context.active_object
    body.data.materials.append(mat)
    smart_uv(body)
    shade_smooth(body)
    for side, z, depth in ((1.0, h * 0.55, 1.1), (-1.0, h * 0.7, 0.9)):
        if not tall and side < 0:
            continue
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=20, radius=r * 0.55, depth=depth, location=(side * r * 1.4, 0, z)
        )
        arm = bpy.context.active_object
        arm.rotation_euler = (0, math.pi / 2 * side, 0)
        bpy.ops.object.transform_apply(rotation=True)
        arm.data.materials.append(mat)
        smart_uv(arm)
        shade_smooth(arm)
    export_glb(PROPS / name)


def make_log(name: str) -> None:
    clear_scene()
    bark_m = mat_textured("Bark", TEX / "bark_diff.jpg", 0.9)
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=0.35, depth=2.4, location=(0, 0, 0.35))
    log = bpy.context.active_object
    log.rotation_euler = (0, math.pi / 2, 0)
    bpy.ops.object.transform_apply(rotation=True)
    log.data.materials.append(bark_m)
    smart_uv(log)
    shade_smooth(log)
    export_glb(PROPS / name)


def densify_existing(src: Path, dst: Path, subdiv: int = 1) -> None:
    """Import a GLB, subdivide meshes (keep author materials/UVs), export denser GLB."""
    # Backup once before first overwrite of this file.
    bak = BACKUP / src.name
    if src.is_file() and not bak.is_file():
        BACKUP.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, bak)
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(src))
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        if subdiv > 0:
            bpy.ops.object.modifier_add(type="SUBSURF")
            obj.modifiers["Subdivision"].levels = subdiv
            obj.modifiers["Subdivision"].render_levels = subdiv
            bpy.ops.object.modifier_apply(modifier="Subdivision")
        shade_smooth(obj)
        # Leave author textures; denser mesh is the HD upgrade for characters.
    export_glb(dst)


def backup_lowpoly() -> None:
    BACKUP.mkdir(parents=True, exist_ok=True)
    for name in (
        "tree_pineDefaultA.glb",
        "tree_pineDefaultB.glb",
        "tree_oak.glb",
        "tree_detailed.glb",
        "tree_default.glb",
        "tree_cone.glb",
        "tree_palmDetailedTall.glb",
        "plant_bushDetailed.glb",
        "plant_bushLarge.glb",
        "rock_largeA.glb",
        "rock_largeB.glb",
        "rock_tallA.glb",
        "rock_smallA.glb",
        "cactus_tall.glb",
        "cactus_short.glb",
        "log_large.glb",
    ):
        src = PROPS / name
        if src.is_file() and not (BACKUP / name).is_file():
            shutil.copy2(src, BACKUP / name)


def main() -> None:
    if not TEX.is_dir():
        print("ERROR: missing HD textures — run tools/gen-hd-textures.py first", file=sys.stderr)
        sys.exit(1)
    backup_lowpoly()
    print("Building HD nature props…")
    make_pine("tree_pineDefaultA.glb", levels=7)
    make_pine("tree_pineDefaultB.glb", levels=6)
    make_oak("tree_oak.glb")
    make_oak("tree_detailed.glb")
    make_oak("tree_default.glb")
    make_cone_tree("tree_cone.glb")
    make_palm("tree_palmDetailedTall.glb")
    make_bush("plant_bushDetailed.glb", large=False)
    make_bush("plant_bushLarge.glb", large=True)
    make_rock("rock_largeA.glb", (1.4, 1.1, 0.9), 4)
    make_rock("rock_largeB.glb", (1.2, 1.3, 1.0), 4)
    make_rock("rock_tallA.glb", (0.7, 0.7, 1.6), 4)
    make_rock("rock_smallA.glb", (0.55, 0.5, 0.4), 3)
    make_cactus("cactus_tall.glb", tall=True)
    make_cactus("cactus_short.glb", tall=False)
    make_log("log_large.glb")

    print("Densifying spectators + animals…")
    for ch in sorted(PROPS.glob("character-*.glb")):
        densify_existing(ch, ch, subdiv=1)
    for an in ("animal-zebra.glb", "animal-elephant.glb", "animal-gazelle.glb"):
        src = PROPS / an
        if src.is_file():
            densify_existing(src, src, subdiv=2)
    for extra in ("tent_detailedClosed.glb", "house-alpine.glb"):
        src = PROPS / extra
        if src.is_file():
            densify_existing(src, src, subdiv=1)

    print("HD props complete →", PROPS)


if __name__ == "__main__":
    main()
