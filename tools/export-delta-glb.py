"""Export TARANTULA's CC-BY Integrale as a compact game GLB.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    "/tmp/delta-src/unpacked/Integrale HF.blend" --python tools/export-delta-glb.py

Fixes vs the first export:
  - 180° yaw so glTF +Z is the nose (game forward)
  - wheel empties at the true hub, children with identity locals
  - rims parented to the same hub so they spin with the tire
"""
import math
import os
from mathutils import Matrix, Vector
from pathlib import Path

import bpy

ROOT = Path("/tmp/delta-src/unpacked")
TEX = ROOT / "Textures"
OUT = Path("/Users/jordanzabady/Desktop/Cursor Projects/Sega_Rally_Clone/assets/delta/integrale.glb")
MAX_TEX = 512

KEEP = {
    "Black",
    "Body",
    "Glass",
    "Shield",
    "Detail",
    "Cube",
    "Exhaust",
    "Light Front",
    "Light Rear.001",
    "Heating threads",
    "Frame",
    "Light glass",
    "Light Glass Bump",
    "Number Plate",
    "Number Plate.001",
    "rim 2",
    "rim F",
    "rim F.001",
    "Tire_Low",
    "Tire_Low.001",
    "Tire_Low.002",
    "Tire_Low.003",
    "rim 2.001",
    "rim F.002",
}

by_base = {}
for p in TEX.rglob("*"):
    if p.is_file():
        by_base.setdefault(p.name.lower(), p)


def find_tex(img):
    name = os.path.basename((img.filepath or img.name).replace("\\", "/")).lower()
    if name in by_base:
        return by_base[name]
    stem = os.path.splitext(name)[0]
    for k, p in by_base.items():
        if os.path.splitext(k)[0] == stem:
            return p
    return None


def load_images():
    for img in list(bpy.data.images):
        src = find_tex(img)
        if not src:
            continue
        try:
            img.filepath = str(src)
            img.reload()
        except Exception as err:
            print("reload fail", img.name, err)
            continue
        if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
            img.scale(MAX_TEX, MAX_TEX)


def drop_extras():
    bpy.ops.object.select_all(action="DESELECT")
    for ob in list(bpy.data.objects):
        if ob.name not in KEEP:
            bpy.data.objects.remove(ob, do_unlink=True)


def object_mode():
    if bpy.context.view_layer.objects.active and bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def face_plus_z():
    """Blender +Y nose becomes glTF -Z. Spin 180° around Z so the nose is +Z in-game."""
    object_mode()
    bpy.ops.object.select_all(action="SELECT")
    for ob in bpy.context.selected_objects:
        ob.hide_set(False)
        ob.hide_viewport = False
    bpy.ops.transform.rotate(value=math.pi, orient_axis="Z", orient_type="GLOBAL")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def origin_geometry(ob):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    ob.select_set(False)


def snap_to_hub(child, empty):
    """Park the mesh on the hub with a zero local transform so glTF does not double-translate."""
    child.parent = None
    child.parent = empty
    child.matrix_parent_inverse = Matrix.Identity(4)
    child.location = (0.0, 0.0, 0.0)
    child.rotation_euler = (0.0, 0.0, 0.0)
    child.scale = (1.0, 1.0, 1.0)


def group_wheels():
    object_mode()
    tires = [o for o in bpy.data.objects if o.name.startswith("Tire_Low")]
    rims = [o for o in bpy.data.objects if o.name.lower().startswith("rim")]
    for ob in tires + rims:
        origin_geometry(ob)
    used = set()
    for i, tire in enumerate(tires):
        loc = tire.matrix_world.translation.copy()
        empty = bpy.data.objects.new(f"Wheel_{i}", None)
        bpy.context.scene.collection.objects.link(empty)
        empty.location = loc
        empty.empty_display_size = 0.2
        snap_to_hub(tire, empty)
        nearest = None
        best = 1e9
        for rim in rims:
            if rim.name in used:
                continue
            d = (rim.matrix_world.translation - loc).length
            if d < best:
                best = d
                nearest = rim
        if nearest is not None and best < 1.5:
            snap_to_hub(nearest, empty)
            used.add(nearest.name)
        for rim in rims:
            if rim.name in used:
                continue
            if (rim.matrix_world.translation - loc).length < 0.45:
                snap_to_hub(rim, empty)
                used.add(rim.name)


def select_car():
    bpy.ops.object.select_all(action="DESELECT")
    for ob in bpy.data.objects:
        ob.hide_set(False)
        ob.hide_viewport = False
        ob.hide_render = False
        ob.select_set(True)


load_images()
drop_extras()
face_plus_z()
group_wheels()
select_car()
OUT.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_image_format="JPEG",
    export_jpeg_quality=72,
    export_cameras=False,
    export_lights=False,
    export_extras=False,
)

print("wrote", OUT, "bytes", OUT.stat().st_size)
