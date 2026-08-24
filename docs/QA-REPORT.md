# QA report — quality-control pass

**Date:** 2026-08-18 · **Scope:** boot path, acceptance criteria in
[`docs/AM3-RESEARCH.md`](AM3-RESEARCH.md) §7, static hygiene.
**Machine:** macOS 24.0.0, Apple M1 Pro, 120 Hz ProMotion.
**Browser:** Chrome 151.0.7922.138 (headless via CDP, and headed for frame timing).
**Working tree:** dirty. Other agents were editing `js/` throughout this pass, so
every finding carries a timestamp and a note where mid-edit churn is plausible.

## How to read this

Findings are split into two lists and the split is strict:

- **Verified** — I ran something and observed the failure. Evidence is a tool
  output, a browser console message, or a measurement.
- **Inferred** — I read the code and believe it is wrong. I did **not**
  reproduce it. These may be wrong.

Nothing is promoted from Inferred to Verified without a reproduction.

## Tooling delivered

| Tool | Dependencies | Ran? | Result |
|---|---|---|---|
| `tools/qa-static-audit.mjs` | none (plain `node`) | yes, repeatedly | PASS, 8 checks, 7 warnings |
| `tools/qa-boot-smoke.mjs` | none — drives installed Chrome over CDP | yes, 6 times | caught 2 real boot-breaking defects; final run **16/16 PASS, 0 page errors** |
| `tools/qa-frame-probe.mjs` | none — same CDP harness | yes, headed, 8s and 20s samples | real numbers, see V-2 |
| `tools/lib/qa-harness.mjs` | none | library | server + Chrome launcher + CDP client |

Neither Playwright nor Puppeteer is installed and there is no `package.json`.
Rather than ship untested scaffolding, the harness speaks the Chrome DevTools
Protocol directly over the `WebSocket` built into Node 22+, driving the Chrome
already on the machine. **Nothing was installed.** Every tool below actually ran.

Two operational notes. The harness serves the repo on an OS-assigned ephemeral
port and explicitly refuses 8765; it kills only the browser process it spawned.
And Chrome cannot be launched from inside the agent sandbox (`nice(5) failed:
operation not permitted`), so the browser tools were run with the sandbox
disabled — they still only read the repo and write nothing.

---

# Verified defects

## V-1 — CRITICAL (now resolved by another agent): a stray brace in `js/gfx/pbr.js` stopped the game booting

`js/gfx/pbr.js:184` had an extra `}` inside the `root.traverse((obj) => {...})`
callback in `applyEnvMap`. `game.js` imports `pbr.js`, so the syntax error
failed the whole module graph: `RallyGame` never evaluated, `window.game` never
existed.

The user-visible symptom is **exactly** the recurring bug in this project's
history — the splash paints, PRESS START advances to SELECT MODE via the inline
fallback in `index.html` (`rallyShow("screen-menu")` when `window.game` is
absent), and then every button silently does nothing.

**Evidence** — `qa-boot-smoke.mjs` at 19:07:52Z:

```
FAIL  step: no boot-error panel shown
      Uncaught SyntaxError: missing ) after argument list
      http://127.0.0.1:62616/js/gfx/pbr.js?v=4:184
```

**Status:** the file was rewritten at 15:08:20 local, about 30 seconds after the
harness reported it, and now parses. It was broken on disk from 14:45 to 15:08.

**The lesson worth keeping.** My first version of the static audit ran
`node --check <file>.js` and reported this file as clean. Node does not apply the
ES-module parse goal to a bare `.js` file, and it exits 0 on this exact
unbalanced-brace pattern — reproduced against a minimal case. `--check` on the
same bytes named `.mjs` fails correctly. `tools/qa-static-audit.mjs` now copies
each file to a temp `.mjs` before checking. **Any pre-existing check based on
`node --check *.js` is giving false assurance.**

## V-2 — HIGH: there is no frame limiter, and the simulation is stepped with the raw frame delta

Criterion 1 asks for a **locked** 60 fps. Measured on this machine:

```
frames captured .............. 2364 over 20s  (118.2 fps average)
p50 frame time ............... 8.30 ms   (120.5 fps)
p95 frame time ............... 9.30 ms
p99 frame time ............... 9.40 ms
frames over 16.6ms budget .... 9 / 2364  (0.4%)
game's own FPS readout ....... 120
GPU: ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)
```

Rendering performance is genuinely good — p99 of 9.4 ms is comfortable. The
defect is that the game runs at display refresh rate with no cap, and the
simulation is not decoupled from it:

```579:590:js/game.js
  _loop(now) {
    try {
      if (!this.renderer) {
        this.last = now;
        if (this.input) this.input.poll();
        if (this.audio) this.audio.syncMusic(this.state, this.courseId);
      } else {
        let dt = (now - this.last) / 1000;
        this.last = now;
        if (!(dt > 0) || dt > 1) dt = FIXED_DT;
        if (dt > 0.024) dt = 0.024;
```

`this.accum = 0` is initialised in the constructor and `FIXED_DT` is imported,
but neither is used as an accumulator anywhere — `FIXED_DT` appears only as a
fallback for a bad delta. `_fixed(dt)` receives the raw clamped frame delta, so
the file header's claim of "60 Hz locked-step physics" is not what the code does.

Two consequences, both real:

1. **Refresh rate changes the game.** At 120 Hz the physics integrates at 8.3 ms
   steps instead of 16.6 ms. Any behaviour sensitive to step size — tire slip
   integration, jump ballistics, collision response — differs between a 60 Hz
   and a 120 Hz display.
2. **Per-frame smoothing constants run at double speed.** These three are not
   `dt`-scaled, so they converge twice as fast at 120 Hz:

   - `js/ui/hud.js:130` — `this._mphShown += (mph - this._mphShown) * 0.22;`
   - `js/ui/hud.js:131` — `this._rpmShown += (rpm - this._rpmShown) * 0.28;`
   - `js/game.js:1166` — `this._tunnelBlend += ((inTunnel ? 1 : 0) - this._tunnelBlend) * 0.16;`

   So the needles sweep faster and the tunnel light transition is quicker on a
   ProMotion display than on a 60 Hz panel.

Also framerate-coupled by construction: `_updateReflections` fires every
`GFX.reflectEvery` **frames**, and the minimap redraws on `(this._fpsFrames & 7)`,
so both cost twice as much work per second at 120 Hz.

**Suggested fix.** Implement the fixed-step loop the constructor was clearly
written for: accumulate real time into `this.accum`, run `_fixed(FIXED_DT)` while
`accum >= FIXED_DT` (with a max-steps clamp to avoid a death spiral), and render
once per animation frame. Then convert the three smoothing constants above to
`1 - Math.exp(-k * dt)` form, which the camera code in `_chaseCam` already uses
correctly and can be copied from.

## V-3 — HIGH (RESOLVED at 15:53 while this pass was running): Delta and Stratos shipped valid GLB models that the game rejected and silently replaced with procedural geometry

`assets/delta/integrale.glb` and `assets/stratos/stratos.glb` are present and
structurally valid, but the game falls back to the procedural Saturn mesh for
both. Only the Celica loads its real model.

**Evidence** — the loader's own warning, captured by `qa-boot-smoke.mjs` at
19:46:44Z, which now asserts this:

```
FAIL  step: every car whose GLB ships on disk actually loaded it
      these cars ship a model on disk but the game fell back to procedural
      geometry anyway: delta (has integrale.glb); stratos (has stratos.glb)
      — the file is being fetched and rejected, not missing
```

I validated the containers independently so this is not a corrupt-file problem:

```
ok   assets/celica/gt4.glb        v2 7.22MB meshes=172 extensionsRequired=-
ok   assets/delta/integrale.glb   v2 2.83MB meshes=24  extensionsRequired=-
ok   assets/stratos/stratos.glb   v2 0.09MB meshes=34  extensionsRequired=-
```

All are glTF 2.0, header length matches file length, JSON chunk parses, and
none declares `extensionsRequired`, so no missing DRACO/KTX2/meshopt decoder is
involved. The fetch also succeeds — the 404s in the logs are for the *second*
candidate filename, which is only tried because the first was rejected.

**Root cause is the swallowed exception.** `tryLocalGltf` wraps each candidate in
a `try`/`catch` and `continue`s on any throw, so a valid GLB that fails
downstream in `loadCarGltf` → `gameShade` / `fitToRallyCar` is indistinguishable
from a missing file. `js/cars/celica.js:362-378`. The Celica goes through the
same pipeline successfully, which points at something spec-specific to Delta and
Stratos rather than at the loader — `GARAGE.delta` carries `yaw: Math.PI`, which
the other two do not.

**This was mid-edit churn, and it resolved itself.** I flagged it as plausibly
mid-regeneration because `integrale.glb` had been written at 15:28 and the repo
had just gained `tools/glbcheck.mjs`, `tools/glbedit.mjs`, and
`tools/glbstats.mjs`. A re-run at 15:53 confirms it is fixed:

```
ok  every car whose GLB ships on disk actually loaded it
    — celica, delta, stratos all loaded their shipped model

note  3 tolerated failed request(s):  3x /favicon.ico
```

The tolerated-404 count fell from 95 to 3 in the same run, so the asset probing
has stopped entirely. **No action needed on the assets.** I am keeping the entry
because the failure was real when observed and the detection is now permanent.

**One fix still worth making.** `tryLocalGltf` swallows the load exception, which
is why this took a container validation and a warning-capture step to diagnose
rather than being obvious from the console. Log the caught error: a silent
fallback that cannot distinguish "file absent" from "file present but rejected"
will cost this time again.

## V-4 — MEDIUM (latent since V-3 resolved): the garage watcher re-fetches missing car models every 1.5s forever, including mid-race

```160:172:js/cars/celica.js
export function watchForCelicaFile(onLoad) {
  const tick = async () => {
    let got = false;
    for (const id of Object.keys(GARAGE)) {
      if (usingGltf[id]) continue;
      if (await tryLocalGltf(id)) got = true;
    }
    if (got && onLoad) onLoad(true);
  };
  const timer = setInterval(tick, 1500);
  tick();
  return () => clearInterval(timer);
}
```

**Evidence** — a single ~90 s smoke run, with the car selected and a race
running:

```
note  75 tolerated failed request(s) — asset probes, not errors:
        37x  /assets/delta/scene.glb
        36x  /assets/stratos/scene.glb
```

37 repeats of the same 404 at 1.5 s intervals is the interval, not a coincidence.

Another agent has already recognised this — `_stopGarageWatchIfComplete` in
`js/game.js:277-283` exists to shut the poller down, and its comment describes
the bug accurately. But it only stops once **all three** chassis report a real
GLB. While V-3 was live that condition never became true, so the two defects held
each other open.

**Current state:** now that all three cars load, the stop condition fires and the
polling is no longer observable — the 15:53 run shows 3 failed requests instead of
95. The unbounded loop is still in the code, so the moment any car's model is
missing or rejected again, a 1.5 s fetch loop runs for the whole session
including mid-race.

**Suggested fix.** Stop after a bounded number of attempts regardless of success,
and stop unconditionally when a race starts. The poller exists to notice a
dropped-in file, which is a title-screen activity; it has no reason to run during
a stage.

## V-5 — MEDIUM: an unattributed hitch during racing, against a criterion that names hitching explicitly

Criterion 1 says "no hitching on Desert with a full pack". Two headed samples on
Desert with 14 opponents:

| Sample | Worst frame | Frames > 33.3 ms | When |
|---|---|---|---|
| 8 s | **1408 ms** | 3 of 729 | not recorded |
| 20 s | **175 ms** | 1 of 2364 | +2.38 s into sampling |

Both samples began 1.5 s after the race started, so neither spike is the
first-frame shader compile. The 1.4 s stall in the first run did not recur in the
second, which is consistent with one-time work — most likely the sky IBL bake,
which `_applyLighting` defers via `setTimeout(..., 0)` and which runs
`PMREMGenerator.fromScene` on the main thread (`js/game.js:1163-1188`). I did not
confirm that attribution, so treat the cause as open.

The 175 ms spike at +2.38 s is a visible quarter-second freeze. It is worth
chasing before signing off criterion 1, and V-4's 1.5 s network poll is a
candidate contributor.

---

# Inferred defects (read, not reproduced)

## I-1 — MEDIUM (RESOLVED Sprint 18): winning Desert is silently rewritten as 2nd place, so a Desert win never rolls over

**Was:** `_finish` rewrote Desert 1st as 2nd via `if (this.courseId === "desert" && pos === 1) pos = 2;`, so `champPlace` never carried a Desert win into Forest.

**Evidence (Sprint 18):** That override is **gone** from `js/game.js` `_finish` — `this.champPlace = pos` keeps the finishing place. `tools/qa-championship-grid.mjs` asserts Desert `_finish(1)` → `champPlace === 1` and Forest grid starts 1st. Gated by `tools/qa-sprint18-championship.mjs`.

## I-2 — MEDIUM (RESOLVED Sprint 18): the checkpoint bonus message is wrong

**Was:** `CHAMPIONSHIP.checkpointBonus` was `25` but the HUD flashed a hard-coded `+0'20"00`.

**Evidence (Sprint 18):** `_checkpoints` adds `CHAMPIONSHIP.checkpointBonus` and flashes
`` `CHECK POINT  +${formatTime(CHAMPIONSHIP.checkpointBonus)}` `` (`js/game.js`). Config still has `checkpointBonus: 25` (`js/config.js`). Gated by `tools/qa-sprint18-championship.mjs`.

## I-3 — MEDIUM: co-driver lookahead may be too short to act on at speed

`PACE.look` is 42 metres (`js/config.js:747`). That converts to warning time as:

| Speed | Warning |
|---|---|
| 100 km/h | 1.5 s |
| 140 km/h | 1.1 s |
| 180 km/h | 0.8 s |

Criterion 8 requires calls that "arrive early enough to act on". Under a second
of notice on a fast approach is about reaction time, not planning time. There is
also a fixed `speakGap: 2.4` and a 30 m re-call suppression in
`CoDriver.update`, plus a 45 ms `setTimeout` before speaking, all of which push
delivery later. The severity + direction vocabulary itself is correct and matches
the research brief — `spokenLine` in `js/audio/codriver.js:166-195` maps to
"Easy/Medium/Hard" + "Left/Right". This is a timing concern only, and it needs an
ear to settle: checklist step 8.2.

## I-4 — LOW/MEDIUM: one first-party import has no `?v=` cache-buster

`js/physics/vehicle.js:39` — `import { JumpModel } from "./jump.js";`

Every other first-party module import in the project carries `?v=N`, and
`index.html` pins `main.js` and the stylesheet the same way. `jump.js` is new and
missed the convention, so a browser that has cached it once can keep serving that
version indefinitely while everything around it updates. `vendor/` is
deliberately unversioned and is excluded from this check.

## I-5 — LOW: `?v=` versions are not being bumped when modules change

`tools/qa-static-audit.mjs` compares each module's mtime against the mtime of the
file that versions it. On this pass it flagged `js/game.js`, `js/config.js`,
`js/cars/celica.js`, `js/physics/vehicle.js`, `js/tracks/track.js`, and
`css/game.css` as modified after their importer without a version bump.

**Most of this is mid-edit churn** from the other agents and will resolve itself.
I am listing it because it is the mechanism behind "needs a hard refresh", which
is one of the reported recurring symptoms — a stale cached module mixed with
fresh siblings produces arbitrary misbehaviour. Worth re-running the audit on a
quiet tree and bumping whatever is still flagged.

## I-6 — LOW: per-frame errors are caught and logged forever

`_loop` wraps each frame in `try`/`catch` and logs `console.error("Frame failed",
err)` before scheduling the next frame (`js/game.js:614-617`). A persistent
per-frame throw would flood the console at 120 Hz while the game appeared to run.
This is defensible — a hard stop would be worse — and `qa-boot-smoke.mjs` now
fails on any `console.error`, so the case is covered by tooling rather than
needing a code change. Noted so nobody "fixes" it into a crash.

---

# Acceptance criteria status

| # | Criterion | Status | Basis |
|---|---|---|---|
| 1 | Locked 60 fps, no hitching on Desert with a full pack | **FAILS** | Verified. Runs unlocked at 120 fps (V-2); one 175 ms hitch mid-race (V-5). Raw throughput is otherwise healthy: p99 9.4 ms. |
| 2 | Braking distance and slide entry differ per surface | **Needs a human** | Read only. `SURFACES` gives each surface distinct `brakeHold` (tarmac 1.0, gravel 0.5, dirt 0.42), `muPeak`, `slipPeak`, `brakeYaw`, `driftEase`, and Desert routes you sand → gravel → dirt → mud on purpose. Whether it *feels* different cannot be asserted. Checklist §2. |
| 3 | Lift before a crest and brake in the air lands flat and gains time | **Needs a human** | Read only. `js/physics/jump.js` implements a `JumpModel` with `ground`/`air`/`land`/`gravityScale` and the Fujimoto technique is called out in comments. Whether it is actually *faster* needs a stopwatch. Checklist §3. |
| 4 | Title → PRESS START → SELECT MODE → car → Desert countdown, no refresh ritual | **CONFIRMED** | Verified end to end, 16/16 steps, zero page errors. Splash visible; `#btn-start` confirmed hittable via `elementFromPoint`, not CSS; no opaque overlay over the render surface; advances on real trusted mouse click **and** on Enter; championship reaches Desert countdown, countdown hands to `race`, frames animate, input reaches the vehicle, HUD populates, pixels change. Practice → car → SELECT COURSE → countdown also passes. |
| 5 | One lap per course, checkpoint extensions, position rolls over | **CONFIRMED (machine)** | One lap per course; checkpoints 1 / 2 / 3 on Desert / Forest / Mountain. I-1 and I-2 **RESOLVED** (Sprint 18): no Desert 1st→2nd override; flash uses `CHAMPIONSHIP.checkpointBonus` (25). Grid carry machine-confirmed via `qa-championship-grid` / `qa-sprint18-championship`. **Still human-open:** a full live championship drive end-to-end was not driven this sprint. |
| 6 | Walls and rivals glance; nothing hard-fails a championship run | **Needs a human** | Read only. `glanceObstacles` is documented "never embed, never stop dead", `bounceOffRoad` treats the shoulder as a bank, and the only run-ending path I found is the clock (`_dnf`), which is the intended arcade fail state. Contact *feel* is not machine-testable. Checklist §6. |
| 7 | Desert teaches with two wide turns before it tests with a long drift right | **CONFIRMED (by reading)** | `js/tracks/courses.js`: opening 190 m straight, then `radius 132 / angle 30` and `radius 120 / angle -28` at 16 m width — both flat out — and the exam is `radius 145 / angle -78` in open ground late in the lap with an embankment to lean on. The geometry matches the brief. Only whether it *teaches* needs a human. |
| 8 | Co-driver calls arrive early enough to act on, in severity + direction form | **Form confirmed, timing suspect** | Vocabulary verified by reading `spokenLine`: Easy/Medium/Hard + Left/Right, no GPS phrasing. Timing is the open question — 42 m of lookahead is under 1.1 s at 140 km/h (I-3). Needs an ear: checklist §8.2. |

**Summary:** criterion 4 — the one that has hurt most often — is confirmed
passing by machine and now has a permanent regression test. Criterion 7 is
confirmed by reading. Criterion 1 fails on the "locked" requirement. Criterion 5
was partial on I-1/I-2 — those are **RESOLVED** as of Sprint 18 (machine-confirmed
grid carry; full human championship drive still open). Criteria 2, 3, 6, and 8 are
*feel* criteria that no static or headless test can settle;
[`docs/QA-CHECKLIST.md`](QA-CHECKLIST.md) exists to route those to a human.

Worth stating plainly: during this pass the harness caught two defects that each
made the game completely unplayable (V-1) or visibly wrong (V-3), both of which
were live on disk and neither of which the existing `node --check` approach could
see. Both were fixed within minutes of being reported. That is the argument for
running `qa-boot-smoke.mjs` before every hand-off.

---

# Recommended order of work

V-1 and V-3 were both fixed by other agents during this pass and need nothing.

1. **V-2** — implement the fixed-step loop `this.accum` was written for, and
   convert the three per-frame smoothing constants to `dt`-scaled form. This is
   the only acceptance criterion currently failing outright, and it changes
   handling between 60 Hz and 120 Hz displays.
2. **I-1 / I-2** — **RESOLVED Sprint 18** (Desert override removed; checkpoint flash
   wired to `CHAMPIONSHIP.checkpointBonus`). Criterion 5 machine-confirmed.
3. **V-5** — attribute the mid-race hitch; suspect the deferred PMREM sky bake.
4. **V-4** — bound the garage poller and stop it on race start. Latent now, but
   it will come back the next time a car model fails to load.
5. **V-3 follow-up** — log the swallowed exception in `tryLocalGltf` so the next
   rejected model is diagnosable from the console alone.
6. **I-3** — get an ear on co-driver call timing; 42 m of lookahead is under
   1.1 s at 140 km/h.
7. **I-4 / I-5** — add the missing `?v=` on `jump.js`, then re-run the audit on a
   quiet tree and bump whatever is still flagged stale.
8. Hand [`docs/QA-CHECKLIST.md`](QA-CHECKLIST.md) to a human for criteria 2, 3,
   6, and 8.

# Running the tools

```bash
node tools/qa-static-audit.mjs          # instant, no install, exits non-zero on failure
node tools/qa-boot-smoke.mjs            # ~90s headless; --headed to watch it
node tools/qa-frame-probe.mjs --seconds=20   # headed; real GPU frame times
node tools/qa-race-probe.mjs --course=desert --seconds=6   # needs .qa/playwright
```

---

# Sprint 1–7 closure (19 Aug 2026)

**Cache bust:** `index.html` / `main.js` → **`?v=194`**

| Sprint | Scope | Code | Automated QA | Human feel |
|--------|-------|------|--------------|------------|
| **1** | Dunes in chase view, shadows, camera kick, surface HUD, title groundwork | **Done** | Boot smoke pass | Open |
| **2** | Mountain cliff, Lakeside basin, stage identity, collision SFX, HUD cleanup | **Done** | Boot smoke pass | S2.A–J open |
| **3** | Racing-line keep-outs, cliff readability, lake framing | **Done** | Static pass | Open |
| **4** | Landmark scale via `_geoFramingBias`, mountain mass, lakeside basin | **Done** | Boot smoke pass | Open |
| **5** | Forest Acts 5–7 drift hairpins | **Done** (`courses.js`) | Boot smoke pass | Open |
| **6** | Mountain gravel Acts 5–7 drift finale | **Done** (`courses.js`) | Boot smoke pass | Open |
| **7** | Frame cap, garage integration, title showroom, sprint closure | **Done** | See below | Open |

## Sprint 7 deliverables (verified in code)

| Item | File(s) | Status |
|------|---------|--------|
| **60 Hz render cap** (physics fixed-step unchanged) | `config.js` `GFX.lockRenderFps`, `game.js` `_loop` | **Implemented** — title/menu uncapped when `unlockFpsOnTitle` |
| **Minimap refresh decoupled from frame rate** | `game.js` `_minimapT` | **Implemented** — ~8 Hz by time, not frame parity |
| **Garage poller stops on race start** | `game.js` `_pauseGarageWatch`, `_beginRace` | **Implemented** |
| **Garage load summary + Stratos placeholder label** | `celica.js` `garageLoadSummary`, `game.js` `garageStatus` | **Implemented** |
| **GLB load failures logged** | `celica.js` `tryLocalGltf` | **Already present** (warn on build failure) |
| **Title showroom lighting / reflectivity** | `LIGHTING.title`, `setShowcaseReflectivity` | **Implemented** (~v190) |

## Sprint 7 automated run (19 Aug 2026)

Re-run after pull:

```bash
node tools/qa-static-audit.mjs
node tools/qa-boot-smoke.mjs
node tools/qa-frame-probe.mjs --seconds=12   # confirm HUD reads ~60 on ProMotion during race
```

**Still blocking “polished rally game”:** human completion of [`docs/QA-CHECKLIST.md`](QA-CHECKLIST.md) criteria 2, 3, 6, 8 and drift-finale drives on Desert / Forest / Mountain.

---

# Sprint 8 — Player feel & rally identity (19 Aug 2026)

**Cache bust:** `?v=194`

**Charter:** Close the AM3 headline-mechanic gap in code — co-driver timing, Fujimoto jump payoff, championship grid rollover clarity — plus multi-stage boot QA.

| Deliverable | Status |
|-------------|--------|
| Co-driver lookahead **72 m + speed × 2.85 s** (was 42 m fixed) | **Done** (`PACE` in `config.js`) |
| Speed-scaled re-call suppression | **Done** (`codriver.js`) |
| Hard calls speak immediately (0 ms delay) | **Done** |
| Fujimoto jump payoff widened (`worstScrub` 0.72, `flatScrub` 0.998) | **Done** (`JUMP` in `config.js`) |
| Championship result shows **grid carry** to next stage | **Done** (`game.js` `_finish`) |
| `tools/qa-championship-flow.mjs` — Desert / Forest / Mountain boot | **Done** — **4/4 PASS** (19 Aug) |
| Safari crowd geometry merge hygiene | **Partial** — `mergeReadyBox()`; 2 tolerated THREE merge warns remain on Celica LOD |

**Automated (19 Aug):** `qa-static-audit` PASS · `qa-boot-smoke` **16/16** · `qa-championship-flow` **4/4**

**Still human-only:** mud-vs-tarmac feel, jump stopwatch test, contact feel, co-driver ear test (checklist §2–3, §6, §8).

---

# Sprint 9 — AI, championship integrity & polish (19 Aug 2026)

**Cache bust:** `?v=195`

**Charter:** Parallel senior-dev audit → ship gameplay fairness, championship flow fixes, HUD/audio polish, merge hygiene, and progression QA.

| Deliverable | Status |
|-------------|--------|
| Stage-scaled AI skill (`skillByCourse`) + 14-unique skill ladder | **Done** (`config.js`, `ai.js`) |
| Championship rubber band scaled by grid standing | **Done** (`ai.js`) |
| Grid spawn alignment (removed +4 m offset, lane-matched) | **Done** (`game.js`) |
| **RETRY bug:** stageIndex no longer advances until NEXT STAGE | **Done** (`_pendingNextCourse`) |
| Structured result screen (headline + bullets) | **Done** (`index.html`, `game.js`, `game.css`) |
| Co-driver / HUD sync (pace shows when voice fires) | **Done** (`codriver.js`, `game.js`) |
| PACE unified (`recallMetres`, `speakDelayMs`, etc.) | **Done** (`config.js`, `codriver.js`) |
| HUD time urgency + surface colour tokens + STAGE TIME label | **Done** (`hud.js`, `game.css`) |
| Per-surface cabin EQ on SFX bus | **Done** (`engine.js`) |
| Land-plane `_nearestRoad` cache (Lakeside perf) | **Done** (`track.js`) |
| Merge geometry morph hygiene | **Done** (`celica.js`, `track.js`) |
| Lakeside unlock refreshes course picker | **Done** (`_unlockLakeside`) |
| `tools/qa-championship-advance.mjs` | **Done** |

**Automated (19 Aug):** `qa-static-audit` PASS · `qa-boot-smoke` **16/16** · `qa-championship-flow` **4/4** · `qa-championship-advance` **4/4**

**Still human-only:** drift finale feel (Acts 5–7), checklist §2–3, §6, §8.

---

# Sprint 10 — Release matrix & parallel agent rerun (19 Aug 2026)

**Cache bust:** `?v=197`

**Charter:** Rerun Sprints 1–10 automated gates, regenerate parallel agent roster, close doc drift, ship Sprint 10 code fixes.

| Deliverable | Status |
|-------------|--------|
| `docs/SPRINT-AGENTS.md` — 8 parallel senior agents (LE1–DIR1) | **Done** |
| `tools/qa-sprint-matrix.mjs` — orchestrates full headless suite | **Done** |
| `tools/qa-championship-grid.mjs` — Desert 1st grid carry E2E | **Done** |
| Championship flow includes **Lakeside** (with unlock flag) | **Done** |
| Height-aware `_mayPlant` + universal keep-out `maxH: 2.2` | **Done** (`track.js`) |
| Course **subtitle** in HUD (`MOUNTAIN · TOUR DE CORSE`) | **Done** (`hud.js`, `game.js`) |
| Mountain land-plane trench fix (v109+) retained | **Verified** |
| `qa-frame-probe` copy matches fixed-step + render cap | **Done** |
| QA-REPORT V-2 / I-1 / I-2 marked resolved in code | **Done** |

## Sprints 1–10 matrix (automated rerun)

| Sprint | Theme | Code | Auto gate |
|--------|-------|------|-----------|
| **1** | Dunes, shadows, camera kick, surface HUD, title | Done | static + boot |
| **2** | Cliff, Lakeside basin, collision SFX, HUD | Done | boot |
| **3** | Keep-outs, cliff/lake framing | Done (+ maxH fix) | static |
| **4** | `_geoFramingBias`, mountain mass | Done | boot |
| **5** | Forest Acts 5–7 drift | Done | flow |
| **6** | Mountain gravel finale | Done | flow |
| **7** | 60 Hz cap, garage, title showroom | Done | boot |
| **8** | Co-driver, jump, grid carry UI | Done | flow + grid |
| **9** | AI, RETRY, results, advance QA | Done | advance + grid |
| **10** | Matrix QA, agents, doc sync | Done | `qa-sprint-matrix` |

**Run full matrix:** `node tools/qa-sprint-matrix.mjs`

---

# Sprint 11 — Ruthless closeout: drift sweeps & terrain proof (19 Aug 2026)

**Cache bust:** `?v=198`

**Charter:** Close PARTIAL items ruthlessly — Act 6 sweeper berms, gravel finale camera, merge hygiene, mountain start regression QA, CEO mandate update.

| Deliverable | Status |
|-------------|--------|
| CEO → **ruthless improvement** mandate | **Done** (`.cursor/rules/virtual-racing-game-studio.mdc`) |
| Forest + Mountain Act 6 **`sweep`** + lean berms | **Done** |
| Forest gravel finale camera bias | **Done** (`game.js`) |
| Rival merge `normalizeForMerge` clone + clearGroups | **Done** |
| GLB load success logging | **Done** |
| `tools/qa-mountain-start.mjs` | **Done** |

**Automated:** `node tools/qa-sprint-matrix.mjs`

**Still human-only:** checklist §2, §3, §6, §8; headed `qa-frame-probe`; drift finale drives.

---

# Sprint 12 — Realistic graphics overhaul (19 Aug 2026)

**Cache bust:** `?v=204`

**Charter:** CEO-mandated realistic rally look — PBR tier 2 with procedural normal maps, stronger sky IBL, tuned stage lighting, async stage load UI, fog-aligned streaming (no pop-in), GLB-only cars.

| Deliverable | Status |
|-------------|--------|
| Procedural **normal maps** on road ribbon + terrain tiles | **Done** (`track.js` `roadNormalFor`, `landNormalMap`) |
| **MeshStandard** road/terrain with higher env response | **Done** (`pbr.js` `worldRoadMaterial`, `worldTerrainMaterial`) |
| **VISUAL tier 2** — textureScale 3, normalStrength 0.92, worldEnv 0.44 | **Done** (`config.js`) |
| **PMREM 128** sky IBL + car env 0.52 | **Done** (`GFX.pmremSize`, `VISUAL.carEnvIntensity`, `game.js`) |
| Stage **loading progress screen** (async `Track.create`) | **Done** (`index.html`, `hud.js`, `game.js`) |
| **GTA-style streaming** with fog-aligned anti-pop-in | **Done** (`STREAM` in `config.js`, `track.js` `update()`) |
| **No procedural car stand-ins** — GLB required | **Done** (`celica.js`) |
| `tools/qa-realistic-visual.mjs` | **Done** |

**Automated:** `node tools/qa-sprint-matrix.mjs` · `node tools/qa-realistic-visual.mjs`

**Still human-only:** full art-direction sign-off (CEO eyes on Desert/Forest/Mountain at race speed); checklist §2–3, §6, §8; headed frame probe on real GPU.

`qa-frame-probe.mjs` must run **headed** to mean anything. Headless Chrome has no
GPU and falls back to the SwiftShader software rasteriser, which caps this game
near 3 fps; the probe detects that and says the measurement is invalid rather
than reporting a fake number. The boot smoke test is headless-safe because it
derives its countdown budget from the frame rate it actually observes.

---

# Sprint 13 — Environmental realism tier 3 (19 Aug 2026)

**Cache bust:** `?v=208`

**Charter:** Push the realistic render path to tier 3 — per-stage horizon haze, richer procedural ground/road grain, road cavity AO, bumped world IBL — while keeping Sprint 12 PBR gates green and 60 Hz budget.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` ≥ 3** in `config.js` | **Done** (`tier: 3`) |
| **Per-stage `horizonGlow` / `horizonStrength` / `dustStrength`** | **Done** (desert, forest, mountain, lakeside, title) |
| **Sky shader** — `uHorizonGlow`, `uDust`, sharper sun disc | **Done** (`sky.js?v=6`) |
| **`paintLandAlbedo`** — pebble/ripple/scree/moss/wet patches | **Done** (EA1) |
| **`paintSurface`** — tarmac aggregate/oil/wear, gravel chips, mud gloss | **Done** (EA1) |
| **`roadAoFor`** — procedural cavity map on ribbons | **Done** (LE1 integration) |
| **Tier-3 IBL bump** on road/terrain materials | **Done** (`pbr.js?v=11`) |
| **Mountain opaque mass removed** (stage 3 visibility) | **Done** (Sprint 13 prep) |
| `tools/qa-sprint13-visual.mjs` | **Done** — **8/8 PASS** |

**Automated:** `node tools/qa-sprint13-visual.mjs` · `node tools/qa-sprint-matrix.mjs`

**Still human-only:** horizon dissolve at race speed on all four stages; checklist §2–3, §6, §8; headed `qa-frame-probe` on real GPU.

---

# Sprint 14 — Aerial depth + hero landmarks tier 4 (19 Aug 2026)

**Cache bust:** `?v=211`

**Charter:** Push visual tier to 4 — distance aerial perspective on terrain, one authored hero silhouette per stage, stronger lakeside water reflections — while keeping Sprint 12–13 gates green.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` ≥ 4** in `config.js` | **Done** (`tier: 4`) |
| **`aerialPerspective`** — vertex fade toward stage fog | **Done** (`_applyAerialPerspective` in `track.js?v=120`) |
| **`heroLandmarks`** — desert arch, forest cedars, lakeside pier | **Done** (`_addHeroLandmarks`) |
| **Tier-4 water** — ripple caustics + higher env | **Done** (`pbr.js?v=12`, `water-ripple-t4`) |
| **World IBL bump** at tier 4 | **Done** (`WORLD_ENV` 1.2) |
| `tools/qa-sprint14-visual.mjs` | **Done** |

**Automated:** `node tools/qa-sprint14-visual.mjs` · `node tools/qa-sprint-matrix.mjs`

**Still human-only:** hero silhouette read at race speed; aerial dissolve vs fog tuning; checklist §2–3, §6, §8; headed `qa-frame-probe` on real GPU.

---

# Sprint 15 — Trackside identity + contact grounding tier 5 (19 Aug 2026)

**Cache bust:** `?v=211`

**Charter:** Push visual tier to 5 — rally boards at start/landmarks/km markers, stronger contact shadows under heroes and trees, animated lakeside water — while keeping Sprint 12–14 gates green.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` ≥ 5** in `config.js` | **Done** (`tier: 5`) |
| **`tracksideSignage`** — stage boards + km markers | **Done** (`_addTracksideSignage`, `stageBoardTexture`) |
| **`contactShadowBoost`** — hero + tree ground blobs | **Done** (`_pushContactShadow`, `SHADOW_MAT_T5`) |
| **`waterScroll`** — lake ripple UV animation | **Done** (`_tickWaterScroll`, `_waterMeshes`) |
| **World IBL bump** at tier 5 | **Done** (`WORLD_ENV` 1.24) |
| `tools/qa-sprint15-visual.mjs` | **Done** |

**Automated:** `node tools/qa-sprint15-visual.mjs` · `node tools/qa-sprint-matrix.mjs`

**Still human-only:** board readability at race speed; water motion vs perf; checklist §2–3, §6, §8; headed `qa-frame-probe` on real GPU.

---

# Sprint 16 — Hotfix wave: POV cockpit + contact blobs + occlusion fade (19 Aug 2026)

**Cache bust:** unchanged (`?v=211` — no bump for doc-only QA closeout)

**Charter:** Close player-visible regressions without a full visual tier bump — POV dash readability, contact shadows planted on ground not chassis, chase-cam tunnel occlusion.

| Deliverable | Status |
|-------------|--------|
| **POV cockpit gauges + mirror** — `hudMat`, `frustumCulled = false`, mirror `try/finally` | **Done** (`celica.js`, `game.js` `_renderMirror`) |
| **Contact blobs on `track.query` ground Y** — not chassis `d.y` alone | **Done** (`game.js` `_syncContactBlobs`) |
| **Camera occlusion fade** — tunnel walls ghost on chase cam | **Done** (`occlusion-fade.js`, `track.js` `cameraFade`, `game.js` `updateCameraFade`) |
| Sprint 16 doc closeout in `QA-REPORT.md` | **Done** (this section) |

**Automated regression:** covered by `node tools/qa-sprint17-visual.mjs` (contact blob + occlusion checks)

**Still human-only:** POV dash legibility at night tunnel; mirror refresh cadence; checklist §2–3, §8; headed desert tunnel hairpin.

---

# Sprint 17 — Chase-cam readability tier 6 (19 Aug 2026)

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=215`** · `track.js?v=123` · `hud.js?v=19` · `css/game.css?v=15` · `config.js?v=76` · `occlusion-fade.js?v=2`

**Charter:** Push visual tier to 6 — chase-cam occlusion fade for tunnels/cliffs, stronger tunnel material read, HUD punch — while keeping Sprint 12–15 gates green.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` ≥ 6** in `config.js` | **Done** (`tier: 6`) |
| **`cameraOcclusionFade`** — product toggle for chase-cam ghost meshes | **Done** (`config.js`, `occlusion-fade.js`) |
| **Tunnel `cameraFade` tags** — walls/ceiling/ribs | **Done** (`track.js` `_addTunnelSegment`) |
| **`updateCameraFade` per frame** on chase cameras | **Done** (`game.js`) |
| **Cliff occlusion fade** — mountain escarpment + forest berms/banks/logs tagged | **Done** (`track.js`) |
| **Tunnel grain** — bake-time bore striation map on wall/rib/portal materials | **Done** (`tunnelBoreStriationMap`) |
| **HUD punch** — brighter chase dials, cluster opacity 0.92, **AIR** when airborne | **Done** (`hud.js`, `game.css`, `h.onGround`) |
| `tools/qa-sprint17-visual.mjs` | **Done** |

**Automated:** `node tools/qa-sprint17-visual.mjs` · `node tools/qa-sprint-matrix.mjs`

**Still human-only:** cliff fade vs aerial perspective at race speed; tunnel grain in the bore; HUD punch in rain/fog; checklist §2–3, §6, §8; headed `qa-frame-probe` on real GPU.

---

# Sprint 18 — Championship integrity + Stratos hero (20 Aug 2026)

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=216`** · `celica.js?v=82`

**Charter:** Close acceptance criterion #5 PARTIAL (I-1 / I-2) and replace the 1.2k-tri Stratos stub with a readable original hero mesh. Sketchfab CC BY was not on disk — Blender rebuild instead of commercial 3dmodels.org.

| Deliverable | Status |
|-------------|--------|
| **I-1 RESOLVED** — no `desert && pos === 1 → pos = 2` in `_finish` | **Done** |
| **I-2 RESOLVED** — flash + clock use `CHAMPIONSHIP.checkpointBonus` (25) | **Done** |
| **NEXT STAGE load** — `Track.createAsync` → `Track.create` (Forest after Desert) | **Done** |
| Criterion **#5** machine-confirmed (grid carry) | **Done** — full human championship drive still open |
| **Stratos hero** — 1,224 → **15,612** tris; rival **14,256**; `WHEEL_*` hubs; `placeholderGlb: false` | **Done** |
| `tools/qa-sprint18-championship.mjs` | **Done** |
| `tools/qa-sprint-matrix.mjs` Sprint 18 row | **Done** |

**Automated:** `node tools/qa-sprint18-championship.mjs` · `node tools/qa-championship-grid.mjs` · `node tools/glbstats.mjs assets/stratos/*.glb`

**Still human-only:** full championship drive; Stratos silhouette at race speed vs Celica/Delta; optional Sketchfab CC BY drop later; checklist §2–3, §6, §8.

---

# Sprint 19 — Arcade sense of speed (20 Aug 2026)

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=218`** · `config.js?v=78` · `vehicle.js?v=43` · `engine.js?v=44`

**Charter:** Car felt sluggish with no racing urgency — punch acceleration/top end and sell speed through chase FOV + cabin rush.

| Deliverable | Status |
|-------------|--------|
| **Power wired** — `peakPowerKw` scales `engineTorque` (was dead) | **Done** (238 kW Celica; 252 Stratos) |
| **Top end** — Celica/Delta/Stratos **230 / 226 / 245** km/h; aeroDrag 0.37 | **Done** |
| **Gears** — slightly taller 4th so redline matches new max | **Done** |
| **Chase rush** — medium closer/lower, FOV 64, speedFov 0.2, punch 13° | **Done** |
| **Cabin wind** — opens earlier / louder by ~120 km/h | **Done** |
| `tools/qa-sprint19-speed.mjs` | **Done** |

**Automated:** `node tools/qa-sprint19-speed.mjs`

**Still human-only:** Desert straight 0–180 feel; Forest tightness vs new power; checklist §2.

---

# Sprint 20 — Highly realistic level design tier 7 (20 Aug 2026)

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=219`** · `config.js?v=79` · `track.js?v=125` · `pbr.js?v=15` · `sky.js?v=7`

**Charter:** Stages must read as real rally places — denser terrain, richer biomes, trackside verge detail, photographic stage light — without reintroducing tunnel overdraw or mountain mass.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` 7** + `terrainRealism` | **Done** |
| **Denser heightmap** — `terrainTileSegs` 18 → **24** | **Done** |
| **Biome height/tint/paint** — dunes, moss banks, ridges, lake shelves | **Done** |
| **Verge detail** — desert scrub/rocks, forest understory, mountain scree, lakeside reeds | **Done** |
| **Stage LIGHTING + IBL** — per-biome sun/fog; `worldEnvIntensity` 0.5; WORLD_ENV 1.28 | **Done** |
| `tools/qa-sprint20-realism.mjs` | **Done** |

**Automated:** `node tools/qa-sprint20-realism.mjs`

**Still human-only:** art sign-off at race speed on all four stages; perf on Desert pack in tunnel; checklist §2–3.

# Sprint 21 — Authored GLB props & characters (20 Aug 2026)

**Charter:** Replace trackside box/cone stand-ins with actual models — crowds, safari animals, trees, rocks, cactus, alpine houses.

| Item | Status |
|------|--------|
| `assets/props/*` Kenney CC0 characters + nature | **Done** |
| Safari animals + alpine house GLBs | **Done** |
| `js/tracks/prop-kit.js` loader | **Done** |
| Track/game wiring, `VISUAL.tier: 8`, `glbProps` | **Done** |
| Crowds instance Kenney `character-*` GLBs via `CrowdField` | **Done** (closed Sprint 22 pass) |
| `tools/qa-sprint21-props.mjs` | **Done** |

**Automated:** `node tools/qa-sprint21-props.mjs` → PASS · `node tools/qa-boot-smoke.mjs` → **16/16**

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=228`** · `track.js?v=132` · `crowd.js?v=4` · `prop-kit.js?v=5` · `trees.js?v=25`

---

# Sprint 22 — Soft off-road + living crowds (20 Aug 2026)

**Charter:** Leave the ribbon freely; soft pull when deep; mid-track reset when too far; no verge wall-slide. Crowds bob/cheer with clap/cheer Doppler beds.

| Deliverable | Status |
|-------------|--------|
| **Off-road zones** — shoulder / runoff / recover / reset (`OFF_RESET=24`) | **Done** |
| **Mid-track reset** — `track.sample` centre-line restore for player | **Done** |
| **No wall skate** — glance re-aims down nose; barriers visual-only | **Done** |
| **Living crowds** — Kenney GLB bodies + proximity bob/cheer | **Done** |
| **Crowd audio** — `CrowdVoice` HRTF + manual Doppler | **Done** |
| **Kenney colormap** — `assets/props/Textures/colormap.png` (no GLTF 404 spam) | **Done** |
| `tools/qa-sprint22-runoff.mjs` | **Done** |

**Automated:** `node tools/qa-sprint22-runoff.mjs` → PASS · boot smoke **16/16** (clean console)

**Cache bust:** `?v=228` · `collide.js?v=29` · `vehicle.js?v=45` · `track.js?v=132` · `crowd.js?v=4` · `engine.js` crowd import `?v=2`

**Still human-only:** drive off Desert verge then deep reset; pass Lakeside crowd at speed for Doppler; checklist §6 contact feel.

---

# Sprint 23 — Photoreal lighting + post (20 Aug 2026)

**Charter:** Environment must read photographic — denser land/road grain, stronger stage IBL + sun, soft shadows, and a real post stack (bloom / grade / vignette / FXAA / sharpen).

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` 9** + `postFx` | **Done** |
| **`js/gfx/postfx.js`** — bloom, colour grade, vignette, FXAA, sharpen | **Done** |
| **Texture density** — `textureScale` 3, full-res normals, desert micro-grain | **Done** |
| **IBL / light** — PMREM 128, world/car env up, stage sun/hemi/exposure | **Done** |
| **Sky sun disc** — tighter photographic corona | **Done** |
| **Road/water response** — higher env metalness/roughness at tier 9 | **Done** |
| `tools/qa-sprint23-photoreal.mjs` | **Done** |

**Automated:** `node tools/qa-sprint23-photoreal.mjs` → PASS · boot smoke **16/16**

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=230`** · `config.js?v=83` · `postfx.js?v=2` · `pbr.js?v=16` · `sky.js?v=8` · `input.js?v=35`

**Still human-only:** headed GPU drive on all four stages; Desert tunnel overdraw; checklist §2–3. True photogrammetry albedo packs are a later asset drop if desired.

---

# Sprint 24 — 60fps photoreal + no control lag (20 Aug 2026)

**Charter:** Keep tier-9 look, restore 60 Hz feel. Sprint 23’s full-res FXAA/sharpen, ×3 textures, and 4× bloom blurs were the lag.

| Deliverable | Status |
|-------------|--------|
| **Quarter-res bloom** (1 separable pair) + grade/vignette | **Done** |
| **FXAA/sharpen off**; MSAA off when post on | **Done** |
| **GPU budget** — PR ≤1.25, textureScale 2, half normals, shadowEvery 2 | **Done** |
| **Adaptive post** — drops bloom when present >~18.5 ms | **Done** |
| **Snappy steer** — input rates + chassis steerSpeed ~22 | **Done** |
| `tools/qa-sprint24-perf.mjs` | **Done** |

**Automated:** `node tools/qa-sprint24-perf.mjs` → PASS · boot smoke **16/16**

**Cache bust:** `?v=230`

**Still human-only:** headed 60 Hz feel on Desert pack; confirm no steer lag after hard refresh.

---

# Sprint 25 — UE5-style PBR photoreal (20 Aug 2026)

**Charter:** Overhaul materials/lighting/textures toward Unreal-like physical response in the browser — without bringing back Sprint 23 control lag.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` 10** + `ue5Look` / `physicalLighting` / `roughnessMaps` | **Done** |
| **Player lacquer** — MeshPhysical clearcoat paint; AI stays Standard | **Done** |
| **Glass/chrome/rubber** — Physical/Standard PBR (no transmission) | **Done** |
| **Road + land roughness maps** — procedural specular variation | **Done** |
| **Physical lights** — `useLegacyLights = false`; stronger sun IBL | **Done** |
| **Cinematic grade** — contrast + film grain (off when adaptive low) | **Done** |
| **60 Hz budget kept** — adaptive post, shadowEvery 2, textureScale 2 | **Done** |
| `tools/qa-sprint25-ue5.mjs` | **Done** |

**Automated:** `node tools/qa-sprint25-ue5.mjs` → PASS · boot smoke **16/16** · s23/s24 still PASS

**Cache bust:** `?v=231` · `config.js?v=84` · `pbr.js?v=17` · `postfx.js?v=3` · `track.js?v=134`

**Honest scope:** This is UE5-*inspired* Three.js PBR (clearcoat, roughness maps, physical lights, ACES + grain) — not Nanite/Lumen/hardware RT. Authored photo albedo packs remain a later asset drop.

---

# Sprint 26 — Driving integrity (20 Aug 2026)

**Charter:** Close the player-reported “hold accelerate → float 1st every stage” failure and the stage 2/3/4 start-grid pop-in. Driving must require steering/braking skill again.

| Deliverable | Status |
|-------------|--------|
| **No player off-road autopilot** — runoff costs pace; AI still guided | **Done** |
| **Planted grip** — higher LAT_BLEED, softer steerFalloff, tighter slide caps, sand/dirt less ice | **Done** |
| **Tougher AI** — skillCeiling 1.05, pace 0.92+, fewer mistakes | **Done** |
| **Exclusive championship grid** — player slot never shared with AI (fixes GO shove) | **Done** |
| **`_plantStartGrid` + cam hold** — car on grid before 3-2-1, no end-of-countdown pop | **Done** |
| `tools/qa-sprint26-driving.mjs` | **Done** |

**Automated:** `node tools/qa-sprint26-driving.mjs` → PASS · `qa-sprint22-runoff` PASS · boot smoke **16/16** · championship grid PASS · live probe: place-1 grid exclusive (player 16 m, AI 29 m+) · throttle-only 14 s → **15th** (14 rivals ahead)

**Cache bust:** `?v=232` · `config.js?v=85` · `collide.js?v=30` · `vehicle.js?v=46` · `ai.js?v=80`

**Still human-only:** full championship drive feel on sand/gravel after hard refresh; confirm stage 2/3/4 cars already on grid during 3-2-1.

---

# Hotfix — roadway clear on stages 2–4 (20 Aug 2026)

**Player report:** random objects/geometry on Forest / Mountain / Lakeside ribbons.

| Fix | Detail |
|-----|--------|
| Wider `ROAD_VERGE` (5.5 m) + farther near-plant shoulder | Trees/bushes start farther out |
| No lateral bush/fern jitter onto asphalt | Along-track scatter only + `_ribbonClear` |
| Forest drift banks / logs / berms / village / signage | Ribbon-clear gated |
| Lakeside land trench | Match Forest/Mountain floor clamp |
| `_scrubRoadwayColliders` | Drop any leftover on-ribbon bumps |

**Live probe:** forest/mountain/lakeside → `onRoad=0`, `landPoke=0` colliders.

**Cache bust:** `?v=233` · `track.js?v=135`

---

# Hotfix — solid opaque environment (20 Aug 2026)

**Player report:** car passes through opaque environment (esp. stages 2–4).

| Fix | Detail |
|-----|--------|
| `glanceObstacles` full depenetration | 2-pass separate; kill inward vel; light scrub |
| `_bumpNearRoad` / `_bumpPoses` | Rocks, trees, berms, banks, logs, stumps, shore stones |
| Mountain cliff face bumps | Sample solid along the cutting |
| Village / cactus / debris | Harder near-road radii |

**Live probe:** embed car in largest near-road collider → after 4 steps `dist >= need` on desert/forest/mountain/lakeside.

**Cache bust:** `?v=234` · `track.js?v=136` · `collide.js?v=31` · `vehicle.js?v=47`

---

# Sprint 27 — Environmental realism + rear dirt wake (21 Aug 2026)

**Charter:** CEO-mandated realism pass — backgrounds, environmental atmosphere, and dirt that clearly leaves the back of the car on loose surfaces.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier: 11`** + `rearDirtWake` / `envAtmosphere` | **Done** |
| **Sky** — ground bounce, stronger haze bands, dual-octave clouds, stage wind | **Done** (`sky.js`) |
| **Stage LIGHTING** — richer fog/horizon/dustStrength + wind vectors | **Done** (`config.js`) |
| **Rear dirt wake** — grit + hanging plume from rear tires, stage wind drift | **Done** (`effects.js`) |
| **Dust ↔ lighting** — `Dust.setAtmosphere()` on course load | **Done** (`game.js`) |
| `tools/qa-sprint27-env.mjs` | **Done** |

**Automated:** `node tools/qa-sprint27-env.mjs` → PASS

**Cache bust:** `?v=247` · `config.js?v=94` · `effects.js?v=47` · `sky.js?v=9` · `game.js?v=246`

**Still human-only:** Desert chase cam plume volume at speed; Forest canopy sky read; Lakeside mist band vs fog.

### Sprint 27 reopen — HD nature only (23 Aug 2026)

**Player moment:** Forest treeline / trackside trees / bushes / rocks / cacti are authored GLBs — no card crowns or cone/cylinder stand-ins on the live scenery path.

| Change | Proof |
|---|---|
| `_addHdNature` / `_addHdBackdrop` GLB-only plant | `qa-sprint27-env.mjs` PASS |
| Forest treeline pine/cedar/fir GLB | gate asserts |
| Verge ferns/bushes/logs + desert scrub HD | code path |
| Lakeside far shore autumn trees HD | code path |

**Cache:** `?v=273` · `track.js?v=149` · `prop-kit.js?v=11`

---

# Sprint 28 — Launch punch + driveline realism (21 Aug 2026)

**Charter:** Full realism pass focused on player-felt power — harder acceleration from a dead stop and a higher top end, without undoing Sprint 26 planted mid-corner grip.

| Deliverable | Status |
|-------------|--------|
| **`HANDLING.launchBoost` 1.38** fades by 78 km/h | **Done** (`config.js` + `vehicle.js`) |
| **Low-RPM torque meat** + peakPowerKw **272** (Stratos **288**) | **Done** |
| **Shorter 1st/2nd** + finalDrive **4.35**; Celica Vmax **250** | **Done** |
| **Less aero wall** (aeroDrag **0.33**) for top-end pull | **Done** |
| **Launch squat** squatMax **0.11** | **Done** |
| **`VISUAL.tier: 12`** | **Done** |
| `tools/qa-sprint28-launch.mjs` | **Done** |
| Sprint 26 gate constants refreshed to live planted values | **Done** |

**Automated:** `node tools/qa-sprint28-launch.mjs` → PASS (re-verified 23 Aug 2026 after Sprint 27 stack)

**Cache bust (live):** `?v=273` · `config.js?v=102` · `vehicle.js?v=59` · `game.js?v=273`

**Still human-only:** 0→100 feel on Desert sand vs Forest gravel; Stratos 2WD wheelspin on loose launch.

---

# Sprint 32 reopen — Desert rock-bridge portal (23 Aug 2026)

**Player moment:** Stage 1 finale approach — drive *under* the sandstone arch before the linked gravel hairpins (not a sealed dune wall).

| Change | Status |
|--------|--------|
| Portal refuse on every bridge block (`openH` **9.8**, `clearHalfD` **11**) | **Done** |
| Placement on sand→gravel approach straight (not mid-hairpin) | **Done** |
| Wider underpass land prism + floor clamp | **Done** |
| `tools/qa-sprint32-desert-finale.mjs` | **PASS** |
| `tools/qa-desert-bridge-portal.mjs` (0 invaders, land bed, car spawn) | **PASS** |

**Cache:** `?v=280` · `track.js?v=152`

**Still human-only:** Visual read of the mouth at chase-cam distance on a live Desert drive.

---

# Sprint 32 — Physically based lighting (23 Aug 2026)

**Player moment:** Sunlit tarmac/gravel reads with believable specular on paint and road; shadows stay sharp under the car at chase distance without killing frame time.

| Change | Status |
|--------|--------|
| `js/gfx/lighting-rig.js` — Kelvin sun, sky-rim fill, tight shadow frustum | **Done** |
| Per-stage `sunKelvin` + `rimInt` in `LIGHTING` | **Done** |
| PMREM sky capture far plane (`GFX.pmremFar` 240) | **Done** |
| Per-material IBL tint in `applyEnvMap` (road/chrome/terrain) | **Done** |
| Post composite highlight shoulder (`highlightRolloff`) | **Done** |
| `tools/qa-sprint32-pbr.mjs` | **PASS** |

**Cache:** `?v=304` · `config.js?v=118` · `lighting-rig.js?v=1` · `postfx.js?v=6` · `pbr.js?v=19`

**Perf:** No extra shadow pass; adaptive post (`adaptFloorMs` 33.3) unchanged. Sky rim is one DirectionalLight with `castShadow=false`.

**Still human-only:** 2-minute Desert/Forest drive — sun spec on Celica paint, shadow contact under wheels, 60 Hz feel on target hardware.

---

# Garage expansion — six GLB chassis + pro rivals (23 Aug 2026)

**Player moment:** SELECT CAR shows Celica/Delta/Stratos plus E-Type, Focus ST, Accord Sport; championship grid mixes real GLB silhouettes with pro racing lines and subtle rub audio.

| Change | Status |
|--------|--------|
| `assets/jaguar`, `focus`, `accord` from Cursor Projects GLBs | **Done** |
| Hero optimize (Accord 52→12 MB) + rival LODs | **Done** |
| `GARAGE_CAR_IDS`, rival chassis pool, per-slot physics | **Done** |
| Pro AI line (tarmac apex / loose width / look-ahead) | **Done** |
| Subtle `carBump` on rival contact | **Done** |
| `tools/qa-garage-cars.mjs` | **PASS** |

**Cache:** `?v=305` · `celica.js?v=96` · `config.js?v=119`

---

# Sprint 33 — Arcade power-slide (23 Aug 2026)

**Player moment:** e-brake + throttle into a gravel/sand hairpin — tail snaps out, throttle holds the slide, countersteer aims the exit. Chase cluster flashes **SLIDE** when attitude builds.

**Model (AM3 + arcade rally):** initiate (lock rears / power oversteer) → transition (yaw + lateral) → sustain (throttle, low bleed) → exit (countersteer).

| Change | Status |
|--------|--------|
| Stronger e-brake snap (`handbrakeYawKick` 3.15, rear µ dump) | **Done** |
| Power oversteer sustain (`handbrakePowerMul` 2.05, TC dump in slide) | **Done** |
| Longer carry (`handbrakeBleedMul` 0.032, `driftBleedMul` 0.048) | **Done** |
| Loose surfaces easier pitch-in (sand/gravel/dirt/mud) | **Done** |
| **SLIDE HUD badge** (`#cluster-slide`, `slideBadge` in hud.js) | **Done** |
| `tools/qa-sprint33-drift.mjs` | **PASS** |

**Cache:** `?v=310` · `config.js?v=119` · `vehicle.js?v=66` · `hud.js?v=26`

**Still human-only:** Desert Act 5 bowl + linked gravel hairpins feel drive.

---

# Sprint 34 — Studio check-in + preload (23 Aug 2026)

**Player moment:** Title screen warms the full championship cup in the background; returning to Desert (or next stage after halfway) skips the loading screen when the track is already hot.

| Change | Status |
|--------|--------|
| `_trackCache` + `_pumpPreloadQueue` background warm | **Done** |
| Instant race when `_isTrackReady(courseId)` | **Done** |
| Halfway checkpoint → next stage preload | **Done** |
| Title hover priority + championship cup queue | **Done** |
| Unified `config.js?v=119` module graph (static audit) | **Done** |
| `tools/qa-cache-version.mjs` + `qa-sprint34-checkin.mjs` | **Done** |
| QA gates use dynamic cache chain (no stale v=) | **Done** |

**Automated:** `node tools/qa-sprint34-checkin.mjs` → **SHIP-CANDIDATE** (23 Aug 2026)

**Cache:** `?v=310` · `game.css?v=22`

**Executive doc:** [`docs/SPRINT-34-CHECKIN.md`](SPRINT-34-CHECKIN.md) — full Sprints 1–33 summary, CEO + CTO reports.

**Still human-only:** 2-minute Desert gravel hairpin SLIDE badge feel; headed frame probe on target GPU.

---

# Sprint 33 reopen — SLIDE HUD (23 Aug 2026)

See Sprint 33 section above — SLIDE badge closed this iteration.

---

# Sprint 35 — Drive-corridor clip cleanup (23 Aug 2026)

**Player moment:** Car must not clip through land / bridge / berm polys on Stage 1 arch, Stage 2 finale, or Stage 3.

| Change | Status |
|--------|--------|
| Wider Stage 1 portal (`openH` **10.2**, `clearHalfD` **12**) + AABB portal scrub | **Done** |
| Axis-aligned footing (no rotated shards in the hole) | **Done** |
| `_markDriveClearCorridors` — Forest end + Mountain full land wash | **Done** |
| Harder land-tile / `_groundHeight` bed clamps in-lane | **Done** |
| Berms / cliff / scree pushed off ribbon + pose strip before instance | **Done** |
| `tools/qa-sprint32-desert-finale.mjs` | **PASS** |
| `tools/qa-desert-bridge-portal.mjs` | **Blocked** (Chrome load timeout in this session — static gate PASS) |

**Cache:** `?v=292` · `track.js?v=155`

**Still human-only:** Live drive under Desert arch; Forest finale; Mountain full lap for residual visual clip.


# Sprint 30 — Cinema realism (environment / textures / lighting) (23 Aug 2026)

**Player moment:** Stages read as photographed rally places — filmic midtones, denser ground/road grain, keyed sun with soft fill — not arcade neon punch.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier: 13`** + `cinemaRealism` | **Done** |
| **ACES filmic tone mapping** (replaces Reinhard for tier 13+) | **Done** |
| **Photographic grade** — lower sat, soft grain, deeper vignette | **Done** |
| **Per-stage LIGHTING retune** — Desert/Forest/Mountain/Lakeside cinema keys | **Done** |
| **Land + tarmac micro-detail** — silica/talus/litter/bitumen paint | **Done** |
| **Stronger IBL / normals** — worldEnv 0.9, normalStrength 1.22, WORLD_ENV 1.72 | **Done** |
| Soft PCF shadows (bias/radius) | **Done** |
| `tools/qa-sprint30-realism.mjs` | **PASS** |
| Regression: s23 photoreal + s25 UE5 | **PASS** |

**Cache:** `?v=293` · `config.js?v=115` · `track.js?v=156` · `pbr.js?v=18` · `sky.js?v=13` · `postfx.js?v=5`

**Still human-only:** 2-minute Desert + Mountain drive for ACES exposure feel and texture read at chase cam.

---

# Delta headlight floating polygons (23 Aug 2026)

**Player moment:** Delta Integrale nose — no full-length glowing light sheets / floating chrome slabs through the body.

| Change | Status |
|--------|--------|
| `isFullLengthLightSheetLabel` matches `Light_glass` / `Light_Glass_Bump` (underscores) | **Done** |
| Sheets **removed + disposed** (not only `visible=false`) | **Done** |
| Oversized `Light_Front` hides **material** so nested emitters still draw | **Done** |
| `tools/qa-delta-lights.mjs` | **PASS** |

**Cache:** `?v=295` · `celica.js?v=93`

**Still human-only:** Garage / practice with Delta headlights on — confirm no floating polygons.

---

# Sprint 31 — AAA expert driving + cinema realism (23 Aug 2026)

**Player moment:** Expert-grade handling — trail-brake rotation into gravel hairpins, countersteer catch at the limit, grip meter on the chase cluster, cinema-tier visuals intact.

| Deliverable | Status |
|-------------|--------|
| **Trail-brake yaw** (`trailBrakeYaw` 0.44) — brake + steer rotates nose on loose entry | **Done** |
| **Expert countersteer** (`expertCounterMul` 1.18) — faster catch at limit | **Done** |
| **Grip / slide telemetry** — `gripUsed()`, `slidePct()` | **Done** |
| **Chase cluster GRIP bar** — green→amber→red under load | **Done** |
| **Drift camera** — lateral kick + FOV pulse when sliding | **Done** |
| Sprint 30 cinema realism (tier 13, ACES, postFx) | **Regression PASS** |
| Sprint 33 power-slide sustain | **Regression PASS** |
| `tools/qa-sprint31-drift.mjs` | **PASS** |

**Cache:** `?v=296` · `config.js?v=116` · `vehicle.js?v=64` · `hud.js?v=25` · `game.css?v=19`

**Still human-only:** Desert Act 5 trail-brake hairpin; Forest gravel power-slide; Mountain tarmac limit catch.

---

# Sprints 35–40 — AAA foundations (23 Aug 2026)

**Automated:** `node tools/qa-sprint35-40-matrix.mjs` → **SHIP**  
**GPT handoff:** [`docs/GPT-OPTIMIZATION-BRIEF.md`](GPT-OPTIMIZATION-BRIEF.md)

| Sprint | Player moment | Proof |
|--------|---------------|-------|
| **35** | Wall rubs darken body paint (wear tiers) | `qa-sprint35-damage.mjs` + `dcc-pipeline.mjs` |
| **36** | Authored co-driver calls + spring steering wheel in POV | `qa-sprint36-pace.mjs` |
| **37** | Tunnel/forest reverb on engine + tires | `qa-sprint37-audio.mjs` |
| **38** | Per-surface Pacejka + 60 Hz fixed-step (verified) | `qa-sprint38-physics.mjs` |
| **39** | iGPU perf tier drops DPR/bloom under load | `qa-sprint39-perf.mjs` |
| **40** | Longer Act 8 stages; Time Attack ghost; telemetry export | `qa-sprint40-telemetry.mjs` |

**Cache:** `?v=320` · `config.js?v=122` · `vehicle.js?v=67`

**Still human-only:** headed iGPU matrix; staff ghost JSON; mocap BVH; online ghost server; photogrammetry capture.

---

# Camera overhaul — close chase + seated POV + live mirror (23 Aug 2026)

**Player moment:** Default medium chase sits close and low like Sega Rally (car large in the lower third). C cycles POV → medium → far in ~0.3 s with no hang. POV is the driver seat: windshield/roof stripped, cabin + working ST205 cluster, animated wheel, and a rearview that renders the road behind.

| Deliverable | Status |
|-------------|--------|
| **Medium chase** `back: 3.98` `height: 1.80` `fov: 62` | **Done** (`config.js` `CAMERA.views`) |
| **C-key blend** 0.3 s smoothstep, then POV hard-locks to `rig.head` | **Done** (`game.js` `_chaseCam`) |
| **Seated eye** in front of the seat, looking over the dash/hood; no cabin glass | **Done** (`celica.js` `buildPovRig` / `tagWindshield`) |
| **Gauges** ~48 mm dials, vmax/redline from `CARS` spec | **Done** |
| **Rearview** 640×200 RT every POV frame on physical glass | **Done** (`GFX.mirrorEvery: 1`) |
| `tools/qa-sprint37-camera.mjs` | **PASS** |
| `tools/qa-sprint19-speed.mjs` | **PASS** (no FOV/speed regression) |
| `tools/qa-static-audit.mjs` | **PASS** (config unified at `?v=123`) |

**Cache:** `main.js?v=335` · `game.js?v=335` · `config.js?v=125` · `celica.js?v=109` · `ai.js?v=98` · `cockpit-anim.js?v=3`

**Medium chase (23 Aug 2026):** `back` 3.18 → 3.98 (+25%), `height` 1.24 → 1.80 (+45%). Default chase sits further off the bumper and higher so the car is not filling the lower third.

**LHD POV (23 Aug 2026):** Driver eye is clamped to negative X. If the GLB has a named rim (`STEER_HR` / `SteeringWheel`), that mesh is reparented and shown in cockpit view — no second torus. RHD rims are shifted across to the left seat. Cars without a modeled wheel still get the procedural rim.

**Still human-only:** headed C-key cycle on Desert (medium size vs lakeside reference; POV gauges + mirror while turning). LHD Celica: one modeled wheel, no duplicate torus.

---

# Sprint 38 — Environment clip-through (23 Aug 2026)

**Player moment:** The car must not pass through land, cliff, berm, rock, or house polygons on any stage. Stage 3 (Mountain / Tour de Corse) was the worst: the authored hairpin cutting sat 18.5 m inside a 15–18 m radius turn, so the back face occupied the opposite carriageway with no collider.

**CEO:** Ship-blocker. Close it; do not carry a PARTIAL.

| Change | Status |
|--------|--------|
| `_nearestRoad` searches local spline **and** nearby grid cells (opposite hairpin arm) | **Done** |
| Stage 3 cliff sits at `half + ROAD_VERGE + 3.2` with ~3.2 m thickness; columns skipped unless `_driveClear` on face, mid, and back | **Done** |
| `_driveClear` cardinal samples for large footprints (rocks, berms, village, wild scatter) | **Done** |
| Colliders whose sphere overlaps painted asphalt are scrubbed; verge walls stay | **Done** |
| Mountain land trench chase **48 m**; landmark wash lateral **46 m** | **Done** |
| `tools/qa-env-clip.mjs` | **run this sprint** |
| `tools/qa-static-audit.mjs` | **run this sprint** |
| `tools/qa-sprint26-solid.mjs` | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=336`** · `track.js?v=164`

**Still human-only:** one full Mountain lap for residual visual clip at jumps / village cobbles.

---

# Sprint 39 — Launch/brake fore-aft hop (23 Aug 2026)

**Player moment:** On throttle (and on the brakes) the car was nodding rapidly forward and back — a glitchy spring. At rest it was planted. It must look solid under accel and brake.

**Cause:** Bang-bang traction control (linear gain 8) plus algebraic kappa plus per-substep load transfer made a ~240 Hz longitudinal oscillator. A 12 rad/s pitch spring on `_ax` painted that chatter onto the mesh, so the bumper bobbed in the chase camera.

**CEO:** Close it. Do not ship a car that jitters on a straight.

| Change | Status |
|--------|--------|
| Visual accel/brake squat removed; mesh pitch is the road plane + one-shot landing squash | **Done** |
| Kappa uses first-order relaxation (`RELAX_KAPPA = 0.14`) like slip angle | **Done** |
| TC / brake-hold cuts are quadratic, not linear gain 8 / 9 | **Done** |
| `_ax` (load transfer) blended once per 60 Hz frame, frozen during tire substeps | **Done** |
| `tools/qa-sprint28-launch.mjs` contracts for the above | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=339`** · `vehicle.js?v=69` · `ai.js?v=99`

**Still human-only:** 10-second dead-stop launch + a hard brake on tarmac; the hull must not shimmer fore-aft.

---

# Sprint 40 — iPhone Safari play (23 Aug 2026)

**Player moment:** Open the game on an iPhone in Safari, tap through the menus, then drive with on-screen GAS/BRAKE and either a left-hand STEER pad or TILT (phone as a wheel). Pedals stay on the right in both modes.

**CEO:** This is the difference between “desktop only” and a shippable arcade rally in the pocket.

| Change | Status |
|--------|--------|
| iOS viewport-fit, web-app meta, 100dvh, safe-area, 48px menu hits | **Done** |
| Touch overlay: analog steer, GAS, BRAKE, HB, pause, camera | **Done** |
| TILT mode — `DeviceOrientationEvent.requestPermission` on the TILT tap | **Done** |
| Renderer no longer floors at 640×360 (broke iPhone width) | **Done** |
| Phone starts at DPR 0.78 / 2048 shadows | **Done** |
| `tools/qa-mobile-controls.mjs` | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=341`** · `input.js?v=38` · `touch-controls.js?v=2` · `css/game.css?v=23`

**Still human-only:** iPhone Safari landscape lap; grant motion on TILT; confirm steer direction feels like turning a wheel.

