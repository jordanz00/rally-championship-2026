# Rally Championship 2026 — AAA Browser Game Production Standard

**Status:** Binding production bar for Cursor and humans.  
**Live:** https://jordanz00.github.io/rally-championship-2026/  
**Companions:** [`VISUAL_GAMEPLAY_NORTH_STAR.md`](VISUAL_GAMEPLAY_NORTH_STAR.md) · [`GAMER_WOW_CHECKLIST.md`](GAMER_WOW_CHECKLIST.md) · [`ALL_STAGES_AAA_STANDARD.md`](ALL_STAGES_AAA_STANDARD.md) · [`WORLD_GEOMETRY_RULES.md`](WORLD_GEOMETRY_RULES.md) · [`RENDERER_MIGRATION_ANALYSIS.md`](RENDERER_MIGRATION_ANALYSIS.md) · [`PERFORMANCE_RULES.md`](PERFORMANCE_RULES.md) · [`RALLY_ENGINE_ROADMAP.md`](RALLY_ENGINE_ROADMAP.md) · [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md)

---

## What this is / is not

| This is | This is not |
|---|---|
| A browser-native **AAA-style arcade rally game** | A Three.js technical demo |
| Gran Turismo / Forza / modern rally **presentation principles** + Sega Rally **arcade DNA** | A procedural driving prototype |
| A real **game production pipeline** | A pile of 3D objects around a road |
| Expensive-looking **where the player looks** | UE5 Nanite/Lumen reproduction |

**Goal:** Make the **game** impressive — not the technology stack.

Experienced gamers should immediately recognize a serious racing game. Friend line: *“How the hell is this running at 60 FPS in a browser?”*

---

## Non-negotiable product stack

```
HIGH VISUAL QUALITY
+ HIGH PERFORMANCE
+ BELIEVABLE PHYSICS
+ AUTHORED TRACK DESIGN
+ AAA-STYLE PRESENTATION
+ ARCADE FUN
```

**Hierarchy (never invert):**

```
Sega Rally fun → modern racing feel → AAA presentation → browser performance
```

Never sacrifice **input latency** for graphical effects.

---

## Primary performance target

| | |
|---|---|
| Desktop | **60 FPS** target |
| Capable hardware | **144 FPS** where practical |
| Priority | **Stable frame pacing** > peak FPS |
| Floor | Honest 30 Hz lock when GPU cannot hold 60 |

Must stay responsive during: high-speed · jumps · dust · dense forest · tunnels · vistas · multi-car · heavy env.

---

## AAA visual priorities (budget order)

1. Player vehicle (HERO)  
2. Road (HERO environment)  
3. Immediate environment  
4. Lighting  
5. Shadows  
6. Terrain  
7. Surface materials  
8. Atmospheric depth  
9. Particles  
10. Distant scenery  

**Do not** make every object equally detailed.

```
HERO → HIGH → MEDIUM → LOW → IMPOSTOR/BILLBOARD
```

Camera / screen-space importance chooses quality. LOD transitions must be invisible in normal play.

### The AAA corridor (spend here)

```
        DISTANT WORLD — low / atmosphere
             MEDIUM DETAIL — trees rocks terrain
     ┌──── HIGH DETAIL CORRIDOR ────┐
     │  trees/rocks · ROAD+SHOULDER │
     └──────────── 🚗 ──────────────┘
```

At 150 km/h the brain sees: car → road → shoulder → nearby veg → particles → lighting → horizon. Budget that corridor first.

---

## Definition of “AAA” for this project

Not 10M polys · not 50 post effects · not 4K everywhere.

| Moment | Player should think |
|---|---|
| See the car | “That looks like a real rally car.” |
| Hit dirt | “That surface looks physical.” |
| Drift | “The car has weight.” |
| Jump | “Holy shit.” |
| Enter tunnel | “That actually looks like a tunnel.” |
| Exit tunnel | “Holy shit.” |
| Mountain vista | “This looks like a real game.” |
| 180 through forest | “This is fast.” |
| Open DevTools | “How is this 60 FPS?” |

Before calling a system finished: expensive? physical? believable **while moving**? performant? player experience? memorable moment?

**Core rule:** Never solve visuals by only adding polygons. Prefer topology · normals · material · texture · shader · lighting · LOD · placement · atmosphere · animation.

---

## Production passes (approval-gated — do not “Go” on all at once)

Work **one pass at a time**. Shared systems first; **all stages** migrate — see [`ALL_STAGES_AAA_STANDARD.md`](ALL_STAGES_AAA_STANDARD.md).

| Pass | Name | Scope | Status |
|---:|---|---|---|
| **1** | **Shared foundation** | TrackDefinition · terrain conform · tunnels · clearance · validator on **every** stage | **ACTIVE** — modules + Mountain authored; migrate Desert/Forest/Lakeside + in-game GREEN all stages |
| **2** | Asset quality (all stages) | Near-field via shared veg/prop/rock systems | After Pass 1 parity |
| **3** | Materials (all stages) | Shared material systems + per-stage params | After Pass 2 |
| **4** | Lighting / atmosphere (all stages) | Shared lighting + per-stage profiles | After Pass 3 |
| **5** | Physics → VFX (all stages) | Shared slip→FX path | After Pass 4 |

Mountain may **stress-test** shared systems first. Shipping Mountain-only AAA tech while other stages lag is **forbidden**.

---

## Track / world (Pass 1 — non-negotiable)

- Racing line **hand-authored** (`TrackDefinition`) on **all** championship + bonus stages. Procedural OK for terrain dressing only.  
- Rhythm: accelerate → brake → turn → slide → recover → crest → jump → land → …  
- Road never floats; terrain never intersects drive corridor; shoulders transition.  
- `TunnelSystem` / volumes · carve · interior · mouths · no props inside · lighting · collision — same tech everywhere tunnels exist.  
- `WorldGeometryValidator` RED/YELLOW/GREEN on **every** stage — see [`WORLD_GEOMETRY_RULES.md`](WORLD_GEOMETRY_RULES.md).

---

## Hero car & road (Pass 2–3)

**Car:** high-quality geo · PBR · clearcoat · glass · wheels/tires/brakes/lights · suspension/roll/pitch/squat · airborne · land compress · **dirt masks** (surface × slip × mud × off-road) — start clean, end filthy.

**Road:** not a flat strip — width · bank · camber · elevation · ruts · grooves · edge erosion · shoulders · wetness · MACRO/MEDIUM/MICRO material detail via shaders where possible.

---

## Renderer (benchmark, don’t prestige-migrate)

Production today: **WebGL / r160** — see [`RENDERER_MIGRATION_ANALYSIS.md`](RENDERER_MIGRATION_ANALYSIS.md).

- Evaluate WebGPURenderer only with **headed benchmarks** + WebGL2 fallback.  
- Prefer **TSL** for *new* purposeful shaders — not complexity for its own sake.  
- Keep gameplay independent of backend (`RenderPipeline` / factory / caps).  
- Linear/HDR-oriented · correct color · sensible exposure · tone map · subtle grade.  
- **No** excessive bloom / saturation / fake cinematic filters.

---

## Lighting · shadows · atmosphere · particles · camera · audio

- Per-track lighting (Mountain cool clear · Forest filtered · Desert warm hard · Lakeside warm atmospheric).  
- Best shadows near player/car/road; falloff with distance.  
- Depth via atmospheric perspective — not flat blue fog.  
- Unified surface FX: slip × speed × surface × suspension × land — **pooled**.  
- Camera = physics readout (look-ahead, FOV, subtle settle) — never extreme shake.  
- Speed perception: slight FOV · dust · peripheral motion — not huge motion blur.  
- Surface tire beds + engine load + impact compression = part of “realism.”

---

## Performance architecture

Pooling · instancing · LOD · frustum/distance cull · KTX2/Meshopt/Draco **measured** · reuse geo/mat · no per-frame alloc · texture by screen importance · dispose unused.

**Presets:** LOW · MEDIUM · HIGH (default) · ULTRA + **dynamic resolution** with hysteresis toward 60 FPS.

**Dev overlay:** FPS · frame time · graph · draw calls · tris · geos · textures · visible · particles · backend · resolution · quality — decisions from **measurement**.

**Post:** AA · tone · grade · subtle bloom/atmosphere only. Clear road view always.

**Presentation:** polished title · intro · countdown · finish · results · future photo/replay.

**Assets:** glTF/GLB · hero textures highest · never 4K “because we have them.”

---

## How to ask Cursor

**Bad:** “Make it AAA.” / “Go.” (whole standard at once)  
**Good:** “Continue **Pass 1** — close Mountain validator RED items from my drive.”  
**Good:** “Begin **Pass 2** — replace Mountain near-field rocks/trees only.”

After each major slice: **STOP AND AUDIT** against this standard + gamer wow checklist.
