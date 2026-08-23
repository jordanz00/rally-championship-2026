"""Sprint 18 — original low-poly Lancia Stratos HF rally mesh.

Not Sega's licensed CAD, not a 3dmodels.org commercial dump, and not the
Sketchfab CC-BY Alitalia Stratos (that file is not on disk; do not download
without login). Rebuilt in Blender for this Saturn tribute.

Wedge cabin, pop-up lamps, short mid-engine tail, Alitalia-inspired red /
cream / green paint without trademarked wordmarks.

Game space after glTF export: +Z forward (180° Z apply before export, same
as the Delta pipeline). Wheel hubs MUST be named WHEEL_FL / WHEEL_FR /
WHEEL_RL / WHEEL_RR so findWheels() in js/cars/celica.js picks four empties
(tire/rim children must not start with \"wheel\" or glbstats over-counts).
"""
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = Path("/Users/jordanzabady/Desktop/Cursor Projects/Sega_Rally_Clone/assets/stratos/stratos.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metallic=0.12, roughness=0.42, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = metallic
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = roughness
    if alpha < 0.99:
        m.blend_method = "BLEND"
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = alpha
    return m


RED = mat("Body", (0.72, 0.07, 0.08), metallic=0.18, roughness=0.38)
CREAM = mat("Stripe", (0.93, 0.93, 0.9), metallic=0.04, roughness=0.48)
GREEN = mat("Green", (0.05, 0.36, 0.16), metallic=0.06, roughness=0.5)
DARK = mat("Dark", (0.04, 0.04, 0.05), metallic=0.35, roughness=0.4)
GLASS = mat("Glass", (0.12, 0.2, 0.28), metallic=0.08, roughness=0.06, alpha=0.38)
RIM = mat("Rim", (0.78, 0.78, 0.74), metallic=0.72, roughness=0.22)
TIRE = mat("Tire", (0.05, 0.05, 0.05), metallic=0.0, roughness=0.88)
LAMP = mat("Lamp", (0.95, 0.93, 0.78), metallic=0.15, roughness=0.12)
TAIL = mat("TailLight", (0.62, 0.05, 0.05), metallic=0.08, roughness=0.28)
BLACK = mat("Black", (0.02, 0.02, 0.02), metallic=0.1, roughness=0.6)
CHROME = mat("Chrome", (0.85, 0.86, 0.88), metallic=0.92, roughness=0.14)
INTERIOR = mat("Interior", (0.12, 0.1, 0.09), metallic=0.02, roughness=0.72)


def assign(ob, material):
    ob.data.materials.clear()
    ob.data.materials.append(material)


def mesh_from_bmesh(name, bm, material):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    assign(ob, material)
    return ob


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_half(a, b, t):
    n = max(len(a), len(b))
    out = []
    for i in range(n):
        ia = min(i, len(a) - 1)
        ib = min(i, len(b) - 1)
        out.append((lerp(a[ia][0], b[ib][0], t), lerp(a[ia][1], b[ib][1], t)))
    return out


def densify_half(half, segments=10):
    """Resample a right-side (x, z) polyline to a fixed point count."""
    if len(half) < 2:
        return list(half)
    lengths = [0.0]
    for i in range(1, len(half)):
        dx = half[i][0] - half[i - 1][0]
        dz = half[i][1] - half[i - 1][1]
        lengths.append(lengths[-1] + math.hypot(dx, dz))
    total = lengths[-1] or 1.0
    out = []
    for s in range(segments + 1):
        target = (s / segments) * total
        j = 0
        while j + 1 < len(lengths) and lengths[j + 1] < target:
            j += 1
        span = lengths[j + 1] - lengths[j] if j + 1 < len(lengths) else 1.0
        t = 0.0 if span < 1e-9 else (target - lengths[j]) / span
        t = max(0.0, min(1.0, t))
        x = lerp(half[j][0], half[min(j + 1, len(half) - 1)][0], t)
        z = lerp(half[j][1], half[min(j + 1, len(half) - 1)][1], t)
        out.append((x, z))
    return out


def refine_stations(dense, steps=2):
    """Insert `steps` interpolated stations between each key pair."""
    refined = [dense[0]]
    for a, b in zip(dense, dense[1:]):
        for s in range(1, steps + 1):
            t = s / (steps + 1)
            y = lerp(a[0], b[0], t)
            refined.append((y, lerp_half(a[1], b[1], t)))
        refined.append(b)
    return refined


def loft_closed(name, stations, material, ring_pts=18, mid_steps=2, subdiv_cuts=1):
    """Loft closed rings. stations: [(y, [(x,z),...]), ...] nose (+Y) → tail (−Y)."""
    dense = [(y, densify_half(half, ring_pts - 1)) for y, half in stations]

    def ring(y, half):
        right = [Vector((x, y, z)) for x, z in half]
        left = [Vector((-x, y, z)) for x, z in reversed(half[1:-1])]
        return right + left

    refined = refine_stations(dense, steps=mid_steps)
    rings = [ring(y, pts) for y, pts in refined]
    n = len(rings[0])
    bm = bmesh.new()
    loops = []
    for ring_verts in rings:
        loops.append([bm.verts.new(p) for p in ring_verts])
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([a[i], a[j], b[j], b[i]])
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if subdiv_cuts > 0:
        bmesh.ops.subdivide_edges(
            bm, edges=list(bm.edges), cuts=subdiv_cuts, use_grid_fill=True
        )
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(name, bm, material)


def box(name, sx, sy, sz, loc, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (sx * 0.5, sy * 0.5, sz * 0.5)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    assign(ob, material)
    return ob


def cyl(name, radius, depth, loc, material, rot=(0, math.pi / 2, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, location=loc, rotation=rot, vertices=verts
    )
    ob = bpy.context.active_object
    ob.name = name
    assign(ob, material)
    return ob


def parent_keep_world(child, parent):
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = Matrix.Identity(4)
    child.matrix_world = world


def subdivide_object(ob, cuts=1):
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=cuts)
    bpy.ops.object.mode_set(mode="OBJECT")


def add_wheel(hub_name, x, y, z=0.32):
    """Empty hub WHEEL_* with Tire_/Rim_/Hubcap_ children (separate materials)."""
    empty = bpy.data.objects.new(hub_name, None)
    bpy.context.scene.collection.objects.link(empty)
    empty.location = Vector((x, y, z))
    empty.empty_display_size = 0.15

    side = hub_name.split("_")[-1]  # FL / FR / RL / RR
    tire = cyl(f"Tire_{side}", 0.33, 0.24, (x, y, z), TIRE, verts=64)
    # Outer rim barrel + face disk + spokes for readable rally wheels.
    rim = cyl(f"Rim_{side}", 0.20, 0.16, (x, y, z), RIM, verts=48)
    face = cyl(
        f"RimFace_{side}",
        0.17,
        0.04,
        (x + (0.02 if x > 0 else -0.02), y, z),
        RIM,
        verts=28,
    )
    hubcap = cyl(
        f"Hubcap_{side}",
        0.06,
        0.08,
        (x + (0.05 if x > 0 else -0.05), y, z),
        CREAM,
        verts=20,
    )

    # Five thin spoke boxes in the wheel plane (Y/Z in Blender build space).
    for i in range(5):
        ang = (i / 5.0) * math.pi * 2
        spoke = box(
            f"Spoke_{side}_{i}",
            0.03,
            0.14,
            0.025,
            (
                x + (0.03 if x > 0 else -0.03),
                y + math.cos(ang) * 0.08,
                z + math.sin(ang) * 0.08,
            ),
            CHROME,
            rot=(0, 0, ang),
        )
        parent_keep_world(spoke, empty)

    parent_keep_world(tire, empty)
    parent_keep_world(rim, empty)
    parent_keep_world(face, empty)
    parent_keep_world(hubcap, empty)
    return empty


# --- Hull: dense Stratos wedge (short nose, bubble cabin, chopped mid-engine tail) ---
# Key stations (y, half-profile). Profiles are right-side (x, z) bottom→top.
HULL = [
    (1.92, [(0.08, 0.24), (0.22, 0.26), (0.36, 0.30), (0.42, 0.38), (0.34, 0.44), (0.16, 0.46), (0.04, 0.44)]),
    (1.72, [(0.14, 0.18), (0.48, 0.20), (0.68, 0.26), (0.78, 0.38), (0.72, 0.50), (0.42, 0.56), (0.14, 0.58)]),
    (1.48, [(0.20, 0.16), (0.62, 0.18), (0.84, 0.28), (0.90, 0.42), (0.82, 0.56), (0.48, 0.62), (0.16, 0.64)]),
    (1.18, [(0.26, 0.15), (0.72, 0.17), (0.92, 0.30), (0.96, 0.46), (0.86, 0.62), (0.50, 0.70), (0.18, 0.74)]),
    (0.78, [(0.28, 0.15), (0.78, 0.17), (0.94, 0.36), (0.92, 0.58), (0.72, 0.82), (0.38, 0.96), (0.12, 1.02)]),
    (0.38, [(0.30, 0.16), (0.80, 0.18), (0.94, 0.40), (0.90, 0.64), (0.68, 0.96), (0.34, 1.12), (0.10, 1.16)]),
    (0.02, [(0.32, 0.16), (0.82, 0.19), (0.94, 0.42), (0.88, 0.68), (0.64, 1.04), (0.30, 1.16), (0.08, 1.18)]),
    (-0.32, [(0.32, 0.16), (0.82, 0.19), (0.94, 0.40), (0.88, 0.64), (0.62, 0.98), (0.28, 1.10), (0.08, 1.12)]),
    (-0.68, [(0.30, 0.16), (0.80, 0.18), (0.94, 0.36), (0.90, 0.56), (0.70, 0.80), (0.34, 0.90), (0.12, 0.92)]),
    (-1.02, [(0.28, 0.16), (0.78, 0.18), (0.94, 0.34), (0.92, 0.50), (0.76, 0.66), (0.40, 0.74), (0.14, 0.76)]),
    (-1.32, [(0.26, 0.18), (0.74, 0.20), (0.90, 0.34), (0.88, 0.48), (0.70, 0.60), (0.36, 0.66), (0.12, 0.68)]),
    (-1.58, [(0.22, 0.20), (0.66, 0.22), (0.82, 0.34), (0.78, 0.48), (0.58, 0.56), (0.28, 0.60), (0.10, 0.60)]),
    (-1.82, [(0.16, 0.24), (0.50, 0.26), (0.64, 0.36), (0.58, 0.46), (0.40, 0.52), (0.18, 0.54), (0.06, 0.52)]),
    (-1.98, [(0.10, 0.28), (0.34, 0.30), (0.44, 0.38), (0.38, 0.46), (0.22, 0.50), (0.08, 0.48)]),
]

loft_closed("Body", HULL, RED, ring_pts=36, mid_steps=3, subdiv_cuts=1)

# Cream roof/hood stripe + green belt — Alitalia-inspired, no wordmark.
stripe = box("Stripe", 0.40, 3.72, 0.035, (0, 0.0, 0.98), CREAM)
subdivide_object(stripe, 5)
green = box("GreenStripe", 1.82, 0.14, 0.03, (0, 0.58, 0.64), GREEN)
subdivide_object(green, 2)

# Wraparound glass — slightly denser panels.
ws = box("Windshield", 1.30, 0.95, 0.045, (0, 0.46, 0.90), GLASS, rot=(0.70, 0, 0))
subdivide_object(ws, 5)
sg_r = box("SideGlass_R", 0.035, 1.10, 0.34, (0.86, -0.06, 0.80), GLASS, rot=(0.06, 0, 0.06))
sg_l = box("SideGlass_L", 0.035, 1.10, 0.34, (-0.86, -0.06, 0.80), GLASS, rot=(0.06, 0, -0.06))
subdivide_object(sg_r, 4)
subdivide_object(sg_l, 4)
rg = box("RearGlass", 1.12, 0.30, 0.035, (0, -0.70, 0.88), GLASS, rot=(-0.52, 0, 0))
subdivide_object(rg, 2)

# Cabin interior silhouette (reads through glass).
box("Dash", 1.10, 0.22, 0.12, (0, 0.28, 0.62), BLACK)
box("Seat_R", 0.36, 0.42, 0.38, (0.28, -0.08, 0.52), INTERIOR)
box("Seat_L", 0.36, 0.42, 0.38, (-0.28, -0.08, 0.52), INTERIOR)
box("RollCage", 1.05, 0.04, 0.55, (0, -0.22, 0.78), BLACK)

# Pop-up lamps on the short hood.
box("LightPod_R", 0.38, 0.40, 0.11, (0.42, 1.56, 0.58), DARK)
box("LightPod_L", 0.38, 0.40, 0.11, (-0.42, 1.56, 0.58), DARK)
box("Headlight_R", 0.30, 0.24, 0.08, (0.42, 1.64, 0.60), LAMP)
box("Headlight_L", 0.30, 0.24, 0.08, (-0.42, 1.64, 0.60), LAMP)
# Secondary round lamps under the pop-ups (Stratos signature cluster).
cyl("Lamp_R2", 0.07, 0.06, (0.58, 1.72, 0.42), LAMP, verts=16)
cyl("Lamp_L2", 0.07, 0.06, (-0.58, 1.72, 0.42), LAMP, verts=16)
cyl("Lamp_R3", 0.055, 0.05, (0.28, 1.74, 0.40), LAMP, verts=12)
cyl("Lamp_L3", 0.055, 0.05, (-0.28, 1.74, 0.40), LAMP, verts=12)

# Nose / grille / bumper.
box("Grille", 0.72, 0.08, 0.18, (0, 1.88, 0.36), BLACK)
box("Bumper_F", 1.55, 0.14, 0.10, (0, 1.90, 0.26), DARK)
box("Lip_F", 1.40, 0.10, 0.04, (0, 1.94, 0.20), BLACK)

# Wheel arches (flare silhouettes).
for name, x, y in (
    ("Arch_FR", 0.92, 1.10),
    ("Arch_FL", -0.92, 1.10),
    ("Arch_RR", 0.94, -1.06),
    ("Arch_RL", -0.94, -1.06),
):
    arch = box(name, 0.18, 0.55, 0.42, (x, y, 0.48), RED)
    subdivide_object(arch, 1)

# Side skirts + sills.
box("Skirt_R", 0.06, 2.40, 0.10, (0.90, 0.02, 0.22), DARK)
box("Skirt_L", 0.06, 2.40, 0.10, (-0.90, 0.02, 0.22), DARK)

# Mirrors.
box("Mirror_R", 0.14, 0.08, 0.08, (0.96, 0.42, 0.78), BLACK)
box("Mirror_L", 0.14, 0.08, 0.08, (-0.96, 0.42, 0.78), BLACK)

# Door creases (subtle panel reads).
box("DoorLine_R", 0.02, 0.95, 0.42, (0.95, -0.05, 0.55), DARK)
box("DoorLine_L", 0.02, 0.95, 0.42, (-0.95, -0.05, 0.55), DARK)

# Rear engine cover + cooling slats + wing.
box("EngineCover", 1.48, 0.78, 0.07, (0, -1.40, 0.64), DARK)
for i, y in enumerate((-1.22, -1.34, -1.46, -1.58, -1.70)):
    box(f"Slat_{i}", 1.34, 0.045, 0.028, (0, y, 0.69), BLACK)
box("Spoiler", 1.52, 0.16, 0.04, (0, -1.90, 0.80), RED)
box("SpoilerEnd_R", 0.06, 0.18, 0.18, (0.76, -1.90, 0.72), RED)
box("SpoilerEnd_L", 0.06, 0.18, 0.18, (-0.76, -1.90, 0.72), RED)
box("SpoilerBrace_R", 0.04, 0.08, 0.22, (0.55, -1.82, 0.68), DARK)
box("SpoilerBrace_L", 0.04, 0.08, 0.22, (-0.55, -1.82, 0.68), DARK)

box("Bumper_R", 1.50, 0.12, 0.10, (0, -1.96, 0.28), DARK)
box("TailLight_R", 0.36, 0.07, 0.13, (0.52, -1.98, 0.48), TAIL)
box("TailLight_L", 0.36, 0.07, 0.13, (-0.52, -1.98, 0.48), TAIL)
cyl("Exhaust_R", 0.045, 0.12, (0.34, -2.00, 0.26), CHROME, verts=12)
cyl("Exhaust_L", 0.045, 0.12, (0.18, -2.00, 0.26), CHROME, verts=12)

# Fuel filler hint on left rear quarter.
cyl("Filler", 0.05, 0.03, (-0.88, -0.95, 0.62), BLACK, rot=(0, 0, math.pi / 2), verts=12)

# Wheels — ~2.2 m wheelbase; hub names match findWheels / glbstats /^wheel/i.
add_wheel("WHEEL_FR", 0.82, 1.12)
add_wheel("WHEEL_FL", -0.82, 1.12)
add_wheel("WHEEL_RR", 0.84, -1.08)
add_wheel("WHEEL_RL", -0.84, -1.08)

# Face glTF +Z (same 180° Z as the Delta export).
bpy.ops.object.select_all(action="SELECT")
bpy.ops.transform.rotate(value=math.pi, orient_axis="Z", orient_type="GLOBAL")
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.object.select_all(action="SELECT")

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
)
print("wrote", OUT, "bytes", OUT.stat().st_size)
