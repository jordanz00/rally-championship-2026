"""Bake a closed driving grip into the hand GLB rest pose.

Runtime bone curls past this angle tear the skin weights. The mesh vertices
become the grip, and the bones rest there, so the wheel shows a closed hand
with the rig still able to move.
"""
import bpy
from mathutils import Vector
import math
import os
import sys

ROOT = "/Users/jordanzabady/Desktop/Cursor Projects/Sega_Rally_Clone/assets/driver"

# Tighter than the live relaxed curl. Local Z closes the fingers over the tube.
FINGER = {
    "Metacarpal": 0.42,
    "Proximal": 1.4,
    "Intermediate": 1.5,
    "Distal": 0.95,
}
FINGERS = ("Index", "Middle", "Ring", "Little")


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    return arm, mesh


def bone_len(arm, side):
    suf = f"_{side}"
    w = arm.matrix_world @ arm.pose.bones[f"Wrist{suf}"].head
    t = arm.matrix_world @ arm.pose.bones[f"Middle_Tip{suf}"].tail
    return (t - w).length, t, w


def pose_grip(arm, side):
    suf = f"_{side}"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for finger in FINGERS:
        for joint, ang in FINGER.items():
            name = f"{finger}_{joint}{suf}"
            if name not in arm.pose.bones:
                continue
            pb = arm.pose.bones[name]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (0.0, 0.0, ang)
    for name, euler in (
        (f"Thumb_Metacarpal{suf}", (0.35, -0.35, 0.5)),
        (f"Thumb_Proximal{suf}", (0.0, 0.0, 0.65)),
        (f"Thumb_Distal{suf}", (0.0, 0.0, 0.45)),
    ):
        if name not in arm.pose.bones:
            continue
        pb = arm.pose.bones[name]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = euler
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()


def bake(path, side):
    arm, mesh = load(path)
    before, _, _ = bone_len(arm, side)
    pose_grip(arm, side)
    posed, _, _ = bone_len(arm, side)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="OBJECT")
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode="OBJECT")
    rebound = mesh.modifiers.new("Armature", "ARMATURE")
    rebound.object = arm
    bpy.context.view_layer.update()
    after, tip, wrist = bone_len(arm, side)
    mid = arm.pose.bones[f"Middle_Proximal_{side}"]
    print(
        f"BAKE {side} open={before:.3f} posed={posed:.3f} rest={after:.3f} "
        f"midZ={mid.rotation_euler.z:.3f} "
        f"tip=({tip.x:+.3f},{tip.y:+.3f},{tip.z:+.3f})"
    )
    if after > 0.14:
        print(f"FAIL {side} grip did not close")
        sys.exit(1)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    mesh.select_set(True)
    for ob in bpy.data.objects:
        if ob.type == "EMPTY":
            ob.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_rest_position_armature=False,
        export_reset_pose_bones=False,
        export_yup=True,
    )
    print("WROTE", path, os.path.getsize(path))


if __name__ == "__main__":
    bake(os.path.join(ROOT, "hand-grip-l.glb"), "L")
    bake(os.path.join(ROOT, "hand-grip-r.glb"), "R")
