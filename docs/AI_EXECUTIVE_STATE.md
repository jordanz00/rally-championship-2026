# AI Executive State — Rally Championship 2026

**Purpose:** Compact brain packet for future Cursor sessions. Read this before rediscovering strategy.  
**Authority:** Code + `docs/QA-REPORT.md` beat stale narrative. Update this file when the current objective closes or a CEO decision lands.  
**Last updated:** 2026-09-04 · Boot `main.js?v=643`

---

## Current product truth (what works)

- Browser arcade rally: Celica / Delta / Stratos · Desert / Forest / Mountain / Lakeside · Championship / Time Attack / Practice.
- Fixed-step vehicle physics + AM3-inspired surfaces/slide/handbrake; Physics Lab (`?physlab=1` / F8) + `COURSES.physlab`.
- TrackDefinition + worldvalidate + clearance/tunnel contracts; four authored stages.
- Title showroom → race load UI → countdown → chase/POV cameras · co-driver VO · touch/tilt.
- QualityManager / perf tiers · WebGL2 path (WebGPU vendor present, production cutover gated).
- Automated gates green when last run: `qa-static-audit`, `qa-validate`, many sprint `qa-*` (headed Chrome optional / flaky in Cursor).
- **Arcade First Boot (SHIP 1, 2026-09-04):** START → championship SELECT CAR → Celica → Desert; garage/GLB/PHYS LAB/FPS/DIST/SURFACE/GRIP/SLIDE behind `?dev=1` / `?debug=1` / `rally-debug=1`.

**Local vs Pages:** Local tree boot ~`?v=643`. Git `origin` last commit noted ~v583 — Pages may lag; hard-refresh local `index.html` pins.

---

## Current weaknesses ranked 1–10

| # | Weakness | Evidence |
|---|----------|----------|
| 1 | **Driver gate A human SHIP/CUT open** — catch/land dial bake machine-green, feel unconfirmed | QA-REPORT CEO #1 · Executive gate A UNKNOWN |
| 2 | **Spectator gate B UNKNOWN** — camera mass Call #2 paused; weight readability not human-scored | QA-REPORT Executive gate |
| 3 | **Intermittent Track.create hang** (stage-build wedge) | QA-REPORT Red · Sprint 76 #2 · do not wholesale rewrite |
| 4 | **Absolute 60 fps claim still soft** | QA-REPORT · software raster / device variance |
| 5 | **AI surface skill / fair pack** not next until A+B human | Roadmap / CEO defer |
| 6 | **Desert vertical-slice identity** (SHIP 2) still open | Prior CEO ship order — after Boot |
| 7 | **Deep race-feedback** (pace readability, slide feel without telemetry HUD) | Pace DOM often `display:none`; audio-first |
| 8 | **Stale Sprint 89 Jump-3 PARTIAL in tables** | Doc lie; superseded by later sprints |
| 9 | **GitHub Pages cache lag** vs local `?v=` | Commit vs working tree |
| 10 | **PerformanceDirector / density** deferred | Roadmap · PERFORMANCE_RULES |

---

## Current objective (exactly ONE)

**Human Driver gate A — SHIP or CUT CEO #1 catch/land dial bake.**

CEO drives Phys Lab + Desert bowl: slide → opposite-lock catch → throttle → jump → planted land. Automated QA already PASS; only human feel closes GREEN LIGHT.

*(Arcade First Boot is shipped in tree as of `?v=643`. Do not reopen unless regression.)*

---

## Design hypothesis

Arcade rally wins when the first minute feels finished and the car’s catch/land reads as a switch the player caused — not when HUD shows more numbers or when sim accuracy rises. Separate player chrome from dev tools; tune existing assist/land dials before adding systems.

---

## Don't touch

- TypeScript / React / Vite / npm app runtime / parallel `src/**` tree  
- WebGPU production cutover (Phase R.2 / Stage 2 only with explicit approval)  
- Wholesale `track.js` rewrite; do not loosen worldvalidate  
- ECS / custom engine / full renderer replacement  
- Uncontrolled vegetation / particle / density spikes  
- Sim-first physics that hurts fun  
- Camera-mass Call #2 until Driver A is scored (paused)  
- PerformanceDirector architecture until A+B authorize plan-only next three  

---

## Do Not Reconsider (attractive bad ideas already killed)

1. **Rewrite track.js to “fix” intermittent hang** — Red; localized only with proof; else leave.  
2. **WebGPU cutover for “AAA”** — gated; report why and stop.  
3. **TypeScript / Vite migration mid-ship** — evolve `js/`.  
4. **Show garage / GLB / FPS / grip telemetry on first-run** — player path is arcade; tools behind `?dev=1`/`?debug=1`.  
5. **Stats screens / difficulty jargon on car/course buttons** — fantasy lines only.  
6. **Camera-mass / new assist layers while Driver A unconfirmed** — no parallel feel authority.  
7. **Unbounded “make it amazing” autonomy** — one coherent objective; institutional state first.  
8. **Fake AAA / invent QA results / weaken validators**.  
9. **Carry Sprint 89 Jump-3 PARTIAL as live P0** — stale doc.  
10. **Feature churn (AI depth, V6 signature, PerformanceDirector) before human A+B** — CEO defer.

---

## Acceptance criteria (current objective)

1. Human: `?physlab=1` (or Practice → PHYS LAB) — hairpin gravel catch feels like a switch, not steered-for-you.  
2. Human: jump land wants the next crest (planted, not mushy).  
3. Human: 2-min Desert Act bowl — trail-brake → hold → opposite lock → crest land still fun.  
4. If FAIL → CUT/revert CEO #1 config dials (or one Cursor-contract feel fix). If PASS → record SHIP in QA-REPORT + Decision Log; then authorize next ONE candidate.

---

## Recent decisions (summary)

| Decision | Result |
|----------|--------|
| CEO #1 dial bake | Machine SHIP candidate; **human SHIP/CUT open** |
| Camera-mass Call #2 | **Paused** until A scored |
| Arcade First Boot | **Shipped** `?v=643` |
| WebGPU R.2 | **Gated** |
| Unbounded amazing mandate | **Stopped** → institutional docs |

See `docs/AI_DECISION_LOG.md`.

---

## Known risks

- Headed Chrome/CDP flaky in Cursor agent hosts — do not invent boot-smoke PASS.  
- `Track.create` intermittent hang — player-facing but Red for architecture.  
- Large uncommitted working tree beyond Boot — do not mix unrelated diffs into Boot claims.  
- Cache: always bump `?v=` on touched modules + importers.

---

## Next candidates (after Driver A closes) — pick ONE later

1. If A FAIL → one feel/camera contract fix (not Boot again).  
2. If A PASS → Spectator B human score (no code until scored) or one camera readability fix if B FAIL.  
3. Desert vertical slice (SHIP 2) — stage identity where the player looks.  
4. Localized Track.create hang **only** with repro + narrow fix.  
5. AI surface skill (plan-only until A+B).

---

## Boot pin

`index.html` → `js/main.js?v=643` · `css/game.css?v=40` · `hud.js?v=35` (via `game.js`)
