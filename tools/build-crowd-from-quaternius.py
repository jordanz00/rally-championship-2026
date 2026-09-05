#!/usr/bin/env python3
"""
build-crowd-from-quaternius.py — convert Quaternius Universal Base Characters
into game character-*.glb (crowd-body + cheer arms) with authored skin maps.

Run (after downloading the Standard pack into hd-src/quaternius):
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python tools/build-crowd-from-quaternius.py

WHO THIS IS FOR: trackside audience that must read as real humans.
WHAT IT DOES: imports Superhero Male/Female glTF, swaps light/dark albedos,
  attaches hairstyles, applies height/build scales, splits L/R arms for cheer,
  downsamples textures to 1k, exports character-*.glb with embedded materials.
HOW IT CONNECTS: prop-kit + CrowdField load character-*.glb; prefer pack mats.
"""

from __future__ import annotations

import math
import shutil
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
PROPS = ROOT / "assets" / "props"
BACKUP = PROPS / "_lowpoly_backup"
PACK = (
    PROPS
    / "hd-src"
    / "quaternius"
    / "extracted"
    / "Universal Base Characters[Standard]"
)
GODOT = PACK / "Base Characters" / "Godot - UE"
TEX = PACK / "Base Characters" / "Textures"
HAIR_DIR = PACK / "Hairstyles" / "Origin at 0" / "glTF (Godot)"

MALE_GLTF = GODOT / "Superhero_Male_FullBody.gltf"
FEMALE_GLTF = GODOT / "Superhero_Female_FullBody.gltf"

ARM_BONES = {
    "upperarm_l",
    "lowerarm_l",
    "hand_l",
    "upperarm_r",
    "lowerarm_r",
    "hand_r",
    "index_01_l",
    "index_02_l",
    "index_03_l",
    "index_04_leaf_l",
    "middle_01_l",
    "middle_02_l",
    "middle_03_l",
    "middle_04_leaf_l",
    "ring_01_l",
    "ring_02_l",
    "ring_03_l",
    "ring_04_leaf_l",
    "pinky_01_l",
    "pinky_02_l",
    "pinky_03_l",
    "pinky_04_leaf_l",
    "thumb_01_l",
    "thumb_02_l",
    "thumb_03_l",
    "thumb_04_leaf_l",
    "index_01_r",
    "index_02_r",
    "index_03_r",
    "index_04_leaf_r",
    "middle_01_r",
    "middle_02_r",
    "middle_03_r",
    "middle_04_leaf_r",
    "ring_01_r",
    "ring_02_r",
    "ring_03_r",
    "ring_04_leaf_r",
    "pinky_01_r",
    "pinky_02_r",
    "pinky_03_r",
    "pinky_04_leaf_r",
    "thumb_01_r",
    "thumb_02_r",
    "thumb_03_r",
    "thumb_04_leaf_r",
}
# Quaternius mirrors L/R bone names vs world +X; cheer arms use world X.
ARM_BONE_L = set()  # unused — spatial split
ARM_BONE_R = set()

CHARACTERS = [
    # name, female?, height, xz_mul, dark_skin?, hair
    ("character-male-a.glb", False, 1.74, 1.00, False, "Hair_SimpleParted.gltf"),
    ("character-male-b.glb", False, 1.86, 1.02, True, "Hair_Buzzed.gltf"),
    ("character-male-c.glb", False, 1.56, 0.96, False, "Hair_Buzzed.gltf"),
    ("character-male-d.glb", False, 1.64, 1.00, True, "Hair_Beard.gltf"),
    ("character-male-e.glb", False, 1.68, 1.14, False, "Hair_SimpleParted.gltf"),
    ("character-male-f.glb", False, 1.22, 0.92, True, "Hair_Buzzed.gltf"),
    ("character-female-a.glb", True, 1.68, 1.00, False, "Hair_Long.gltf"),
    ("character-female-b.glb", True, 1.84, 1.02, True, "Hair_Buns.gltf"),
    ("character-female-c.glb", True, 1.54, 0.96, False, "Hair_BuzzedFemale.gltf"),
    ("character-female-d.glb", True, 1.62, 1.00, True, "Hair_SimpleParted.gltf"),
    ("character-female-e.glb", True, 1.20, 0.92, False, "Hair_BuzzedFemale.gltf"),
    ("character-female-f.glb", True, 1.66, 1.12, True, "Hair_Long.gltf"),
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
    for block in list(bpy.data.armatures):
        bpy.data.armatures.remove(block)


def import_gltf(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [o for o in bpy.data.objects if o not in before]


def downsample_images(max_size: int = 512) -> None:
    for img in list(bpy.data.images):
        if not img.size[0] or not img.size[1]:
            continue
        name = (img.name or "").lower()
        # Drop oversized normal maps — diffuse is enough for mid-distance crowd.
        if "normal" in name or "norm" in name:
            # Shrink aggressively
            target = min(max_size, 256)
        else:
            target = max_size
        w, h = img.size[0], img.size[1]
        if max(w, h) <= target:
            continue
        scale = target / float(max(w, h))
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        try:
            img.scale(nw, nh)
        except Exception:
            pass


def purge_unused_images() -> None:
    used = set()
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                used.add(node.image.name)
    for img in list(bpy.data.images):
        if img.name not in used:
            try:
                bpy.data.images.remove(img)
            except Exception:
                pass


def strip_heavy_maps() -> None:
    """Crowd is mid-distance — keep base color, drop normal/rough for size."""
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        for sock_name in ("Normal", "Roughness", "Metallic"):
            if sock_name not in bsdf.inputs:
                continue
            for link in list(bsdf.inputs[sock_name].links):
                links.remove(link)
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.62


def swap_skin_albedo(female: bool, dark: bool) -> None:
    """Point body Base Color image nodes at light/dark Quaternius maps."""
    if female:
        target = (
            GODOT / "T_Superhero_Female_Dark_BaseColor.png"
            if dark
            else GODOT / "T_Superhero_Female_Light_BaseColor.png"
        )
        keys = ("female", "superhero_female", "body")
    else:
        target = (
            GODOT / "T_Superhero_Male_Dark.png"
            if dark
            else GODOT / "T_Superhero_Male_Ligh.png"
        )
        keys = ("male", "superhero_male", "body", "dark", "ligh")
    if not target.is_file():
        print(f"  WARN missing albedo {target}", flush=True)
        return
    new_img = bpy.data.images.load(str(target), check_existing=True)
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        name = (mat.name or "").lower()
        # Only swap body/skin mats, not eyes/hair
        if any(x in name for x in ("hair", "eye", "brow")):
            continue
        for node in mat.node_tree.nodes:
            if node.type != "TEX_IMAGE" or not node.image:
                continue
            iname = (node.image.name or "").lower()
            if any(k in iname for k in ("superhero", "male", "female", "body", "dark", "ligh")):
                node.image = new_img


def apply_armatures() -> None:
    """Bake rest-pose skinned meshes to static geometry (preserve vertex groups)."""
    meshes = [o for o in list(bpy.data.objects) if o.type == "MESH"]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in meshes:
        has_arm = any(m.type == "ARMATURE" for m in obj.modifiers)
        # Always evaluate to freeze skinning / shape
        eval_obj = obj.evaluated_get(depsgraph)
        try:
            new_mesh = bpy.data.meshes.new_from_object(eval_obj, preserve_all_data_layers=True, depsgraph=depsgraph)
        except TypeError:
            new_mesh = bpy.data.meshes.new_from_object(eval_obj)
        old_mesh = obj.data
        obj.modifiers.clear()
        obj.data = new_mesh
        bpy.data.meshes.remove(old_mesh)
        # Keep vertex groups from evaluated if present
        print(f"    bake {obj.name}: verts={len(obj.data.vertices)} groups={len(obj.vertex_groups)} arm={has_arm}", flush=True)


def delete_armatures() -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in list(bpy.data.objects):
        if o.type == "ARMATURE":
            o.select_set(True)
    bpy.ops.object.delete(use_global=False)


def attach_hair(hair_name: str, female: bool) -> None:
    path = HAIR_DIR / hair_name
    if not path.is_file():
        print(f"  WARN hair missing {hair_name}", flush=True)
        return
    # Find head top from current meshes
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        return
    max_z = -1e9
    cx = cz = 0.0
    count = 0
    for m in meshes:
        for v in m.data.vertices:
            co = m.matrix_world @ v.co
            if co.z > max_z:
                max_z = co.z
            cx += co.x
            cz += co.y  # glTF Y-up often already converted; Blender is Z-up after import
            count += 1
    cx /= max(1, count)
    # Import hair
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    hair_objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not hair_objs:
        return
    # Place near head — Quaternius origin-at-0 hairs sit around origin; move to head
    for h in hair_objs:
        # Apply any armature on hair
        bpy.context.view_layer.objects.active = h
        h.select_set(True)
        for mod in list(h.modifiers):
            if mod.type == "ARMATURE":
                try:
                    bpy.ops.object.modifier_apply(modifier=mod.name)
                except Exception:
                    pass
        h.select_set(False)
        # Rough head placement: center X, lift to head
        bb = [h.matrix_world @ v.co for v in h.data.vertices]
        hz0 = min(c.z for c in bb)
        hx = sum(c.x for c in bb) / len(bb)
        hy = sum(c.y for c in bb) / len(bb)
        h.location.x += -hx
        h.location.y += -hy
        h.location.z += (max_z - 0.12) - hz0
        bpy.context.view_layer.objects.active = h
        h.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        h.select_set(False)


def join_meshes(objs: list[bpy.types.Object], name: str) -> bpy.types.Object | None:
    objs = [o for o in objs if o and o.type == "MESH"]
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj


def select_arm_verts(obj: bpy.types.Object, side: str) -> int:
    """Select arm verts by bone weight + world X (Quaternius L/R bones are mirrored)."""
    mesh = obj.data
    bpy.ops.object.mode_set(mode="OBJECT")
    name_by_index = {vg.index: vg.name for vg in obj.vertex_groups}
    for v in mesh.vertices:
        v.select = False
    count = 0
    for i, v in enumerate(mesh.vertices):
        w = 0.0
        for g in v.groups:
            if name_by_index.get(g.group, "") in ARM_BONES:
                w += g.weight
        if w < 0.5:
            continue
        co = obj.matrix_world @ v.co
        # crowd-arm-l = -X, crowd-arm-r = +X in game space
        if side == "L" and co.x < -0.02:
            v.select = True
            count += 1
        elif side == "R" and co.x > 0.02:
            v.select = True
            count += 1
    return count


def split_arms(body: bpy.types.Object) -> tuple[bpy.types.Object | None, bpy.types.Object | None]:
    arm_l = arm_r = None
    for side, name in (("L", "crowd-arm-l"), ("R", "crowd-arm-r")):
        bpy.context.view_layer.objects.active = body
        body.select_set(True)
        n = select_arm_verts(body, side)
        if n < 20:
            print(f"  WARN few arm verts {side}: {n}", flush=True)
            bpy.ops.object.mode_set(mode="OBJECT")
            continue
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        # Newly separated object is selected together with body
        parts = [o for o in bpy.context.selected_objects if o != body and o.type == "MESH"]
        if not parts:
            continue
        arm = parts[0]
        arm.name = name
        if side == "L":
            arm_l = arm
        else:
            arm_r = arm
        # Reselect body only for next pass
        bpy.ops.object.select_all(action="DESELECT")
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
    body.name = "crowd-body"
    return arm_l, arm_r


def ground_and_scale(obj: bpy.types.Object, target_h: float, xz_mul: float) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    min_z = min(c.z for c in coords)
    max_z = max(c.z for c in coords)
    min_x = min(c.x for c in coords)
    max_x = max(c.x for c in coords)
    min_y = min(c.y for c in coords)
    max_y = max(c.y for c in coords)
    obj.location.x -= (min_x + max_x) * 0.5
    obj.location.y -= (min_y + max_y) * 0.5
    obj.location.z -= min_z
    bpy.ops.object.transform_apply(location=True)
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    h = max(c.z for c in coords) - min(c.z for c in coords)
    if h > 1e-4:
        s = target_h / h
        obj.scale = (s * xz_mul, s * xz_mul, s)
        bpy.ops.object.transform_apply(scale=True)
        coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
        min_z = min(c.z for c in coords)
        obj.location.z -= min_z
        bpy.ops.object.transform_apply(location=True)


def set_origin_shoulder(obj: bpy.types.Object) -> None:
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    cx = (min(c.x for c in coords) + max(c.x for c in coords)) * 0.5
    cy = (min(c.y for c in coords) + max(c.y for c in coords)) * 0.5
    max_z = max(c.z for c in coords)
    min_z = min(c.z for c in coords)
    top_z = max_z * 0.9 + min_z * 0.1
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.context.scene.cursor.location = (cx, cy, top_z)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")


def export_glb(path: Path, parts: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        if o:
            o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
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
        export_animations=False,
        export_skins=False,
    )


def build_one(name: str, female: bool, height: float, xz_mul: float, dark: bool, hair: str) -> None:
    clear_scene()
    src = FEMALE_GLTF if female else MALE_GLTF
    if not src.is_file():
        raise FileNotFoundError(src)
    print(f"  building {name} …", flush=True)
    import_gltf(src)
    apply_armatures()
    delete_armatures()
    swap_skin_albedo(female, dark)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    body = join_meshes(meshes, "crowd-body")
    if not body:
        print(f"  FAIL no mesh for {name}", flush=True)
        return

    downsample_images(512)
    strip_heavy_maps()
    purge_unused_images()
    ground_and_scale(body, height, xz_mul)
    # Export a single authored human mesh. Cheer arms are split in prop-kit
    # (splitCrowdCharacter) so we keep Quaternius topology/UVs intact.
    arm_l = arm_r = None
    body.name = "crowd-body"

    # Hair after body is grounded.
    attach_hair(hair, female)
    delete_armatures()
    hair_meshes = [
        o
        for o in bpy.data.objects
        if o.type == "MESH" and o != body
    ]
    if hair_meshes:
        bpy.ops.object.select_all(action="DESELECT")
        body.select_set(True)
        for h in hair_meshes:
            h.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()
        body = bpy.context.active_object
        body.name = "crowd-body"

    for p in body.data.polygons:
        p.use_smooth = True

    out = PROPS / name
    export_glb(out, [body])
    print(
        f"    wrote {name} body_v={len(body.data.vertices)} size={out.stat().st_size}",
        flush=True,
    )


def main() -> None:
    if not MALE_GLTF.is_file() or not FEMALE_GLTF.is_file():
        print("ERROR: Quaternius Standard pack not found under", PACK, file=sys.stderr)
        sys.exit(1)
    BACKUP.mkdir(parents=True, exist_ok=True)
    for name, *_ in CHARACTERS:
        src = PROPS / name
        bak = BACKUP / f"pre_quaternius_{name}"
        if src.is_file() and not bak.is_file():
            shutil.copy2(src, bak)

    print("Building crowd from Quaternius Universal Base Characters…", flush=True)
    for spec in CHARACTERS:
        build_one(*spec)
    print("Done →", PROPS, flush=True)


if __name__ == "__main__":
    main()
