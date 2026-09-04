# Rally Championship 2026 — Sega Rally–inspired driving model

**Status:** Binding physics / feel contract for Cursor.  
**Date:** 2026-09-04  
**Authority:** This doc + `js/physics/vehicle.js` + `HANDLING` / `ARCADE_ASSIST` / `SURFACES` in `js/config.js`.  
**Related:** [`AM3-RESEARCH.md`](AM3-RESEARCH.md) · [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md) · Stage 4 in [`RALLY_ENGINE_ROADMAP.md`](RALLY_ENGINE_ROADMAP.md)

---

## Target (read this first)

```
BELIEVABLE + RESPONSIVE + DRIFTABLE + FORGIVING + PHYSICAL + FAST + FUN
```

**Easy to drive → difficult to master → spectacular when mastered.**

Chase Sega Rally Championship **feel** (1995-era arcade rally): attack → slide → recover → accelerate.  
Do **not** chase 1995 technical implementation. Do **not** build a hardcore sim. Do **not** build floaty “move forward” arcade.

**Design ratio (philosophy, not math):** ~**70% physical behavior** + ~**30% invisible game-design assistance**.

The player should believe the car is physical. The game quietly helps them have fun.

---

## What we are / are not

| Do | Do not |
|---|---|
| Velocity-based chassis with real lateral behavior | `position += forward * speed` + cosmetic drift |
| Progressive grip → controlled slide → recovery | Binary GRIP / SLIP cliff |
| Drift from steer + brake + throttle + weight + optional handbrake | Handbrake-only drift |
| Invisible assists (no HUD “DRIFT ASSIST”) | Magnetic road glue / auto-countersteer stealing agency |
| Surface-driven physics + visuals + audio agreement | Same car on every surface |
| Fixed-timestep physics, interpolated render | FPS-dependent handling |
| Tune against the Physics Lab torture track | Tune by reading code alone |

---

## Primary player verbs

The player must be able to: brake late · rotate · initiate / hold / catch a slide · steer the drift with throttle · trail-brake · handbrake hairpins · jump · land with suspension · recover from mistakes · cut shoulders without instant stop.

**Inputs that must matter:** steering · throttle · brake · surface · weight transfer.

---

## VehicleState (minimum)

Track separately from rendering:

`speed` · longitudinal / lateral velocity · yaw rate · steer · throttle · brake · handbrake · slip angle · wheel slip · surface / grip · suspension · airborne / landing · drifting · weight transfer.

**Repo:** `Vehicle` + `physSnapshot()` in `js/physics/vehicle.js`.

---

## Tire / grip (arcade-friendly)

Conceptual per-wheel: longitudinal slip + lateral slip → long/lat force.  
Not a perfect real tire. Tune for controllability.

**Grip curve (required feel):**

```
HIGH GRIP → INCREASING SLIP → CONTROLLED SLIDE → HIGH SLIP → LOSS OF CONTROL
```

Player must feel the transition. Soften the cliff via `ARCADE_ASSIST.tireSlideSoft` / `tirePeakBoost`.

---

## Drift + throttle + steering

- Drift is a **primary mechanic**; initiation must be learnable without a drift button.
- Throttle strongly shapes rear slip / yaw (more = more attitude; less = recovery). AWD still allows expressive slides.
- Speed-sensitive progressive steering (more authority low speed; less twitch high speed).
- Countersteer must work **naturally**; do not auto-countersteer so hard the player loses agency.

**Invisible assist dials (`ARCADE_ASSIST`):** `yawAssist` · `recoveryAssist` · `recoverableSlide` · `driftStability` · `landingAssist` · tire soft/peak.

---

## Weight transfer · braking · handbrake

- Brake → front load up / rear down · pitch · trail-brake rotation · ABS-like forgiveness OK.
- Accel → rear load up · mild front unload.
- Cornering → outside load.
- Handbrake: useful, **not** mandatory; dump rear grip + yaw; release recovers. No instant 90° teleport spins.

**Repo knobs:** `HANDLING.weightTransferMul` · `trailBrakeYaw` · `liftOffYaw` · `handbrake*` · `throttleSlide` · `powerSlidePitch` · brake torques.

---

## Surfaces

Every surface must change stop distance, breakaway, and recovery (`SURFACES` table). Minimum cast: asphalt/tarmac · gravel · dirt · mud · grass · sand · rock (as present).

Transitions must be felt immediately and agree with dust / marks / tire audio.

---

## Jumps · suspension · landings · rollover

- Crest unload · airborne attitude · landing compression · camera + dust.
- Per-wheel travel with body independent of wheels (visual realism).
- Hard landings matter; normal rally jumps must not instant-crash.
- Rollover threshold high enough that ordinary aggression does not flip constantly.

---

## Collisions · off-road · difficulty

- Impact response from direction / speed / mass — no tiny-obstacle → 180° spin.
- Off-road: progressive performance loss (road → shoulder → grass → rough), never instant stop.
- Raise difficulty via track / rhythm / surfaces / jumps / AI — **not** by making the car less controllable.

---

## Lap-time design

Reward commitment · controlled drift · late braking · corner cuts · surface knowledge · throttle control.  
Fast ≠ hold full throttle forever.

**Rhythm:** ATTACK → SLIDE → RECOVER → ACCELERATE (not perfect-apex simulation lines only).

---

## Physics Lab (Stage 4)

**Do not tune by code inspection alone.**

| Tool | How |
|---|---|
| Live overlay | `?physlab=1` or `localStorage rally-physlab=1` · F8 toggles |
| Telemetry | speed · slip · yaw · surface · µ · suspension · inputs |
| Live dials | mutate `ARCADE_ASSIST` + key `HANDLING` knobs at runtime |
| Torture track | course id `physlab` — Practice → **PHYS LAB** |

Torture rhythm:

```
hairpin → gravel → jump → downhill → S-bends → sweeper → mud → jump → hairpin
```

---

## Quality gate (before calling handling “done”)

Drive and remain fun/controllable on: asphalt · gravel · dirt · mud · grass · jumps/landings · hairpins · sweepers · S-curves · downhill braking · uphill accel · off-road · collisions.

**Feel sequence that must feel satisfying:**

Straight punch → hard brake weight → trail-brake rotate → release → throttle → rear slide → countersteer → modulate → hold drift → straighten → accelerate out.

---

## Final feeling

> Anyone can drive it. A really good player can destroy the track.

Player thoughts: *one more lap · I can brake later · I can hold that drift longer.*

---

## Map to current code (do not rewrite from scratch)

| Spec idea | Where it lives today |
|---|---|
| Fixed timestep | `FIXED_DT` + accumulator in `game.js` |
| Lateral chassis / tires | `js/physics/vehicle.js` |
| Surfaces | `SURFACES` in `config.js` + `Track.query` |
| Arcade forgiveness | `ARCADE_ASSIST` |
| Feel dials | `HANDLING` |
| Debug / lab | `js/debug/physics-debug.js` (`?physlab=1`) |
| Torture stage | `COURSES.physlab` in `courses.js` |

**CEO rule:** Prefer closing PARTIAL feel defects and Lab-proven tuning over new sim complexity. Never degrade fun for sim accuracy.
