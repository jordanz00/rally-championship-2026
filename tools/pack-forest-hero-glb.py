"""Pack already-downloaded Poly Haven 1k glTF into runtime GLBs. Run via Blender."""
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[1]
JOBS = [
    ("assets/props/hd-src/polyhaven/boulder_01/boulder_01_1k.gltf", "assets/props/forest_hero_boulder_a.glb"),
    ("assets/props/hd-src/polyhaven/rock_07/rock_07_1k.gltf", "assets/props/forest_hero_boulder_b.glb"),
    ("assets/props/hd-src/polyhaven/rock_moss_set_01/rock_moss_set_01_1k.gltf", "assets/props/forest_hero_moss_set_a.glb"),
    ("assets/props/hd-src/polyhaven/rock_moss_set_02/rock_moss_set_02_1k.gltf", "assets/props/forest_hero_moss_set_b.glb"),
    ("assets/props/hd-src/polyhaven/dead_tree_trunk/dead_tree_trunk_1k.gltf", "assets/props/forest_hero_log.glb"),
    ("assets/props/hd-src/polyhaven/fern_02/fern_02_1k.gltf", "assets/props/forest_hero_fern.glb"),
]


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


for src_rel, dst_rel in JOBS:
    src = ROOT / src_rel
    dst = ROOT / dst_rel
    print("PACK", src.name, "->", dst.name)
    clear()
    bpy.ops.import_scene.gltf(filepath=str(src))
    bpy.ops.export_scene.gltf(
        filepath=str(dst),
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )
    print("  bytes", dst.stat().st_size)

print("DONE")
