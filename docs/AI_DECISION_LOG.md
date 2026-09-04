# AI Decision Log — Rally Championship 2026

Short institutional log. Newest first. Format: DATE / DECISION / WHY / REJECTED / RESULT / NEXT

---

### 2026-09-04 — Gate A SHIP (CEO human)

| | |
|--|--|
| **DECISION** | **SHIP** CEO #1 catch/land dial bake. Retain `ARCADE_ASSIST` / `HANDLING` / `JUMP` / `gripSnap` changes. |
| **WHY** | Human CEO confirmed catch feels like a switch and land wants the next jump. |
| **REJECTED** | CUT/revert dials; starting camera-mass Call #2 without Spectator B score. |
| **RESULT** | Gate A = PASS. Accountant C remains PASS. Full GREEN LIGHT still needs B. |
| **NEXT** | Human Spectator gate B; then ONE of: camera fix (if B FAIL) / Desert vertical slice / headed trackside check. |

---

### 2026-09-04 — Intelligence Layer bootstrap (Level 200)

| | |
|--|--|
| **DECISION** | Establish / refresh persistent AI memory: `AI_EXECUTIVE_STATE.md`, this log, `AI_PLAYER_MOMENTS.md`, `docs/ai/*` companions. No gameplay redesign. |
| **WHY** | Affordable Cursor models lose strategy between sessions; ChatGPT/CEO reasoning must persist as institutional memory, not rediscover TypeScript/WebGPU/track rewrite. |
| **REJECTED** | Another unbounded “make it amazing” Auto Mode; inventing parallel docs that contradict code; scoring player moments without evidence (use UNKNOWN). |
| **RESULT** | Brain packet current through boot `?v=652`, Kenney trackside, splash credit. Active mission remains human Driver A. |
| **NEXT** | Human SHIP/CUT A; then ONE Cursor mission from Executive Top 5. |

---

### 2026-09-04 — Kenney trackside GLB pack (hero-zone props)

| | |
|--|--|
| **DECISION** | Import Kenney CC0 Racing/City/Furniture kit GLBs into `assets/props/`; wire barriers, fences, grandstands, gantries, cones via `prop-kit.js` + `track.js` with primitive fallback. Keep crowd bipeds. |
| **WHY** | Highest visual cheapness in trackside primitives while feel gates frozen; hero-zone spend, not density spam. |
| **REJECTED** | Replacing crowd with Mini Characters; global vegetation push; photogrammetry; track.js rewrite. |
| **RESULT** | Shipped in working tree. Boot `main.js?v=652`. Attribution updated. Static audit + validate PASS. Racing-speed human check still open. |
| **NEXT** | After Driver A: optional headed “props read at speed” check — not a density sprint. |

---

### 2026-09-04 — Splash credit + remove tech showcase page

| | |
|--|--|
| **DECISION** | Credit Jordan Zabady + Cursor on splash; remove `#screen-tech` / TECH menu / `dev-showcase.js` / `project-stats.js` from player path. |
| **WHY** | First-minute product identity; tech page was inventory, not arcade fun. |
| **REJECTED** | Keeping TECH as player-facing mode; inventing new marketing screens. |
| **RESULT** | Shipped. Boot bumped through `?v=651`–`652`. |
| **NEXT** | Do not restore tech page unless product asks. |

---

### 2026-09-04 — Pack place punch (race excitement + boot graph repair)

| | |
|--|--|
| **DECISION** | Complete overtake feedback end-to-end: `RACE_FEEDBACK` export, `placeOrdinal` + `punchPlace`, `audio.placeGain`, CSS punches. Gain → `2ND!` flash + chirp; drop → glyph only. |
| **WHY** | Highest player-visible gap with high confidence while Driver A / camera-mass frozen. Also repairs incomplete graph in `f0e5283` where `game.js` already imported `RACE_FEEDBACK` / `placeOrdinal` without matching exports — boot-breaking module load. |
| **REJECTED** | Retuning ARCADE_ASSIST/JUMP; camera-mass Call #2; restoring `#hud-pace` / SLIDE badge; AI skill churn; Desert vertical slice this pass. |
| **RESULT** | Shipped in working tree. Boot `main.js?v=645`. `qa-static-audit` PASS · `qa-validate` PASS · `qa-sprint33-drift` PASS. Cursor headed Chrome not asserted. |
| **NEXT** | Human Driver A still the ONE feel objective. Hard-refresh `?v=645` — confirm title boots and first championship pass flashes place without post-GO spam. |

---

### 2026-09-04 — Stop unbounded autonomy; institutional knowledge

| | |
|--|--|
| **DECISION** | Halt “make the game amazing” open mandate. Finish mid-flight Arcade First Boot only. Create `AI_EXECUTIVE_STATE.md` + this log. |
| **WHY** | Future sessions must read decisions, not rediscover strategy; unbounded scope produces half-work. |
| **REJECTED** | Continuing multi-feature autonomy; inventing new strategy; starting SHIP 2 / feel / camera while Boot unfinished. |
| **RESULT** | Docs created. Boot shipped (see below). Current objective = human Driver gate A. |
| **NEXT** | CEO human A drive; update this log with SHIP or CUT. |

---

### 2026-09-04 — Arcade First Boot (SHIP 1)

| | |
|--|--|
| **DECISION** | Ship first-run UX: START → championship SELECT CAR → Celica → Desert; hide garage/GLB/PHYS LAB/FPS/DIST/SURFACE/GRIP/SLIDE behind `?dev=1`/`?debug=1`/`rally-debug`. |
| **WHY** | CEO live observation: garage GLB, FPS, config wall made first 60s feel like a dev build. Highest fixable player-facing impact vs Red track hang. |
| **REJECTED** | Deleting garage capability; auto-skip car select; giant HUD rewrite; Desert vertical slice; physics/camera work in same pass. |
| **RESULT** | Shipped in tree. Boot `main.js?v=643`. `qa-static-audit` + `qa-validate` PASS. `qa-boot-smoke` path updated (Chrome not asserted this pass). |
| **NEXT** | Do not reopen unless regression. Human Driver A is the current objective. |

---

### 2026-09-04 — Executive gate A/B/C (no feature expansion)

| | |
|--|--|
| **DECISION** | Defer GREEN LIGHT until CEO human scores Driver A + Spectator B. Accountant C machine PASS. |
| **WHY** | Machine-green ≠ shippable feel; UNKNOWN ≠ invent busywork. |
| **REJECTED** | AI surface skill, PerformanceDirector, V6 signature as active coding work before A+B. |
| **RESULT** | Documented in QA-REPORT. Intervention: none that session. |
| **NEXT** | Human A instrument (Phys Lab + Desert). |

---

### 2026-09-04 — CEO #1 catch/land dial bake (conditional SHIP)

| | |
|--|--|
| **DECISION** | Config-only ARCADE_ASSIST / HANDLING / JUMP / gripSnap bake (`config.js?v=201`). |
| **WHY** | Player moment: slip → opposite-lock catch → planted land. Prefer dials over new assist layer. |
| **REJECTED** | Camera-mass Call #2 in same pass; track.js; WebGPU; new systems. |
| **RESULT** | Automated handling/jump/drift QA PASS. **Human SHIP/CUT still open.** |
| **NEXT** | Human Lab/Desert drive → SHIP or CUT/revert dials. |

---

### 2026-09-04 — Camera-mass Call #2 paused

| | |
|--|--|
| **DECISION** | Do not implement camera mass follow-up until Driver A is scored. |
| **WHY** | Avoid parallel feel authorities; Spectator B depends on readable mass but code churn before A risks false attribution. |
| **REJECTED** | Speculative camera spring redesign “for weight.” |
| **RESULT** | Medium/POV hotfixes earlier that day remain; mass Call #2 stays paused. |
| **NEXT** | After A: score B; only then one camera contract if B FAIL. |

---

### Standing — WebGPU production cutover gated

| | |
|--|--|
| **DECISION** | WebGPU preferred for *new* shaders long-term; full cutover only with Phase R.2 / Stage 2 approval. |
| **WHY** | Risk vs player value; WebGL2 path ships today. |
| **REJECTED** | Migrating production renderer to WebGPU without explicit approval; parallel TS renderer tree. |
| **RESULT** | `vendor/three.webgpu.js` may exist; not production authority. |
| **NEXT** | If WebGPU seems necessary: STOP and report why. |

---

### Standing — No track.js wholesale rewrite

| | |
|--|--|
| **DECISION** | Intermittent stage-build hang is Red; localized fix only with proof; never loosen worldvalidate. |
| **WHY** | Rewrite cost/risk dwarfs uncertain repro; world geometry contract is the product safety rail. |
| **REJECTED** | “Clean architecture” track rebuild; disabling validation to hide bugs. |
| **RESULT** | Hang remains known risk. |
| **NEXT** | Repro-first narrow patch only. |

---

## Protected Wins

Do not casually “improve” these away.

| Behavior | Why it works | Files | Regression warning |
|----------|--------------|-------|--------------------|
| Arcade First Boot | First minute feels like a finished arcade product | `index.html`, `game.js`, HUD CSS | Restoring garage/FPS/PHYS LAB on default path |
| Pack place punch | Overtake flash + chirp without post-GO spam | `config` RACE_FEEDBACK, `hud.js`, `audio` | Silent place changes |
| Worldvalidate GREEN | Road integrity = friend-test safety | validators / TrackDefinition | Loosening float/bury gates |
| Shared Vehicle for AI | Fair rivals; one physics authority | `vehicle.js`, `ai.js` | Parallel AIPhysics |
| Splash credit | Clear authorship without tech inventory | splash UI | Reintroducing TECH screen as player mode |
