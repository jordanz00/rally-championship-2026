"""Pose the CC0 Godot XR Tools hands around a 16 mm rim tube and export GLBs.

Skins stay live. Object transforms are baked into edit-bones + verts BEFORE
rebind so Three.js origin is the grip hole (not a floating wrist).

glTF Y-up: Blender +Z → +Y (tube), Blender +Y → −Z (knuckles toward driver).
"""
from __future__ import annotations

import math
import os
import shutil

import bpy
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = "/tmp/hand-sources"
OUT = os.path.join(ROOT, "assets/driver")
KEEP = os.path.join(OUT, "src")
TUBE_R = 0.016
PAD = 0.005

# Local-X flexion closes a fist on this rig. Tight C around 16 mm, not a candy wrap.
FINGER = {
    "Index_Proximal": 1.12,
    "Index_Intermediate": 1.28,
    "Index_Distal": 0.78,
    "Middle_Proximal": 1.18,
    "Middle_Intermediate": 1.34,
    "Middle_Distal": 0.82,
    "Ring_Proximal": 1.12,
    "Ring_Intermediate": 1.28,
    "Ring_Distal": 0.78,
    "Little_Proximal": 1.02,
    "Little_Intermediate": 1.16,
    "Little_Distal": 0.64,
}
THUMB = {
    "L": {
        "Thumb_Metacarpal": (0.72, -0.18, 0.42),
        "Thumb_Proximal": (0.42, 0.16, 0.88),
        "Thumb_Distal": (0.28, 0.10, 0.62),
    },
    "R": {
        "Thumb_Metacarpal": (0.72, 0.18, -0.42),
        "Thumb_Proximal": (0.42, -0.16, -0.88),
        "Thumb_Distal": (0.28, -0.10, -0.62),
    },
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    return arm, mesh


def world(arm, bone, attr="head"):
    pb = arm.pose.bones.get(bone)
    if not pb:
        return None
    return arm.matrix_world @ (pb.head if attr == "head" else pb.tail)


def pose(arm, side):
    suf = f"_{side}"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for name, ang in FINGER.items():
        pb = arm.pose.bones.get(name + suf)
        if not pb:
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (ang, 0.0, 0.0)
    for name, euler in THUMB[side].items():
        pb = arm.pose.bones.get(name + suf)
        if not pb:
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = euler
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()


def hole_center(arm, side):
    """Center of the C the fingers make — that is where the leather sits."""
    pts = []
    for name in ("Index_Proximal", "Middle_Proximal", "Ring_Proximal"):
        h = world(arm, f"{name}_{side}", "head")
        t = world(arm, f"{name}_{side}", "tail")
        if h and t:
            pts.append((h + t) * 0.5)
    if not pts:
        return Vector((0, 0, 0))
    c = sum(pts, Vector()) / len(pts)
    wrist = world(arm, f"Wrist_{side}", "head")
    # Keep the origin on the finger shafts so the dorsum sits on the leather,
    # not the wrist. A step toward the palm floated the hands inside the hub.
    return c


def palm_knuckle_dir(arm, side):
    """Unit vector out of the back of the hand (knuckles)."""
    wrist = world(arm, f"Wrist_{side}")
    mid = world(arm, f"Middle_Proximal_{side}")
    idx = world(arm, f"Index_Proximal_{side}")
    lit = world(arm, f"Little_Proximal_{side}")
    if not (wrist and mid and idx and lit):
        return Vector((0, 1, 0))
    along = (mid - wrist).normalized()
    across = (idx - lit).normalized()
    n = across.cross(along)
    if n.length < 1e-6:
        return Vector((0, 1, 0))
    n.normalize()
    # Palm vs back: the side opposite the thumb web is the back.
    thumb = world(arm, f"Thumb_Proximal_{side}")
    if thumb and (thumb - mid).dot(n) > 0:
        n = -n
    return n


def seat(arm, mesh, side):
    """Hole on origin, tube +Z, knuckles +Y (driver after glTF Y-up)."""
    c = hole_center(arm, side)
    delta = -c
    arm.location += delta
    if mesh.parent != arm:
        mesh.location += delta
    bpy.context.view_layer.update()

    knuckle = palm_knuckle_dir(arm, side)
    print(f"HOLE {side} c={tuple(round(v, 3) for v in c)} knuckle={tuple(round(v, 3) for v in knuckle)}")

    # Rotate around the tube (+Z) so knuckles land on +Y.
    # knuckle projected onto XY; we want that to become +Y.
    kx, ky = knuckle.x, knuckle.y
    if abs(kx) + abs(ky) > 1e-5:
        # Rotate so (kx, ky) lands on +Y. +atan2(kx, ky) around Z.
        ang = math.atan2(kx, ky)
        roll = Matrix.Rotation(ang, 4, "Z")
        arm.matrix_world = roll @ arm.matrix_world
        if mesh.parent != arm:
            mesh.matrix_world = roll @ mesh.matrix_world
        bpy.context.view_layer.update()

    knuckle2 = palm_knuckle_dir(arm, side)
    print(f"SEAT {side} loc={tuple(round(v, 3) for v in arm.location)} knuckle2={tuple(round(v, 3) for v in knuckle2)}")


def bake_world_into_data(arm, mesh):
    """Move verts + edit bones into world space and leave objects at identity."""
    if mesh.parent:
        mw = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = mw
    mw = mesh.matrix_world.copy()
    mesh.data.transform(mw)
    mesh.matrix_world = Matrix.Identity(4)
    aw = arm.matrix_world.copy()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for bone in arm.data.edit_bones:
        bone.matrix = aw @ bone.matrix
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()


def freeze(arm, mesh):
    # 1. Bake the posed mesh (unbind).
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=mod.name)
    # 2. Pose becomes rest.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode="OBJECT")
    # 3. Bake seat into data WHILE UNBOUND so bind pose matches verts.
    bake_world_into_data(arm, mesh)
    # 4. Parent then rebind so the exporter keeps a valid skin.
    mesh.parent = arm
    mesh.matrix_parent_inverse = Matrix.Identity(4)
    mesh.matrix_basis = Matrix.Identity(4)
    rebound = mesh.modifiers.new("Armature", "ARMATURE")
    rebound.object = arm
    bpy.context.view_layer.update()


def mark_wrist(arm, side):
    empty = bpy.data.objects.new("wrist", None)
    bpy.context.collection.objects.link(empty)
    pb = arm.pose.bones.get(f"Wrist_{side}")
    if pb:
        empty.location = arm.matrix_world @ pb.head
    empty.parent = arm
    empty.matrix_parent_inverse = arm.matrix_world.inverted()
    return empty


def render_check(arm, mesh, side):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.filepath = os.path.join(OUT, f"grip-check-{side}-grip.png")
    if "tube-guide" not in bpy.data.objects:
        bpy.ops.mesh.primitive_cylinder_add(radius=TUBE_R, depth=0.14)
        t = bpy.context.object
        t.name = "tube-guide"
        m = bpy.data.materials.new("leather")
        m.diffuse_color = (0.07, 0.07, 0.07, 1)
        t.data.materials.append(m)
    world_data = bpy.data.worlds.new("w" + side)
    scene.world = world_data
    world_data.use_nodes = True
    bg = world_data.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.16, 0.17, 0.2, 1)
    light = bpy.data.lights.new("k" + side, "AREA")
    light.energy = 80
    light.size = 0.6
    lo = bpy.data.objects.new("k" + side, light)
    bpy.context.collection.objects.link(lo)
    lo.location = (0.12, 0.22, 0.16)
    fill = bpy.data.lights.new("f" + side, "AREA")
    fill.energy = 30
    fill.size = 0.8
    fo = bpy.data.objects.new("f" + side, fill)
    bpy.context.collection.objects.link(fo)
    fo.location = (-0.16, 0.12, 0.18)
    cam_data = bpy.data.cameras.new("c" + side)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.28
    cam = bpy.data.objects.new("c" + side, cam_data)
    bpy.context.collection.objects.link(cam)
    # Driver view: knuckles on +Y, look from +Y toward the hole.
    cam.location = (0.0, 0.34, 0.04)
    cam.rotation_euler = (math.radians(83), 0, math.radians(180))
    scene.camera = cam
    bpy.ops.render.render(write_still=True)
    print("RENDER", scene.render.filepath)


def export_glb(arm, mesh, empty, path):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    mesh.select_set(True)
    empty.select_set(True)
    bpy.context.view_layer.objects.active = arm
    kwargs = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_yup=True,
    )
    try:
        bpy.ops.export_scene.gltf(export_rest_position_armature=False, **kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)
    print("WROTE", path, os.path.getsize(path))


def build(side):
    reset()
    src = os.path.join(SRC, f"godot-nails-{side.lower()}.gltf")
    arm, mesh = load(src)
    mesh.name = f"mesh_Hand_{side}"
    pose(arm, side)
    seat(arm, mesh, side)
    freeze(arm, mesh)
    for p in mesh.data.polygons:
        p.use_smooth = True
    empty = mark_wrist(arm, side)
    os.makedirs(OUT, exist_ok=True)
    try:
        render_check(arm, mesh, side)
    except Exception as exc:
        print("RENDER_FAIL", exc)
    export_glb(arm, mesh, empty, os.path.join(OUT, f"hand-grip-{side.lower()}.glb"))


def keep_sources():
    os.makedirs(KEEP, exist_ok=True)
    for name in ("godot-nails-l.gltf", "godot-nails-r.gltf"):
        shutil.copy2(os.path.join(SRC, name), os.path.join(KEEP, name))
        print("SRC", name)


if __name__ == "__main__":
    keep_sources()
    build("R")
    build("L")
