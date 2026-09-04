# AI Executive State — Rally Championship 2026

**Purpose:** Compact brain packet. Read before rediscovering strategy.  
**Authority:** Code + `docs/QA-REPORT.md` beat stale narrative.  
**Last updated:** 2026-09-04 · Boot `main.js?v=652` · Gate A **SHIP** · Pages ship package

---

## Product North Star

Browser arcade rally that makes a friend say “Wait — this is running in a browser?”  
Priority: **fun → feel → feedback → hero presentation → perf → maintainability → sim.**

---

## Current Game State (what works)

- Modes: Title → car → Championship / Time Attack / Practice · Celica / Delta / Stratos · Desert / Forest / Mountain / Lakeside (+ physlab).
- Arcade First Boot: START → championship SELECT CAR → Celica → Desert; garage/FPS/telemetry behind `?dev=1` / `?debug=1`.
- Splash credit: **Developed by Jordan Zabady** · **AI-assisted development with Cursor** (tech page removed).
- Physics: CEO #1 catch/land dials — **human SHIP 2026-09-04** (retained). Lab `?physlab=1` / F8.
- World: TrackDefinition + worldvalidate GREEN · Kenney CC0 trackside pack via `prop-kit.js?v=31` · `track.js?v=292`.
- Race feedback: pack place punch (overtake flash + chirp).

**Ship target:** Push working tree → GitHub Pages (`main`).

---

## Current Weaknesses (ranked)

| # | Weakness | Evidence |
|---|----------|----------|
| 1 | **Spectator gate B UNKNOWN** — camera mass unscored | QA-REPORT |
| 2 | **Intermittent Track.create hang** | QA-REPORT Red · localized only |
| 3 | **Absolute 60 fps claim soft** | device / raster variance |
| 4 | **Desert vertical-slice identity** (SHIP 2) | after B |
| 5 | Kenney trackside at racing speed — light human confirm | optional |
| 6 | AI surface skill deferred | until A+B (A done) |
| 7 | Stale Sprint 89 Jump-3 PARTIAL in tables | doc lie |
| 8 | PerformanceDirector / density deferred | roadmap |

---

## Active Mission (ONE)

**Human Spectator gate B — score camera mass communication.**

Watch chase (no HUD coaching): braking pitch, slide yaw follow, land compression readable without nausea?  
PASS → log SHIP B; then Desert vertical slice OR one camera contract if FAIL.  
Do not implement camera-mass Call #2 until B is scored.

---

## Current Hypothesis

Feel (A) is shipped. Next bottleneck for “expensive” perception is whether the **camera sells mass** at racing speed — score before coding.

---

## Architectural Constraints (permanent)

See `docs/ai/DO_NOT_DO.md`. WebGPU / TS / track rewrite gated.

---

## Recent Wins

| When | Win |
|------|-----|
| 2026-09-04 | **Gate A SHIP** — CEO #1 catch/land dials retained |
| 2026-09-04 | Arcade First Boot · place punch · splash credit · Kenney trackside |
| 2026-09-04 | Intelligence layer (`AI_*` + `docs/ai/`) |

## Recent Failures / pauses

| Item | Status |
|------|--------|
| Camera-mass Call #2 | Awaiting human Gate B score |
| Unbounded amazing mandate | Stopped |

---

## Current Top 5

1. Human Spectator B score  
2. If B FAIL → one camera readability contract  
3. Desert vertical slice (SHIP 2)  
4. Kenney trackside headed glance  
5. Localized Track.create hang with repro  

---

## Next Move

**Human:** Spectator gate B (chase drive). Cursor: Pages ship only until B returns.

---

## Boot pin

`index.html` → `main.js?v=653` · `css/game.css?v=43` · `prop-kit.js?v=31` · `track.js?v=293`
