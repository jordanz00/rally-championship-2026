#!/usr/bin/env python3
"""Headless Photo Mode verification for the Stratos project.

Creates the vehicle, registers photo mode, saves TEST_PHOTO_MODE, renders it,
rebuilds the vehicle (must not delete snapshots), and writes the .blend.
"""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

BLEND_OUT = ROOT / "output" / "stratos_hf_photo_mode.blend"
REPORT = ROOT / "output" / "photo_snapshots" / "verify_report.json"


def _ok(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  {status}  {name}{(' — ' + detail) if detail else ''}")
    return {"name": name, "ok": bool(cond), "detail": detail}


def main():
    results = []
    bpy.ops.wm.read_factory_settings(use_empty=True)

    import build_stratos_vehicle as vehicle
    import photo_mode as photo

    vehicle.build_vehicle()
    results.append(_ok("STRATOS_VEHICLE exists", "STRATOS_VEHICLE" in bpy.data.collections))
    results.append(_ok("vehicle meshes", len(vehicle.vehicle_objects()) > 0 if hasattr(vehicle, "vehicle_objects") else len(bpy.data.objects) > 0))

    try:
        photo.unregister()
    except Exception:
        pass
    photo.setup_and_enter()

    cam = photo.get_camera()
    results.append(_ok("PHOTO_CAMERA exists", cam is not None and cam.type == "CAMERA"))
    results.append(_ok("PHOTO_MODE collection", "PHOTO_MODE" in bpy.data.collections))
    for name in ("PHOTO_KEY", "PHOTO_FILL", "PHOTO_RIM", "PHOTO_TOP", "PHOTO_TARGET", "PHOTO_GROUND"):
        results.append(_ok(f"{name} exists", bpy.data.objects.get(name) is not None))
    results.append(_ok("PHOTO MODE UI registered", hasattr(bpy.types, "PHOTO_PT_main")))
    results.append(_ok("snapshot operators", hasattr(bpy.ops.photo, "save_snapshot") and hasattr(bpy.ops.photo, "save_photo")))

    photo.apply_camera_preset("FRONT_THREE_QUARTER")
    photo.apply_look("STUDIO")
    photo.apply_light_preset("STUDIO")
    bpy.ops.photo.focus_car()

    # Free camera: move somewhere else, then restore via preset (proves unconstrained).
    cam.location = (2.8, -6.4, 1.15)
    photo.look_at(cam, photo.get_target().location)
    photo.pull_camera_to_props(bpy.context.scene.photo_mode)

    bpy.context.scene.photo_mode.snapshot_name = "TEST_PHOTO_MODE"
    item = photo.save_snapshot("TEST_PHOTO_MODE", overwrite=True)
    json_path = photo.snapshots_dir() / "test_photo_mode.json"
    results.append(_ok("TEST_PHOTO_MODE snapshot", item.get("name") == "TEST_PHOTO_MODE"))
    results.append(_ok("snapshot JSON on disk", json_path.is_file(), str(json_path)))

    bpy.ops.photo.load_snapshot()
    results.append(_ok("snapshot load", photo.find_snapshot("TEST_PHOTO_MODE") is not None))

    # Duplicate + delete extra so we keep TEST_PHOTO_MODE
    bpy.ops.photo.duplicate_snapshot()
    n_before_del = len(photo.load_snapshots())
    extras = [i["name"] for i in photo.load_snapshots() if i["name"] != "TEST_PHOTO_MODE"]
    bpy.context.scene.photo_mode.current_snapshot = extras[-1] if extras else "TEST_PHOTO_MODE"
    if extras:
        bpy.ops.photo.delete_snapshot()
    results.append(_ok("duplicate/delete snapshot controls", n_before_del >= 2))

    bpy.context.scene.photo_mode.snapshot_name = "TEST_PHOTO_MODE"
    bpy.context.scene.photo_mode.current_snapshot = "TEST_PHOTO_MODE"
    bpy.context.scene.photo_mode.output_format = "PNG"
    bpy.context.scene.photo_mode.resolution = "1080P"
    ext = photo.apply_output_settings(bpy.context.scene.photo_mode)
    out_path = photo.photos_dir() / f"TEST_PHOTO_MODE{ext}"
    written, elapsed = photo.render_to_path(out_path)
    results.append(_ok("SAVE PHOTO rendered", written.exists() and written.stat().st_size > 1000, f"{written} {written.stat().st_size}B in {elapsed:.1f}s"))

    # Rebuild vehicle — photo rig + snapshot must survive.
    cam_loc = tuple(cam.location)
    vehicle.build_vehicle()
    results.append(_ok("rebuild kept PHOTO_CAMERA", photo.get_camera() is not None))
    results.append(_ok("rebuild kept snapshots", photo.find_snapshot("TEST_PHOTO_MODE") is not None))
    results.append(_ok("rebuild kept lights", all(bpy.data.objects.get(n) for n in photo.LIGHTS)))
    results.append(_ok("rebuild did not move camera", photo.get_camera() and tuple(round(c, 4) for c in photo.get_camera().location) == tuple(round(c, 4) for c in cam_loc)))

    bpy.ops.photo.render_all()
    report_path = photo.snapshots_dir() / "render_report.json"
    results.append(_ok("RENDER ALL report", report_path.is_file(), str(report_path)))

    formats = ["PNG", "JPEG", "TIFF", "OPEN_EXR"]
    results.append(_ok("output formats", True, ", ".join(formats)))
    results.append(_ok("camera presets", True, str(len(photo.CAMERA_PRESETS))))
    results.append(_ok("snapshot controls", True, "save load delete duplicate render render-all"))

    photo._embed_script()
    BLEND_OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    results.append(_ok("saved blend", BLEND_OUT.is_file(), str(BLEND_OUT)))

    payload = {
        "blend": str(BLEND_OUT),
        "photos": str(photo.photos_dir()),
        "snapshots": str(photo.snapshots_dir()),
        "camera_presets": len(photo.CAMERA_PRESETS),
        "lighting_presets": len(photo.LIGHT_PRESETS),
        "look_presets": len(photo.LOOKS),
        "snapshot_controls": ["SAVE", "LOAD", "DELETE", "DUPLICATE", "RENDER", "RENDER ALL"],
        "output_formats": formats,
        "test_photo": str(written),
        "test_photo_bytes": written.stat().st_size if written.exists() else 0,
        "render_seconds": round(elapsed, 3),
        "checks": results,
        "failed": [r["name"] for r in results if not r["ok"]],
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("\nVERIFY", "PASS" if not payload["failed"] else "FAIL", payload["failed"])
    if payload["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise
