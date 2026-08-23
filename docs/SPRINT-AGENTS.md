# Sprint Parallel Agent Roster — Sega Rally Clone

> **Authority:** [`.cursor/rules/virtual-racing-game-studio.mdc`](../.cursor/rules/virtual-racing-game-studio.mdc)  
> **Validation:** [`docs/QA-CHECKLIST.md`](QA-CHECKLIST.md) · [`docs/AM3-RESEARCH.md`](AM3-RESEARCH.md)  
> **Status log:** [`docs/QA-REPORT.md`](QA-REPORT.md)

Eight senior agents run **in parallel** under the Game Director.

**CEO mandate (Sprint 11+): ruthless improvement** — close every PARTIAL item or cut it; no tolerated player-facing defects; automated proof before sprint sign-off. See studio rule for full CEO charter.

---

## Sprint index (1–34)

| Sprint | Theme | Primary deliverables |
|--------|-------|----------------------|
| **1** | Boot + first impressions | Dunes chase view, shadows, camera kick, surface HUD, title |
| **2** | Stage identity | Mountain cliff, Lakeside basin, collision SFX, HUD cleanup |
| **3** | Readability + keep-outs | Racing-line keep-outs, cliff readability, lake framing |
| **4** | Landmark scale | `_geoFramingBias`, mountain mass, lakeside framing |
| **5** | Forest drift curriculum | Forest Acts 5–7 drift hairpins |
| **6** | Mountain drift finale | Mountain gravel Acts 5–7 Bowl / linked pair |
| **7** | Performance + garage | 60 Hz render cap, garage poller, title showroom |
| **8** | Rally identity | Co-driver lookahead, Fujimoto jump, grid carry UI |
| **9** | AI + championship integrity | Stage AI, RETRY fix, result screen, championship QA |
| **10** | Release candidate | Full sprint matrix QA, doc reconciliation |
| **11** | Ruthless closeout | Act 6 sweeps, mountain start QA, merge/GLB hygiene, CEO mandate |
| **12** | Realistic graphics overhaul | Normal-mapped PBR world, IBL tier 2, stage load UI, streaming anti-pop-in |
| **13** | Environmental realism tier 3 | `VISUAL.tier` 3, horizon haze, terrain/road grain, road AO, tier-3 IBL |
| **14** | Aerial depth + hero landmarks tier 4 | Aerial perspective, hero silhouettes, tier-4 water |
| **15** | Trackside identity tier 5 | Rally boards, contact shadows, water scroll |
| **16** | Hotfix wave (doc closeout) | POV cockpit gauges + mirror, contact blob ground Y, camera occlusion fade |
| **17** | Chase-cam readability tier 6 | `cameraOcclusionFade`, cliff fade, tunnel grain, HUD punch |
| **18** | Championship + Stratos hero | I-1/I-2 closed, #5 machine-confirmed, Stratos 15.6k tris |
| **19** | Arcade sense of speed | Power punch, chase FOV rush, cabin wind |
| **20** | Highly realistic level design tier 7 | Terrain biomes, verge detail, stage lighting |
| **21** | Authored GLB props & characters | Kenney crowds/nature, safari animals, alpine houses; no box stand-ins |
| **22** | Soft off-road + living crowds | Free runoff, soft nudge, mid-track reset, clap/cheer + Doppler |
| **23** | Photoreal lighting + post | Tier 9 textures, IBL, stage light, bloom/grade |
| **24** | 60fps photoreal + no lag | Adaptive post, GPU budget, snappy steer |
| **25** | UE5-style PBR photoreal | Clearcoat paint, roughness maps, physical lights, film grain |
| **26** | Driving integrity | No throttle-only win, planted grip, exclusive grid, no start pop-in |
| **27** | Environmental realism + dirt wake | Tier 11 skies/haze, stage wind, rear dirt/grit plume |
| **28** | Launch punch + driveline realism | Dead-stop boost, shorter 1st, higher Vmax, tier 12 |
| **29** | Handbrake power slides | e-brake rear dump, throttle power slide, hb bleed sustain |
| **30** | Cinema realism | Tier 13, ACES, photographic grade, land micro-detail |
| **31** | AAA expert driving | Trail-brake yaw, grip HUD, drift camera kick |
| **32** | PBR lighting + desert portal | Kelvin sun, sky rim, tight shadows, rock-bridge underpass |
| **33** | Arcade power-slide | Strong e-brake snap, throttle sustain, SLIDE HUD badge |
| **34** | Studio check-in + preload | Background track cache, instant race when hot, QA orchestrator |
| **35** | DCC + damage | Asset manifest, progressive body wear tiers |
| **36** | Pace library + cockpit | Authored WRC pace notes, procedural cockpit motion |
| **37** | Audio mix + reverb | Dynamic reverb zones, wet/dry SFX bus |
| **38** | Pacejka + fixed-step | Per-surface Magic Formula, 60 Hz accumulator gate |
| **39** | Integrated GPU perf | Perf tier module, iGPU floor targets |
| **40** | WRC + ghosts + telemetry | Act 8 stages, localStorage ghosts, live QA export |

---

## Agent roster

| ID | Role | Mission | Key files |
|----|------|---------|-----------|
| **LE1** | Lead Engineer | Loop, fixed-step physics, render cap, cameras, perf | `game.js`, `config.js`, `physics/*`, `gfx/*` |
| **GD1** | Gameplay Designer | Handling, drift acts, AI, championship rules | `courses.js`, `ai.js`, `vehicle.js`, `surfaces.js` |
| **EA1** | Environment Art | Tracks, terrain, landmarks, lighting | `track.js`, `courses.js`, `sky.js`, `pbr.js` |
| **VS1** | Vehicle Systems | GLB load, garage, merge hygiene, car pose | `celica.js`, `assets/*`, `tools/glb*.mjs` |
| **AH1** | Audio / HUD Director | Engine, co-driver, HUD readability | `audio/*`, `hud.js`, `game.css` |
| **QA1** | QA / Playtest Lead | Automated + human checklist, QA-REPORT | `tools/qa-*.mjs`, `QA-CHECKLIST.md` |
| **RM1** | Release Manager | Cache bust, boot path, sprint closure docs | `index.html`, `main.js`, `QA-REPORT.md` |
| **DIR1** | Game Director | Integration, prioritization, ship / no-go | `AM3-RESEARCH.md`, cross-cutting review |

---

## Commands

```bash
node tools/qa-sprint-matrix.mjs      # full sprint 1–27 automated rerun
node tools/qa-realistic-visual.mjs     # Sprint 12 PBR / normal-map gate
node tools/qa-sprint13-visual.mjs    # Sprint 13 horizon haze + terrain grain gate
node tools/qa-sprint14-visual.mjs    # Sprint 14 aerial depth + hero landmarks gate
node tools/qa-sprint15-visual.mjs    # Sprint 15 trackside identity + contact grounding gate
node tools/qa-sprint17-visual.mjs    # Sprint 17 chase-cam occlusion fade + tier 6 gate
node tools/qa-sprint20-realism.mjs   # Sprint 20 tier-7 level realism gate
node tools/qa-sprint21-props.mjs     # Sprint 21 GLB props/characters gate
node tools/qa-sprint22-runoff.mjs    # Sprint 22 soft off-road + living crowds gate
node tools/qa-sprint23-photoreal.mjs # Sprint 23 photoreal lighting + post gate
node tools/qa-sprint24-perf.mjs      # Sprint 24 60fps photoreal + no lag gate
node tools/qa-sprint25-ue5.mjs       # Sprint 25 UE5-style PBR photoreal gate
node tools/qa-sprint26-driving.mjs   # Sprint 26 driving integrity + grid plant gate
node tools/qa-sprint27-env.mjs       # Sprint 27 env realism + rear dirt wake gate
node tools/qa-sprint28-launch.mjs    # Sprint 28 dead-stop launch + Vmax gate
node tools/qa-sprint29-drift.mjs     # Sprint 29 handbrake drift gate
node tools/qa-sprint30-realism.mjs   # Sprint 30 cinema realism gate
node tools/qa-sprint31-drift.mjs     # Sprint 31 expert driving + grip HUD gate
node tools/qa-sprint32-pbr.mjs       # Sprint 32 PBR lighting gate
node tools/qa-sprint33-drift.mjs     # Sprint 33 arcade power-slide gate
node tools/qa-sprint34-preload.mjs   # Sprint 34 background preload gate
node tools/qa-sprint34-checkin.mjs   # Sprint 34 full studio check-in
node tools/qa-sprint35-40-matrix.mjs   # Sprints 35–40 AAA foundations gate
node tools/dcc-pipeline.mjs            # Sprint 35 DCC manifest
node tools/qa-garage-cars.mjs        # Six-car garage + rival chassis gate
node tools/qa-sprint18-championship.mjs  # Sprint 18 I-1/I-2 + grid carry gate
node tools/qa-mountain-start.mjs     # Mountain stage 3 trench regression
node tools/qa-static-audit.mjs
node tools/qa-boot-smoke.mjs
node tools/qa-championship-flow.mjs
node tools/qa-championship-advance.mjs
node tools/qa-championship-grid.mjs
node tools/qa-frame-probe.mjs          # headed — real GPU only
python3 -m http.server 8765
```

*Regenerated: Sprint 40 — WRC extensions + ghosts + telemetry.*
