# RALLY CHAMPIONSHIP 2026 — VISUAL & GAMEPLAY NORTH STAR

**Status:** Binding visual/gameplay brief for Cursor and humans.  
**Companions:** [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md) · [`docs/GAMER_WOW_CHECKLIST.md`](GAMER_WOW_CHECKLIST.md) · [`docs/RENDERER_MIGRATION_ANALYSIS.md`](RENDERER_MIGRATION_ANALYSIS.md) · [`docs/RALLY_ENGINE_ROADMAP.md`](RALLY_ENGINE_ROADMAP.md) · [`docs/PERFORMANCE_RULES.md`](PERFORMANCE_RULES.md)

**Live build:** https://jordanz00.github.io/rally-championship-2026/

**Non-negotiable:** Do **not** rewrite the game. Do **not** remove cars, tracks, or modes. Measure before replacing systems. Improve incrementally. Evaluate visuals from the **player camera at racing speed**, not static screenshots.

---

## Objective

Create an extremely polished modern 3D **arcade** rally racing game inspired by the gameplay philosophy of Sega Rally Championship.

The game must be:

- highly realistic **visually** (perceived AAA presentation)
- highly fun to drive
- highly responsive
- visually impressive to **experienced gamers**
- performant in a browser
- optimized for stable frame rates
- believable rather than obviously procedural
- cinematic without sacrificing gameplay clarity

**The target is NOT** “a good Three.js demo.”

**The target is:**

> Someone who plays modern racing games sees this and immediately recognizes it as a serious racing game.

**Friend-test line:**

> “Wait… this is running in a browser?”

---

## Product hierarchy (strict)

```
Sega Rally fun
  → modern racing-game feel
    → AAA presentation
      → browser performance
```

Never invert this (no “maximum polygons → hope it’s fun”).

Never sacrifice responsiveness for visual effects.  
Never add visual complexity merely to increase polygon count.

Prefer: shaders · instancing · LOD · texture detail · lighting · atmospheric perspective · procedural variation · physics-driven FX  
over brute-force geometry.

---

## Core design philosophy

```
REALISTIC PRESENTATION
+ ARCADE-FRIENDLY PHYSICS
+ EXTREMELY RESPONSIVE CONTROLS
+ PHYSICAL VEHICLE MOVEMENT
+ HIGH DETAIL WHERE THE PLAYER LOOKS
+ AGGRESSIVE PERFORMANCE OPTIMIZATION
```

---

## Visual priority (budget order)

1. **Player car** (Hero Car Mode — disproportionate quality)
2. **Road** immediately around player
3. **Camera** (physical, not offset-follow)
4. **Surface interaction** (dust / gravel / mud / tracks / audio)
5. **Lighting**
6. Nearby terrain
7. Nearby vegetation
8. Dust / gravel / mud particle systems
9. Mid-distance environment
10. Distant environment

Player car + road receive **disproportionate** visual quality.

---

## “WOW” moments (systems must reinforce these)

| Moment | Systems involved |
|---|---|
| Sunlight flashing across glossy bodywork | Paint clearcoat · env/PMREM · sun |
| Suspension compressing over bumps | Wheel travel · body pitch/roll · camera |
| Gravel exploding from tires | Wheel slip × surface × load |
| Dust clouds expanding behind the car | Same |
| Tire tracks in dirt | Shared surface + road masks |
| Body roll / weight transfer | Physics → visual → camera |
| Car becoming dirty / mud on arches | Dirt/mud masks driven by spray |
| Dramatic jumps · airborne attitude · hard landings | Jump phys · unload · land dust · cam compress |
| Rocks/veg rushing past · dense forest at speed | LOD · instances · look-ahead streaming |
| Surface transitions (gravel→dirt→asphalt) | Grip · sound · particles · road look |
| Reflections moving across the car | Env lighting · roughness |
| Mountains fading into haze | Atmospheric perspective (cheap depth cue) |
| Camera reacting to impacts | Springs / dampers — **subtle**, not fake shake |

Every major visual change must be judged **while playing at speed**.

---

## Hero Car Mode

The player car must look **ridiculously good** vs everything else — not millions of polys; deliberate geometry + materials + lighting + animation + dirt.

| Layer | Expectation |
|---|---|
| Geometry | Separate body, glass, wheels, tires, brakes, lights, grille, exhaust, suspension, visible underbody |
| Materials | Automotive PBR: metallic paint, clearcoat, clearcoat roughness, normals, roughness, dirt/mud masks — Physical only where visible |
| Lighting | Constantly catches sun, sky, env reflections, shadow gradients |
| Animation | Suspension travel, wheel spin/steer, body pitch/roll/squat, brake glow under extreme brake, exhaust |
| Dirt | Start clean → end rally filthy (lower body / arches first) |

Evolve `js/cars/celica.js` + `js/gfx/pbr.js` — do not replace the car roster.

---

## Road (near-photoreal priority)

Road occupies huge screen area at race speed — often worth more than trees.

Detail scales:

| Scale | Content |
|---|---|
| Macro | Terrain shape / grade |
| Medium | Ruts, bumps, grooves, edge deformation |
| Small | Pebbles, cracks, dirt variation |
| Micro | Normal maps · roughness variation |

Shared **track surface data** must drive physics + renderer + audio (no drifting visual/physics roads).

---

## Environment: believable, not merely dense

Ecological clusters beat random spam. Prefer ~2k careful instances over 50k fake ones.

World systems (evolve `js/tracks/*`, `effects.js`):

```
WORLD → Terrain · Road · VegetationSystem · RockSystem · DebrisSystem · ParticleSystem · Atmosphere
```

**Hero locations:** each stage needs ~5–10 unforgettable moments (tree tunnel, cliff vista, jump, bridge, canyon, wet shore, etc.) — UE5-*feeling* moments without UE5 tech.

Per-track lighting profiles (desert golden · forest filtered · mountain cold clear · lakeside warm late) — sun + env + PBR + haze + shadows. **Do not** solve lighting with bloom. Subtle bloom / exposure / contrast / grade / vignette only.

---

## Camera = AAA feel

```
CAR PHYSICS → accel / brake / lateral / slip / jump / land / surface
     ↓
CAMERA PHYSICS → position · rotation · FOV · look-ahead · roll · pitch · subtle settle
```

Not `camera = car + offset`. Inertia: car leads, camera follows slightly. Drift heading vs velocity must read. Speed cue: slight FOV widen / pull-back / dust — **never** huge artificial shake.

---

## Coherence: one physics value → many visuals

| Driver | Feeds |
|---|---|
| Wheel slip | smoke · dust · gravel · marks · tire sound · yaw · camera |
| Suspension compression | wheel pose · body · contact · dust · impact SFX · camera |

Coherence beats polygon count for “this feels real.”

---

## Performance & quality

| | |
|---|---|
| Primary | **60 FPS** aspirational |
| Budget | **~16.67 ms** |
| Floor | Honest **30 Hz** lock when needed |

Monitor: FPS · frame time · CPU · GPU (where available) · draw calls · tris · textures · geos · render resolution · particles · visible objects.

Quality ladder: **LOW · MEDIUM · HIGH · ULTRA** controlling resolution, shadows, vegetation, terrain, particles, post, reflections, ambient, LOD, texture bias + **dynamic resolution**.

Every major optimization: **before/after** measurements. See [`PERFORMANCE_RULES.md`](PERFORMANCE_RULES.md).

---

## Renderer stance

Production: **WebGL2 / WebGLRenderer (r160)** until evidence says otherwise.  
WebGPU: audited in [`RENDERER_MIGRATION_ANALYSIS.md`](RENDERER_MIGRATION_ANALYSIS.md) — migrate only on explicit Stage 2 / Phase R.2 approval. Prefer TSL for *new* shaders.

---

## Friend / gamer bar

Permanent checklist: [`GAMER_WOW_CHECKLIST.md`](GAMER_WOW_CHECKLIST.md).

Future high-value showcase (not started): **Photo Mode** after race (orbit, FOV, exposure, TOD, HUD off) — showcase what gameplay camera already paid for.

---

## How to ask Cursor

**Bad:** “Can you make the graphics better?”  
**Good:** “Can you make **this system** produce a convincing physical visual response **inside our frame budget**?”

Name a stage/phase before implementation. After major work: **STOP AND AUDIT**.
