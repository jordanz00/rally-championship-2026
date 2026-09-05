#!/usr/bin/env python3
"""
build-crowd-humans.py — HD human spectators for trackside crowds.

Run:
  python3 tools/gen-crowd-atlas.py
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build-crowd-humans.py

WHO THIS IS FOR: Desert / Lakeside (and any stage) audience members.
WHAT IT DOES: builds denser biped humans with readable anatomy (head, neck,
  torso, tapered limbs, hair, shoes, facial volumes), UV-mapped to
  crowd_atlas.png including face panels. Exports crowd-body + crowd-arm-l/r.
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

# Atlas UV rectangles for 2048 atlas (u0,v0,u1,v1) — v grows upward in Blender/GLTF.
SKIN = [
    (0.00, 0.75, 0.25, 1.00),
    (0.25, 0.75, 0.50, 1.00),
    (0.50, 0.75, 0.75, 1.00),
    (0.75, 0.75, 1.00, 1.00),
]
FACE = [
    (0.00, 0.00, 0.25, 0.125),
    (0.25, 0.00, 0.50, 0.125),
    (0.50, 0.00, 0.75, 0.125),
    (0.75, 0.00, 1.00, 0.125),
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

# Quality knobs — human silhouette at medium cam, shared InstancedMesh cost.
# Subdiv 2 ≈ 80k verts/body and multi-MB GLBs — too heavy for browser crowds.
SEG_BODY = 22
SEG_LIMB = 14
SEG_HEAD = 26
RINGS_HEAD = 16
SUBDIV_LEVEL = 1


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
    tex.interpolation = "Linear"
    bsdf.inputs["Roughness"].default_value = 0.62
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.35
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def shade_smooth(obj) -> None:
    for p in obj.data.polygons:
        p.use_smooth = True


def set_uv_rect(obj, rect, face_front: bool = False) -> None:
    u0, v0, u1, v1 = rect
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data
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
            if face_front:
                u = 0.5 + (co.x - (min_x + max_x) * 0.5) / dx * 0.85
                v = (co.z - min_z) / dz
                if co.y < (min_y + max_y) * 0.45:
                    u = 0.08 + ((co.x - min_x) / dx) * 0.2
            else:
                u = ((co.x - min_x) / dx * 0.55 + (co.y - min_y) / dy * 0.45)
                v = (co.z - min_z) / dz
            uv_layer[li].uv = (
                u0 + 0.04 + max(0.0, min(1.0, u)) * (u1 - u0) * 0.92,
                v0 + 0.04 + max(0.0, min(1.0, v)) * (v1 - v0) * 0.92,
            )


def add_sphere(mat, name, loc, scale, segs=SEG_BODY, rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    shade_smooth(obj)
    return obj


def add_cylinder(mat, name, loc, radius, depth, rot=(0, 0, 0), verts=SEG_LIMB):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(rotation=True)
    bpy.ops.object.modifier_add(type="BEVEL")
    obj.modifiers["Bevel"].width = min(radius * 0.42, depth * 0.12)
    obj.modifiers["Bevel"].segments = 3
    bpy.ops.object.modifier_apply(modifier="Bevel")
    obj.data.materials.append(mat)
    shade_smooth(obj)
    return obj


def add_cone(mat, name, loc, radius1, depth, rot=(0, 0, 0), verts=SEG_LIMB):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=radius1, radius2=radius1 * 0.55, depth=depth, location=loc
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(rotation=True)
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
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    min_x = min(c.x for c in coords)
    max_x = max(c.x for c in coords)
    min_y = min(c.y for c in coords)
    max_y = max(c.y for c in coords)
    min_z = min(c.z for c in coords)
    max_z = max(c.z for c in coords)
    cx = (min_x + max_x) * 0.5
    cy = (min_y + max_y) * 0.5
    top_z = max_z * 0.92 + min_z * 0.08
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.context.scene.cursor.location = (cx, cy, top_z)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")


def densify(obj) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_add(type="SUBSURF")
    mod = obj.modifiers["Subdivision"]
    mod.levels = SUBDIV_LEVEL
    mod.render_levels = SUBDIV_LEVEL
    bpy.ops.object.modifier_apply(modifier="Subdivision")
    shade_smooth(obj)


PROFILES = {
    "adult": {"height": 1.74, "head_mul": 1.0, "leg_mul": 1.0, "shoulder_mul": 1.0, "hip_mul": 1.0},
    "tall": {"height": 1.86, "head_mul": 0.94, "leg_mul": 1.1, "shoulder_mul": 1.05, "hip_mul": 0.97},
    "stocky": {"height": 1.68, "head_mul": 1.02, "leg_mul": 0.92, "shoulder_mul": 1.18, "hip_mul": 1.16},
    "teen": {"height": 1.56, "head_mul": 1.08, "leg_mul": 0.96, "shoulder_mul": 0.88, "hip_mul": 0.9},
    "elder": {"height": 1.64, "head_mul": 1.04, "leg_mul": 0.9, "shoulder_mul": 0.92, "hip_mul": 1.04},
    "child": {"height": 1.22, "head_mul": 1.24, "leg_mul": 0.86, "shoulder_mul": 0.76, "hip_mul": 0.86},
}


def make_human(name: str, seed: int, female: bool = False, profile: str = "adult") -> None:
    clear_scene()
    rng = random.Random(seed)
    mat = crowd_mat()
    prof = PROFILES.get(profile, PROFILES["adult"])

    skin_i = seed % len(SKIN)
    shirt_i = (seed * 3) % len(SHIRT)
    pants_i = (seed * 5) % len(PANTS)
    hair_i = (seed * 7) % len(HAIR)

    shoulder = (0.36 if female else 0.42) * prof["shoulder_mul"]
    hip = (0.34 if female else 0.32) * prof["hip_mul"]
    torso_d = 0.50 if female else 0.55
    if profile == "child":
        torso_d *= 0.86
    elif profile == "elder":
        torso_d *= 0.93
    leg_len = (0.80 if female else 0.84) * prof["leg_mul"]
    arm_len = (0.54 if female else 0.58) * (0.9 if profile == "child" else 1.0)
    head_r = (0.098 if female else 0.104) * prof["head_mul"]
    waist_z = leg_len * 0.82
    chest_z = waist_z + torso_d * 0.55
    shoulder_z = waist_z + torso_d * 0.92

    tagged = []

    for side, sx in (("L", -1), ("R", 1)):
        thigh = add_cone(
            mat, f"LegUpper_{side}",
            (sx * 0.09, 0.01, leg_len * 0.58),
            0.082 if not female else 0.074,
            leg_len * 0.46, verts=SEG_LIMB,
        )
        tagged.append((thigh, PANTS[pants_i], False))
        calf = add_cone(
            mat, f"LegLower_{side}",
            (sx * 0.09, 0.01, leg_len * 0.24),
            0.058 if not female else 0.052,
            leg_len * 0.4, verts=SEG_LIMB,
        )
        tagged.append((calf, PANTS[pants_i], False))
        knee = add_sphere(
            mat, f"Knee_{side}",
            (sx * 0.09, 0.02, leg_len * 0.42),
            (0.055, 0.05, 0.05), segs=SEG_LIMB, rings=12,
        )
        tagged.append((knee, PANTS[pants_i], False))
        foot = add_sphere(
            mat, f"Foot_{side}",
            (sx * 0.09, 0.08, 0.048),
            (0.068, 0.135, 0.045), segs=SEG_LIMB, rings=12,
        )
        tagged.append((foot, SHOES, False))

    hips = add_sphere(mat, "Hips", (0, 0.01, waist_z), (hip, hip * 0.62, 0.12), segs=SEG_BODY, rings=16)
    tagged.append((hips, PANTS[pants_i], False))
    pelvis = add_sphere(
        mat, "Pelvis", (0, 0.02, waist_z + 0.06),
        (hip * 0.92, hip * 0.55, 0.1), segs=SEG_BODY, rings=14,
    )
    tagged.append((pelvis, PANTS[pants_i], False))

    torso = add_cylinder(mat, "Torso", (0, 0.02, chest_z), shoulder * 0.48, torso_d, verts=SEG_BODY)
    torso.scale = (1.12 if not female else 1.0, 0.68 if female else 0.74, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    tagged.append((torso, SHIRT[shirt_i], False))

    chest = add_sphere(
        mat, "Chest",
        (0, 0.05, chest_z + torso_d * 0.08),
        (shoulder * 0.52, 0.13 if female else 0.15, torso_d * 0.3),
        segs=SEG_BODY, rings=14,
    )
    tagged.append((chest, SHIRT[shirt_i], False))
    if female:
        for sx in (-1, 1):
            bust = add_sphere(
                mat, f"Bust_{'L' if sx < 0 else 'R'}",
                (sx * shoulder * 0.18, 0.08, chest_z + torso_d * 0.12),
                (0.09, 0.08, 0.09), segs=16, rings=12,
            )
            tagged.append((bust, SHIRT[shirt_i], False))

    hem = add_cylinder(mat, "Hem", (0, 0.01, waist_z + 0.04), shoulder * 0.5, 0.09, verts=SEG_BODY)
    tagged.append((hem, SHIRT[shirt_i], False))

    # Collar / jacket lapel volume
    collar = add_sphere(
        mat, "Collar",
        (0, 0.04, shoulder_z - 0.02),
        (shoulder * 0.42, 0.1, 0.06), segs=20, rings=12,
    )
    tagged.append((collar, SHIRT[shirt_i], False))

    for side, sx in (("L", -1), ("R", 1)):
        sh = add_sphere(
            mat, f"Shoulder_{side}",
            (sx * shoulder * 0.52, 0.02, shoulder_z),
            (0.072, 0.072, 0.072), segs=SEG_LIMB, rings=12,
        )
        tagged.append((sh, SHIRT[shirt_i], False))
        upper = add_cone(
            mat, f"ArmUpper_{side}",
            (sx * (shoulder * 0.52 + 0.02), 0.02, shoulder_z - arm_len * 0.22),
            0.05, arm_len * 0.44, verts=SEG_LIMB,
        )
        tagged.append((upper, SHIRT[shirt_i] if rng.random() > 0.25 else SKIN[skin_i], False))
        elbow = add_sphere(
            mat, f"Elbow_{side}",
            (sx * (shoulder * 0.52 + 0.03), 0.03, shoulder_z - arm_len * 0.44),
            (0.04, 0.04, 0.04), segs=14, rings=10,
        )
        tagged.append((elbow, SKIN[skin_i], False))
        lower = add_cone(
            mat, f"ArmLower_{side}",
            (sx * (shoulder * 0.52 + 0.03), 0.03, shoulder_z - arm_len * 0.58),
            0.04, arm_len * 0.4, verts=SEG_LIMB,
        )
        tagged.append((lower, SKIN[skin_i], False))
        hand = add_sphere(
            mat, f"Hand_{side}",
            (sx * (shoulder * 0.52 + 0.03), 0.05, shoulder_z - arm_len * 0.82),
            (0.04, 0.06, 0.03), segs=14, rings=10,
        )
        tagged.append((hand, SKIN[skin_i], False))
        # Finger stubs — read as hands, not mittens
        for fi, fy in enumerate((-0.02, 0.0, 0.02, 0.035)):
            finger = add_sphere(
                mat, f"Finger{fi}_{side}",
                (sx * (shoulder * 0.52 + 0.03), 0.09 + fy * 0.4, shoulder_z - arm_len * 0.9),
                (0.012, 0.028, 0.01), segs=8, rings=6,
            )
            tagged.append((finger, SKIN[skin_i], False))

    neck = add_cylinder(mat, "Neck", (0, 0.025, shoulder_z + 0.08), 0.045, 0.1, verts=SEG_LIMB)
    tagged.append((neck, SKIN[skin_i], False))
    head_z = shoulder_z + 0.2
    head = add_sphere(
        mat, "Head",
        (0, 0.035, head_z),
        (head_r * 0.9, head_r * 1.0, head_r * 1.14),
        segs=SEG_HEAD, rings=RINGS_HEAD,
    )
    tagged.append((head, FACE[skin_i], True))

    jaw = add_sphere(
        mat, "Jaw",
        (0, 0.055, head_z - head_r * 0.38),
        (head_r * 0.72, head_r * 0.58, head_r * 0.48),
        segs=20, rings=14,
    )
    tagged.append((jaw, SKIN[skin_i], False))
    brow = add_sphere(
        mat, "Brow",
        (0, 0.07, head_z + head_r * 0.15),
        (head_r * 0.78, head_r * 0.35, head_r * 0.22),
        segs=18, rings=10,
    )
    tagged.append((brow, SKIN[skin_i], False))
    nose = add_sphere(
        mat, "Nose",
        (0, head_r * 1.02, head_z - head_r * 0.02),
        (0.02, 0.038, 0.026), segs=12, rings=8,
    )
    tagged.append((nose, SKIN[skin_i], False))
    for side, sx in (("L", -1), ("R", 1)):
        ear = add_sphere(
            mat, f"Ear_{side}",
            (sx * head_r * 0.9, 0.0, head_z),
            (0.024, 0.018, 0.038), segs=12, rings=8,
        )
        tagged.append((ear, SKIN[skin_i], False))
        # Eye socket hint (darker face UV already; volume helps silhouette)
        socket = add_sphere(
            mat, f"Socket_{side}",
            (sx * head_r * 0.32, head_r * 0.78, head_z + head_r * 0.05),
            (0.028, 0.012, 0.022), segs=10, rings=6,
        )
        tagged.append((socket, FACE[skin_i], True))

    hair_style = seed % 5
    if hair_style == 0:
        hair = add_sphere(
            mat, "Hair",
            (0, -0.01, head_z + head_r * 0.28),
            (head_r * 1.05, head_r * 1.08, head_r * 0.58),
            segs=SEG_BODY, rings=14,
        )
    elif hair_style == 1:
        hair = add_sphere(
            mat, "Hair",
            (0, -0.02, head_z + head_r * 0.22),
            (head_r * 1.1, head_r * 1.14, head_r * 0.72),
            segs=SEG_BODY, rings=14,
        )
    elif hair_style == 2:
        hair = add_sphere(
            mat, "Hair",
            (0, -0.08, head_z + head_r * 0.02),
            (head_r * 1.08, head_r * 1.25, head_r * 0.9),
            segs=SEG_BODY, rings=14,
        )
    elif hair_style == 3:
        hair = add_sphere(
            mat, "Hair",
            (0, -0.04, head_z + head_r * 0.15),
            (head_r * 1.12, head_r * 1.18, head_r * 0.8),
            segs=SEG_BODY, rings=14,
        )
        bang = add_sphere(
            mat, "Bang",
            (0, 0.06, head_z + head_r * 0.35),
            (head_r * 0.7, head_r * 0.35, head_r * 0.25),
            segs=16, rings=10,
        )
        tagged.append((bang, HAIR[hair_i], False))
    else:
        hair = add_sphere(
            mat, "Hair",
            (0, 0.0, head_z + head_r * 0.38),
            (head_r * 1.06, head_r * 1.06, head_r * 0.48),
            segs=SEG_BODY, rings=12,
        )
    tagged.append((hair, HAIR[hair_i], False))

    for obj, rect, face_front in tagged:
        set_uv_rect(obj, rect, face_front=face_front)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    arm_l = [
        o for o in meshes
        if o.name.endswith("_L") and any(k in o.name for k in ("Arm", "Hand", "Shoulder", "Elbow", "Finger"))
    ]
    arm_r = [
        o for o in meshes
        if o.name.endswith("_R") and any(k in o.name for k in ("Arm", "Hand", "Shoulder", "Elbow", "Finger"))
    ]
    body_parts = [o for o in meshes if o not in arm_l and o not in arm_r]

    body = join_meshes(body_parts, mat, "crowd-body")
    arm_l_obj = join_meshes(arm_l, mat, "crowd-arm-l") if arm_l else None
    arm_r_obj = join_meshes(arm_r, mat, "crowd-arm-r") if arm_r else None

    for part in (body, arm_l_obj, arm_r_obj):
        if part:
            densify(part)

    target_h = float(prof["height"]) + rng.uniform(-0.02, 0.02)
    if female and profile == "adult":
        target_h -= 0.04
    height_s = scale_to_height(body, target_h)
    if arm_l_obj:
        apply_scale(arm_l_obj, height_s)
        set_origin_shoulder(arm_l_obj)
    if arm_r_obj:
        apply_scale(arm_r_obj, height_s)
        set_origin_shoulder(arm_r_obj)

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
    print(f"  wrote {name}  profile={profile} h≈{target_h:.2f} body={verts} arm_verts={arm_v}", flush=True)


CHARACTERS = [
    ("character-male-a.glb", 11, False, "adult"),
    ("character-male-b.glb", 23, False, "tall"),
    ("character-male-c.glb", 37, False, "teen"),
    ("character-male-d.glb", 41, False, "elder"),
    ("character-male-e.glb", 53, False, "stocky"),
    ("character-male-f.glb", 67, False, "child"),
    ("character-female-a.glb", 71, True, "adult"),
    ("character-female-b.glb", 83, True, "tall"),
    ("character-female-c.glb", 97, True, "teen"),
    ("character-female-d.glb", 101, True, "elder"),
    ("character-female-e.glb", 113, True, "child"),
    ("character-female-f.glb", 127, True, "stocky"),
]


def main() -> None:
    if not TEX.is_file() and not COLORMAP.is_file():
        print("ERROR: run tools/gen-crowd-atlas.py first", file=sys.stderr)
        sys.exit(1)
    BACKUP.mkdir(parents=True, exist_ok=True)
    for name, *_rest in CHARACTERS:
        src = PROPS / name
        bak = BACKUP / f"crowd_v2_{name}"
        if src.is_file() and not bak.is_file():
            shutil.copy2(src, bak)

    print("Building HD crowd humans…", flush=True)
    for name, seed, female, profile in CHARACTERS:
        make_human(name, seed, female=female, profile=profile)
    print("Crowd humans complete →", PROPS, flush=True)


if __name__ == "__main__":
    main()
