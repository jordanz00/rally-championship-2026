"""Print object names and world bbox for a GLB. Usage: blender --background --python inspect-car-glb.py -- path.glb"""
import bpy
import sys
from mathutils import Vector

argv = sys.argv
path = argv[argv.index("--") + 1] if "--" in argv else ""
if not path:
    raise SystemExit("need -- path.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
print("===", path, "===")
for ob in bpy.data.objects:
    loc = ob.matrix_world.translation
    print(f"{ob.type:8} {ob.name:40} loc=({loc.x:7.2f},{loc.y:7.2f},{loc.z:7.2f})")
minv = Vector((1e9, 1e9, 1e9))
maxv = Vector((-1e9, -1e9, -1e9))
for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    for c in ob.bound_box:
        w = ob.matrix_world @ Vector(c)
        minv.x = min(minv.x, w.x)
        minv.y = min(minv.y, w.y)
        minv.z = min(minv.z, w.z)
        maxv.x = max(maxv.x, w.x)
        maxv.y = max(maxv.y, w.y)
        maxv.z = max(maxv.z, w.z)
print("bbox min", tuple(round(v, 3) for v in minv))
print("bbox max", tuple(round(v, 3) for v in maxv))
print("size", tuple(round(v, 3) for v in (maxv - minv)))
