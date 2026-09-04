# Quality Target — Rally Championship 2026

**Date:** 2026-09-03  
**Status:** Phase 1 **implemented** (vehicle + camera springs + PerformanceMonitor). Awaiting human exit criteria before Phase 2.  
**Depends on:** [`docs/CURRENT_ENGINE_AUDIT.md`](CURRENT_ENGINE_AUDIT.md) · [`docs/AM3-RESEARCH.md`](AM3-RESEARCH.md) · [`docs/PERFORMANCE_RULES.md`](PERFORMANCE_RULES.md) · [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md)  
**Live build:** https://jordanz00.github.io/rally-championship-2026/  
**Local tree:** may be ahead of Pages (`?v=598` at audit time)

---

## Mandate

The game already has the **right foundation** (modes, cars, courses, controls, cameras, HUD loop). The next phase is a **2.0 visual + handling overhaul**, not another feature sprint.

**Rendering reality check:** Ship AAA *visual principles* (PBR, HDR, atmosphere, selective shadows, instancing, LOD, dynamic resolution) under **browser GPU budgets**. Do **not** brute-force UE5 geometry counts. Current present path is **WebGL (Three r160)**; **WebGPU is a separate approved migration**, not a prerequisite for Phase 1.

| Do | Do not |
|---|---|
| Preserve architecture; replace/tune **weak subsystems** | Rewrite the project from scratch |
| Make existing systems feel cohesive, physical, polished, expensive | Add tracks/cars/modes before feel is excellent |
| **Realistic graphics + believable physics + arcade handling** | Hardcore sim that kills fun |
| Communicate physics through camera, suspension, dust, audio, road | Pretty scenery that doesn’t read weight/slip |
| Obey [`PERFORMANCE_RULES.md`](PERFORMANCE_RULES.md) | Parallel “clean” renderer that forks the game |

**North-star sentence:** After one clean Desert run you want *one more run* — not another menu option.

---

## Identity stack

```
              RALLY CHAMPIONSHIP 2026

                    GAMEPLAY
                       │
                 Sega Rally DNA
                       │
           ┌───────────┴───────────┐
           │                       │
       PHYSICS                  CAMERA
           │                       │
           └───────────┬───────────┘
                       │
                  PRESENTATION
                       │
       ┌───────────────┼────────────────┐
       │               │                │
      CAR           TERRAIN          EFFECTS
       │               │                │
      PBR           PBR terrain       dust
      glass         vegetation        gravel
      paint         lighting          mud
      tires         atmosphere        debris
      suspension    shadows           sparks
```

**Everything should communicate physics.** Suspension, camera springs, dust, tire marks, audio, and surface HUD are not separate polish tracks — they are readouts of one vehicle model.

---

## Priority order (product)

1. Rebuild/tune **driving model** around Sega Rally feel (AM3)  
2. Make the **camera** substantially more physical  
3. Make **road/terrain** visually richer (road first)  
4. Make **cars** read as hero assets (materials + suspension + dirt), not “dropped GLBs”  
5. Make **dust / gravel / marks / suspension / surface** react to wheel physics  
6. Improve **lighting / materials / reflections**  
7. Mature **LOD / instancing / streaming** (evolve what exists — don’t invent from zero)  
8. Strengthen **dynamic performance manager**  
9. Polish **menus / HUD / audio**  
10. **Only then** add more content  

---

## Architecture principle: physics owns the GLB

```
VehiclePhysics
      │
      ├── Body
      ├── Wheel FL / FR / RL / RR   (contact, load, slip, steer, spin, surface)
             │
             ↓
          GLB visual shell
```

**Already true in this repo (do not “introduce” as greenfield):**  
`js/physics/vehicle.js` is independent of GLB; `js/cars/celica.js` is the visual shell + wheel pose hooks. Phase 1 means **deepen the coupling outward** (camera, VFX, audio, suspension mesh) from wheel state — not invent a second physics graph.

---

## Car identity bar (must be feelable in 10 seconds)

| Car | Label | Feel target |
|---|---|---|
| **Celica** | 4WD PLANTED | Squats under power; less rear rotation; traction-biased |
| **Delta** | 4WD SNAPPY | Faster rotation; sharper turn-in; abrupt transitions |
| **Stratos** | RWD SLIDE | Easier rear slip; obvious throttle oversteer |

Player should switch cars and immediately think: *“This one drives differently.”*

---

## Honest gap map (audit ↔ this brief)

Use this so Phase work improves weak links instead of rebuilding what already works.

| Brief ask | Repo today | Gap / Phase |
|---|---|---|
| Fixed timestep + substeps | `FIXED_DT`, `MAX_SUBSTEPS`, tire substeps | Tune + render interp honesty — **P1** |
| Heading ≠ velocity (drift from forces) | Pacejka / slip / handbrake / gear-drift exist | Controllability curve + car identity separation — **P1** |
| Per-wheel contact/load/slip driving VFX | Partial (vehicle + deform + dust) | One wheel-state → many consumers — **P1→P2** |
| Visible dive/squat/roll/land | Partial suspension travel / body roll | More readable mesh response — **P1** |
| Camera springs (pos/rot/FOV) | Chase lerp + FOV punch + roll follow | True spring-damper + look-ahead + drift lag — **P1** |
| Speed FOV / drift offset / corner look-ahead | Partial FOV; weak look-ahead | Complete spring camera — **P1** |
| PerformanceMonitor (CPU/GPU/draws) | FPS HUD + `perf-tier` | Dev overlay + timings — **P1** |
| Dynamic resolution | DPR/tier + lock-30; not continuous 0.75–1.0 scaler | Evolve `perf-tier` — **P1** (foundation) / **P2** (full) |
| Clearcoat / glass | Player clearcoat + showroom glass work | Race hero consistency — **P2** |
| Layered road shader (wear/mud/marks/wet) | Procedural maps + surface paint + tire marks/deform | Richer layered road — **P2** |
| Instancing + spatial cells + STREAM | **Already** InstancedMesh, chunks, fog stream | Density + asymmetry + speed-based preload — **P3** |
| Mud on body shader | Not a first-class dirt mask loop | **P2** (after dry look nails) |
| Weather / rain | Later | **After** dry → overcast → wet |
| Driving school | Controls copy only | Content after feel — **post P1** |
| Minimal arcade HUD vs debug | Race HUD still dense / debug-flavored | **After P1** (or small parallel polish) |
| Live title / garage showcase | Title showroom + car select exist | Premium presentation — **after P1–2** |

**Budget rule (render):**

```
PLAYER CAR       █████████████
ROAD             ███████████
NEAR TERRAIN     █████████
EFFECTS          ███████
NEAR VEGETATION  ███████
MID ENVIRONMENT  ████
DISTANT WORLD    ██
```

Not inverted (10k trees starving the car).

---

## Phase gates

### Phase 1 — Vehicle + camera + performance foundation

**Status: IMPLEMENTED locally (`?v=600`)** — human exit criteria still required before Phase 2.

**Shipped**

- `js/camera/camera-spring.js` — pos / look / FOV springs; road + speed look-ahead; accel/brake cam pitch bias  
- Car identity knobs (Celica planted / Delta snappy / Stratos RWD)  
- Handbrake initiation (lower yawKick / powerMul; higher enter threshold)  
- Visible brake dive / accel squat + `wheelTravelVisual`  
- `js/debug/performance-monitor.js` — `?debug=1` or `?perfmon=1`  

**Exit criteria (human)**

- [ ] 10-second car-identity test passes (Celica ≠ Delta ≠ Stratos)  
- [ ] Handbrake starts a slide; player finishes it  
- [ ] Camera feels attached to a physical body without nausea  
- [ ] Headed frame probe recorded; FPS claim remains **honest**  
- [x] Report: files / physics / camera / perf (see QA-REPORT Sprint v599–600)  
- [ ] **Stop.** Do not auto-start Phase 2  

**Suggested QA**

- `qa-steering`, `qa-am3-handling`, `qa-sprint70-camera`, headed `qa-frame-probe`  
- Human: Desert hairpin + jump 3 + mud exit on all three cars  

---

### Phase 2 — Modern rally visual overhaul

**In scope**

- Hero car PBR (paint, glass, tires, wells, dirt/mud mask), visual LODs  
- Layered road materials; edge blend into terrain  
- Macro/medium/micro terrain detail via materials more than poly spam  
- Physics-driven dust/gravel/mud emission from wheel slip × load × surface  
- Lighting: sun + HDR + selective locals; atmospheric perspective  
- Subtle post (no filter look); **quality tiers LOW→ULTRA** + dynamic resolution  

**Out of scope**

- Physics retunes (unless a visual bug forces a tiny fix)  
- New tracks/modes  

**Exit criteria**

- [ ] Road is the star of the frame at race speed  
- [ ] Sand ≠ gravel ≠ mud in particle *and* sound  
- [ ] Benchmark table: draw calls, tris, GPU/CPU ms, texture mem, FPS, render scale  
- [ ] **Stop.** Do not auto-start Phase 3  

---

### Phase 3 — Environment density + world streaming

**In scope**

- Road as streaming spine; speed-based forward load distance  
- Cell-based vegetation/rocks; deterministic asymmetry (clusters, not grids)  
- Atmosphere hides LOD pops  
- Streaming debug view (loaded / visible / culled / instances / memory)  

**Out of scope**

- Blind geometry explosion; weather until dry world sells  

**Exit criteria**

- [ ] Same courses feel denser without dropping below quality-tier FPS targets  
- [ ] **Stop** for content/UI/weather decisions  

---

### Later (explicitly deferred)

| Item | Why later |
|---|---|
| Driving School (short drills) | Needs stable Phase 1 feel |
| Minimal arcade HUD vs Expert/debug | After clutter stops fighting camera/feel |
| Live title (idle car, atmosphere) + garage showcase | After hero materials exist |
| Weather (overcast → wet → rain) | After dry look + grip story |
| Feel-test track `/debug/vehicle-test` | High leverage **during** Phase 1 if approved as tooling |
| Visual benchmark track | During Phase 2 |
| More courses/cars | After polish ROI drops |

---

## Feel checklist (acceptance for every change)

Use as a playtest script, not marketing copy.

1. Launch Celica → camera settles → accelerate onto dirt → **squat + gravel**  
2. Hard brake → **nose dive** → turn → rear rotates → **countersteer → recover**  
3. Crest → unload → air → tap brake → **nose drop** → land → **compress + dust + camera thump**  
4. Dirt → asphalt → **sound + grip change** readable without HUD  
5. Switch to Stratos → same corner → **obviously more rear slip**  
6. Still want *one more run*

---

## Relationship to CRITICAL audit items

Phase work must not ignore the audit’s professional blockers:

| Audit CRITICAL | How phases address it |
|---|---|
| 60 fps honesty | P1 monitor + resolution/quality evolution; no fake 60 claims |
| Stage-build wedge | Prefer cache/yield improvements over denser cold builds; P3 streaming must not worsen cold load |
| Env-clip / tunnel / jump fragility | Prefer physics/camera/materials first; world density only with regression tools |
| Monoliths | Prefer surgical modules (`CameraSpring`, `PerformanceMonitor`) over rewriting `track.js` |

---

## Approval switch

| Request | Action |
|---|---|
| *(this document)* | Quality target only — **done** |
| “Begin Phase 1” | Vehicle + camera + perf foundation only |
| “Begin Phase 2 / 3” | Only after prior phase exit criteria |

**Default until you say otherwise:** no gameplay or rendering implementation.

---

## Renderer roadmap (explicitly gated)

Canonical stage list: [`RALLY_ENGINE_ROADMAP.md`](RALLY_ENGINE_ROADMAP.md) · constitution: [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md).

| Sprint | Goal | Prerequisite |
|---|---|---|
| **Phase 1** | Vehicle + camera springs + PerformanceMonitor on **current WebGL** | Done (human exit still open) |
| **Phase 2** | Materials / road layers / physics-driven VFX / quality tiers | Phase 1 exit + “Begin Phase 2” |
| **Phase 3** | Density + streaming refinements | Phase 2 exit |
| **Phase R.1** | WebGPU *foundation* (factory/pipeline/caps) + WebGL production | Done |
| **Phase R.2 / Stage 2** | Prefer WebGPURenderer + TSL for new shaders; WebGL2 fallback; migrate GLSL post/FX | Explicit “Begin Phase R.2” or “Begin Stage 2” |
| **Stages 3–19** | Profiler → physics lab → … → benchmark → polish | Per roadmap; name the stage |

### Phase R status (2026-09-04)

**R.1 shipped (foundation):** RenderPipeline + renderer factory + RENDER_CAPS + QualityManager + vendored `three.webgpu.js` (r170). Production present path remains **WebGL / three.module.js r160** (Pages + CDP safe). Factory is WebGPURenderer-ready when a future THREE cutover exports it; GLSL post/dust gated by `RENDER_CAPS.glslCustom`. Async `_bootGfx` joins in-flight init (race-safe).

**Not yet (R.2):** Default cutover to `three.webgpu.js` / native WebGPU (blocked on TSL ports for PhotoRealPost + particle GLSL). Opt-in after headed smoke.

Phase R must not strand Pages users: **WebGL fallback required**. Prefer TSL/NodeMaterial for *new* custom shader work so WebGPU + WebGL2 can share graphs.

---

## Suggested next approvals

| Say | Meaning |
|---|---|
| **Continue Pass 1** | Agent 8 — foundation / migrate stages |
| **Begin Visual Pass V1** | Agent 1 (+2) — render/color/tone |
| **Begin Visual Pass V2** | Agent 4 (+3) — hero car |
| **Visual QA review** | Agent 12 — scores only |
| **Integrate visual work** | Agent 13 — all-stage gates |

See [`AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md). Never launch all visual agents at once.
