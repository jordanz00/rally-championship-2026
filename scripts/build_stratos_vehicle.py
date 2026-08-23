#!/usr/bin/env python3
"""Build the Stratos into STRATOS_VEHICLE only.

WHO THIS IS FOR: the Blender Stratos project.
WHAT IT DOES: imports (or generates) the car into one collection.
HOW IT CONNECTS: photo mode lives in PHOTO_MODE and must survive this rebuild.

Never deletes PHOTO_MODE, PHOTO_CAMERA, lights, snapshots, or JSON on disk.
Never calls read_factory_settings.
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
GLB = ROOT / "assets" / "stratos" / "stratos.glb"
VEHICLE_COL = "STRATOS_VEHICLE"
PROTECTED = {
    "PHOTO_MODE",
    "PHOTO_LIGHTS",
    "PHOTO_TARGET",
    "PHOTO_REFERENCE",
    "PHOTO_SNAPSHOTS",
}


def _col(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def _unlink_hierarchy(col):
    for child in list(col.children):
        _unlink_hierarchy(child)
        col.children.unlink(child)
        if child.name not in PROTECTED:
            bpy.data.collections.remove(child)
    for ob in list(col.objects):
        col.objects.unlink(ob)
        if ob.name.startswith("PHOTO_"):
            continue
        if ob.users == 0:
            bpy.data.objects.remove(ob, do_unlink=True)


def clear_vehicle():
    col = _col(VEHICLE_COL)
    _unlink_hierarchy(col)
    for ob in list(col.objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def _import_glb():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    return [o for o in bpy.data.objects if o not in before]


def _link_to_vehicle(objects):
    dest = _col(VEHICLE_COL)
    scene = bpy.context.scene.collection
    for ob in objects:
        for col in list(ob.users_collection):
            col.objects.unlink(ob)
        dest.objects.link(ob)
        if ob.name in scene.objects:
            try:
                scene.objects.unlink(ob)
            except RuntimeError:
                pass


def build_vehicle():
    """Rebuild only STRATOS_VEHICLE. Photo mode collections stay intact."""
    clear_vehicle()
    if GLB.is_file():
        imported = _import_glb()
        _link_to_vehicle(imported)
        print(f"STRATOS_VEHICLE: imported {len(imported)} objects from {GLB}")
        return VEHICLE_COL
    print("STRATOS_VEHICLE: GLB missing, generating placeholder")
    _generate_placeholder()
    return VEHICLE_COL


def _generate_placeholder():
    """Minimal wedge so photo mode can frame something if the GLB is gone."""
    dest = _col(VEHICLE_COL)
    mesh = bpy.data.meshes.new("Stratos_Body")
    ob = bpy.data.objects.new("Stratos_Body", mesh)
    dest.objects.link(ob)
    import bmesh

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(1.7, 3.8, 1.1), verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    ob.location = Vector((0, 0, 0.55))
    mat = bpy.data.materials.new("Stratos_Body")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.72, 0.07, 0.08, 1)
    ob.data.materials.append(mat)


def register():
    pass


def unregister():
    pass


if __name__ == "__main__":
    build_vehicle()
