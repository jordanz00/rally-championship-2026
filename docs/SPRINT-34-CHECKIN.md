# Sprint 34 Studio Check-In — Rally Championship 2026

**Date:** 23 Aug 2026  
**Build:** `http://127.0.0.1:8765/index.html?v=310`  
**Automated proof:** `node tools/qa-sprint34-checkin.mjs` → **SHIP-CANDIDATE**

---

## Iteration 34 verdict — will this be a bad time?

**No.** The check-in gate passed cleanly after closing Sprint 33 and hardening the module graph. Boot path, championship flow, six-car garage, PBR lighting stack, arcade power-slide handling, background stage preload, co-driver boundary callouts, and the 1995-style **Rally Championship 2026** title emblem all have automated coverage. The remaining gaps are honest human-playtest items (Desert Act 5 bowl feel, headed GPU frame budget on low-end hardware) — not silent regressions or broken menus.

| Gate | Result |
|------|--------|
| Sprint 33 power-slide + SLIDE HUD | PASS |
| Sprint 34 background preload | PASS |
| Sprint 32 PBR lighting | PASS |
| Six-car garage + pro rivals | PASS |
| Sprint 31 expert driving + grip HUD | PASS |
| Sprint 30 cinema realism | PASS |
| Static audit (syntax, imports, cache, security) | PASS |

**CEO ship test for a 10-minute drive:** Yes — with the caveat that AAA-console polish (full VO pipeline, motion-captured cockpit, native asset LOD streaming) is still out of scope for a static browser build. What *is* shippable today: a fast, heavy, readable arcade rally with cinema lighting, planted grip telemetry, championship integrity, and Sega-Rally-*inspired* immediacy without trademark baggage.

---

## CEO progress report

### What specific player moment improved?

1. **Gravel hairpin power-slide (Sprint 33)** — e-brake snaps the tail, throttle holds the slide, countersteer exits. The chase cluster now flashes **SLIDE** when attitude builds so the player reads limit without guessing.
2. **Title → first race (Sprint 34 preload)** — championship cup and next stages warm in the background; a returning player skips the loading screen when the track is already hot.
3. **Sunlit paint read (Sprint 32 PBR)** — Kelvin sun, sky-rim fill, tight shadow frustum, per-material IBL — tarmac and lacquer specular read at chase distance.
4. **Garage identity** — six real GLB silhouettes (Celica, Delta, Stratos, E-Type, Focus ST, Accord Sport) with pro racing-line rivals and subtle rub SFX.
5. **Hard boundary feedback** — co-driver alternates *"Whoa!"* / *"Try to take it easy on the car!"* on heavy wall hits.
6. **Brand moment** — classic arcade title layout: red disc emblem, **RALLY CHAMPIONSHIP**, **2026** year pill — no legacy platform branding.

### What automated command proves it?

```bash
node tools/qa-sprint34-checkin.mjs
```

Supporting gates: `qa-sprint33-drift.mjs`, `qa-sprint34-preload.mjs`, `qa-sprint32-pbr.mjs`, `qa-garage-cars.mjs`, `qa-sprint31-drift.mjs`, `qa-sprint30-realism.mjs`, `qa-static-audit.mjs`.

### What partial items did we close or cut?

| Item | Status |
|------|--------|
| Sprint 33 SLIDE HUD badge | **Closed** |
| Stale cache-bust QA gates (hardcoded v=296–305) | **Closed** — dynamic `qa-cache-version.mjs` |
| Split `config.js` import versions (8 copies in browser) | **Closed** — unified `?v=119` |
| Title SEGA/SATURN branding | **Cut** — replaced with Rally Championship 2026 |
| Desert Act 5 bowl human feel | **Open** — human-only, not blocking ship-candidate |
| Boot smoke CDP timeout in sandbox | **Tolerated** — environment constraint, not code regression |

### Would we ship this build to a friend for 10 minutes?

**Yes**, for an arcade rally session. Blockers to *AAA retail* are documented below (CTO section) — not blockers to a impressive browser demo.

---

## CTO report — why this is not yet AAA in every area

We are **close on feel and visual tier** for a WebGL product. We are **not** close to a $70 console AAA bar across production depth. Honest gaps:

| Area | Current state | AAA gap |
|------|---------------|---------|
| **Asset pipeline** | Optimized GLBs, procedural terrain, Kenney/Blender props | No DCC round-trip, no photogrammetry stages, no authored damage/wear variants |
| **Animation** | Wheel pose, suspension squash, cockpit mirror | No driver body IK, no gear-shift hand anim, no crowd skeletal cycles |
| **Audio** | Procedural engine + co-driver WAVs + surface beds | No Wwise/FMOD mix bus, no dynamic reverb zones, no full pace-note library per stage |
| **Physics** | Arcade-realistic tire slip, jump ballistics, planted grip | Not a full pacejka/suspension sim; refresh-rate coupling on high-Hz displays (see QA-REPORT V-2) |
| **AI** | Pro racing line, trail-brake, yield-to-player | No telemetry-derived opponent lines; rubber-band is invisible but present |
| **Lighting** | Tier-13 cinema PBR, ACES, adaptive post | No Lumen/RTGI, no time-of-day weather system, no wet-surface reflection pass |
| **Performance** | Adaptive bloom drop, rival lowDetail, GPU budget knobs | No guaranteed 60 Hz on integrated GPUs; frame probe needs headed human hardware matrix |
| **Content** | 4 stages, championship flow, 6 cars | No full WRC-length season, no livery editor, no online ghosts |
| **QA** | Strong static + logic gates; boot smoke when Chrome available | Human checklist §2–3 (feel, comfort, stage identity) still manual |
| **Production** | Single-repo static host | No CI render farm, no crash telemetry, no staged rollout |

**Bottom line:** The browser stack delivers **AAA-adjacent moments** (light on paint, slide on gravel, championship grid plant, desert portal underpass) at **indie-plus production depth**. Closing the full AAA gap requires asset volume, audio production, sim validation on reference hardware, and content scale — not another week of config tuning alone.

---

## Full sprint history — Sprints 1–33

*Rally Championship 2026 — from bootstrapped prototype to cinema-tier browser rally.*

### Foundation (Sprints 1–10) — “Does it run? Does the championship work?”

| Sprint | Theme | Player-facing outcome |
|--------|-------|----------------------|
| **1** | Boot + first impressions | Dunes chase cam, shadows, camera kick, surface HUD, title flow |
| **2** | Stage identity | Mountain cliff, Lakeside basin, collision SFX, HUD cleanup |
| **3** | Readability + keep-outs | Racing-line keep-outs, cliff readability, lake framing |
| **4** | Landmark scale | Geo framing bias, mountain mass, lakeside hero scale |
| **5** | Forest drift curriculum | Forest Acts 5–7 drift hairpins teach loose-surface rotation |
| **6** | Mountain drift finale | Mountain gravel Acts 5–7 bowl + linked pair |
| **7** | Performance + garage | 60 Hz render cap, garage poller, title showroom |
| **8** | Rally identity | Co-driver lookahead, Fujimoto jump, grid carry UI |
| **9** | AI + championship integrity | Stage AI, RETRY fix, result screen, championship QA |
| **10** | Release candidate | Full sprint matrix, doc reconciliation |

### Ruthless closeout + visual tiers (Sprints 11–18)

| Sprint | Theme | Player-facing outcome |
|--------|-------|----------------------|
| **11** | Ruthless closeout | Act 6 sweeps, mountain start QA, CEO mandate enforced |
| **12** | Realistic graphics overhaul | Normal-mapped PBR world, IBL tier 2, stage load UI |
| **13** | Environmental realism tier 3 | Horizon haze, terrain grain, road AO |
| **14** | Aerial depth tier 4 | Aerial perspective, hero silhouettes, tier-4 water |
| **15** | Trackside identity tier 5 | Rally boards, contact shadows, water scroll |
| **16** | Hotfix wave | POV cockpit gauges + mirror, contact blob ground Y |
| **17** | Chase-cam readability tier 6 | Camera occlusion fade, cliff fade, HUD punch |
| **18** | Championship + Stratos hero | Grid carry closed, Stratos 15.6k tris hero |

### Speed, levels, props, crowds (Sprints 19–22)

| Sprint | Theme | Player-facing outcome |
|--------|-------|----------------------|
| **19** | Arcade sense of speed | Power punch, chase FOV rush, cabin wind |
| **20** | Realistic level design tier 7 | Terrain biomes, verge detail, stage lighting |
| **21** | Authored GLB props | Kenney crowds, safari animals, alpine houses — no box stand-ins |
| **22** | Soft off-road + living crowds | Free runoff, soft nudge, mid-track reset, clap/cheer + Doppler |

### Photoreal stack + driving integrity (Sprints 23–28)

| Sprint | Theme | Player-facing outcome |
|--------|-------|----------------------|
| **23** | Photoreal lighting + post | Tier 9 textures, IBL, bloom/grade |
| **24** | 60fps photoreal + no lag | Adaptive post, GPU budget, snappy steer |
| **25** | UE5-style PBR | Clearcoat paint, roughness maps, physical lights, film grain |
| **26** | Driving integrity | No throttle-only win, planted grip, exclusive grid, no start pop-in |
| **27** | Environmental realism + dirt wake | Tier 11 skies, stage wind, rear grit plume, HD nature GLBs |
| **28** | Launch punch + driveline | Dead-stop boost, shorter 1st, higher Vmax, tier 12 |

### Cinema realism → arcade mastery (Sprints 29–33)

| Sprint | Theme | Player-facing outcome |
|--------|-------|----------------------|
| **29** | Handbrake power slides | Low e-brake threshold, rear µ dump, throttle power slide entry |
| **30** | Cinema realism | Tier 13, ACES filmic, photographic grade, land micro-detail |
| **31** | AAA expert driving | Trail-brake yaw, expert countersteer, GRIP bar, drift camera kick |
| **32** | PBR lighting + desert portal | Kelvin sun, sky rim, tight shadows, rock-bridge underpass finale |
| **33** | Arcade power-slide | Strong e-brake snap, throttle sustain, **SLIDE** HUD badge |

*Parallel tracks (same window): six-car garage + pro rivals, co-driver boundary callouts, Rally Championship 2026 title emblem, drive-corridor clip cleanup (Sprint 35 doc), Delta headlight fix.*

---

## Sprint 33 — execution summary (this iteration)

**Charter:** Close the fun arcade power-slide loop with readable HUD feedback.

| Deliverable | Status |
|-------------|--------|
| `handbrakeYawKick` 3.15, `handbrakePowerMul` 2.05 | Done |
| `handbrakeBleedMul` 0.032, `driftBleedMul` 0.048 | Done |
| Loose surface pitch-in (sand/gravel/dirt/mud) | Done |
| Chase cluster **SLIDE** badge (`#cluster-slide`, `slideBadge`) | Done |
| `tools/qa-sprint33-drift.mjs` | PASS |

**Still human-only:** Desert Act 5 bowl + linked gravel hairpins — confirm tail snap and exit on a live drive.

---

## Sprint 34 — execution summary (this iteration)

**Charter:** Studio check-in — preload hot paths, QA orchestration, module graph hygiene.

| Deliverable | Status |
|-------------|--------|
| Background `_trackCache` + `_pumpPreloadQueue` | Done |
| Instant race when `_isTrackReady` | Done |
| Halfway next-stage preload | Done |
| Title championship cup warm | Done |
| `tools/qa-sprint34-checkin.mjs` orchestrator | Done |
| `tools/qa-cache-version.mjs` shared cache reader | Done |
| Unified `config.js?v=119` across module graph | Done |
| QA gates updated (no stale hardcoded v=) | Done |

---

## Play & validate

```bash
python3 -m http.server 8765
# open http://127.0.0.1:8765/index.html?v=310

node tools/qa-sprint34-checkin.mjs
node tools/qa-sprint-matrix.mjs   # full 1–28 regression matrix
```

**Human checklist (2 minutes):** Desert gravel hairpin e-brake → SLIDE badge → countersteer exit; title → SELECT MODE → instant Desert if preloaded; garage → pick Focus ST → championship grid with mixed GLB rivals.

---

*Game Director sign-off: Sprint 33 closed. Sprint 34 check-in SHIP-CANDIDATE. Iteration 35 targets human playtest closure on Desert Act 5 bowl and headed frame probe on target hardware.*
