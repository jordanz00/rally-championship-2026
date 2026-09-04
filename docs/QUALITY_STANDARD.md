# Rally Championship 2026 — Quality Standard

**Status:** Binding quality contract. **Higher priority than individual feature requests.**  
**Companions:** [`ALL_STAGES_AAA_STANDARD.md`](ALL_STAGES_AAA_STANDARD.md) · [`AAA_BROWSER_PRODUCTION_STANDARD.md`](AAA_BROWSER_PRODUCTION_STANDARD.md) · [`WORLD_GEOMETRY_RULES.md`](WORLD_GEOMETRY_RULES.md) · [`GAMER_WOW_CHECKLIST.md`](GAMER_WOW_CHECKLIST.md) · [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md)

**Validate command:** `node tools/qa-validate.mjs` (non-zero exit on critical fail)

---

## Purpose

Stop treating clipping, floating geometry, and ugly assets as post-generation repair work.

```
DESIGN SPEC → VALIDATED DATA → GENERATION → AUTOMATED VALIDATION
  → VISUAL QA → PERFORMANCE QA → ONLY THEN → GAME
```

The generator should **refuse** invalid geometry where possible — not produce it and hope someone drives into it later.

**Objective:** Cursor works inside a system that makes incorrect results **obvious, reproducible, testable, and difficult to ship** — not “Cursor writes perfect code.”

---

## Priority order

1. **Correctness**  
2. **Visual quality**  
3. **Gameplay quality**  
4. **Performance**  
5. **Maintainability**

A feature is **not** complete because it renders.

Complete only when it:

- looks high quality  
- behaves correctly  
- has no visible geometry defects / obvious clipping / floating geometry  
- has no broken collision  
- has no major visual artifacts  
- has no console errors  
- has no significant memory leaks  
- maintains performance targets  
- passes automated validation  
- passes visual inspection  

### Never “fix” by hiding

Do not solve problems with: fog · darkness · deleting geometry · disabling collisions · moving the camera · reducing visual quality · excessively lowering density.

**Fix the underlying system.**

---

## Zero-tolerance geometry (production)

| Rule | Tolerance |
|---|---|
| Floating roads | **ZERO** visible |
| Floating props | **ZERO** visible |
| Terrain/road intersections | **ZERO** obvious |
| Tunnel/terrain intersections | **ZERO** obvious |
| Bridge/terrain intersections | **ZERO** obvious |
| Vegetation/road intersections | **ZERO** obvious |
| Broken / disconnected track | **ZERO** |
| Severe z-fighting | **ZERO** |
| Placeholder primitives in hero/near-field | **ZERO** |

Tolerances for automated checks live in `js/tracks/world-config.js` (`TerrainConfig.floatTol`, etc.) — not magic numbers scattered in unrelated files.

---

## Zero-tolerance runtime (production build)

| Rule |
|---|
| ZERO uncaught JavaScript errors |
| ZERO repeated runtime exceptions |
| ZERO asset loading failures |
| ZERO broken references |
| ZERO NaN/Infinity entering physics |
| ZERO unexplained frame-time spikes from avoidable code |
| ZERO continuously growing allocations during normal gameplay |

---

## Quality gate (definition of done)

```
BUILD → TYPECHECK/LINT (when tooling exists) → UNIT/QA SCRIPTS
  → GEOMETRY VALIDATION → ASSET VALIDATION → PERFORMANCE VALIDATION
  → VISUAL QA → PLAYTEST
→ ONLY THEN COMPLETE
```

If any critical gate fails: **do not report the task complete.** Fix or clearly report the blocker. Never hide failures.

Run: `node tools/qa-validate.mjs`

---

## Controlled engineering mode (Cursor)

Before changing code:

1. Inspect relevant files · trace dependencies · identify current behavior · failure modes  
2. Explain the **smallest** change that solves the problem  
3. Implement · run validation/tests · check regressions  
4. Report exactly what changed  

**Do not:** unrelated refactors · rewrite entire files unless necessary · replace working systems without explaining why · create duplicate systems · “simplify” away necessary complexity · broad vibe changes that cascade tunnel→terrain→road→collision→camera  

If the request exposes an architectural problem: **stop and explain** before a large workaround. Prefer **root causes** over patches.

**Golden rule:** Never manually fix 100 floating trees — fix the placement algorithm. Never lower a floating road by 0.3 — fix terrain conformity. Never hide tunnel clips — fix TunnelSystem. Never move rocks off the road one-by-one — fix ClearanceSystem. Eliminate **classes** of bugs.

---

## Production loop (every significant change)

```
DISCOVER → PLAN → IMPLEMENT → VALIDATE (qa-validate / static-audit)
  → GEOMETRY QA → ASSET QA → PERFORMANCE QA → VISUAL QA
  → REGRESSION QA (all four stages) → DOCUMENT
→ ONLY THEN COMPLETE
```

---

## Deterministic generation

World generation must use **deterministic seeds** (`def.seed` + mulberry/etc.).

Same stage definition + seed + engine version ⇒ reproducible stage.

**Never** use uncontrolled `Math.random()` for world generation / plant placement. Runtime cosmetic FX may use random if they do not affect topology.

---

## Fail fast

Invalid data during generation ⇒ **error**, do not silently continue.

Examples: invalid road segment · invalid tunnel volume · impossible elevation · broken track connection · missing asset (error or explicit marked fallback).

Compile path: `compileTrackDefinition` / `validateCourseData` throw or return critical errors.

---

## Prototype vs production

| | Prototype | Production |
|---|---|---|
| Primitives | Allowed if marked **PLACEHOLDER** | Forbidden in hero/near-field |
| Materials | Simplified OK | PBR / budgeted textures |
| Collision / LOD | May be stub | Required where specified |
| Placement | Must still respect clearance | Full validation pass |

Anything intended for the final game is **production-ready by default** unless explicitly marked placeholder.

---

## Assets

Cursor builds the **pipeline** and placement systems — not final AAA meshes from `BoxGeometry`.

Production assets: authored tools → GLB → optimize → KTX2/Meshopt where measured → LOD → validation → game.

**Asset definition of done:** source · hero · LOD0/1/2 · collision · materials · textures · metadata.

Asset validation (warn/reject): missing textures · excessive res · missing normals · bad transforms/scale · poly/material budgets · missing LODs/collision where required.

---

## Performance is quality

25 FPS beauty is **not** high quality. Every stage: measurable budgets, baselines, before/after on visual changes. See [`PERFORMANCE_RULES.md`](PERFORMANCE_RULES.md) · stage profiles in [`ALL_STAGES_AAA_STANDARD.md`](ALL_STAGES_AAA_STANDARD.md).

---

## Regression protection

| When | Add |
|---|---|
| Geometry bug fixed | Validation rule if possible |
| Asset load bug | Asset check |
| Perf regression | Threshold / probe |
| Logic bug | QA script if possible |

Same bug should not return unnoticed.

---

## Visual debug (dev)

Toggleable (no production cost): road centerline · boundaries · clearance · terrain height · collision · tunnel volumes · LOD · frustum · bounds · surfaces · spawn/exclusion zones · validation errors.

Milestone: expand `?worldvalidate=1` / debug overlays toward this full set.

---

## Golden stages

Known-good structural references (`golden_*` or validated championship defs) become integration tests: change engine → validate **all four** stages. One stage green + another red ⇒ change **not** complete.

---

## Automated visual / perf (milestones)

| Gate | Status |
|---|---|
| Stage data + geometry validate | **Shipped** — `tools/qa-validate.mjs` |
| Static audit | **Shipped** — `tools/qa-static-audit.mjs` |
| Boot / frame probes | **Shipped** — headed Chrome with `RALLY_QA_ALLOW_CHROME=1` |
| Screenshot golden frames | Milestone — predefined cams + compare |
| Per-stage FPS budgets in CI | Milestone — after measured baselines |

---

## Specs, not vibes

**Bad:** “Make the forest better.”  
**Good:** “Forest: 5 tree species, 3 rock families, 4 veg layers, 2 density zones, 60 FPS, zero road intersections, no identical silhouettes within 100 m.”

---

## Pipeline diagram

```
GAME DESIGN → STAGE DEFINITION → TRACK → ROAD + TERRAIN
  → WORLD CONFORMITY → ENVIRONMENT (trees/rocks/props)
  → LOD/CULL → LIGHTING → VFX/AUDIO → PERFORMANCE
  → QUALITY GATES → AUTOMATED QA + VISUAL QA → SHIP
```

**Visual target:** [`AAA_VISUAL_TARGET.md`](AAA_VISUAL_TARGET.md) — Presentation Layer; Visual Passes V1–V10; quality gates are prerequisites.

Once gates exist, AAA visual pushes propagate safely across Desert, Forest, Mountain, and Lakeside instead of one-off patches.
