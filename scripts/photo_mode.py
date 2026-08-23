# SPDX-License-Identifier: MIT
"""Photo Mode — free 3D camera, lighting, snapshots, and one-click stills.

WHO THIS IS FOR: photographing the Lancia Stratos HF in Blender.
WHAT IT DOES: a dedicated PHOTO_MODE rig + sidebar that does not touch vehicle
  collections. Snapshots persist in the .blend and as JSON on disk.
HOW IT CONNECTS: scripts/build_stratos_vehicle.py rebuilds STRATOS_VEHICLE only.

Blender 3.6+ / Apple Silicon Metal Cycles.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import bpy
from bpy.props import (
    BoolProperty,
    EnumProperty,
    FloatProperty,
    FloatVectorProperty,
    IntProperty,
    PointerProperty,
    StringProperty,
)
from mathutils import Vector

bl_info = {
    "name": "Stratos Photo Mode",
    "author": "Virtual Racing Game Studio",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > PHOTO MODE",
    "category": "3D View",
}

COL_ROOT = "PHOTO_MODE"
COL_LIGHTS = "PHOTO_LIGHTS"
COL_TARGET = "PHOTO_TARGET"
COL_REF = "PHOTO_REFERENCE"
COL_SNAPS = "PHOTO_SNAPSHOTS"
CAM_NAME = "PHOTO_CAMERA"
TARGET_NAME = "PHOTO_TARGET"
GROUND_NAME = "PHOTO_GROUND"
LIGHTS = ("PHOTO_KEY", "PHOTO_FILL", "PHOTO_RIM", "PHOTO_TOP")
VEHICLE_COL = "STRATOS_VEHICLE"
PROTECTED = {COL_ROOT, COL_LIGHTS, COL_TARGET, COL_REF, COL_SNAPS, CAM_NAME, TARGET_NAME, GROUND_NAME, *LIGHTS}

SNAPSHOT_KEY = "photo_mode_snapshots"
_DRAW_HANDLE = None


def project_root() -> Path:
    here = Path(__file__).resolve() if "__file__" in dir() else None
    if here and here.parent.name == "scripts":
        return here.parent.parent
    fp = bpy.data.filepath
    if fp:
        p = Path(fp).resolve()
        if p.parent.name == "output":
            return p.parent.parent
        return p.parent
    return Path.cwd()


def photos_dir() -> Path:
    d = project_root() / "renders" / "photos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def snapshots_dir() -> Path:
    d = project_root() / "output" / "photo_snapshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def sanitize(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", (name or "").strip().lower()).strip("-")
    return s or "shot"


def _col(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        host = parent or bpy.context.scene.collection
        if col.name not in host.children:
            host.children.link(col)
    return col


def _ensure_child(parent, name):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in parent.children:
        parent.children.link(col)
    return col


def vehicle_objects():
    col = bpy.data.collections.get(VEHICLE_COL)
    if col:
        return [o for o in col.all_objects if o.type == "MESH"]
    return [
        o
        for o in bpy.context.scene.objects
        if o.type == "MESH" and o.name not in PROTECTED and not o.name.startswith("PHOTO_")
    ]


def vehicle_bbox():
    obs = vehicle_objects()
    if not obs:
        return Vector((0, 0, 0.6)), Vector((1.8, 4.0, 1.2))
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for ob in obs:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            mn.x, mn.y, mn.z = min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)
            mx.x, mx.y, mx.z = max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)
    center = (mn + mx) * 0.5
    size = mx - mn
    return center, size


def get_camera():
    return bpy.data.objects.get(CAM_NAME)


def get_target():
    return bpy.data.objects.get(TARGET_NAME)


def get_ground():
    return bpy.data.objects.get(GROUND_NAME)


def get_light(name):
    return bpy.data.objects.get(name)


def vec3(v):
    return [round(float(v[0]), 5), round(float(v[1]), 5), round(float(v[2]), 5)]


def euler3(e):
    return [round(float(e.x), 5), round(float(e.y), 5), round(float(e.z), 5)]


# ---------------------------------------------------------------------------
# Rig
# ---------------------------------------------------------------------------

def ensure_photo_rig():
    """Create the photo-mode hierarchy without touching the vehicle."""
    root = _col(COL_ROOT)
    lights_col = _ensure_child(root, COL_LIGHTS)
    _ensure_child(root, COL_TARGET)
    _ensure_child(root, COL_REF)
    _ensure_child(root, COL_SNAPS)

    cam = bpy.data.objects.get(CAM_NAME)
    if cam is None or cam.type != "CAMERA":
        data = bpy.data.cameras.new(CAM_NAME)
        cam = bpy.data.objects.new(CAM_NAME, data)
        root.objects.link(cam)
    cam.data.lens = cam.data.lens or 50
    cam.data.sensor_width = cam.data.sensor_width or 36
    cam.data.clip_start = 0.02
    cam.data.clip_end = 250
    cam.data.dof.use_dof = True
    cam.data.dof.aperture_fstop = 2.8
    if abs(cam.location.length) < 0.01:
        cam.location = Vector((3.4, -5.6, 1.4))
        cam.rotation_euler = (1.35, 0.0, 0.52)

    tgt = bpy.data.objects.get(TARGET_NAME)
    if tgt is None:
        tgt = bpy.data.objects.new(TARGET_NAME, None)
        tgt.empty_display_type = "SPHERE"
        tgt.empty_display_size = 0.12
        root.objects.link(tgt)
    center, _ = vehicle_bbox()
    if abs(tgt.location.length) < 0.01:
        tgt.location = center
    cam.data.dof.focus_object = tgt

    ground = bpy.data.objects.get(GROUND_NAME)
    if ground is None:
        bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, 0))
        ground = bpy.context.active_object
        ground.name = GROUND_NAME
        for col in list(ground.users_collection):
            col.objects.unlink(ground)
        root.objects.link(ground)
        mat = bpy.data.materials.get("PHOTO_GROUND_MAT") or bpy.data.materials.new("PHOTO_GROUND_MAT")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (0.18, 0.18, 0.19, 1)
            bsdf.inputs["Roughness"].default_value = 0.62
        ground.data.materials.clear()
        ground.data.materials.append(mat)
        try:
            ground.is_shadow_catcher = False
        except Exception:
            pass

    specs = {
        "PHOTO_KEY": ((4.2, -3.4, 3.2), (0.9, 0.2, 0.7), 450, (1.0, 0.96, 0.9), 1.4),
        "PHOTO_FILL": ((-3.8, -2.2, 2.0), (1.1, -0.3, -0.6), 160, (0.75, 0.82, 1.0), 2.4),
        "PHOTO_RIM": ((-1.2, 4.6, 2.6), (1.2, 0.0, 3.3), 280, (1.0, 0.92, 0.82), 1.1),
        "PHOTO_TOP": ((0.0, 0.2, 6.4), (0.0, 0.0, 0.0), 120, (1.0, 1.0, 1.0), 4.0),
    }
    for name, (loc, rot, energy, color, size) in specs.items():
        lamp = bpy.data.objects.get(name)
        if lamp is None or lamp.type != "LIGHT":
            data = bpy.data.lights.new(name, "AREA")
            lamp = bpy.data.objects.new(name, data)
            lights_col.objects.link(lamp)
            lamp.location = loc
            lamp.rotation_euler = rot
            data.energy = energy
            data.color = color
            data.size = size

    scene = bpy.context.scene
    scene.camera = cam
    if SNAPSHOT_KEY not in scene:
        scene[SNAPSHOT_KEY] = "[]"
    configure_cycles(scene)
    ensure_world()
    ensure_compositor(scene)
    return cam


def configure_cycles(scene):
    scene.render.engine = "CYCLES"
    cyc = scene.cycles
    cyc.device = "GPU"
    cyc.samples = 64
    cyc.use_adaptive_sampling = True
    try:
        cyc.adaptive_min_samples = 8
        cyc.adaptive_threshold = 0.02
    except Exception:
        pass
    cyc.use_denoising = True
    try:
        cyc.denoiser = "OPENIMAGEDENOISE"
    except TypeError:
        pass
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    try:
        addon = bpy.context.preferences.addons.get("cycles")
        if addon:
            prefs = addon.preferences
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for dev in getattr(prefs, "devices", []):
                dev.use = True
    except Exception:
        pass


def ensure_world():
    world = bpy.context.scene.world or bpy.data.worlds.new("PHOTO_WORLD")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.12, 0.13, 0.15, 1)
        bg.inputs["Strength"].default_value = 0.35
    return world


def ensure_compositor(scene):
    scene.use_nodes = True
    tree = scene.node_tree
    nodes, links = tree.nodes, tree.links
    rl = nodes.get("PHOTO_RL")
    if rl is None:
        nodes.clear()
        rl = nodes.new("CompositorNodeRLayers")
        rl.name = "PHOTO_RL"
        rl.location = (0, 0)
        hsv = nodes.new("CompositorNodeHueSat")
        hsv.name = "PHOTO_HSV"
        hsv.location = (220, 0)
        bal = nodes.new("CompositorNodeColorBalance")
        bal.name = "PHOTO_BALANCE"
        bal.location = (440, 0)
        out = nodes.new("CompositorNodeComposite")
        out.name = "PHOTO_OUT"
        out.location = (700, 0)
        links.new(rl.outputs["Image"], hsv.inputs["Image"])
        links.new(hsv.outputs["Image"], bal.inputs["Image"])
        links.new(bal.outputs["Image"], out.inputs["Image"])


# ---------------------------------------------------------------------------
# Looks / lighting / camera presets
# ---------------------------------------------------------------------------

LOOKS = {
    "NEUTRAL": {"view": "Standard", "look": "None", "exposure": 0.0, "gamma": 1.0, "sat": 1.0, "gain": (1, 1, 1)},
    "STUDIO": {"view": "Filmic", "look": "Medium High Contrast", "exposure": 0.15, "gamma": 1.0, "sat": 1.02, "gain": (1, 1, 1)},
    "DRAMATIC": {"view": "Filmic", "look": "Very High Contrast", "exposure": -0.25, "gamma": 1.05, "sat": 1.08, "gain": (1.05, 1.0, 0.95)},
    "CINEMATIC": {"view": "Filmic", "look": "Medium Contrast", "exposure": -0.1, "gamma": 0.98, "sat": 0.92, "gain": (1.04, 1.0, 0.94)},
    "HIGH_CONTRAST": {"view": "Filmic", "look": "Very High Contrast", "exposure": 0.0, "gamma": 1.08, "sat": 1.0, "gain": (1, 1, 1)},
    "BLACK_AND_WHITE": {"view": "Filmic", "look": "Medium High Contrast", "exposure": 0.1, "gamma": 1.0, "sat": 0.0, "gain": (1, 1, 1)},
}

LIGHT_PRESETS = {
    "STUDIO": {
        "PHOTO_KEY": {"loc": (4.2, -3.4, 3.2), "rot": (0.9, 0.2, 0.7), "energy": 480, "color": (1, 0.97, 0.92), "size": 1.4, "hide": False},
        "PHOTO_FILL": {"loc": (-3.8, -2.2, 2.0), "rot": (1.1, -0.3, -0.6), "energy": 170, "color": (0.78, 0.84, 1), "size": 2.6, "hide": False},
        "PHOTO_RIM": {"loc": (-1.2, 4.6, 2.6), "rot": (1.2, 0.0, 3.3), "energy": 260, "color": (1, 0.94, 0.86), "size": 1.1, "hide": False},
        "PHOTO_TOP": {"loc": (0.0, 0.2, 6.4), "rot": (0, 0, 0), "energy": 110, "color": (1, 1, 1), "size": 4.5, "hide": False},
        "world": ((0.12, 0.13, 0.15), 0.32),
    },
    "SUNSET": {
        "PHOTO_KEY": {"loc": (6.0, -2.0, 1.6), "rot": (1.35, 0.1, 1.1), "energy": 620, "color": (1.0, 0.55, 0.28), "size": 2.8, "hide": False},
        "PHOTO_FILL": {"loc": (-4.0, -1.5, 1.8), "rot": (1.1, 0, -0.7), "energy": 90, "color": (0.4, 0.5, 0.8), "size": 3.2, "hide": False},
        "PHOTO_RIM": {"loc": (1.5, 5.0, 2.0), "rot": (1.2, 0, 3.4), "energy": 400, "color": (1.0, 0.7, 0.4), "size": 1.6, "hide": False},
        "PHOTO_TOP": {"loc": (0, 0, 7), "rot": (0, 0, 0), "energy": 40, "color": (0.6, 0.45, 0.35), "size": 5, "hide": False},
        "world": ((0.35, 0.16, 0.08), 0.55),
    },
    "OVERCAST": {
        "PHOTO_KEY": {"loc": (2.0, -3.0, 5.0), "rot": (0.4, 0, 0.4), "energy": 220, "color": (0.92, 0.94, 1), "size": 5.0, "hide": False},
        "PHOTO_FILL": {"loc": (-3.0, 1.0, 3.0), "rot": (0.8, 0, -0.4), "energy": 180, "color": (0.9, 0.92, 1), "size": 4.0, "hide": False},
        "PHOTO_RIM": {"loc": (0, 4.0, 3.0), "rot": (1.0, 0, 3.14), "energy": 80, "color": (1, 1, 1), "size": 3.0, "hide": False},
        "PHOTO_TOP": {"loc": (0, 0, 8), "rot": (0, 0, 0), "energy": 200, "color": (0.95, 0.96, 1), "size": 8.0, "hide": False},
        "world": ((0.22, 0.24, 0.26), 0.7),
    },
    "NIGHT": {
        "PHOTO_KEY": {"loc": (3.0, -4.0, 1.4), "rot": (1.2, 0.1, 0.5), "energy": 180, "color": (1.0, 0.85, 0.6), "size": 0.8, "hide": False},
        "PHOTO_FILL": {"loc": (-2.5, -1.0, 1.2), "rot": (1.1, 0, -0.5), "energy": 40, "color": (0.3, 0.4, 0.8), "size": 2.0, "hide": False},
        "PHOTO_RIM": {"loc": (0.4, 4.2, 1.8), "rot": (1.2, 0, 3.2), "energy": 220, "color": (0.5, 0.7, 1.0), "size": 0.7, "hide": False},
        "PHOTO_TOP": {"loc": (0, 0, 6), "rot": (0, 0, 0), "energy": 12, "color": (0.4, 0.45, 0.7), "size": 5, "hide": False},
        "world": ((0.02, 0.025, 0.04), 0.08),
    },
    "SHOWROOM": {
        "PHOTO_KEY": {"loc": (3.5, -4.5, 2.8), "rot": (1.05, 0.15, 0.55), "energy": 520, "color": (1, 0.99, 0.97), "size": 2.0, "hide": False},
        "PHOTO_FILL": {"loc": (-3.6, -2.8, 2.2), "rot": (1.05, -0.1, -0.55), "energy": 260, "color": (1, 1, 1), "size": 2.2, "hide": False},
        "PHOTO_RIM": {"loc": (0, 5.2, 2.4), "rot": (1.15, 0, 3.14), "energy": 300, "color": (1, 1, 1), "size": 1.5, "hide": False},
        "PHOTO_TOP": {"loc": (0, 0, 7.2), "rot": (0, 0, 0), "energy": 240, "color": (1, 1, 1), "size": 6.0, "hide": False},
        "world": ((0.85, 0.85, 0.86), 0.9),
    },
    "DRAMATIC": {
        "PHOTO_KEY": {"loc": (5.5, -1.5, 2.4), "rot": (1.1, 0.3, 1.2), "energy": 700, "color": (1.0, 0.9, 0.75), "size": 0.9, "hide": False},
        "PHOTO_FILL": {"loc": (-4.0, -2.0, 1.4), "rot": (1.2, 0, -0.8), "energy": 35, "color": (0.45, 0.55, 0.9), "size": 2.5, "hide": True},
        "PHOTO_RIM": {"loc": (-2.0, 4.8, 1.6), "rot": (1.3, 0, 3.4), "energy": 520, "color": (1.0, 0.95, 0.85), "size": 0.6, "hide": False},
        "PHOTO_TOP": {"loc": (0, 0, 6.5), "rot": (0, 0, 0), "energy": 20, "color": (1, 1, 1), "size": 3, "hide": True},
        "world": ((0.04, 0.04, 0.05), 0.12),
    },
}

CAMERA_PRESETS = {
    "FRONT_PORTRAIT": {"axis": "front", "dist": 1.55, "height": 0.22, "lens": 85},
    "LOW_FRONT": {"axis": "front", "dist": 1.7, "height": -0.35, "lens": 35},
    "FRONT_THREE_QUARTER": {"axis": "front_q", "dist": 1.85, "height": 0.12, "lens": 50},
    "SIDE_PROFILE": {"axis": "side", "dist": 1.7, "height": 0.05, "lens": 70},
    "REAR_THREE_QUARTER": {"axis": "rear_q", "dist": 1.85, "height": 0.1, "lens": 50},
    "REAR_LOW": {"axis": "rear", "dist": 1.65, "height": -0.32, "lens": 35},
    "TOP_DOWN": {"axis": "top", "dist": 2.4, "height": 0.0, "lens": 50},
    "DETAIL_CLOSEUP": {"axis": "front_q", "dist": 0.55, "height": 0.05, "lens": 85},
    "INTERIOR": {"axis": "interior", "dist": 0.15, "height": 0.18, "lens": 24},
    "WHEEL_DETAIL": {"axis": "wheel", "dist": 0.85, "height": -0.28, "lens": 50},
    "LOW_HERO": {"axis": "front_q", "dist": 1.9, "height": -0.42, "lens": 28},
    "EYE_LEVEL_STUDIO": {"axis": "front_q", "dist": 2.1, "height": 0.18, "lens": 50},
    "AGGRESSIVE_FRONT": {"axis": "front", "dist": 1.35, "height": -0.2, "lens": 24},
    "REAR_RACING": {"axis": "rear_q", "dist": 1.7, "height": -0.15, "lens": 35},
    "COCKPIT": {"axis": "interior", "dist": -0.05, "height": 0.22, "lens": 20},
    "ROOF": {"axis": "top", "dist": 1.6, "height": 0.0, "lens": 35},
}

FRAME_MODES = {
    "FULL_CAR": {"axis": "front_q", "margin": 1.35, "height": 0.1},
    "BODY_CLOSEUP": {"axis": "front_q", "margin": 0.72, "height": 0.12},
    "FRONT": {"axis": "front", "margin": 1.2, "height": 0.08},
    "REAR": {"axis": "rear", "margin": 1.2, "height": 0.08},
    "SIDE": {"axis": "side", "margin": 1.25, "height": 0.05},
}


def look_at(cam, target):
    direction = Vector(target) - cam.location
    if direction.length < 1e-6:
        return
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def camera_offset(axis, dist, height, center, size):
    hx, hy, hz = size.x * 0.5, size.y * 0.5, size.z * 0.5
    if axis == "front":
        return Vector((center.x, center.y - hy - dist, center.z + height))
    if axis == "rear":
        return Vector((center.x, center.y + hy + dist, center.z + height))
    if axis == "side":
        return Vector((center.x + hx + dist, center.y, center.z + height))
    if axis == "front_q":
        return Vector((center.x + hx * 0.85 + dist * 0.55, center.y - hy - dist * 0.75, center.z + height))
    if axis == "rear_q":
        return Vector((center.x + hx * 0.85 + dist * 0.5, center.y + hy + dist * 0.7, center.z + height))
    if axis == "top":
        return Vector((center.x, center.y, center.z + hz + dist))
    if axis == "interior":
        return Vector((center.x, center.y - 0.15, center.z + hz * 0.35 + height))
    if axis == "wheel":
        return Vector((center.x + hx + dist, center.y - hy * 0.55, center.z + height))
    return Vector((center.x + dist, center.y - dist, center.z + height))


def apply_camera_preset(key):
    cam = ensure_photo_rig()
    spec = CAMERA_PRESETS.get(key)
    if not spec:
        return
    center, size = vehicle_bbox()
    loc = camera_offset(spec["axis"], spec["dist"] * max(size.y, 2.0) * 0.55, spec["height"] * size.z, center, size)
    if spec["axis"] == "top":
        loc = camera_offset("top", spec["dist"] * max(size.x, size.y) * 0.5, 0, center, size)
    cam.location = loc
    tgt = get_target()
    aim = Vector(center)
    if spec["axis"] == "wheel":
        aim = Vector((center.x + size.x * 0.42, center.y - size.y * 0.32, center.z - size.z * 0.28))
    elif spec["axis"] == "interior":
        aim = Vector((center.x, center.y + 0.35, center.z + size.z * 0.15))
    if tgt:
        tgt.location = aim
    look_at(cam, aim)
    cam.data.lens = spec["lens"]
    cam.data.type = "PERSP"


def apply_frame(mode):
    cam = ensure_photo_rig()
    spec = FRAME_MODES.get(mode, FRAME_MODES["FULL_CAR"])
    center, size = vehicle_bbox()
    sensor = cam.data.sensor_width
    lens = cam.data.lens
    fov = 2.0 * math_atan((sensor * 0.5) / max(lens, 1.0))
    largest = max(size.x, size.y, size.z)
    dist = (largest * 0.5 * spec["margin"]) / max(0.12, math_tan(fov * 0.5))
    loc = camera_offset(spec["axis"], dist, spec["height"] * size.z, center, size)
    cam.location = loc
    tgt = get_target()
    if tgt:
        tgt.location = center
    look_at(cam, center)


def math_atan(x):
    import math

    return math.atan(x)


def math_tan(x):
    import math

    return math.tan(x)


def apply_look(name):
    spec = LOOKS.get(name, LOOKS["NEUTRAL"])
    scene = bpy.context.scene
    vs = scene.view_settings
    try:
        vs.view_transform = spec["view"]
    except TypeError:
        pass
    try:
        vs.look = spec["look"]
    except TypeError:
        vs.look = "None"
    vs.exposure = spec["exposure"]
    vs.gamma = spec["gamma"]
    ensure_compositor(scene)
    hsv = scene.node_tree.nodes.get("PHOTO_HSV")
    bal = scene.node_tree.nodes.get("PHOTO_BALANCE")
    if hsv:
        hsv.inputs["Saturation"].default_value = spec["sat"]
    if bal:
        g = spec["gain"]
        bal.gain = g if len(g) == 3 else g[:3]
    s = scene.photo_mode
    s.look = name
    s.exposure = spec["exposure"]
    s.saturation = spec["sat"]


def apply_light_preset(name):
    spec = LIGHT_PRESETS.get(name)
    if not spec:
        return
    ensure_photo_rig()
    for lamp_name in LIGHTS:
        lamp = get_light(lamp_name)
        data = spec.get(lamp_name)
        if not lamp or not data:
            continue
        lamp.location = data["loc"]
        lamp.rotation_euler = data["rot"]
        lamp.data.energy = data["energy"]
        lamp.data.color = data["color"]
        lamp.data.size = data["size"]
        lamp.hide_viewport = lamp.hide_render = data["hide"]
    color, strength = spec["world"]
    world = ensure_world()
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (*color, 1)
        bg.inputs["Strength"].default_value = strength
    bpy.context.scene.photo_mode.light_preset = name


def reset_lights():
    apply_light_preset("STUDIO")


def set_look_at_constraint(enable):
    cam = get_camera()
    tgt = get_target()
    if not cam:
        return
    con = cam.constraints.get("PHOTO_LOOK")
    if enable:
        if con is None:
            con = cam.constraints.new("TRACK_TO")
            con.name = "PHOTO_LOOK"
        con.target = tgt
        con.track_axis = "TRACK_NEGATIVE_Z"
        con.up_axis = "UP_Y"
        con.mute = False
    elif con:
        con.mute = True


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------

def load_snapshots():
    raw = bpy.context.scene.get(SNAPSHOT_KEY, "[]")
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def store_snapshots(items):
    bpy.context.scene[SNAPSHOT_KEY] = json.dumps(items)
    bpy.context.scene["photo_mode_snapshot_count"] = len(items)


def next_shot_name(items):
    n = 1
    existing = {i.get("name") for i in items}
    while f"SHOT_{n:03d}" in existing:
        n += 1
    return f"SHOT_{n:03d}"


def capture_state():
    cam = ensure_photo_rig()
    scene = bpy.context.scene
    s = scene.photo_mode
    world = scene.world
    bg = world.node_tree.nodes.get("Background") if world and world.use_nodes else None
    hsv = scene.node_tree.nodes.get("PHOTO_HSV") if scene.use_nodes else None
    lights = {}
    for name in LIGHTS:
        lamp = get_light(name)
        if not lamp:
            continue
        lights[name] = {
            "location": vec3(lamp.location),
            "rotation": euler3(lamp.rotation_euler),
            "energy": lamp.data.energy,
            "color": vec3(lamp.data.color),
            "size": getattr(lamp.data, "size", 1.0),
            "hide": bool(lamp.hide_render),
        }
    vis = {ob.name: bool(ob.hide_render) for ob in vehicle_objects()}
    ground = get_ground()
    return {
        "schema": 1,
        "camera": {
            "location": vec3(cam.location),
            "rotation": euler3(cam.rotation_euler),
            "lens": cam.data.lens,
            "sensor_width": cam.data.sensor_width,
            "type": cam.data.type,
            "dof": cam.data.dof.use_dof,
            "fstop": cam.data.dof.aperture_fstop,
            "focus_distance": cam.data.dof.focus_distance,
            "shift_x": cam.data.shift_x,
            "shift_y": cam.data.shift_y,
            "clip_start": cam.data.clip_start,
            "clip_end": cam.data.clip_end,
        },
        "target": vec3(get_target().location) if get_target() else [0, 0, 0],
        "render": {
            "engine": scene.render.engine,
            "samples": scene.cycles.samples,
            "resolution_x": scene.render.resolution_x,
            "resolution_y": scene.render.resolution_y,
            "file_format": scene.render.image_settings.file_format,
            "film_transparent": scene.render.film_transparent,
        },
        "color": {
            "view_transform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": scene.view_settings.exposure,
            "gamma": scene.view_settings.gamma,
            "saturation": hsv.inputs["Saturation"].default_value if hsv else 1.0,
            "preset": s.look,
        },
        "world": {
            "color": vec3(bg.inputs["Color"].default_value) if bg else [0.1, 0.1, 0.1],
            "strength": bg.inputs["Strength"].default_value if bg else 0.3,
        },
        "ground": {
            "hide": bool(ground.hide_render) if ground else True,
            "location": vec3(ground.location) if ground else [0, 0, 0],
        },
        "lights": lights,
        "light_preset": s.light_preset,
        "vehicle_visibility": vis,
        "output_format": s.output_format,
    }


def restore_state(data):
    cam = ensure_photo_rig()
    scene = bpy.context.scene
    c = data.get("camera", {})
    cam.location = c.get("location", cam.location)
    cam.rotation_euler = c.get("rotation", cam.rotation_euler)
    cam.data.lens = c.get("lens", 50)
    cam.data.sensor_width = c.get("sensor_width", 36)
    cam.data.type = c.get("type", "PERSP")
    cam.data.dof.use_dof = c.get("dof", True)
    cam.data.dof.aperture_fstop = c.get("fstop", 2.8)
    cam.data.dof.focus_distance = c.get("focus_distance", 4.0)
    cam.data.shift_x = c.get("shift_x", 0)
    cam.data.shift_y = c.get("shift_y", 0)
    cam.data.clip_start = c.get("clip_start", 0.02)
    cam.data.clip_end = c.get("clip_end", 250)
    tgt = get_target()
    if tgt and "target" in data:
        tgt.location = data["target"]
    r = data.get("render", {})
    scene.render.engine = r.get("engine", "CYCLES")
    scene.cycles.samples = r.get("samples", 64)
    scene.render.resolution_x = r.get("resolution_x", 1920)
    scene.render.resolution_y = r.get("resolution_y", 1080)
    scene.render.image_settings.file_format = r.get("file_format", "PNG")
    scene.render.film_transparent = r.get("film_transparent", False)
    col = data.get("color", {})
    vs = scene.view_settings
    try:
        vs.view_transform = col.get("view_transform", "Filmic")
        vs.look = col.get("look", "None")
    except TypeError:
        pass
    vs.exposure = col.get("exposure", 0)
    vs.gamma = col.get("gamma", 1)
    ensure_compositor(scene)
    hsv = scene.node_tree.nodes.get("PHOTO_HSV")
    if hsv:
        hsv.inputs["Saturation"].default_value = col.get("saturation", 1)
    w = data.get("world", {})
    bg = scene.world.node_tree.nodes.get("Background") if scene.world else None
    if bg:
        bg.inputs["Color"].default_value = (*w.get("color", [0.12, 0.13, 0.15]), 1)
        bg.inputs["Strength"].default_value = w.get("strength", 0.3)
    for name, spec in data.get("lights", {}).items():
        lamp = get_light(name)
        if not lamp:
            continue
        lamp.location = spec["location"]
        lamp.rotation_euler = spec["rotation"]
        lamp.data.energy = spec["energy"]
        lamp.data.color = spec["color"]
        lamp.data.size = spec.get("size", 1)
        lamp.hide_render = lamp.hide_viewport = spec.get("hide", False)
    ground = get_ground()
    g = data.get("ground", {})
    if ground:
        ground.hide_render = ground.hide_viewport = g.get("hide", False)
        ground.location = g.get("location", ground.location)
    vis = data.get("vehicle_visibility", {})
    for ob in vehicle_objects():
        if ob.name in vis:
            ob.hide_render = vis[ob.name]
    s = scene.photo_mode
    s.look = col.get("preset", s.look)
    s.light_preset = data.get("light_preset", s.light_preset)
    s.output_format = data.get("output_format", s.output_format)
    s.current_snapshot = data.get("name", s.current_snapshot)


def write_snapshot_json(item):
    path = snapshots_dir() / f"{sanitize(item['name'])}.json"
    path.write_text(json.dumps(item, indent=2), encoding="utf-8")
    return path


def save_snapshot(name, overwrite=False):
    items = load_snapshots()
    name = (name or "").strip() or next_shot_name(items)
    if not overwrite:
        existing = {i["name"] for i in items}
        base = name
        n = 2
        while name in existing:
            name = f"{base}_{n:02d}"
            n += 1
    item = capture_state()
    item["name"] = name
    item["saved_at"] = datetime.now().isoformat(timespec="seconds")
    items = [i for i in items if i.get("name") != name]
    items.append(item)
    store_snapshots(items)
    write_snapshot_json(item)
    bpy.context.scene.photo_mode.current_snapshot = name
    bpy.context.scene.photo_mode.snapshot_name = name
    return item


def find_snapshot(name):
    for item in load_snapshots():
        if item.get("name") == name:
            return item
    return None


def render_to_path(path: Path, preview=False, apply_output=True):
    scene = bpy.context.scene
    cam = ensure_photo_rig()
    scene.camera = cam
    prev = {
        "filepath": scene.render.filepath,
        "x": scene.render.resolution_x,
        "y": scene.render.resolution_y,
        "samples": scene.cycles.samples,
        "fmt": scene.render.image_settings.file_format,
        "pct": scene.render.resolution_percentage,
    }
    s = scene.photo_mode
    if preview:
        scene.render.resolution_x = 1280
        scene.render.resolution_y = 720
        scene.cycles.samples = 16
        scene.render.image_settings.file_format = "PNG"
    elif apply_output:
        apply_output_settings(s)
    scene.render.filepath = str(path.with_suffix(""))
    path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    elapsed = time.time() - t0
    scene.render.filepath = prev["filepath"]
    scene.render.resolution_x = prev["x"]
    scene.render.resolution_y = prev["y"]
    scene.cycles.samples = prev["samples"]
    scene.render.image_settings.file_format = prev["fmt"]
    scene.render.resolution_percentage = prev["pct"]
    written = path
    if not written.exists():
        for cand in path.parent.glob(path.stem + ".*"):
            written = cand
            break
    return written, elapsed


def apply_output_settings(s):
    scene = bpy.context.scene
    presets = {
        "720P": (1280, 720),
        "1080P": (1920, 1080),
        "1440P": (2560, 1440),
        "4K": (3840, 2160),
        "CUSTOM": (s.custom_x, s.custom_y),
    }
    scene.render.resolution_x, scene.render.resolution_y = presets.get(s.resolution, (1920, 1080))
    fmt = s.output_format
    scene.render.image_settings.file_format = fmt
    if fmt == "JPEG":
        scene.render.image_settings.quality = s.quality
        scene.render.image_settings.color_mode = "RGB"
    elif fmt == "PNG":
        scene.render.image_settings.color_mode = "RGBA" if s.transparent else "RGB"
        scene.render.image_settings.compression = max(0, 100 - s.quality)
    elif fmt == "OPEN_EXR":
        scene.render.image_settings.color_mode = "RGBA"
    else:
        scene.render.image_settings.color_mode = "RGBA" if s.transparent else "RGB"
    scene.render.film_transparent = s.transparent
    ext = {"PNG": ".png", "JPEG": ".jpg", "TIFF": ".tif", "OPEN_EXR": ".exr"}[fmt]
    return ext


def photo_filename(name, ext):
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    return photos_dir() / f"{stamp}_{sanitize(name)}{ext}"


# ---------------------------------------------------------------------------
# Overlay
# ---------------------------------------------------------------------------

def _guide_shader():
    import gpu

    try:
        return gpu.shader.from_builtin("2D_UNIFORM_COLOR")
    except ValueError:
        return gpu.shader.from_builtin("UNIFORM_COLOR")


def draw_guides():
    s = getattr(bpy.context.scene, "photo_mode", None)
    if not s or not s.active:
        return
    region = bpy.context.region
    if region is None or region.type != "WINDOW":
        return
    space = bpy.context.space_data
    if space and getattr(space, "region_3d", None) and space.region_3d.view_perspective != "CAMERA":
        if not s.show_guides_always:
            return
    import gpu
    from gpu_extras.batch import batch_for_shader

    w, h = region.width, region.height
    shader = _guide_shader()
    col = (*s.guide_color, s.guide_opacity)
    shader.bind()
    shader.uniform_float("color", col)

    def lines(coords):
        batch_for_shader(shader, "LINES", {"pos": coords}).draw(shader)

    if s.guide_thirds:
        lines([(w / 3, 0), (w / 3, h), (2 * w / 3, 0), (2 * w / 3, h), (0, h / 3), (w, h / 3), (0, 2 * h / 3), (w, 2 * h / 3)])
    if s.guide_center:
        lines([(w / 2, 0), (w / 2, h), (0, h / 2), (w, h / 2)])
    if s.guide_golden:
        g = 0.382
        lines([(w * g, 0), (w * g, h), (w * (1 - g), 0), (w * (1 - g), h), (0, h * g), (w, h * g), (0, h * (1 - g)), (w, h * (1 - g))])
    if s.guide_diagonal:
        lines([(0, 0), (w, h), (0, h), (w, 0)])
    if s.guide_horizon:
        lines([(0, h * 0.5), (w, h * 0.5)])
    if s.guide_safe:
        m = 0.08
        x0, x1, y0, y1 = w * m, w * (1 - m), h * m, h * (1 - m)
        lines([(x0, y0), (x1, y0), (x1, y0), (x1, y1), (x1, y1), (x0, y1), (x0, y1), (x0, y0)])


def add_draw_handler():
    global _DRAW_HANDLE
    if _DRAW_HANDLE is None:
        _DRAW_HANDLE = bpy.types.SpaceView3D.draw_handler_add(draw_guides, (), "WINDOW", "POST_PIXEL")


def remove_draw_handler():
    global _DRAW_HANDLE
    if _DRAW_HANDLE is not None:
        bpy.types.SpaceView3D.draw_handler_remove(_DRAW_HANDLE, "WINDOW")
        _DRAW_HANDLE = None


def sync_camera_from_props(s):
    cam = get_camera()
    if not cam:
        return
    cam.location = (s.pos_x, s.pos_y, s.pos_z)
    cam.rotation_euler = (s.rot_x, s.rot_y, s.rot_z)
    cam.data.lens = s.focal
    cam.data.sensor_width = s.sensor
    cam.data.type = s.cam_type
    cam.data.dof.use_dof = s.dof
    cam.data.dof.aperture_fstop = s.fstop
    cam.data.dof.focus_distance = s.focus_distance
    cam.data.shift_x = s.shift_x
    cam.data.shift_y = s.shift_y
    cam.data.clip_start = s.clip_start
    cam.data.clip_end = s.clip_end
    bpy.context.scene.view_settings.exposure = s.exposure
    bpy.context.scene.view_settings.gamma = s.contrast
    hsv = bpy.context.scene.node_tree.nodes.get("PHOTO_HSV") if bpy.context.scene.use_nodes else None
    if hsv:
        hsv.inputs["Saturation"].default_value = s.saturation
        hsv.inputs["Hue"].default_value = 0.5 + s.tint * 0.05
    bal = bpy.context.scene.node_tree.nodes.get("PHOTO_BALANCE") if bpy.context.scene.use_nodes else None
    if bal:
        t = s.temperature
        bal.gain = (1 + t * 0.15 + s.highlights * 0.12, 1.0 + s.highlights * 0.04, 1 - t * 0.15 + s.highlights * 0.02)
        lift = 1 + s.shadows * 0.12
        bal.lift = (lift, lift, lift)


def pull_camera_to_props(s):
    cam = get_camera()
    if not cam:
        return
    s.pos_x, s.pos_y, s.pos_z = cam.location
    s.rot_x, s.rot_y, s.rot_z = cam.rotation_euler
    s.focal = cam.data.lens
    s.sensor = cam.data.sensor_width
    s.cam_type = cam.data.type
    s.dof = cam.data.dof.use_dof
    s.fstop = cam.data.dof.aperture_fstop
    s.focus_distance = cam.data.dof.focus_distance
    s.shift_x = cam.data.shift_x
    s.shift_y = cam.data.shift_y
    s.clip_start = cam.data.clip_start
    s.clip_end = cam.data.clip_end


def _on_cam_update(self, context):
    sync_camera_from_props(self)


def _on_light_update(self, context):
    lamp = get_light(self.active_light)
    if not lamp:
        return
    lamp.location = (self.light_x, self.light_y, self.light_z)
    lamp.rotation_euler = (self.light_rx, self.light_ry, self.light_rz)
    lamp.data.energy = self.light_energy
    lamp.data.color = self.light_color
    lamp.data.size = self.light_size
    lamp.hide_viewport = lamp.hide_render = not self.light_enabled


def _on_world_update(self, context):
    world = ensure_world()
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (*self.world_color, 1)
        bg.inputs["Strength"].default_value = self.world_strength
    context.scene.render.film_transparent = self.transparent
    ground = get_ground()
    if ground:
        ground.hide_viewport = ground.hide_render = not self.ground_on
        if ground.data.materials:
            bsdf = ground.data.materials[0].node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Roughness"].default_value = self.ground_rough
                bsdf.inputs["Base Color"].default_value = (*self.ground_color, 1)


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------

class PhotoModeSettings(bpy.types.PropertyGroup):
    active: BoolProperty(name="Photo Mode", default=False)
    snapshot_name: StringProperty(name="Snapshot Name", default="")
    current_snapshot: StringProperty(name="Current Snapshot", default="")
    look: EnumProperty(
        name="Look",
        items=[(k, k.replace("_", " "), "") for k in LOOKS],
        default="STUDIO",
    )
    light_preset: EnumProperty(
        name="Lights",
        items=[(k, k, "") for k in LIGHT_PRESETS],
        default="STUDIO",
    )
    pos_x: FloatProperty(name="Position X", default=3.4, update=_on_cam_update)
    pos_y: FloatProperty(name="Position Y", default=-5.6, update=_on_cam_update)
    pos_z: FloatProperty(name="Position Z", default=1.4, update=_on_cam_update)
    rot_x: FloatProperty(name="Rotation X", default=1.35, subtype="ANGLE", update=_on_cam_update)
    rot_y: FloatProperty(name="Rotation Y", default=0.0, subtype="ANGLE", update=_on_cam_update)
    rot_z: FloatProperty(name="Rotation Z", default=0.52, subtype="ANGLE", update=_on_cam_update)
    focal: FloatProperty(name="Focal Length", default=50, min=12, max=300, update=_on_cam_update)
    sensor: FloatProperty(name="Sensor Width", default=36, min=10, max=70, update=_on_cam_update)
    cam_type: EnumProperty(name="Type", items=[("PERSP", "Perspective", ""), ("ORTHO", "Orthographic", "")], default="PERSP", update=_on_cam_update)
    dof: BoolProperty(name="Depth of Field", default=True, update=_on_cam_update)
    fstop: FloatProperty(name="F-Stop", default=2.8, min=0.8, max=22, update=_on_cam_update)
    focus_distance: FloatProperty(name="Focus Distance", default=4.0, min=0.05, max=80, update=_on_cam_update)
    shift_x: FloatProperty(name="Shift X", default=0.0, min=-2, max=2, update=_on_cam_update)
    shift_y: FloatProperty(name="Shift Y", default=0.0, min=-2, max=2, update=_on_cam_update)
    clip_start: FloatProperty(name="Clip Start", default=0.02, min=0.001, max=10, update=_on_cam_update)
    clip_end: FloatProperty(name="Clip End", default=250, min=10, max=5000, update=_on_cam_update)
    exposure: FloatProperty(name="Exposure", default=0.0, min=-4, max=4, update=_on_cam_update)
    contrast: FloatProperty(name="Contrast (Gamma)", default=1.0, min=0.4, max=2.2, update=_on_cam_update)
    highlights: FloatProperty(name="Highlights", default=0.0, min=-1, max=1, update=_on_cam_update)
    shadows: FloatProperty(name="Shadows", default=0.0, min=-1, max=1, update=_on_cam_update)
    temperature: FloatProperty(name="Temperature", default=0.0, min=-1, max=1, update=_on_cam_update)
    tint: FloatProperty(name="Tint", default=0.0, min=-1, max=1, update=_on_cam_update)
    saturation: FloatProperty(name="Saturation", default=1.0, min=0, max=2, update=_on_cam_update)
    guide_thirds: BoolProperty(name="Rule of Thirds", default=True)
    guide_center: BoolProperty(name="Center Crosshair", default=False)
    guide_golden: BoolProperty(name="Golden Ratio", default=False)
    guide_diagonal: BoolProperty(name="Diagonals", default=False)
    guide_horizon: BoolProperty(name="Horizon", default=True)
    guide_safe: BoolProperty(name="Safe Frame", default=False)
    show_guides_always: BoolProperty(name="Guides Outside Camera View", default=False)
    guide_opacity: FloatProperty(name="Grid Opacity", default=0.45, min=0.05, max=1)
    guide_color: FloatVectorProperty(name="Guide Color", subtype="COLOR", size=3, default=(1, 0.85, 0.2), min=0, max=1)
    active_light: EnumProperty(name="Light", items=[(n, n.replace("PHOTO_", ""), "") for n in LIGHTS], default="PHOTO_KEY", update=lambda s, c: pull_light(s))
    light_enabled: BoolProperty(name="Enabled", default=True, update=_on_light_update)
    light_x: FloatProperty(name="Light X", default=4.2, update=_on_light_update)
    light_y: FloatProperty(name="Light Y", default=-3.4, update=_on_light_update)
    light_z: FloatProperty(name="Light Z", default=3.2, update=_on_light_update)
    light_rx: FloatProperty(name="Light Rot X", default=0.9, subtype="ANGLE", update=_on_light_update)
    light_ry: FloatProperty(name="Light Rot Y", default=0.2, subtype="ANGLE", update=_on_light_update)
    light_rz: FloatProperty(name="Light Rot Z", default=0.7, subtype="ANGLE", update=_on_light_update)
    light_energy: FloatProperty(name="Intensity", default=450, min=0, max=4000, update=_on_light_update)
    light_color: FloatVectorProperty(name="Color", subtype="COLOR", size=3, default=(1, 0.96, 0.9), min=0, max=1, update=_on_light_update)
    light_size: FloatProperty(name="Size", default=1.4, min=0.05, max=12, update=_on_light_update)
    world_color: FloatVectorProperty(name="World Color", subtype="COLOR", size=3, default=(0.12, 0.13, 0.15), min=0, max=1, update=_on_world_update)
    world_strength: FloatProperty(name="World Strength", default=0.35, min=0, max=8, update=_on_world_update)
    transparent: BoolProperty(name="Transparent Background", default=False, update=_on_world_update)
    studio_bg: BoolProperty(name="Studio Background", default=True)
    ground_on: BoolProperty(name="Ground Plane", default=True, update=_on_world_update)
    ground_rough: FloatProperty(name="Ground Roughness", default=0.62, min=0, max=1, update=_on_world_update)
    ground_color: FloatVectorProperty(name="Ground Color", subtype="COLOR", size=3, default=(0.18, 0.18, 0.19), min=0, max=1, update=_on_world_update)
    output_format: EnumProperty(
        name="Format",
        items=[("PNG", "PNG", ""), ("JPEG", "JPEG", ""), ("TIFF", "TIFF", ""), ("OPEN_EXR", "OPEN_EXR", "")],
        default="PNG",
    )
    resolution: EnumProperty(
        name="Resolution",
        items=[("720P", "1280 x 720", ""), ("1080P", "1920 x 1080", ""), ("1440P", "2560 x 1440", ""), ("4K", "3840 x 2160", ""), ("CUSTOM", "Custom", "")],
        default="1080P",
    )
    custom_x: IntProperty(name="Resolution X", default=1920, min=256, max=8192)
    custom_y: IntProperty(name="Resolution Y", default=1080, min=256, max=8192)
    quality: IntProperty(name="Quality", default=90, min=10, max=100)
    output_dir: StringProperty(name="Output Directory", default="", subtype="DIR_PATH")
    look_at_lock: BoolProperty(name="Look At Target", default=False)
    cam_distance: FloatProperty(name="Camera Distance", default=5.0, min=0.2, max=40)
    frame_mode: EnumProperty(name="Frame", items=[(k, k.replace("_", " "), "") for k in FRAME_MODES], default="FULL_CAR")


def pull_light(s):
    lamp = get_light(s.active_light)
    if not lamp:
        return
    s.light_enabled = not lamp.hide_render
    s.light_x, s.light_y, s.light_z = lamp.location
    s.light_rx, s.light_ry, s.light_rz = lamp.rotation_euler
    s.light_energy = lamp.data.energy
    s.light_color = lamp.data.color
    s.light_size = getattr(lamp.data, "size", 1.0)


# ---------------------------------------------------------------------------
# Operators
# ---------------------------------------------------------------------------

class PHOTO_OT_enter(bpy.types.Operator):
    bl_idname = "photo.enter"
    bl_label = "Enter Photo Mode"
    bl_options = {"REGISTER"}

    def execute(self, context):
        cam = ensure_photo_rig()
        context.scene.camera = cam
        context.scene.photo_mode.active = True
        pull_camera_to_props(context.scene.photo_mode)
        for area in context.screen.areas if context.screen else []:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.region_3d.view_perspective = "CAMERA"
                space.lock_camera = True
                space.overlay.show_ortho_grid = False
                space.shading.type = "MATERIAL"
                try:
                    space.overlay.show_camera_passepartout = True
                except Exception:
                    pass
        self.report({"INFO"}, "Photo Mode on — navigate the viewport to move PHOTO_CAMERA")
        return {"FINISHED"}


class PHOTO_OT_exit(bpy.types.Operator):
    bl_idname = "photo.exit"
    bl_label = "Exit Photo Mode"
    bl_options = {"REGISTER"}

    def execute(self, context):
        context.scene.photo_mode.active = False
        for area in context.screen.areas if context.screen else []:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.lock_camera = False
                space.region_3d.view_perspective = "PERSP"
        self.report({"INFO"}, "Photo Mode off")
        return {"FINISHED"}


class PHOTO_OT_cam_to_view(bpy.types.Operator):
    bl_idname = "photo.camera_to_view"
    bl_label = "Move Camera To View"

    def execute(self, context):
        ensure_photo_rig()
        context.scene.camera = get_camera()
        try:
            bpy.ops.view3d.camera_to_view()
        except Exception:
            pass
        pull_camera_to_props(context.scene.photo_mode)
        return {"FINISHED"}


class PHOTO_OT_view_to_cam(bpy.types.Operator):
    bl_idname = "photo.align_view_to_camera"
    bl_label = "Align View To Camera"

    def execute(self, context):
        context.scene.camera = ensure_photo_rig()
        try:
            bpy.ops.view3d.view_camera()
        except Exception:
            pass
        return {"FINISHED"}


class PHOTO_OT_reset_cam(bpy.types.Operator):
    bl_idname = "photo.reset_camera"
    bl_label = "Reset Camera"

    def execute(self, context):
        apply_camera_preset("FRONT_THREE_QUARTER")
        pull_camera_to_props(context.scene.photo_mode)
        return {"FINISHED"}


class PHOTO_OT_focus_car(bpy.types.Operator):
    bl_idname = "photo.focus_car"
    bl_label = "Focus On Car"

    def execute(self, context):
        cam = ensure_photo_rig()
        tgt = get_target()
        center, _ = vehicle_bbox()
        tgt.location = center
        cam.data.dof.focus_object = tgt
        cam.data.dof.focus_distance = (cam.location - center).length
        context.scene.photo_mode.focus_distance = cam.data.dof.focus_distance
        return {"FINISHED"}


class PHOTO_OT_focus_selected(bpy.types.Operator):
    bl_idname = "photo.focus_selected"
    bl_label = "Focus On Selected Object"

    def execute(self, context):
        ob = context.active_object
        if ob is None or ob.name in (CAM_NAME,):
            self.report({"WARNING"}, "Select a vehicle object first")
            return {"CANCELLED"}
        cam = ensure_photo_rig()
        tgt = get_target()
        tgt.location = ob.matrix_world.translation
        cam.data.dof.focus_object = ob
        cam.data.dof.focus_distance = (cam.location - tgt.location).length
        context.scene.photo_mode.focus_distance = cam.data.dof.focus_distance
        return {"FINISHED"}


class PHOTO_OT_look_at(bpy.types.Operator):
    bl_idname = "photo.look_at_target"
    bl_label = "Look At Target"

    def execute(self, context):
        s = context.scene.photo_mode
        s.look_at_lock = not s.look_at_lock
        if s.look_at_lock:
            cam = ensure_photo_rig()
            tgt = get_target()
            look_at(cam, tgt.location)
            set_look_at_constraint(True)
        else:
            set_look_at_constraint(False)
        pull_camera_to_props(s)
        return {"FINISHED"}


class PHOTO_OT_apply_distance(bpy.types.Operator):
    bl_idname = "photo.apply_distance"
    bl_label = "Apply Camera Distance"

    def execute(self, context):
        cam = ensure_photo_rig()
        tgt = get_target()
        s = context.scene.photo_mode
        direction = cam.location - tgt.location
        if direction.length < 1e-4:
            direction = Vector((0, -1, 0.3))
        cam.location = tgt.location + direction.normalized() * s.cam_distance
        look_at(cam, tgt.location)
        pull_camera_to_props(s)
        return {"FINISHED"}


class PHOTO_OT_frame(bpy.types.Operator):
    bl_idname = "photo.frame_car"
    bl_label = "Frame Car"

    def execute(self, context):
        apply_frame(context.scene.photo_mode.frame_mode)
        pull_camera_to_props(context.scene.photo_mode)
        return {"FINISHED"}


class PHOTO_OT_preset_cam(bpy.types.Operator):
    bl_idname = "photo.camera_preset"
    bl_label = "Camera Preset"
    preset: StringProperty()

    def execute(self, context):
        apply_camera_preset(self.preset)
        pull_camera_to_props(context.scene.photo_mode)
        return {"FINISHED"}


class PHOTO_OT_preset_look(bpy.types.Operator):
    bl_idname = "photo.apply_look"
    bl_label = "Apply Look"

    def execute(self, context):
        apply_look(context.scene.photo_mode.look)
        return {"FINISHED"}


class PHOTO_OT_preset_lights(bpy.types.Operator):
    bl_idname = "photo.apply_lights"
    bl_label = "Apply Lighting Preset"

    def execute(self, context):
        apply_light_preset(context.scene.photo_mode.light_preset)
        pull_light(context.scene.photo_mode)
        return {"FINISHED"}


class PHOTO_OT_reset_lights(bpy.types.Operator):
    bl_idname = "photo.reset_lights"
    bl_label = "Reset Photo Lights"

    def execute(self, context):
        reset_lights()
        pull_light(context.scene.photo_mode)
        return {"FINISHED"}


class PHOTO_OT_fstop(bpy.types.Operator):
    bl_idname = "photo.set_fstop"
    bl_label = "Set F-Stop"
    value: FloatProperty()

    def execute(self, context):
        cam = ensure_photo_rig()
        cam.data.dof.aperture_fstop = self.value
        context.scene.photo_mode.fstop = self.value
        return {"FINISHED"}


class PHOTO_OT_save_snapshot(bpy.types.Operator):
    bl_idname = "photo.save_snapshot"
    bl_label = "Save Snapshot"

    def execute(self, context):
        item = save_snapshot(context.scene.photo_mode.snapshot_name)
        self.report({"INFO"}, f"Saved snapshot {item['name']}")
        return {"FINISHED"}


class PHOTO_OT_load_snapshot(bpy.types.Operator):
    bl_idname = "photo.load_snapshot"
    bl_label = "Load Snapshot"

    def execute(self, context):
        name = context.scene.photo_mode.current_snapshot or context.scene.photo_mode.snapshot_name
        item = find_snapshot(name)
        if not item:
            items = load_snapshots()
            item = items[-1] if items else None
        if not item:
            self.report({"WARNING"}, "No snapshot to load")
            return {"CANCELLED"}
        restore_state(item)
        pull_camera_to_props(context.scene.photo_mode)
        pull_light(context.scene.photo_mode)
        self.report({"INFO"}, f"Loaded {item['name']}")
        return {"FINISHED"}


class PHOTO_OT_delete_snapshot(bpy.types.Operator):
    bl_idname = "photo.delete_snapshot"
    bl_label = "Delete Snapshot"

    def execute(self, context):
        name = context.scene.photo_mode.current_snapshot or context.scene.photo_mode.snapshot_name
        items = [i for i in load_snapshots() if i.get("name") != name]
        store_snapshots(items)
        path = snapshots_dir() / f"{sanitize(name)}.json"
        if path.exists():
            path.unlink()
        self.report({"INFO"}, f"Deleted {name}")
        return {"FINISHED"}


class PHOTO_OT_duplicate_snapshot(bpy.types.Operator):
    bl_idname = "photo.duplicate_snapshot"
    bl_label = "Duplicate Snapshot"

    def execute(self, context):
        name = context.scene.photo_mode.current_snapshot
        item = find_snapshot(name)
        if not item:
            self.report({"WARNING"}, "Nothing to duplicate")
            return {"CANCELLED"}
        copy = dict(item)
        copy["name"] = next_shot_name(load_snapshots())
        items = load_snapshots() + [copy]
        store_snapshots(items)
        write_snapshot_json(copy)
        context.scene.photo_mode.current_snapshot = copy["name"]
        return {"FINISHED"}


class PHOTO_OT_save_photo(bpy.types.Operator):
    bl_idname = "photo.save_photo"
    bl_label = "Save Photo"

    def execute(self, context):
        s = context.scene.photo_mode
        ext = apply_output_settings(s)
        name = s.snapshot_name or s.current_snapshot or "photo"
        path = photo_filename(name, ext)
        written, elapsed = render_to_path(path)
        self.report({"INFO"}, f"Saved {written.name} in {elapsed:.1f}s")
        print("PHOTO saved", written, f"{elapsed:.2f}s")
        return {"FINISHED"}


class PHOTO_OT_save_photo_json(bpy.types.Operator):
    bl_idname = "photo.save_photo_json"
    bl_label = "Save Photo + JSON"

    def execute(self, context):
        item = save_snapshot(context.scene.photo_mode.snapshot_name)
        bpy.ops.photo.save_photo()
        self.report({"INFO"}, f"Photo + JSON for {item['name']}")
        return {"FINISHED"}


class PHOTO_OT_render_snapshot(bpy.types.Operator):
    bl_idname = "photo.render_snapshot"
    bl_label = "Render Snapshot"

    def execute(self, context):
        bpy.ops.photo.load_snapshot()
        bpy.ops.photo.save_photo()
        return {"FINISHED"}


class PHOTO_OT_render_all(bpy.types.Operator):
    bl_idname = "photo.render_all"
    bl_label = "Render All Snapshots"

    def execute(self, context):
        backup = capture_state()
        backup["name"] = "__current__"
        items = load_snapshots()
        report = []
        s = context.scene.photo_mode
        ext = apply_output_settings(s)
        for item in items:
            restore_state(item)
            path = photo_filename(item["name"], ext)
            try:
                written, elapsed = render_to_path(path, apply_output=False)
                report.append(
                    {
                        "snapshot": item["name"],
                        "filename": str(written),
                        "resolution": [context.scene.render.resolution_x, context.scene.render.resolution_y],
                        "render_time": round(elapsed, 3),
                        "success": True,
                        "timestamp": datetime.now().isoformat(timespec="seconds"),
                    }
                )
            except Exception as err:
                report.append(
                    {
                        "snapshot": item["name"],
                        "filename": None,
                        "success": False,
                        "error": str(err),
                        "timestamp": datetime.now().isoformat(timespec="seconds"),
                    }
                )
        restore_state(backup)
        pull_camera_to_props(s)
        out = snapshots_dir() / "render_report.json"
        out.write_text(json.dumps(report, indent=2), encoding="utf-8")
        self.report({"INFO"}, f"Rendered {len(items)} snapshots — {out}")
        return {"FINISHED"}


class PHOTO_OT_preview(bpy.types.Operator):
    bl_idname = "photo.render_preview"
    bl_label = "Render Preview"

    def execute(self, context):
        path = photos_dir() / "_preview.png"
        written, elapsed = render_to_path(path, preview=True)
        self.report({"INFO"}, f"Preview {written.name} ({elapsed:.1f}s)")
        return {"FINISHED"}


class PHOTO_OT_open_folder(bpy.types.Operator):
    bl_idname = "photo.open_output_folder"
    bl_label = "Open Output Folder"

    def execute(self, context):
        path = photos_dir()
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
        return {"FINISHED"}


class PHOTO_OT_copy_path(bpy.types.Operator):
    bl_idname = "photo.copy_output_path"
    bl_label = "Copy Output Path"

    def execute(self, context):
        context.window_manager.clipboard = str(photos_dir())
        self.report({"INFO"}, str(photos_dir()))
        return {"FINISHED"}


class PHOTO_OT_pick_snapshot(bpy.types.Operator):
    bl_idname = "photo.pick_snapshot"
    bl_label = "Select Snapshot"
    name: StringProperty()

    def execute(self, context):
        context.scene.photo_mode.current_snapshot = self.name
        context.scene.photo_mode.snapshot_name = self.name
        return {"FINISHED"}


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------

class PHOTO_PT_base:
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "PHOTO MODE"


class PHOTO_PT_main(PHOTO_PT_base, bpy.types.Panel):
    bl_label = "PHOTO MODE"

    def draw(self, context):
        s = context.scene.photo_mode
        cam = get_camera()
        col = self.layout.column(align=True)
        row = col.row(align=True)
        row.operator("photo.enter", icon="CAMERA_DATA")
        row.operator("photo.exit", icon="LOOP_BACK")
        col.separator()
        col.label(text=f"Current Snapshot: {s.current_snapshot or '—'}")
        col.label(text=f"Output: {photos_dir()}")
        if cam:
            loc = cam.location
            col.label(text=f"XYZ  {loc.x:.2f}  {loc.y:.2f}  {loc.z:.2f}")
            col.label(text=f"{cam.data.lens:.0f}mm   f/{cam.data.dof.aperture_fstop:.1f}   {cam.data.dof.focus_distance:.2f}m")
            col.label(text=f"{context.scene.render.resolution_x} x {context.scene.render.resolution_y}")


class PHOTO_PT_camera(PHOTO_PT_base, bpy.types.Panel):
    bl_label = "CAMERA"
    bl_parent_id = "PHOTO_PT_main"

    def draw(self, context):
        s = context.scene.photo_mode
        lay = self.layout
        col = lay.column(align=True)
        col.prop(s, "pos_x")
        col.prop(s, "pos_y")
        col.prop(s, "pos_z")
        col.prop(s, "rot_x")
        col.prop(s, "rot_y")
        col.prop(s, "rot_z")
        col.separator()
        col.operator("photo.camera_to_view")
        col.operator("photo.align_view_to_camera")
        col.operator("photo.reset_camera")
        col.operator("photo.focus_car")
        col.operator("photo.focus_selected")
        col.separator()
        col.label(text="Presets")
        grid = col.grid_flow(row_major=True, columns=2, even_columns=True, align=True)
        for key in CAMERA_PRESETS:
            op = grid.operator("photo.camera_preset", text=key.replace("_", " ").title())
            op.preset = key


class PHOTO_PT_lens(PHOTO_PT_base, bpy.types.Panel):
    bl_label = "LENS"
    bl_parent_id = "PHOTO_PT_main"

    def draw(self, context):
        s = context.scene.photo_mode
        col = self.layout.column(align=True)
        col.prop(s, "focal")
        col.prop(s, "sensor")
        col.prop(s, "cam_type")
        col.prop(s, "shift_x")
        col.prop(s, "shift_y")
        col.prop(s, "clip_start")
        col.prop(s, "clip_end")


class PHOTO_PT_dof(PHOTO_PT_base, bpy.types.Panel):
    bl_label = "DEPTH OF FIELD"
    bl_parent_id = "PHOTO_PT_main"

    def draw(self, context):
        s = context.scene.photo_mode
        col = self.layout.column(align=True)
        col.prop(s, "dof")
        col.prop(s, "focus_distance")
        col.prop(s, "fstop")
        row = col.row(align=True)
        for v in (1.4, 2.0, 2.8, 4.0, 5.6, 8.0, 11.0):
            op = row.operator("photo.set_fstop", text=f"f/{v:g}")
            op.value = v


class PHOTO_PT_exposure(PHOTO_PT_base, bpy.types.Panel):
    bl_label = "EXPOSURE"
    bl_parent_id = "PHOTO_PT_main"

    def draw(self, context):
        s = context.scene.photo_mode
        col = self.layout.column(align=True)
        col.prop(s, "look")
        col.operator("photo.apply_look")
        col.prop(s, "exposure")
        col.prop(s, "contrast")
        col.prop(s, "highlights")
        col.prop(s, "shadows")
        col.prop(s, "temperature")
        col.prop(s, "tint")
        col.prop(s, "saturation")


class PHOTO_PT_comp(PHOTO_PT_base, bpy.types.Panel):
    bl_label = "COMPOSITION"
    bl_parent_id = "PHOTO_PT_main"

    def draw(self, context):
        s = context.scene.photo_mode
        col = self.layout.column(align=True)
        col.prop(s, "guide_thirds")
        col.prop(s, "guide_center")
        col.prop(s, "guide_golden")
        col.prop(s, "guide_diagonal")
        col.prop(s, "guide_horizon")
        col.prop(s, "guide_safe")
        col.prop(s, "guide_opacity")
        col.prop(s, "guide_color")
        col.separator()
        col.prop(s, "frame_mode")
        col.operator("photo.frame_car")
        col.prop(s, "look_at_lock")
        col.operator("photo.look_at_target")
        col.prop(s, "cam_distance")
        col.operator("photo.apply_distance")
        tgt = get_target()
        if tgt:
            col.prop(tgt, "location", text="Target")


class PHOTO_PT_lights(PHOTO_PT_base, bpy.types.Panel):
    bl_label = "LIGHTING"
    bl_parent_id = "PHOTO_PT_main"

    def draw(self, context):
        s = context.scene.photo_mode
        col = self.layout.column(align=True)
        col.prop(s, "light_preset")
        col.operator("photo.apply_lights")
        col.operator("photo.reset_lights")
        col.separator()
        col.prop(s, "active_light")
        col.prop(s, "light_enabled")
        col.prop(s, "light_x")
        col.prop(s, "light_y")
        col.prop(s, "light_z")
        col.prop(s, "light_rx")
        col.prop(s, "light_ry")
        col.prop(s, "light_rz")
        col.prop(s, "light_energy")
        col.prop(s, "light_color")
        col.prop(s, "light_size")
        col.separator()
        col.prop(s, "world_color")
        col.prop(s, "world_strength")
        col.prop(s, "transparent")
        col.prop(s, "ground_on")
        col.prop(s, "ground_color")
        col.prop(s, "ground_rough")


class PHOTO_PT_snaps(PHOTO_PT_base, bpy.types.Panel):
    bl_label = "SNAPSHOT"
    bl_parent_id = "PHOTO_PT_main"

    def draw(self, context):
        s = context.scene.photo_mode
        col = self.layout.column(align=True)
        col.prop(s, "snapshot_name")
        col.operator("photo.save_snapshot")
        col.operator("photo.load_snapshot")
        col.operator("photo.delete_snapshot")
        col.operator("photo.duplicate_snapshot")
        col.operator("photo.render_snapshot")
        col.operator("photo.render_all")
        col.separator()
        for item in load_snapshots():
            op = col.operator("photo.pick_snapshot", text=item.get("name", "?"), depress=item.get("name") == s.current_snapshot)
            op.name = item.get("name", "")


class PHOTO_PT_out(PHOTO_PT_base, bpy.types.Panel):
    bl_label = "OUTPUT"
    bl_parent_id = "PHOTO_PT_main"

    def draw(self, context):
        s = context.scene.photo_mode
        col = self.layout.column(align=True)
        col.prop(s, "output_format")
        col.prop(s, "resolution")
        if s.resolution == "CUSTOM":
            col.prop(s, "custom_x")
            col.prop(s, "custom_y")
        col.prop(s, "quality")
        col.prop(s, "transparent")
        col.label(text=str(photos_dir()))
        col.operator("photo.save_photo", icon="RENDER_STILL")
        col.operator("photo.save_photo_json")
        col.operator("photo.render_preview")
        col.operator("photo.open_output_folder")
        col.operator("photo.copy_output_path")


CLASSES = (
    PhotoModeSettings,
    PHOTO_OT_enter,
    PHOTO_OT_exit,
    PHOTO_OT_cam_to_view,
    PHOTO_OT_view_to_cam,
    PHOTO_OT_reset_cam,
    PHOTO_OT_focus_car,
    PHOTO_OT_focus_selected,
    PHOTO_OT_look_at,
    PHOTO_OT_apply_distance,
    PHOTO_OT_frame,
    PHOTO_OT_preset_cam,
    PHOTO_OT_preset_look,
    PHOTO_OT_preset_lights,
    PHOTO_OT_reset_lights,
    PHOTO_OT_fstop,
    PHOTO_OT_save_snapshot,
    PHOTO_OT_load_snapshot,
    PHOTO_OT_delete_snapshot,
    PHOTO_OT_duplicate_snapshot,
    PHOTO_OT_save_photo,
    PHOTO_OT_save_photo_json,
    PHOTO_OT_render_snapshot,
    PHOTO_OT_render_all,
    PHOTO_OT_preview,
    PHOTO_OT_open_folder,
    PHOTO_OT_copy_path,
    PHOTO_OT_pick_snapshot,
    PHOTO_PT_main,
    PHOTO_PT_camera,
    PHOTO_PT_lens,
    PHOTO_PT_dof,
    PHOTO_PT_exposure,
    PHOTO_PT_comp,
    PHOTO_PT_lights,
    PHOTO_PT_snaps,
    PHOTO_PT_out,
)


def _embed_script():
    """Keep a Register text block so the UI survives file reopen."""
    src = Path(__file__).read_text(encoding="utf-8") if "__file__" in globals() else ""
    if not src:
        return
    text = bpy.data.texts.get("photo_mode.py") or bpy.data.texts.new("photo_mode.py")
    if text.as_string() != src:
        text.clear()
        text.write(src)
    text.use_module = True


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.photo_mode = PointerProperty(type=PhotoModeSettings)
    add_draw_handler()


def unregister():
    remove_draw_handler()
    if hasattr(bpy.types.Scene, "photo_mode"):
        del bpy.types.Scene.photo_mode
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


def setup_and_enter():
    register()
    ensure_photo_rig()
    apply_look("STUDIO")
    apply_light_preset("STUDIO")
    apply_camera_preset("FRONT_THREE_QUARTER")
    pull_camera_to_props(bpy.context.scene.photo_mode)
    pull_light(bpy.context.scene.photo_mode)
    _embed_script()
    bpy.context.scene.photo_mode.active = True
    bpy.context.scene.camera = get_camera()


if __name__ == "__main__":
    try:
        unregister()
    except Exception:
        pass
    setup_and_enter()
    print("PHOTO_MODE ready", get_camera().name if get_camera() else "NO CAM")
