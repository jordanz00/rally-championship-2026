"""
build-crowd-humans.py — realistic low-poly biped spectators for trackside crowds.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build-crowd-humans.py

WHO THIS IS FOR: Desert / Lakeside (and any stage) audience members.
WHAT IT DOES: replaces Kenney block characters with textured biped humans
  (~2–3.5k verts), UV-mapped to crowd_atlas.png, feet at origin, ~1.7 m tall.
HOW IT CONNECTS: prop-kit loads character-*.glb; CrowdField instances them.
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
TEX = PROPS / "Textures" / "hd" / "crowd_atlas.png"
COLORMAP = PROPS / "Textures" / "colormap.png"
BACKUP = PROPS / "_lowpoly_backup"

# Atlas UV rectangles (u0,v0,u1,v1) in 0–1. v grows upward in Blender/GLTF.
SKIN = [
    (0.00, 0.75, 0.25, 1.00),
    (0.25, 0.75, 0.50, 1.00),
    (0.50, 0.75, 0.75, 1.00),
    (0.75, 0.75, 1.00, 1.00),
]
SHIRT = [
    (0.00, 0.625, 0.25, 0.75),
    (0.25, 0.625, 0.50, 0.75),
    (0.50, 0.625, 0.75, 0.75),
    (0.75, 0.625, 1.00, 0.75),
    (0.00, 0.50, 0.25, 0.625),
    (0.25, 0.50, 0.50, 0.625),
    (0.50, 0.50, 0.75, 0.625),
    (0.75, 0.50, 1.00, 0.625),
]
PANTS = [
    (0.00, 0.375, 0.25, 0.50),
    (0.25, 0.375, 0.50, 0.50),
    (0.50, 0.375, 0.75, 0.50),
    (0.75, 0.375, 1.00, 0.50),
    (0.00, 0.25, 0.25, 0.375),
    (0.25, 0.25, 0.50, 0.375),
    (0.50, 0.25, 0.75, 0.375),
    (0.75, 0.25, 1.00, 0.375),
]
HAIR = [
    (0.00, 0.125, 0.125, 0.25),
    (0.125, 0.125, 0.25, 0.25),
    (0.25, 0.125, 0.375, 0.25),
    (0.375, 0.125, 0.50, 0.25),
]
SHOES = (0.50, 0.125, 0.75, 0.25)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        bpy.data.images.remove(block)


def crowd_mat() -> bpy.types.Material:
    mat = bpy.data.materials.new("CrowdAtlas")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(TEX if TEX.is_file() else COLORMAP))
    tex.interpolation = "Closest"
    bsdf.inputs["Roughness"].default_value = 0.78
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def set_uv_rect(obj, rect) -> None:
    """Map every loop UV into atlas rect (simple planar-ish packing)."""
    u0, v0, u1, v1 = rect
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data
    # Use object-space bounds for stable UV
    coords = [obj.matrix_world @ v.co for v in mesh.vertices]
    xs = [c.x for c in coords]
    ys = [c.y for c in coords]
    zs = [c.z for c in coords]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)
    dx = max(1e-6, max_x - min_x)
    dy = max(1e-6, max_y - min_y)
    dz = max(1e-6, max_z - min_z)
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            co = coords[vi]
            # Wrap cylindrical-ish: XZ around + Y height
            u = ((co.x - min_x) / dx * 0.55 + (co.z - min_z) / dz * 0.45)
            v = (co.y - min_y) / dy
            uv_layer[li].uv = (u0 + u * (u1 - u0), v0 + v * (v1 - v0))


def shade_smooth(obj) -> None:
    for p in obj.data.polygons:
        p.use_smooth = True


def add_limb(mat, name, loc, scale, rot=(0, 0, 0), segs=14, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    obj.data.materials.append(mat)
    shade_smooth(obj)
    return obj


def add_capsule(mat, name, loc, radius, depth, rot=(0, 0, 0), verts=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(rotation=True)
    # Caps for softer limb ends
    bpy.ops.object.modifier_add(type="BEVEL")
    obj.modifiers["Bevel"].width = radius * 0.35
    obj.modifiers["Bevel"].segments = 2
    bpy.ops.object.modifier_apply(modifier="Bevel")
    obj.data.materials.append(mat)
    shade_smooth(obj)
    return obj


def join_meshes(objects: list[bpy.types.Object], mat, name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = name
    body.data.materials.clear()
    body.data.materials.append(mat)
    return body


def subdiv_displace(obj, seed: int, levels: int = 1, strength: float = 0.014) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_add(type="DISPLACE")
    tex = bpy.data.textures.new(f"CrowdDisp_{seed}_{obj.name}", type="CLOUDS")
    if hasattr(tex, "noise_scale"):
        tex.noise_scale = 0.85
    obj.modifiers["Displace"].texture = tex
    obj.modifiers["Displace"].strength = strength
    bpy.ops.object.modifier_apply(modifier="Displace")
    bpy.ops.object.modifier_add(type="SUBSURF")
    obj.modifiers["Subdivision"].levels = levels
    obj.modifiers["Subdivision"].render_levels = levels
    bpy.ops.object.modifier_apply(modifier="Subdivision")
    shade_smooth(obj)


def set_origin_top(obj) -> None:
    set_origin_shoulder(obj)


def ground_feet_arm(obj) -> None:
    pass


def export_crowd_glb(path: Path, parts: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="NONE",
        export_colors=False,
        export_cameras=False,
        export_lights=False,
    )


def ground_feet(obj) -> None:
    bpy.context.view_layer.objects.active = obj
    # Move so min Z (Blender Z-up export → Y-up in glTF) — Blender is Z-up.
    # glTF exporter converts Z-up to Y-up. Keep feet on Z=0 in Blender.
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    min_z = min(c.z for c in coords)
    obj.location.z -= min_z
    bpy.ops.object.transform_apply(location=True)


def scale_to_height(obj, target=1.70) -> float:
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    h = max(c.z for c in coords) - min(c.z for c in coords)
    if h < 1e-4:
        return 1.0
    s = target / h
    obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(scale=True)
    ground_feet(obj)
    return s


def apply_scale(obj, s: float) -> None:
    if abs(s - 1.0) < 1e-4:
        return
    obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(scale=True)


def set_origin_shoulder(obj) -> None:
    """Arm meshes rotate from the shoulder — origin at upper socket."""
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    min_x = min(c.x for c in coords)
    max_x = max(c.x for c in coords)
    min_y = min(c.y for c in coords)
    max_y = max(c.y for c in coords)
    min_z = min(c.z for c in coords)
    max_z = max(c.z for c in coords)
    cx = (min_x + max_x) * 0.5
    cy = (min_y + max_y) * 0.5
    top_z = max_z * 0.9 + min_z * 0.1
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.context.scene.cursor.location = (cx, cy, top_z)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")


def make_human(name: str, seed: int, female: bool = False) -> None:
    clear_scene()
    rng = random.Random(seed)
    mat = crowd_mat()

    skin_i = seed % len(SKIN)
    shirt_i = (seed * 3) % len(SHIRT)
    pants_i = (seed * 5) % len(PANTS)
    hair_i = (seed * 7) % len(HAIR)

    # Proportions
    shoulder = 0.38 if female else 0.44
    hip = 0.36 if female else 0.34
    torso_d = 0.52 if female else 0.58
    leg_len = 0.78 if female else 0.82
    arm_len = 0.52 if female else 0.56
    head_r = 0.105 if female else 0.112

    # Legs (standing)
    for side, sx in (("L", -1), ("R", 1)):
        thigh = add_capsule(
            mat, f"LegUpper_{side}", (sx * 0.09, 0, leg_len * 0.55), 0.065 if female else 0.072, leg_len * 0.48, verts=14
        )
        set_uv_rect(thigh, PANTS[pants_i])
        calf = add_capsule(
            mat, f"LegLower_{side}", (sx * 0.09, 0, leg_len * 0.22), 0.05 if female else 0.055, leg_len * 0.42, verts=14
        )
        set_uv_rect(calf, PANTS[pants_i])
        foot = add_limb(
            mat, f"Foot_{side}", (sx * 0.09, 0.06, 0.04), (0.07, 0.12, 0.045), segs=10, rings=7
        )
        set_uv_rect(foot, SHOES)

    # Pelvis + torso
    hips = add_limb(mat, "Hips", (0, 0, leg_len * 0.78), (hip, hip * 0.7, 0.12), segs=12, rings=8)
    set_uv_rect(hips, PANTS[pants_i])
    torso = add_capsule(mat, "Torso", (0, 0, leg_len * 0.78 + torso_d * 0.55), shoulder * 0.55, torso_d, verts=18)
    # Widen chest
    torso.scale = (1.15 if not female else 1.05, 0.72, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    set_uv_rect(torso, SHIRT[shirt_i])

    # Shoulders / arms
    for side, sx in (("L", -1), ("R", 1)):
        sh = add_limb(
            mat,
            f"Shoulder_{side}",
            (sx * shoulder * 0.55, 0, leg_len * 0.78 + torso_d * 0.95),
            (0.07, 0.07, 0.07),
            segs=10,
            rings=8,
        )
        set_uv_rect(sh, SHIRT[shirt_i])
        upper = add_capsule(
            mat,
            f"ArmUpper_{side}",
            (sx * (shoulder * 0.55 + 0.02), 0, leg_len * 0.78 + torso_d * 0.7),
            0.045,
            arm_len * 0.48,
            verts=12,
        )
        set_uv_rect(upper, SHIRT[shirt_i] if rng.random() > 0.35 else SKIN[skin_i])
        lower = add_capsule(
            mat,
            f"ArmLower_{side}",
            (sx * (shoulder * 0.55 + 0.02), 0, leg_len * 0.78 + torso_d * 0.7 - arm_len * 0.45),
            0.038,
            arm_len * 0.42,
            verts=12,
        )
        set_uv_rect(lower, SKIN[skin_i])
        hand = add_limb(
            mat,
            f"Hand_{side}",
            (sx * (shoulder * 0.55 + 0.02), 0.02, leg_len * 0.78 + torso_d * 0.7 - arm_len * 0.72),
            (0.04, 0.055, 0.03),
            segs=9,
            rings=6,
        )
        set_uv_rect(hand, SKIN[skin_i])

    # Neck + head
    neck = add_capsule(
        mat, "Neck", (0, 0, leg_len * 0.78 + torso_d + 0.06), 0.045, 0.1, verts=12
    )
    set_uv_rect(neck, SKIN[skin_i])
    head = add_limb(
        mat,
        "Head",
        (0, 0.02, leg_len * 0.78 + torso_d + 0.18),
        (head_r, head_r * 1.05, head_r * 1.15),
        segs=18,
        rings=12,
    )
    set_uv_rect(head, SKIN[skin_i])
    hair = add_limb(
        mat,
        "Hair",
        (0, -0.01, leg_len * 0.78 + torso_d + 0.26),
        (head_r * 1.05, head_r * 1.1, head_r * 0.55),
        segs=14,
        rings=10,
    )
    set_uv_rect(hair, HAIR[hair_i])

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    arm_l = [o for o in meshes if o.name.endswith("_L") and ("Arm" in o.name or "Hand" in o.name or "Shoulder" in o.name)]
    arm_r = [o for o in meshes if o.name.endswith("_R") and ("Arm" in o.name or "Hand" in o.name or "Shoulder" in o.name)]
    body_parts = [o for o in meshes if o not in arm_l and o not in arm_r]

    body = join_meshes(body_parts, mat, "crowd-body")
    arm_l_obj = join_meshes(arm_l, mat, "crowd-arm-l") if arm_l else None
    arm_r_obj = join_meshes(arm_r, mat, "crowd-arm-r") if arm_r else None

    subdiv_displace(body, seed, levels=2, strength=0.012)
    if arm_l_obj:
        subdiv_displace(arm_l_obj, seed + 1, levels=1, strength=0.008)
    if arm_r_obj:
        subdiv_displace(arm_r_obj, seed + 2, levels=1, strength=0.008)

    height_s = scale_to_height(body, 1.64 + (0.0 if female else 0.08) + rng.uniform(-0.03, 0.04))
    if arm_l_obj:
        apply_scale(arm_l_obj, height_s)
        set_origin_shoulder(arm_l_obj)
    if arm_r_obj:
        apply_scale(arm_r_obj, height_s)
        set_origin_shoulder(arm_r_obj)

    remap_joined_uvs(body, skin_i, shirt_i, pants_i, hair_i)
    if arm_l_obj:
        remap_joined_uvs(arm_l_obj, skin_i, shirt_i, pants_i, hair_i)
    if arm_r_obj:
        remap_joined_uvs(arm_r_obj, skin_i, shirt_i, pants_i, hair_i)

    export_parts = [body]
    if arm_l_obj:
        export_parts.append(arm_l_obj)
    if arm_r_obj:
        export_parts.append(arm_r_obj)

    out = PROPS / name
    export_crowd_glb(out, export_parts)
    verts = len(body.data.vertices)
    arm_v = (len(arm_l_obj.data.vertices) if arm_l_obj else 0) + (
        len(arm_r_obj.data.vertices) if arm_r_obj else 0
    )
    print(f"  wrote {name}  body={verts} arm_verts={arm_v}", flush=True)


def remap_joined_uvs(obj, skin_i, shirt_i, pants_i, hair_i) -> None:
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data
    coords = [v.co.copy() for v in mesh.vertices]
    min_z = min(c.z for c in coords)
    max_z = max(c.z for c in coords)
    h = max(1e-6, max_z - min_z)
    min_x = min(c.x for c in coords)
    max_x = max(c.x for c in coords)
    min_y = min(c.y for c in coords)
    max_y = max(c.y for c in coords)
    dx = max(1e-6, max_x - min_x)
    dy = max(1e-6, max_y - min_y)

    for poly in mesh.polygons:
        # Classify by average height
        zs = [coords[mesh.loops[li].vertex_index].z for li in poly.loop_indices]
        z_n = (sum(zs) / len(zs) - min_z) / h
        if z_n > 0.88:
            rect = HAIR[hair_i]
        elif z_n > 0.78:
            rect = SKIN[skin_i]
        elif z_n > 0.48:
            rect = SHIRT[shirt_i]
        elif z_n > 0.08:
            rect = PANTS[pants_i]
        else:
            rect = SHOES
        u0, v0, u1, v1 = rect
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            co = coords[vi]
            u = ((co.x - min_x) / dx * 0.5 + (co.y - min_y) / dy * 0.5)
            v = (co.z - min_z) / h
            # keep within panel with margin
            uv_layer[li].uv = (
                u0 + 0.08 + u * (u1 - u0) * 0.84,
                v0 + 0.08 + v * (v1 - v0) * 0.84,
            )


CHARACTERS = [
    ("character-male-a.glb", 11, False),
    ("character-male-b.glb", 23, False),
    ("character-male-c.glb", 37, False),
    ("character-male-d.glb", 41, False),
    ("character-male-e.glb", 53, False),
    ("character-male-f.glb", 67, False),
    ("character-female-a.glb", 71, True),
    ("character-female-b.glb", 83, True),
    ("character-female-c.glb", 97, True),
    ("character-female-d.glb", 101, True),
    ("character-female-e.glb", 113, True),
    ("character-female-f.glb", 127, True),
]


def main() -> None:
    if not TEX.is_file() and not COLORMAP.is_file():
        print("ERROR: run tools/gen-crowd-atlas.py first", file=sys.stderr)
        sys.exit(1)
    BACKUP.mkdir(parents=True, exist_ok=True)
    for name, _, _ in CHARACTERS:
        src = PROPS / name
        bak = BACKUP / name
        if src.is_file() and not bak.is_file():
            shutil.copy2(src, bak)

    print("Building realistic crowd bipeds…", flush=True)
    for name, seed, female in CHARACTERS:
        make_human(name, seed, female=female)
    print("Crowd humans complete →", PROPS, flush=True)


if __name__ == "__main__":
    main()
