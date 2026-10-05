"""Search a thumb pose that rests on the tube, then export both grip GLBs.

Tube center becomes the origin. Tube axis is Blender +Z, which glTF writes as +Y
(the rim tangent). A +90° Z turn puts the palm on Blender +Y, glTF -Z (driver).
"""
import bpy
from mathutils import Vector, Matrix
import math
import os

ROOT = "/Users/jordanzabady/Desktop/Cursor Projects/Sega_Rally_Clone/assets/driver"
OUT_DIR = ROOT

FINGER = {
    "Index_Proximal": 1.05,
    "Index_Intermediate": 1.2,
    "Index_Distal": 0.62,
    "Middle_Proximal": 1.12,
    "Middle_Intermediate": 1.28,
    "Middle_Distal": 0.68,
    "Ring_Proximal": 1.05,
    "Ring_Intermediate": 1.2,
    "Ring_Distal": 0.62,
    "Little_Proximal": 0.95,
    "Little_Intermediate": 1.05,
    "Little_Distal": 0.55,
}

# (metacarpal xyz, proximal z, distal z) — searched once, then locked.
THUMB_PRESETS = [
    ((0.6, -0.4, 0.15), -0.9, -0.7),
    ((1.2, 0.2, 0.2), 0.7, 0.55),
    ((-0.8, 0.6, 0.3), 0.8, 0.6),
    ((0.9, -0.8, -0.4), 0.5, 0.4),
    ((-1.1, -0.3, 0.5), -0.6, -0.4),
    ((1.4, 0.9, -0.6), 0.85, 0.7),
    ((0.2, 1.1, 0.4), 0.9, 0.75),
    ((-0.4, -1.0, 0.2), 0.6, 0.5),
]


def load_hand(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    return arm, mesh


def apply_pose(arm, side, thumb):
    suf = f"_{side}"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for name, ang in FINGER.items():
        pb = arm.pose.bones[name + suf]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0.0, 0.0, ang)
    meta, pz, dz = thumb
    for name, euler in (
        ("Thumb_Metacarpal" + suf, meta),
        ("Thumb_Proximal" + suf, (0.15, 0.0, pz)),
        ("Thumb_Distal" + suf, (0.1, 0.0, dz)),
    ):
        pb = arm.pose.bones[name]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = euler
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()


def tube_center(arm, side):
    suf = f"_{side}"
    h = arm.matrix_world @ arm.pose.bones["Middle_Proximal" + suf].head
    t = arm.matrix_world @ arm.pose.bones["Middle_Tip" + suf].tail
    return (h + t) * 0.5


def thumb_score(arm, side, tube):
    tip = arm.matrix_world @ arm.pose.bones[f"Thumb_Tip_{side}"].tail
    # Close to the tube in the curl plane, and not past the pinky (negative Z).
    radial = math.hypot(tip.x - tube.x, tip.y - tube.y)
    z_pen = 0.0 if tip.z > -0.01 else ( -0.01 - tip.z) * 4
    return radial + z_pen, tip


def _unused_search_thumb(src, side):
    best = None
    for preset in THUMB_PRESETS:
        arm, mesh = load_hand(src)
        apply_pose(arm, side, preset)
        tube = tube_center(arm, side)
        score, tip = thumb_score(arm, side, tube)
        print(f"THUMB {side} score={score:.3f} tip=({tip.x:+.3f},{tip.y:+.3f},{tip.z:+.3f}) preset={preset}")
        if best is None or score < best[0]:
            best = (score, preset)
    print(f"BEST {side} {best[1]} score={best[0]:.3f}")
    return best[1]


def export_hand(src, side, thumb, out_path):
    arm, mesh = load_hand(src)
    apply_pose(arm, side, thumb)
    bpy.context.view_layer.update()
    tube = tube_center(arm, side)
    # Freeze the curl into the vertices, then make that shape the new rest
    # pose so the rig still bends from a gripped hand.
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="OBJECT")
    arm_mod = next(m.name for m in mesh.modifiers if m.type == "ARMATURE")
    bpy.ops.object.modifier_apply(modifier=arm_mod)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode="OBJECT")
    rebound = mesh.modifiers.new("Armature", "ARMATURE")
    rebound.object = arm
    bpy.context.view_layer.update()
    # Park the crook on the origin, then turn the palm toward +Y.
    delta = Vector((-tube.x, -tube.y, -tube.z))
    arm.location += delta
    mesh.location += delta
    bpy.context.view_layer.update()
    rot = Matrix.Rotation(math.radians(90), 4, "Z")
    for ob in (arm, mesh):
        ob.matrix_world = rot @ ob.matrix_world
    bpy.context.view_layer.update()

    # Wrist marker the sleeves can hang from. Not a bone.
    wrist_bone = arm.pose.bones[f"Wrist_{side}"]
    head = arm.matrix_world @ wrist_bone.head
    empty = bpy.data.objects.new("wrist", None)
    bpy.context.collection.objects.link(empty)
    empty.location = head
    empty.parent = arm
    empty.matrix_parent_inverse = arm.matrix_world.inverted()

    mod = mesh.modifiers.new("sub", "SUBSURF")
    mod.levels = 2
    mod.render_levels = 2
    bpy.context.view_layer.objects.active = mesh
    while mesh.modifiers[0].type != "SUBSURF":
        bpy.ops.object.modifier_move_up(modifier=mod.name)
    for poly in mesh.data.polygons:
        poly.use_smooth = True

    skin = bpy.data.materials.new("skin")
    skin.use_nodes = True
    bs = skin.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (0.72, 0.50, 0.40, 1)
    bs.inputs["Roughness"].default_value = 0.55
    mesh.data.materials.clear()
    mesh.data.materials.append(skin)

    # Confirm the palm side and that the curl still clears a 16mm tube.
    deps = bpy.context.evaluated_depsgraph_get()
    em = mesh.evaluated_get(deps)
    inside = 0
    for v in em.data.vertices:
        p = em.matrix_world @ v.co
        if math.hypot(p.x, p.y) < 0.012:
            inside += 1
    tip = arm.matrix_world @ arm.pose.bones[f"Middle_Tip_{side}"].tail
    wrist = empty.matrix_world.translation
    print(f"EXPORT {side} inside={inside} tip=({tip.x:+.3f},{tip.y:+.3f},{tip.z:+.3f}) wrist=({wrist.x:+.3f},{wrist.y:+.3f},{wrist.z:+.3f})")

    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    mesh.select_set(True)
    empty.select_set(True)
    bpy.context.view_layer.objects.active = arm
    # Default exporter writes the rest pose and drops the grip. Keep the pose.
    mid = arm.pose.bones[f"Middle_Proximal_{side}"]
    print(f"POSE {side} middle Z rad={mid.rotation_euler.z:.3f}")
    render_check(arm, mesh, side)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_skins=True,
        export_animations=False,
        export_rest_position_armature=False,
        export_reset_pose_bones=False,
        export_yup=True,
    )
    print("WROTE", out_path, os.path.getsize(out_path))


def render_check(arm, mesh, side):
    scene = bpy.context.scene
    idents = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in idents else "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.filepath = os.path.join(OUT_DIR, f"grip-check-{side}.png")
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.17, 0.18, 0.2, 1)
    bg.inputs[1].default_value = 0.55
    light = bpy.data.lights.new("key", "AREA")
    light.energy = 35
    light.size = 0.45
    lo = bpy.data.objects.new("key", light)
    bpy.context.collection.objects.link(lo)
    lo.location = (0.15, -0.2, 0.2)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.28
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, 0.0, 0.45)
    cam.rotation_euler = Vector((0, 0, -1)).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    bpy.ops.render.render(write_still=True)
    print("RENDER", scene.render.filepath)


# Thumb presets chosen by the radial search (closest tip to the tube).
LEFT_THUMB = ((0.9, -0.8, -0.4), 0.5, 0.4)
RIGHT_THUMB = ((0.6, -0.4, 0.15), -0.9, -0.7)
export_hand(os.path.join(ROOT, "Hand_Nails_L.gltf"), "L", LEFT_THUMB, os.path.join(OUT_DIR, "hand-grip-l.glb"))
export_hand(os.path.join(ROOT, "Hand_Nails_R.gltf"), "R", RIGHT_THUMB, os.path.join(OUT_DIR, "hand-grip-r.glb"))
