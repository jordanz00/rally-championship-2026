#!/usr/bin/env python3
"""
upgrade-trackside-props.py — replace Kenney low-poly trackside GLBs with
Poly Haven CC0 denser meshes (+ densify remaining Kenney props).

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/upgrade-trackside-props.py

Maps:
  concrete_road_barrier     → barrier_wall.glb
  concrete_road_barrier_02  → road_side_barrier.glb (+ barrier_red/white variants)
  modular_chainlink_fence   → construction_fence.glb (+ fence_straight)
  painted_wooden_bench      → bench.glb
  wooden_crate_01           → crate.glb

Remaining Kenney trackside kinds get Subdivision×2 densify in place.
"""

from __future__ import annotations

import math
import shutil
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
PROPS = ROOT / "assets" / "props"
HD = PROPS / "hd-src" / "polyhaven"
BACKUP = PROPS / "_kenney_backup"

# (source_folder, source_fbx_name, dest_glb_stem, optional_tint_rgb)
PH_MAP = [
    ("concrete_road_barrier", "concrete_road_barrier.fbx", "barrier_wall", None),
    ("concrete_road_barrier_02", "concrete_road_barrier_02.fbx", "road_side_barrier", None),
    ("concrete_road_barrier_02", "concrete_road_barrier_02.fbx", "barrier_red", (0.85, 0.18, 0.12)),
    ("concrete_road_barrier_02", "concrete_road_barrier_02.fbx", "barrier_white", (0.92, 0.92, 0.9)),
    ("modular_chainlink_fence", "modular_chainlink_fence.fbx", "construction_fence", None),
    ("modular_chainlink_fence", "modular_chainlink_fence.fbx", "fence_straight", None),
    ("painted_wooden_bench", "painted_wooden_bench.fbx", "bench", None),
    ("wooden_crate_01", "wooden_crate_01.fbx", "crate", None),
]

# Kenney leftovers to densify (keep silhouette, raise poly count).
DENSIFY_KINDS = [
    "barrier_wall",  # overwritten by PH first if present — also listed for safety
    "fence_curved",
    "grandstand",
    "grandstand_covered",
    "billboard",
    "billboard_low",
    "gantry_overhead",
    "gantry_overhead_lights",
    "flag_checkers",
    "flag_red",
    "pylon",
    "light_post",
    "rail",
    "rail_double",
    "banner_tower",
    "construction_barrier",
    "construction_cone",
    "road_sign_empty",
    "sign_highway",
]


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        bpy.data.images.remove(block)


def import_fbx(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=True)
    return [o for o in bpy.data.objects if o not in before and o.type == "MESH"]


def import_glb(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [o for o in bpy.data.objects if o not in before and o.type == "MESH"]


def join_selected(meshes: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj


def ground_and_orient(obj: bpy.types.Object, target_height: float | None = None) -> None:
    """Y-up FBX often arrives Z-up already in Blender; ground feet on Z=0."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    # Apply rotation/scale first
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    min_z = min(c.z for c in coords)
    max_z = max(c.z for c in coords)
    min_x = min(c.x for c in coords)
    max_x = max(c.x for c in coords)
    min_y = min(c.y for c in coords)
    max_y = max(c.y for c in coords)
    # Center XZ, ground Z
    cx = (min_x + max_x) * 0.5
    cy = (min_y + max_y) * 0.5
    obj.location.x -= cx
    obj.location.y -= cy
    obj.location.z -= min_z
    bpy.ops.object.transform_apply(location=True)

    if target_height is not None:
        coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
        h = max(c.z for c in coords) - min(c.z for c in coords)
        if h > 1e-4:
            s = target_height / h
            obj.scale = (s, s, s)
            bpy.ops.object.transform_apply(scale=True)
            coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
            min_z = min(c.z for c in coords)
            obj.location.z -= min_z
            bpy.ops.object.transform_apply(location=True)


def tint_materials(obj: bpy.types.Object, rgb) -> None:
    r, g, b = rgb
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                # Multiply existing base color
                cur = n.inputs["Base Color"].default_value
                n.inputs["Base Color"].default_value = (
                    cur[0] * 0.35 + r * 0.65,
                    cur[1] * 0.35 + g * 0.65,
                    cur[2] * 0.35 + b * 0.65,
                    1.0,
                )


def repair_packed_images(folder: Path) -> None:
    """Remap missing FBX texture refs to downloaded Poly Haven 1k maps."""
    files = {p.name.lower(): p for p in folder.iterdir() if p.is_file()}
    for img in list(bpy.data.images):
        if img.size[0] > 0 and img.size[1] > 0:
            continue
        stem = Path(img.name).stem.lower().replace(".png", "").replace(".jpg", "")
        # Try exact / _1k.jpg variants
        candidates = [
            f"{stem}_1k.jpg",
            f"{stem}_1k.png",
            f"{stem}.jpg",
            f"{stem}.png",
            img.name.lower(),
        ]
        # Also strip trailing _diff style mismatches
        hit = None
        for c in candidates:
            if c in files:
                hit = files[c]
                break
        if not hit:
            # fuzzy: any file containing the core token
            token = stem.replace("_1k", "")
            for name, path in files.items():
                if token in name and name.endswith((".jpg", ".png")):
                    hit = path
                    break
        if hit:
            try:
                img.filepath = str(hit)
                img.reload()
                print(f"    repaired tex {img.name} ← {hit.name}", flush=True)
            except Exception as e:
                print(f"    tex repair fail {img.name}: {e}", flush=True)


def attach_diffuse_if_present(obj: bpy.types.Object, folder: Path) -> None:
    repair_packed_images(folder)
    diffs = sorted(folder.glob("*diff*_1k.jpg")) + sorted(folder.glob("*diff*.jpg"))
    if not diffs:
        return
    img = bpy.data.images.load(str(diffs[0]))
    for slot in obj.material_slots:
        mat = slot.material
        if not mat:
            mat = bpy.data.materials.new(name=f"{obj.name}_Mat")
            mat.use_nodes = True
            slot.material = mat
        if not mat.use_nodes:
            mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        has_map = False
        for link in list(bsdf.inputs["Base Color"].links):
            if link.from_node.type == "TEX_IMAGE" and link.from_node.image and link.from_node.image.size[0] > 0:
                has_map = True
                break
        if has_map:
            continue
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])


def export_glb(path: Path, obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )


def densify_mesh(obj: bpy.types.Object, levels: int = 2) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    # Only subdivide if low poly
    if len(obj.data.vertices) > 8000:
        return
    bpy.ops.object.modifier_add(type="SUBSURF")
    mod = obj.modifiers["Subdivision"]
    mod.levels = levels if len(obj.data.vertices) < 1500 else 1
    mod.render_levels = mod.levels
    bpy.ops.object.modifier_apply(modifier="Subdivision")
    for p in obj.data.polygons:
        p.use_smooth = True


# Target heights in meters matching trackside prop scale expectations
HEIGHTS = {
    "barrier_wall": 1.05,
    "road_side_barrier": 0.85,
    "barrier_red": 0.85,
    "barrier_white": 0.85,
    "construction_fence": 1.6,
    "fence_straight": 1.4,
    "bench": 0.9,
    "crate": 0.7,
}


def process_polyhaven() -> None:
    BACKUP.mkdir(parents=True, exist_ok=True)
    for folder, fbx_name, dest, tint in PH_MAP:
        src = HD / folder / fbx_name
        if not src.is_file():
            print(f"  skip missing {src}", flush=True)
            continue
        dest_path = PROPS / f"{dest}.glb"
        if dest_path.is_file():
            bak = BACKUP / f"kenney_{dest}.glb"
            if not bak.is_file():
                shutil.copy2(dest_path, bak)
        print(f"  PH → {dest}.glb from {folder}", flush=True)
        clear_scene()
        meshes = import_fbx(src)
        if not meshes:
            print(f"  WARN no meshes in {src}", flush=True)
            continue
        obj = join_selected(meshes, dest)
        attach_diffuse_if_present(obj, HD / folder)
        if tint:
            tint_materials(obj, tint)
        ground_and_orient(obj, HEIGHTS.get(dest))
        # Poly Haven meshes are already dense — only smooth, do not explode vert count.
        for p in obj.data.polygons:
            p.use_smooth = True
        export_glb(dest_path, obj)
        print(f"    wrote {dest_path.name} verts={len(obj.data.vertices)}", flush=True)


def densify_remaining() -> None:
    for kind in DENSIFY_KINDS:
        path = PROPS / f"{kind}.glb"
        if not path.is_file():
            continue
        # Skip if already replaced from Poly Haven in this run
        if any(d == kind for _a, _b, d, _c in PH_MAP):
            # Already handled
            continue
        bak = BACKUP / f"kenney_{kind}.glb"
        if not bak.is_file():
            shutil.copy2(path, bak)
        print(f"  densify {kind}.glb", flush=True)
        clear_scene()
        meshes = import_glb(path)
        if not meshes:
            continue
        obj = join_selected(meshes, kind)
        before = len(obj.data.vertices)
        densify_mesh(obj, levels=2 if before < 800 else 1)
        export_glb(path, obj)
        print(f"    {before} → {len(obj.data.vertices)} verts", flush=True)


def main() -> None:
    print("Upgrading trackside props…", flush=True)
    process_polyhaven()
    densify_remaining()
    print("Trackside upgrade complete.", flush=True)


if __name__ == "__main__":
    main()
