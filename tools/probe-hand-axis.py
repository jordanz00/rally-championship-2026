"""Print which bone axis closes the imported grip."""
import bpy
import os

ROOT = "/Users/jordanzabady/Desktop/Cursor Projects/Sega_Rally_Clone/assets/driver"


def measure(path, side):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    suf = f"_{side}"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")

    def dist():
        bpy.context.view_layer.update()
        w = arm.matrix_world @ arm.pose.bones[f"Wrist{suf}"].head
        t = arm.matrix_world @ arm.pose.bones[f"Middle_Tip{suf}"].tail
        return (t - w).length

    names = [f"Middle_{j}{suf}" for j in ("Proximal", "Intermediate", "Distal")]
    base = dist()
    print(f"REST {side} {base:.3f}")
    for axis in range(3):
        for ang in (1.2, -1.2):
            for name in names:
                pb = arm.pose.bones[name]
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = (0, 0, 0)
                pb.rotation_euler[axis] = ang
            print(f"  axis{axis} {ang:+.1f} -> {dist():.3f}")
            for name in names:
                arm.pose.bones[name].rotation_euler = (0, 0, 0)


measure(os.path.join(ROOT, "hand-grip-l.glb"), "L")
measure(os.path.join(ROOT, "hand-grip-r.glb"), "R")
