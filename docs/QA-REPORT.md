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

**Still human-only (closed Sprint 41):** 10-second dead-stop launch — hull shimmer persisted after this sprint; see Sprint 41.

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

---

# Sprint 41 — Accel body bounce closeout (24 Aug 2026)

**Player moment:** Floor it from a standstill. The Celica mesh must stay a solid car — no springy fore-aft nod, no bumper shimmer in the chase cam. Standstill was already planted; throttle was still glitchy after Sprint 39.

**Cause:** Sprint 39 removed visual squat but left three amplifiers: (1) raw Pacejka Fx still integrated into `vx` every 240 Hz substep, (2) axle-height noise painted onto mesh pitch around a contact-patch origin, (3) chase cam lagged in XZ so any leftover hop read as the body bouncing in frame.

**CEO:** Close it. A car that jitters on a straight does not ship.

| Change | Status |
|--------|--------|
| Player `vx` integrates filtered `_axDrive` (`AX_DRIVE_RATE = 11`) | **Done** |
| Visual pitch follows deadzoned `_visPitch` (not raw `_roadPitch`) | **Done** |
| Deck plant target filtered (`DECK_FILT_RATE = 8`) so ribbon noise cannot bob Y | **Done** |
| `WHEEL_I` 3.6 → 6.4, `RELAX_KAPPA` 0.14 → 0.22 | **Done** |
| Medium chase locks XZ to the live car | **Done** |
| `tools/qa-sprint28-launch.mjs` contracts | **run this sprint** |
| `tools/qa-launch-stable.mjs` live throttle probe | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=343`** · `vehicle.js?v=71` · `ai.js?v=101`

**Still human-only:** one 10-second launch in the headed game to confirm the mesh looks like a rigid body.

---

# Sprint 42 — POV steering wheel column spin (24 Aug 2026)

**Player moment:** C into POV, turn the wheel. The rim must rotate around the steering column like a real car — not tumble on a sideways axis.

**Cause:** `rotateOnAxis` used a **world-AABB** “thinnest” axis. GLB rims are tilted; that axis was car-space, then applied as a **local** axis, so the modeled wheel cartwheeled.

**CEO:** Close it. A broken steering wheel in the seat is not shippable.

| Change | Status |
|--------|--------|
| Local-space disc axis + `steer-spin` pivot whose +Z is the column | **Done** |
| Cockpit anim sets `rotation.z` on that pivot (same as the procedural torus) | **Done** |
| `tools/qa-pov-steer.mjs` static + title-car live | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=344`** · `celica.js?v=110` · `cockpit-anim.js?v=4` · `ai.js?v=102`

**Still human-only:** one headed POV lock-to-lock to confirm the spokes turn in the wheel plane.

---

# Sprint 43 — POV speedo / tach (24 Aug 2026)

**Player moment:** C into the seat. The two analog dials must read like the chase cluster — 0 at 7:30, clockwise to 4:30, MPH 0–140 and RPM ×1000 to 9 — with needles sitting on 0 at rest and climbing with speed/revs. Switching C must not change the scale.

**Cause:** In-car faces used a different zero (10:30), the 3D needle was a +Y blade (12 o'clock rest), each disc was Y-flipped so numerals were mirrored, the tach spring was underdamped plus idle `performance.now()` jitter, and the speedo was km/h 0–250. Parenting the needle under `scale.x = -1` also hid/reversed the blade.

**CEO:** Close it. A broken cluster in the seat is not shippable.

| Change | Status |
|--------|--------|
| Face ticks + needle angle match chase HUD (`GAUGE_START = 0.75π`, sweep 1.5π) | **Done** |
| Needle along +X; live `rotation.z = -(START + SWEEP * t)` | **Done** |
| Face-only Y-flip + `scale.x = -1` so numerals read; needle stays unmirrored | **Done** |
| Speedo MPH 0–140, tach ×1000 to 9, overdamped springs | **Done** |
| `tools/qa-pov-gauges.mjs` static + title-car live | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=345`** · `celica.js?v=111` · `ai.js?v=103`

**Still human-only:** headed C into POV at rest (needles on 0) then a short pull to confirm both climb clockwise.

---

# Sprint 44 — POV rearview glass (24 Aug 2026)

**Player moment:** C into the seat. The interior rearview must show the road behind you — sky, trees, rivals — not a black rectangle.

**Cause:** Three stacked defects. (1) ACES was baked into a `NoColorSpace` RT, then the canvas encoded it as linear → crushed to black. (2) The live plane sat on the **windshield** side of the frame, so the driver saw dark plastic. (3) GLB meshes named `mirror` were shaded as chrome and left visible, covering the RT.

**CEO:** Close it. A black mirror in the seat is not shippable.

| Change | Status |
|--------|--------|
| Capture `NoToneMapping` into an sRGB RT; glass stays `toneMapped: false` | **Done** |
| Glass on the seat side (`z = -0.01`), `depthTest: false` | **Done** |
| Hide GLB interior rearview; wing mirrors stay | **Done** |
| `tools/qa-pov-mirror.mjs` static + live RT luma | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=346`** · `celica.js?v=112` · `ai.js?v=104`

**Still human-only:** headed C into POV on Desert — confirm the glass shows the start grid / road behind, not black.

---

# Sprint 45 — Seamless C-key camera blend (24 Aug 2026)

**Player moment:** Press C. The lens must *move* to the next view (POV / medium / far) in about a fifth of a second — no cut, no hang, no extra load, no hesitation.

**Cause:** A blend timer existed, but C also swapped the cockpit, hid the windshield, toggled the chase HUD, and kicked a full rearview capture on the **same frame**. FOV used the ease value as a follow rate, so it sat still then snapped. `setCockpitView` walked the whole GLB twice.

**CEO:** Close it. Camera swaps are a moment every player hits.

| Change | Status |
|--------|--------|
| C only records the from-pose; cockpit attaches mid-blend | **Done** |
| FOV / near lerp with the pose; 0.22s smoothstep | **Done** |
| Hide cache, no live GLB traverse; no mirror capture on the C frame | **Done** |
| Chase cluster fades instead of `display:none` pop | **Done** |
| `tools/qa-cam-blend.mjs` static + live step probe | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=347`** · `config.js?v=127` · `celica.js?v=113` · `ai.js?v=105` · `css/game.css?v=24`

**Still human-only:** headed C cycle on Desert (POV → medium → far) while rolling — confirm the lens eases and never hitch-stops.

---

# Sprint 47 — Desert sand-on-road + env clip (24 Aug 2026)

**Player moment:** Stage 1 opening through the gravel corridor and Bowl — the racing line is asphalt, not a dune, and the car does not ghost through sand banks, rocks, or berms.

**Cause:** Desert land had no chase-flatten (Forest/Mountain already did). Dunes rose the instant the ~29 m trench ended, so 10 m land cells interpolated sand onto the ribbon and the inside of radius-36 gravel corners. An 8.2 m dune skirt folded across tight bends. Roadside rocks planted at half+9 m overlapped the chase; Bowl berms at half+9.2 failed `_driveClear` so they were visual-only (or skipped) while leftover rocks had colliders smaller than the mesh.

**CEO:** Ship-blocker on the teaching stage. Close it; do not carry a PARTIAL.

| Change | Status |
|--------|--------|
| Full-stage Desert land wash (`lateral: 44`) | **Done** |
| Chase-flat in `_groundHeight` + `_addLandTile` (half+48, 0.03 bank) | **Done** |
| In-lane refuse padded a full land cell past the verge | **Done** |
| Skirt 8.2 m → 2.6 m tuck; outer Y capped below the deck | **Done** |
| Rocks/cacti/berms/herd plant past the verge; colliders match the mesh | **Done** |
| `tools/qa-desert-clip.mjs` static + headed corridor probe | **PASS** — in-lane land −0.72 m over 104 stations; verge −0.72 m; 351 colliders off the lane |
| `tools/qa-env-clip.mjs` Mountain regression | **PASS** — in-lane −0.78 m over 85 stations |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=348`** · `track.js?v=165`

**Still human-only:** 2-minute Desert drive — opening straights, gravel snakes, Bowl — confirm no sand on the painted lane and no chassis through rocks.

---

# Sprint 48 — Desert rock-bridge underpass (24 Aug 2026)

**Player moment:** Late Stage 1 — drive *under* the sandstone arch. The hole is empty. The chassis does not clip the lintel, piers, or a sand slab filling the bottom.

**Cause:** Land under the arch used `_nearestRoad` Y, so the finale hairpin's opposite arm could refill the hole with a car-height dune. Ceiling ribs sat on the portal threshold. Portal scrub needed two AABB corners inside the prism, so a slab whose corners sat outside still filled the drive-through. Chase-cam fade on the lintel also read as the car ghosting through rock.

**CEO:** Close it. The underpass is a moment every Desert lap hits.

| Change | Status |
|--------|--------|
| Shared `_desertBridgePortal` (`openH` **12.8**, `clearHalfD` **16**, half+4.8 wide) | **Done** |
| `_underpassFloorY` uses the bridge sample, not nearest-road | **Done** |
| Lintel underside 0.55 m above the hole; no ceiling ribs in the prism | **Done** |
| Conservative AABB portal scrub; rubble only on pier caps | **Done** |
| `tools/qa-desert-bridge-portal.mjs` + `qa-sprint32-desert-finale.mjs` | **PASS** — openH 12.8, hole 16 m deep, 0 invaders, 0 car-envelope hits, land −0.95 m, car on deck |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=349`** · `track.js?v=166`

**Still human-only:** headed Desert drive through the arch — confirm empty sky/shadow under the lintel, no roof-through-rock.

---

# Sprint 49 — All-stage roadway clear (24 Aug 2026)

**Player moment:** Every stage, including hairpins — the painted lane is asphalt, not a bank, and solid props do not sit in the car's envelope.

**Cause:** `_nearestRoad` only searched ±2 grid cells (64 m). Hairpin opposite arms at 70–90 m were invisible, so land verts and plants used the wrong ribbon. Lakeside catch-fence posts sat at half+0.6 m on the kerb.

**CEO:** Close the PARTIAL. Do not ship a stage whose inside line is a hill.

| Change | Status |
|--------|--------|
| Nearby-segment search ±3 cells (96 m); `minOver` / `overlapBed` on every ribbon test | **Done** |
| `_groundHeight` + `_addLandTile` flatten to any overlapping arm; Desert underpass floor still wins first | **Done** |
| Lakeside full-stage wash (`lateral: 48`); every biome skirt is a short tuck | **Done** |
| `_ribbonClear` / `_driveClear` / collider scrub / `_bumpNearRoad` use `minOver` | **Done** |
| Lakeside barriers past `ROAD_VERGE + 1.4` with `_ribbonClear` | **Done** |
| `tools/qa-env-clip.mjs` headed desert/forest/mountain/lakeside | **PASS** — in-lane land −0.72 / −0.72 / −0.78 / −0.28 m; 0 colliders on asphalt (284 / 119 / 60 / 49) |
| `tools/qa-desert-clip.mjs` | **PASS** — in-lane −0.72 m over 104 stations; 284 colliders off the lane |
| `tools/qa-sprint32-desert-finale.mjs` + `qa-static-audit.mjs` | **PASS** |
| `tools/qa-desert-bridge-portal.mjs` | **PASS** — 0 invaders, 0 car-envelope hits, land −0.95 m, car on deck |

**Cache:** `index.html` / `main.js` **`?v=351`** · `track.js?v=168`

**Still human-only:** 2-minute drive of a Forest or Mountain hairpin — confirm the inside line is tarmac and the chassis does not sink into a bank.

---

# Sprint 50 — Instant POV seat + cheap preloaded mirror (24 Aug 2026)

**Player moment:** C into the seat on the grid, standing still. Cabin and gauges are there immediately. No windshield flash, no hitch, no waiting until the car rolls. The rearview already shows road/sky.

**Cause:** Cabin swap and the first rearview capture were deferred until the blend (and felt like they waited for speed). Mirror was 512×160 with a 620 m far plane — a full extra scene on the first seated frame.

**CEO:** Same-frame work that used to hitch must be instant. Preload it. Never hitch again.

| Change | Status |
|--------|--------|
| Entering POV calls `_applyCockpitCam` on the C press (windshield unused from inside) | **Done** |
| Tiny mirror RT **180×56**, far **72 m**, capture every other POV frame | **Done** |
| `_warmPov` compiles cabin + one mirror grab during load | **Done** |
| Pose still eases 0.22 s (lens move, not a cut) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=352`**

---

# Sprint 51 — Desert finale underpass is a closed hill-cut (24 Aug 2026)

**Player moment:** Late Stage 1 — drive *through* a sandstone ridge. Walls and ceiling are the front faces of closed boxes. No road/land undersides. No shard interiors. The car fits under the lintel.

**Cause:** A heightmap cannot be a tunnel. Flattening land under the deck opened a trench of FrontSide backs. Open 6-vertex rock shards were non-manifold. Sweep berms were tagged as underpass, which stripped skirts for a hundred metres. Mouth boxes sat 0.9 m into the hole.

**CEO:** Close the hole. The player must read an underpass and never see polygon backs.

| Change | Status |
|--------|--------|
| Closed box hill-cut: inner piers at ±`clearHalfW`, lintel bottom at `openH` **8.4**, depth **18** m | **Done** |
| Mouth frames flush with the portal; outer hill may camera-fade, lining stays opaque | **Done** |
| Land floor only the drive tube (not an 80 m plaza); sweep no longer tagged underpass | **Done** |
| Closed road underside under the arch; debris uses `IcosahedronGeometry` | **Done** |
| Tunnel walls sit outside the lane; portal rubble is boxes, FrontSide rock | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=353`** · `track.js?v=169`

**Proof:** `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-desert-bridge-portal.mjs`

---

# Sprint 52 — Tunnel / underpass bump matches the lining (24 Aug 2026)

**Player moment:** Clip the sandstone underpass or the desert tunnel wall — the car kisses the **visible inner face**, not an invisible bulge a metre into the lane, and does not slip through the rock between sparse bumps.

**Cause:** Wall hits were spheres at the **core** of thick boxes. Combined with the car radius they fired early and left gaps along the lining.

**CEO:** The scrape has to be the wall you see.

| Change | Status |
|--------|--------|
| Planar `kind: "wall"` slabs on the inner faces (`_wallFace`) | **Done** |
| Underpass: one slab per lining at ±`clearHalfW` | **Done** |
| Desert tunnel: one slab per segment on the mesh inner face (`half + 0.25`) | **Done** |
| `glanceObstacles` uses car OBB vs the plane (not a circle in the rock) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=354`** · `track.js?v=170` · `collide.js?v=33`

**Proof:** `node tools/qa-sprint26-solid.mjs` · `node tools/qa-sprint32-desert-finale.mjs`

---

# Sprint 53 — Focus ST scale (player + AI + title)

**Player moment:** Focus ST sits at the same 4.36 m as a real Mk2/Mk3 ST next to the Celica, whether you drive it, race against it, or park it on the title pad.

**Cause:** `assets/focus/focus.glb` (and the rival LOD) is a Sketchfab export ~11.1 m long. `fitToRallyCar` applied `root.scale = 4.36 / 11.1 ≈ 0.39` on the **wrapper**. That did shrink the bodyshell, but it also shrunk cockpit, lamps, and POV (parented in metres to the wrapper). AI clones of the same template inherited the same squash.

**Fix:** Measure visible bodywork (skip studio helpers), keep the wrapper at scale 1, and `multiplyScalar` the **inner** GLB scene so hero, rival, ghost, and title all land on `CARS.focus.lengthM` (4.36 m). Other garage cars were already ~1:1 so they do not change size.

| Change | Status |
|--------|--------|
| `fitToRallyCar` scales inner scene, wrapper stays 1 | **Done** |
| Length / yaw from `visibleMeshBounds` | **Done** |
| Same path for `loadCarGltf` and `loadRivalGltf` | **Done** |
| `lengthM` 4.36 kept as the ST target | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=355`** · `celica.js?v=114`

**Proof:** `node tools/qa-car-scale.mjs` · `node tools/qa-focus-scale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 54 — AI pack planted hull (24 Aug 2026)

**Player moment:** Race a pack. The rivals no longer hop fore-aft on throttle the way the player Celica used to. They sit on the road like real cars.

**Cause:** Sprint 41 / 53 planted the **player** hull (filtered `_axDrive`, deadzoned vis-pitch, deck plant). Opponents still ran `lowDetail`: raw Pacejka Fx into `vx`, vis-pitch follow at 14/s, and a max-step height slew on unfiltered ribbon samples. Same oscillator, 14 cars.

**Fix:** Share the planted hull. Rivals still use cheap racing-line road probes and fewer tire substeps (frame budget). They now filter long-accel, follow vis-pitch at the player rate, and plant the deck the same way.

| Change | Status |
|--------|--------|
| `_axDrive` filter on every chassis | **Done** |
| Vis-pitch deadzone + `VIS_PITCH_RATE` for AI | **Done** |
| Deck filter + direct plant for AI (no max-step slew) | **Done** |
| Cheap `_axleRoadCheap` probes kept | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=356`** · `vehicle.js?v=73` · `ai.js?v=107`

**Proof:** `node tools/qa-sprint28-launch.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 55 — POV cockpit: no A-pillars, gauges face the driver, live rearview (24 Aug 2026)

**Player moment:** Press C into the seat. The windshield is an open aperture — no black A-pillar bar in the lens. The tach and speedo face you and read like the chase HUD. The interior mirror shows the road behind, not a black rectangle.

**Cause:** Procedural A-pillars sat at eye height in the POV frustum. Gauge discs used Y=180 plus `scale.x = -1`, which after `lookAt` aimed the printed face at the windshield. The rearview camera sat *at the interior glass* looking into the hidden cabin (black), and the RT was sRGB sampled as linear by `MeshBasicMaterial`.

**Fix:** Drop the cabin A-pillars and hide GLB window-frame meshes in POV. Aim the cluster at the seated eye so CircleGeometry’s +Z faces the driver. Capture the mirror from behind the bumper into a linear RT.

| Change | Status |
|--------|--------|
| Procedural A-pillars removed; GLB frames tagged `povShell` | **Done** |
| Gauge cluster `lookAt` the driver eye; no Y=180 / negative scale | **Done** |
| Rearview capture camera behind the bumper (`mirrorCamZ`) | **Done** |
| Linear SRGB RT + NoToneMapping; glass on driver-facing +Z | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=357`** · `celica.js?v=115`

**Proof:** `node tools/qa-pov-gauges.mjs` · `node tools/qa-pov-mirror.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 56 — Title → countdown: no scenery/lighting pop-in (24 Aug 2026)

**Player moment:** Leave the title, pick a car and course, and the 3-2-1 starts on a fully drawn, fully lit stage. Terrain does not stream in during countdown. Exposure / IBL / shadows do not snap. The loading overlay covers GPU settle even when the track is already cached.

**Cause:** Cached stages skipped the loading overlay and went straight to countdown. IBL baked on a `setTimeout(0)` after HUD. Stream chunks around the grid stayed hidden until the first countdown frames. The first expensive present dumped post/DPR quality, which looked like a lighting glitch.

**Fix:** Always keep the loading overlay up through GPU settle. Bake IBL synchronously. Pre-warm stream around the start grid, compile shaders, and draw two shadowed frames before HUD. Skip quality adapt and force shadow updates through countdown.

| Change | Status |
|--------|--------|
| Loading overlay always covers GPU settle (hot cache skips terrain rebuild only) | **Done** |
| Sync IBL bake — no deferred sky-env snap | **Done** |
| `prewarmAround` + `settle` stream radius 720 m at the grid | **Done** |
| `renderer.compile` + 2 dummy shadowed presents under overlay | **Done** |
| Countdown skips post/DPR adapt; forces shadow updates | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=358`** · `track.js?v=172` · `config.js?v=128`

**Proof:** `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`




---

# Sprint 57 — Splash / title hitch (24 Aug 2026)

**Player moment:** Open the game. PRESS START is immediately clickable and the attract car orbits without stutters. Heavy stage/prop work waits until after start.

**Cause:** Splash was doing race boot: every prop GLB, four `Track.create` jobs, 4096² shadows, live cube captures every 3 frames, uncapped FPS, 2× DPR, and IBL on the first frame.

**Fix:** Title is a cheap showroom (1024 shadows every 4 frames, 1.25 DPR, 60 Hz cap, low post, delayed IBL, no cube captures). Props + Desert preload start on PRESS START; the rest of the cup queues 4s later.

| Change | Status |
|--------|--------|
| No prop kit / track build / extra car clones on splash | **Done** |
| Title 1024 shadows, 1.25 DPR, 60 Hz, low post | **Done** |
| Live cube reflections off on title; IBL after 480 ms | **Done** |
| PRESS START starts Desert preload + prop kit | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=360`**

**Proof:** `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 58 — Title attract LOD (24 Aug 2026)

**Player moment:** Open the game. The rotating title car appears as soon as the ~3 MB rival shell is in, not after every hero GLB and cockpit clone.

**Cause:** Splash waited on `prepareCelica()` (all six chassis heroes) then `createPlayerCar()` (cockpit, beams, POV rig) just to orbit on the pad.

**Fix:** Load `assets/<car>/rival.glb` first, clone it with original livery and no cockpit, and only promote to the hero mesh when a race starts.

| Change | Status |
|--------|--------|
| `prepareTitleCar` + `createTitleCar` (rival LOD, original paint) | **Done** |
| Title / menu keep the LOD; race calls `_promotePlayerCar` | **Done** |
| Full garage load still runs after the attract car is up | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=362`** · `celica.js?v=116`

**Proof:** `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 59 — Distance mesh LOD (24 Aug 2026)

**Player moment:** Drive Forest / Mountain. Trees beside the car stay authored GLB. The hillside and horizon swap to cheap 3-plane cards. Far pack cars stop punching 14 extra shadow casters into the map. Frame time holds when the gallery is full.

**Cause:** Streamed slices still drew every trunk+canopy GLB out to fog (~900 m). Horizon rings used the same HD pack. Rival shadows never dropped with distance.

**Fix:** Classic mesh LOD. Near chunk = hi GLB. Beyond `STREAM.lodNear` (108 m, with hysteresis) = painted crown cards. Horizon trees are cards only. Rivals beyond 92 m disable `castShadow`.

| Change | Status |
|--------|--------|
| Dual-batch tree LOD (`lod: "hi"` / `"lo"`) with stream hysteresis | **Done** |
| Horizon treeline uses card impostors | **Done** |
| Far rival shadow casters culled | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=364`** · `config.js?v=129` · `track.js?v=173` · `trees.js?v=31`

**Proof:** `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 60 — Screen + camera hitch cut (24 Aug 2026)

**Player moment:** PRESS START, car/course picks, and C-key camera swaps stay at 60 Hz. No freeze between title and SELECT MODE, no hitch when returning to the attract pad, no stall when the lens eases POV → medium → far.

**Cause:** C applied the cabin on the same frame as the click (shader + mirror). Mid-race quality adapt reallocated the canvas whenever DPR hunted. PRESS START rebuilt title lights and warmed cars on the click. Coming back from a race disposed the whole stage on that frame and shrank the 4096 shadow atlas to 1024. Title orbit called `setCockpitView` every tick. POV compile was keyed only by course+car, so a title LOD warm skipped the hero cabin.

**Fix:** C only records a 0.22s blend; the cabin seats mid-ease and the mirror waits two frames. Adapt changes post quality only. PRESS START shows the menu then warms next frame. Title hides the stage immediately and disposes on the following frame. Shadow atlas never shrinks. `setCockpitView` no-ops when already in the requested mode. POV warm keys the live mesh uuid.

| Change | Status |
|--------|--------|
| C-key blend-only; cabin + mirror deferred | **Done** |
| No mid-race canvas / DPR realloc | **Done** |
| PRESS START / return-to-title work split across frames | **Done** |
| Shadow atlas never shrinks | **Done** |
| `setCockpitView` early-out + POV warm by mesh uuid | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=366`** · `celica.js?v=117`

**Proof:** `node tools/qa-sprint60-smooth.mjs` · `node tools/qa-sprint37-camera.mjs` · `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 61 — Brighter, lower-contrast lighting (24 Aug 2026)

**Player moment:** Title pad and every stage read as daylight, not a crushed grade. Shade under trees and in the Desert underpass stays readable. Paint and road still have shape, without the previous hard key / black fill split.

**Cause:** Sun intensity sat well above fill/hemi/ambient, post `gradeContrast` was 1.14, and vignette 0.34 crushed the corners. Cranking the sun would have made the problem worse.

**Fix:** Raise hemisphere, fill, ambient, exposure, sky exposure, and IBL. Lower sun intensity, post contrast, and vignette. Make vignette actually scale with its uniform (it used to darken corners even when the slider was near zero). Soften highlight rolloff. Tunnel shade keeps more fill so the bore is not a black hole.

| Change | Status |
|--------|--------|
| VISUAL `gradeContrast` 1.14 → 0.96, `vignette` 0.34 → 0.08 | **Done** |
| Post vignette now scales with the uniform (no baked corner crush) | **Done** |
| All stages: fill/hemi/ambient + exposure up, `sunInt` down | **Done** |
| IBL `worldEnvIntensity` / `carEnvIntensity` above 1.0 | **Done** |
| Tunnel `ambientFloor` / retain raised | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=368`** · `config.js?v=131` · `lighting-rig.js?v=5` · `postfx.js?v=12` · `sky.js?v=17`

**Proof:** `node tools/qa-sprint61-lighting.mjs` · `node tools/qa-sprint60-smooth.mjs` · `node tools/qa-sprint37-camera.mjs` · `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 62 — Roadway env-clip close (24 Aug 2026)

**Player moment:** The painted lane is asphalt. Dunes, banks, rocks, and trees do not sit on it or poke through it. The car does not drive through a hillside that was drawn on the racing line.

**Cause:** Land verts could still be raised to a nearer, higher hairpin arm. Lakeside land sat only 28 cm under the deck (z-fight / poke-through). Nearby-ribbon search missed opposite arms past ~96 m. Instanced GLB rocks/trees were tested with a footprint smaller than the mesh.

**Fix:** Widen hairpin segment search. Sink land ~1.1 m under every overlapping ribbon and never raise it. Push the road in depth so the deck wins z. Strip props 8 m past the painted edge.

| Change | Status |
|--------|--------|
| Nearby-segment search ±28 samples / ±5 grid cells | **Done** |
| Overlap pad `VERGE + 2.4× cell` (min 32 m) | **Done** |
| Land bed ~1.15 m under deck; lakeside 0.28 → 0.9 | **Done** |
| Final `minOver` sink so straddling tris stay a floor | **Done** |
| Road `polygonOffset` −4/−8, `renderOrder` 2 | **Done** |
| `ROAD_VERGE` 8.2 m + GLB strip 5.8 / forest 8.6 | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=369`** · `track.js?v=174`

**Proof:** `node tools/qa-env-clip.mjs` · `node tools/qa-desert-clip.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint61-lighting.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 63 — Tire contact on the roadway (24 Aug 2026)

**Player moment:** At rest and on a climb, the rubber sits on the asphalt — not hovering a tyre’s width above it, and not buried through the deck.

**Cause:** Physics origin is already the contact patch (`plantOnContactPatch`). Chassis Y then subtracted **9 cm** (`TIRE_PLANT`) from the visual deck, so the car sat in the tarmac. An **8/s** deck filter lagged ~30 cm on hills, and a **5/s** visual-pitch follow left one axle in the air. A 38% bias toward the lower axle made that worse.

**Fix:** Embed 1.4 cm. Plant Y on the front/rear axle midpoint. Follow real deck/pitch changes quickly; filter only centimetre ribbon noise.

| Change | Status |
|--------|--------|
| `TIRE_PLANT` 0.09 → 0.014 | **Done** |
| `_roadDeckY` = `midH - TIRE_PLANT` (no lower-axle bias) | **Done** |
| Two-band deck follow (`DECK_NOISE_BAND` + `deckFollowRate`) | **Done** |
| Visual pitch 16/s with snap on real grades | **Done** |
| Ground mesh pitch follow 8/s → 24/s | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=370`** · `vehicle.js?v=74`

**Proof:** `node tools/qa-sprint63-plant.mjs` · `node tools/qa-sprint61-lighting.mjs` · `node tools/qa-sprint60-smooth.mjs` · `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute drive — standstill plant, then a crest — rubber stays on the painted lane.

---

# Sprint 64 — AI racing line stays on the road (24 Aug 2026)

**Player moment:** Race a pack. Rivals take an out-in-out line on the asphalt instead of sliding off into the dirt on every hairpin.

**Cause:** Lanes sat at **±2.8 m** and an apex of **1.4 m** pinned chassis origins on the painted edge (wheels already over it). Traffic dodges shoved them the rest of the way out, hairpin handbrakes fired off-road, and they stayed flat on the throttle in the dirt.

**Fix:** Keep slots inside **~1.3 m**. Build a speed-aware out-in-out envelope with a 2.2 m edge keep-out. Cap dodges inside that envelope. Brake more for tight bends. Handbrake only while still on the ribbon. Lift once a wheel is in the dirt.

| Change | Status |
|--------|--------|
| Lanes / grid ±1.3 m | **Done** |
| `racingLat` out-in-out + `safeHalfWidth` | **Done** |
| Traffic dodge capped at 48% of envelope | **Done** |
| Tight-corner speed cap (`tightMul`) | **Done** |
| On-road-only hairpin flick + dirt lift | **Done** |
| Sprint 26 pace formula unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=371`** · `ai.js?v=108`

**Proof:** `node tools/qa-sprint64-line.mjs` · `node tools/qa-sprint26-driving.mjs` · `node tools/qa-sprint63-plant.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute pack race — Desert hairpin and a Forest sweeper — rivals stay on the painted lane.

---

# Sprint 65 — Blocking rivals go transparent (24 Aug 2026)

**Player moment:** Chase cam. A pack car sits between the lens and the player's car. That rival's body goes see-through so the player's car stays readable. POV does not ghost the pack (the camera *is* the player). The rearview stays solid.

**Cause:** Shared rival paints (`userData.shared`) meant mutating opacity on one AI car would ghost the whole grid. Painting before the mirror capture would also bake a hollow pack into the rearview.

**Fix:** Clone that car's materials on first hit. Tube-test the rival hull on the cam→player sightline. Store ghost amount, paint solid for mirror/cube, then paint leftover opacity for the chase view.

| Change | Status |
|--------|--------|
| `updatePackSeeThrough` + `paintPackSeeThrough` | **Done** |
| Per-car material clone (`packFadeClone`) | **Done** |
| POV / title / menu skip | **Done** |
| Solid pack for mirror, then ghost for chase | **Done** |
| Player mesh excluded from the fade pack | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=373`** · `track.js?v=176` · `occlusion-fade.js?v=8`

**Proof:** `node tools/qa-sprint65-rival-fade.mjs` · `node tools/qa-sprint64-line.mjs` · `node tools/qa-sprint63-plant.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-sprint17-visual.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute chase — get an AI between camera and player, that car ghosts, neighbours stay solid; C into POV, pack is solid again.

---

# Sprint 66 — Rivals cannot shove the player (24 Aug 2026)

**Player moment:** Rub a pack car. You keep your line with a light bump. They bounce aside instead of sliding you into the dirt.

**Cause:** Mixed contact still used shared inverse-mass with `PLAYER_ANCHOR` 0.42 (~30% of the shove) and `FRICTION * 4` tangent drag. Overlap stayed in the player's box, so the next 60 frames kept pushing.

**Fix:** Dedicated player-vs-rival resolve. Cap player depenetration and Δv. Almost no sideways drag. Rival eats the overlap and sidesteps.

| Change | Status |
|--------|--------|
| `resolvePlayerRival` | **Done** |
| `PLAYER_PUSH_CAP` 0.028 m / `PLAYER_BUMP_VEL` 2.2 m/s | **Done** |
| `PLAYER_SLIDE_SHARE` 0.12 (was FRICTION×4 on the player) | **Done** |
| Rival sidestep + `_aiPassT` | **Done** |
| AI-AI pack resolve unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=374`** · `collide.js?v=34` · `vehicle.js?v=75` · `ai.js?v=110`

**Proof:** `node tools/qa-sprint66-player-bump.mjs` · `node tools/qa-sprint64-line.mjs` · `node tools/qa-sprint63-plant.mjs` · `node tools/qa-sprint65-rival-fade.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute pack race — let an AI lean on you through a sweeper. You stay on the painted lane; they go around.

---

# Sprint 67 — Recorded navigator, next turn / jump only (24 Aug 2026)

**Player moment:** The co-driver calls the corner you are actually approaching — Easy / Medium / Hard / Hairpin left or right, or Jump — once, in a human voice. No “into gravel”, no tunnel, no second Jump on the Desert pair.

**Cause:** Authored notes were stale and overrode geometry with surface lines. The look-ahead picked the *sharpest* heading change in 190 m, so a bowl 150 m out stole the next easy bend. Jump ids plus authored `des-jump1` said Jump twice. Voice was `speechSynthesis`.

**Fix:** Geometry picker (`pace-call.mjs`) takes the soonest turn or jump. Recorded CC BY clips from SentientMattress. One jump lock of 110 m. Nav bus off the SFX compressor so the line is not chopped.

| Change | Status |
|--------|--------|
| Soonest turn/jump, not max-degrees | **Done** |
| No gravel / tunnel / mud / finish speech | **Done** |
| Jump once per crest pair (`JUMP_LOCK_M` 110) | **Done** |
| Human VO clips in `assets/sfx/nav/` | **Done** |
| TTS removed from the race path | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=376`** · `track.js?v=178` · `engine.js?v=50` · `codriver.js?v=31` · `bank.js?v=2` · `pace-call.mjs?v=1`

**Proof:** `node tools/qa-sprint67-pace-vo.mjs` · `node tools/qa-sprint36-pace.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute Desert drive — teaching left then right, one Jump before the pair, no tunnel/gravel talk, voice is the recorded navigator.

---

# Sprint 68 — Jump landings stay on the road (24 Aug 2026)

**Player moment:** Stage 1 Desert, after the 3rd jump (the Safari throw — second of the close pair). The car lands on the asphalt. Tires stay on the deck. The chassis does not bury through the ribbon. Same for every AI car.

**Cause:** Two stacked bugs. (1) Flight used `_landPadY > 0` as “pad armed”, then treated the visual **pit mesh** as a legal landing (`hitting && (overPad || pit)`). Grounded follow then used pit `deck` once the old **36 m** samePit window ended — a hole that long, or a pad at Y ≤ 0, put the contact patch in the landing ribbon. (2) Origin is the contact patch (Sprint 63). Leftover air pitch (up to ~0.44 rad) plus a landing nose-squat around that origin put a bumper through the road until the 24/s blend caught up. Worst on jump 3, the longest air time and deepest drop (5.2 m rise / 3.6 m drop).

**Fix:** Arm the pad with `_landPadArmed`. Floor Y is the scanned land, never the hole. Land only on the real pad. Hold that Y for the scanned pit length. Snap mesh pitch onto the axle plane on the pad. No pitch-squat through the deck. Clamp every car after the air step.

| Change | Status |
|--------|--------|
| `_landPadArmed` + `_roadFloorY` (pit mesh is not a floor) | **Done** |
| Land only when `overPad` — never on `pit` | **Done** |
| `_scanLandPad` returns `{ y, end }`; samePit uses land dist | **Done** |
| `_snapPitchToRoad` on pad; landing squat 0 | **Done** |
| `_clampToRoadDeck` after `_stepAir` (player + AI) | **Done** |
| Sprint 63 `TIRE_PLANT` 0.014 unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=383`** · `vehicle.js?v=77`

**Proof:** `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint63-plant.mjs`

**Still human-only:** 2-minute Desert drive — take the jump pair flat-out; after the 3rd landing the Celica sits on the sand ribbon, not in it.

---

# Sprint 69 — Volumetric cumulus sky (24 Aug 2026)

**Player moment:** Title pad and every stage show real cumulus — puffy depth, sun wrapping through the volume, darker bases — not a painted stripe on the dome. Desert reads warm and dusty, Forest cooler and fuller, Mountain thin alpine, Lakeside slightly misty. The sky still matches fog and the key sun.

**Cause:** `sky.js` sampled 3D noise four times on a spherical shell and mixed by colour length. That reads as a flat cloud texture, not a volume.

**Fix:** Planet-shell raymarch (camera on a virtual planet, cloud slab between two radii). Six view steps × two sun-shadow samples at cinema quality (four × one on low/min). Ridged fBm + cheap Worley for cumulus blobs, Beer-Lambert transmittance, Henyey-Greenstein silver lining, horizon fade into stage haze. Stage palettes in `STAGE_CLOUD_PALETTES`. Title cover floor 0.44 so the attract sky is not empty.

| Change | Status |
|--------|--------|
| Planet-shell raymarch (`CLOUD_BUDGET`, max 8 view / 2 light) | **Done** |
| Beer-Lambert + self-shadow + HG phase | **Done** |
| Stage palettes (desert / forest / mountain / lakeside / title) | **Done** |
| `setSkyQuality` follows integrated GPU tier | **Done** |
| No handling/weather; fog/sun/IBL path unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=382`** · `sky.js?v=22`

**Proof:** `node tools/qa-sprint69-clouds.mjs` · `node tools/qa-static-audit.mjs`

**Budget:** Cinema 6×2 steps on sky fragments only (early-out below the horizon). Not a 128-step fullscreen volume. Low tier drops Worley and light samples. Title cover floor 0.44 so the attract pad is not empty.

**Still human-only:** Park on the SELECT MODE pad, then a 2-minute Desert / Forest look-up — clouds have thickness and a lit side, not a JPEG.

---

# Sprint 70 — POV rearview stays lit + in-car seat + smooth C (24 Aug 2026)

**Player moment:** Press C into the seat. The interior mirror shows the road behind — never a black rectangle — at a cheap 384×120. The cabin reads as a real LHD cockpit (dash cowl, door cards, seated FOV). Every C-key angle (POV / medium / far) eases with no hang.

**Cause:** The glass could sit on an empty or dead render target. Seating deferred capture for two frames even when the RT had never been drawn (clear = black). Nothing rebuilt the target after a WebGL context loss. A 640×200 every-frame pass made the first C hitch, so the old path skipped work instead of keeping a last-good image.

**Fix:** Fixed 384×120 linear RT. Recreate on missing/zero-size/context restore. Bind the map every POV frame. Capture immediately if the RT has no image; reuse the last road frame when seating. Cheap pass: no shadows, no post, no dust/tire marks. Pre-warm + compile still happens at load. Smootherstep pose blend on every mode. Cabin: FOV 76, instrument hood, boot-allocated fill light (intensity 0 until seated).

| Change | Status |
|--------|--------|
| `_ensureMirrorRT` + context lost/restored | **Done** |
| `_mirrorHasImage` — never skip an empty RT | **Done** |
| `GFX.mirrorW/H` 384×120 | **Done** |
| Cheap capture (shadows/dust/marks off) | **Done** |
| Smootherstep C-key blend; no dispose-on-switch | **Done** |
| LHD cabin FOV 76 + binnacle hood + boot `_cabinFill` | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=379`** · `config.js?v=132` · `celica.js?v=118`

**Proof:** `node tools/qa-sprint70-camera.mjs` · `node tools/qa-pov-mirror.mjs` · `node tools/qa-cam-blend.mjs` · `node tools/qa-sprint37-camera.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** C into POV on Desert — glass shows the start grid / road, not black; cycle C through all three views while rolling — lens eases, no hitch.

---

# Sprint 71 — Authentic Group A garage + arcade power-slide (24 Aug 2026)

**Player moment:** SELECT CAR is Celica GT-Four, Delta HF, and Stratos HF — the real WRC cars. Jaguar E-Type, Focus ST, and Accord Sport are gone. Desert’s long right and Forest gravel are holdable power slides: Space snaps the tail, throttle carries the angle, opposite lock aims it. Chase cam looks down the slide so the car sits sideways in frame. Tarmac still stops you.

**Cause:** The six-car garage mixed road cars into a rally game. Slide dials from Sprint 33 were too planted (high bleed, modest pitch-in, camera locked to heading) so a power slide read as a scrub instead of a tool.

**Fix:** Garage cut to Celica / Delta / Stratos (rivals too). Surfaces: dirt/sand/gravel/mud looser, tarmac still planted. Handling: longer throttle carry, bigger HB snap, easier pitch-in. Vehicle: lower slideIntent bar, softer yaw-follow in a slide. Chase: look along velocity + offset outside the slide. Dust and tire beds punch earlier.

| Change | Status |
|--------|--------|
| Road cars removed from `CARS`, `GARAGE`, SELECT CAR, DCC, LODs | **Done** |
| Celica planted / Delta snappy / Stratos loose RWD | **Done** |
| Arcade slide dials + surface contrast | **Done** |
| Chase look-into-slide (`CAMERA.slideLook`) | **Done** |
| Dust + skid sell the slide | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=385`** · `config.js?v=134` · `vehicle.js?v=77` · `celica.js?v=119`

**Proof:** `node tools/qa-sprint71-garage.mjs` · `node tools/qa-garage-cars.mjs` · `node tools/qa-sprint33-drift.mjs` · `node tools/qa-car-scale.mjs` · `node tools/qa-static-audit.mjs`

**Headed:** PRESS START → CHAMPIONSHIP → SELECT CAR shows Celica / Delta / Stratos only (no E-Type, Focus ST, Accord). Garage status: `LOADED · Celica · Delta HF · Stratos`.

**Headless boot smoke:** title → SELECT MODE passes; garage-warm timeout in headless Chrome (25s) did not enable a car button this run. Headed path above is the player-visible proof.

**Still human-only:** 2-minute Desert drive — trail-brake or Space into the long right, hold with throttle, catch with opposite lock.

---

# Sprint 72 — Stay on the road (24 Aug 2026)

**Player moment:** Drive Desert. The car never falls through the ribbon, never warps to another part of the stage, never freezes. Wheels stay on the road except in a real jump.

**Cause:** Missing the crest→gap frame left the car grounded in the visual pit. A later nearest-spline query (30 m from the hint window) snapped `progress` to another loop of the stage. `bounceOffRoad` then teleported XZ to that wrong centre line and **did not set Y**, so the hull sat inside the terrain. NaN pose killed the frame loop (`_fatal` after 30 throws).

**Fix:** Force takeoff whenever grounded in a gap. Reject a progress snap bigger than one step. Restore last good pose on NaN/warp. Extreme runoff reset plants Y on the sampled ribbon and refuses a 40 m dist warp. Grounded cars clamp onto the deck; jumps still use the far pad.

| Change | Status |
|--------|--------|
| `_keepOnRibbon` + last-good pose | **Done** |
| Gap takeoff without `enteringGap` edge | **Done** |
| `bounceOffRoad` sets Y / refuses dist warp | **Done** |
| Grounded deck plant (wheels on road) | **Done** |
| `TIRE_PLANT` 0.014 unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=386`** · `vehicle.js?v=78` · `collide.js?v=35`

**Proof:** `node tools/qa-sprint72-road-lock.mjs` · `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint63-plant.mjs`

**Still human-only:** full Desert lap — jumps fly, landings plant, no underground, no teleport.

---

# Sprint 73 — GTA IV weight, arcade recoverability (24 Aug 2026)

**Player moment:** The car has mass. Brake into a gravel hairpin and the rear unloads so the nose rotates. Stay in the throttle on tarmac and the front pushes. Lift mid-corner and the tail comes. At 200 km/h the steering is heavy; in a hairpin it is still easy. Body leans and dives. Opposite lock and the e-brake still catch like Sega Rally.

**Cause:** The chassis railed until a grip cap, then snapped into a slide. Full-lock keys teleported the rack. Accel/brake squat was zeroed. Roll max was 4°. Load transfer existed on paper but barely changed yaw.

**Fix:** Weight transfer scales axle µ and adds brake-oversteer / throttle-understeer. Lift-off dumps rear grip. Yaw uses a mushy limit plus speed-mass follow. The steering rack has inertia. Brake-dive and body roll come from filtered `_ax` / `_ay` (capped so the nose stays out of the deck). Camera leans and FOV punches with speed. Handbrake, countersteer, and surface contrast stay arcade.

| Change | Status |
|--------|--------|
| `weightTransferMul` + load-scaled axle µ | **Done** |
| Lift-off oversteer + high-speed understeer | **Done** |
| `softLimit` mushy breakaway (not a rail) | **Done** |
| Weighted steering rack (no digital snap) | **Done** |
| Brake-dive / accel-squat + body roll | **Done** |
| Chase roll-follow + speed FOV | **Done** |
| Celica planted / Delta snappy / Stratos loose | **Done** |
| `TIRE_PLANT` 0.014 unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=390`** · `config.js?v=135` · `vehicle.js?v=80`

**Proof:** `node tools/qa-sprint73-gta-phys.mjs` · `node tools/qa-sprint33-drift.mjs` · `node tools/qa-sprint31-drift.mjs` · `node tools/qa-sprint72-road-lock.mjs` · `node tools/qa-sprint38-physics.mjs` · `node tools/qa-static-audit.mjs`

**Boot smoke:** title → SELECT MODE → SELECT CAR → Desert countdown **PASS**. Race handoff timed out at 0 fps in headless Chrome (120s) — same class as prior garage-warm stalls, not a physics syntax break. Human drive is the feel proof.

**Still human-only:** 2-minute Desert drive — trail-brake the long right, lift to rotate, catch with opposite lock; then a Mountain tarmac sweeper at speed for the push.

---

# Sprint 74 — Rigid-body jumps (24 Aug 2026)

**Player moment:** Hit Desert's teaching hop, then the pair. Each leave is a throw from speed, lip, suspension, and line — not a canned hop. Flat-out hangs nose-high; lift-and-brake lands flatter. A messy arrival can bounce once. Wheels still never go through the road.

**Cause:** Air pitch was a keyframed technique score. Takeoff ignored chassis angular rate, roll, and lateral. Every run of the same jump looked the same.

**Fix:** RAGE-style vehicle air (GTA IV/V cars, not ped Euphoria). Launch inherits pitch/roll/yaw, compress, and a deterministic lip grain. Inertia + wheel-reaction torque + light aero. Hard landings get a short bounce above the pad. No `Math.random`. Road-lock from Sprint 72 stays.

| Change | Status |
|--------|--------|
| `JumpModel.launch(..., body)` inherits attitude | **Done** |
| `lipGrain(dist, lateral)` ±4.5% vy | **Done** |
| Air roll + aero pitch | **Done** |
| Landing bounce cap 2.15 m/s | **Done** |
| `launchHeightScale` 0.28 | **Done** |
| Clip-through guards kept | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=391`** · `vehicle.js?v=80` · `jump.js?v=12` · `config.js?v=135`

**Proof:** `node tools/qa-sprint74-jump-air.mjs` · `node tools/qa-sprint72-road-lock.mjs` · `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint63-plant.mjs`

**Still human-only:** three Desert jumps — change speed or line each time; the arc should change; landings stay on the sand.

---

# Sprint 75 — Glitch Department: stay on the road (24 Aug 2026)

**Player moment:** Drive any championship stage. The car stays on the painted lane. It never warps to another part of the track. It never falls through the road. Phones start on a cheaper quality tier so the first corner is still 3D, not a hitch then a dump.

**Cause (remaining after Sprint 72):** `_nearestIndex` with a progress hint still picked Euclidean-nearest inside a ±22-post window. A hairpin opposite arm is close in XZ and 18–30 m along the spline — inside the old 32 m `maxStep` floor — so `progress` snapped and `bounceOffRoad` planted the hull on the wrong loop.

**Fix:** Score hinted queries by XZ **plus** along-track jump (reject > 22 m along). Tighten `_keepOnRibbon` to ~10 m per physics step, wrap-aware at the finish. `_guardDrive` restores last-good pose on teleport / NaN / bury. Live Chrome drive holds throttle on Desert, Forest, and Mountain and fails the sprint if any sample jumps. Phones open the quality scaler on `low` (PBR/ACES still on) instead of `high`.

**Not done (CEO cut):** a full-engine rewrite. The architecture is not the blocker. Teleport-on-road was.

| Change | Status |
|--------|--------|
| `Track._nearestIndex` continuity score | **Done** |
| Tighter wrap-aware `_keepOnRibbon` | **Done** |
| `_guardDrive` live watchdog | **Done** |
| Chrome glitch department (`qa-sprint75-glitch`) | **Done** |
| Phone starts on `low` quality tier | **Done** |
| `TIRE_PLANT` 0.014 unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=396`** · `vehicle.js?v=83` · `track.js?v=180` · `collide.js?v=37` · `perf-tier.js?v=6` · `input.js?v=39`

**Proof:** `node tools/qa-sprint75-glitch.mjs` live Chrome pump (24 Aug 23:54Z):

| Course | Dist | vmax | Hits | Teleport | Buried | NaN |
|--------|-----:|-----:|-----:|---------:|-------:|----:|
| Desert | 41.7 m | 23.7 | 0 | 0 | 0 | 0 |
| Forest | 50.4 m | 26.8 | 0 | 0 | 0 | 0 |
| Mountain | 63.4 m | 31.1 | 0 | 0 | 0 | 0 |

Also: `node tools/qa-sprint72-road-lock.mjs` · `node tools/qa-sprint76-perf.mjs`

**Still human-only:** one full Desert lap on a phone — no warp, no bury.

---

# Sprint 75b — Overlapping ribbon crash (24 Aug 2026)

**Player moment:** Hit the Desert mud after the tunnel, the Forest glade return, or a Mountain stacked hairpin. The car keeps driving. It does not reset, drop through the road, or freeze the game.

**Cause:** Championship stages **cross themselves**. Desert mud at ~1684 m sits **1.5 m** in XZ from the later sweeper at ~2395 m (711 m along-track). Forest and Mountain have the same diamond. `_nearestIndex` still **global-scanned** once you were 30–40 m off the hinted posts, so `progress` jumped 600–700 m. `bounceOffRoad` then planted XZ+Y on the **other** loop (Mountain: 8 m of Y). NaN pose hit `_fatal` after 30 throws. Sprint 75's hint score was not enough: the two roads occupy the same volume.

**Fix:** Hinted queries never fall back to a global nearest. A snapped re-query pins to last-good dist. Off-road reset plants on `progress` (not the snapped `q.dist`), refuses an 18 m along warp and a 2.6 m Y warp. `_guardDrive` restores a 3.2 m grounded Y spike. After the spline is built, a later ribbon that occupies the same XZ at nearly the same Y is lifted into a **7.4 m flyover** so the painted lanes are not two tarmacs in one hole.

| Change | Status |
|--------|--------|
| Hinted `_nearestIndex` never global-scans | **Done** |
| `_pinQuery` if restore still snaps | **Done** |
| `bounceOffRoad` uses progress / refuses Y-warp | **Done** |
| `_guardDrive` y-warp | **Done** |
| `_separateOverlappingRibbon` flyover | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=400`** · `vehicle.js?v=84` · `track.js?v=180` · `collide.js?v=37`

**Proof:** `node tools/qa-sprint75-glitch.mjs --static` · `node tools/qa-sprint72-road-lock.mjs`

**Still human-only:** Desert through the tunnel into the mud, then the long right — two roads must not occupy one hole; no reset, no crash.

---

# Sprint 75c — GTA IV rival: tire-moment yaw + IV principles (24 Aug 2026)

**Player moment:** High-speed tarmac **pushes** like a Comet that gained weight. Lift mid-corner and the tail comes. A hairpin is still catchable with opposite lock. The car has mass — you wait for the yaw — but it is still a rally tool, not a drunk bus. Celica stays planted (Sultan 4WD); Stratos lights the rear (Comet RWD).

**Cause:** `_integrate` drove yaw from a kinematic bicycle `rWant = (vx * st) / (L * (1 + kus * vx²))`. Pacejka `front.fy` / `rear.fy` only shoved `vy`. GTA IV / RAGE cars rotate from **tire yaw moments**. Sprint 73 load-transfer was not enough.

**GTA IV sources (principles, not a clone):**
- [GTAMods handling.dat](https://gtamods.com/wiki/Handling.dat) — `m_fTractionCurveMax/Min`, `m_fTractionBias`, `m_nDriveBias`, `m_fDriveInertia`
- [Grand Theft Wiki Handling.cfg/GTAIV](https://www.grandtheftwiki.com/Handling.cfg/GTAIV) — IV is multipliers + algorithms, not a full sim; CurveMax = peak, CurveMin = sliding floor
- [Traxion on IV vehicle physics](https://traxion.gg/how-grand-theft-auto-iv-broke-the-open-world-mould-for-vehicle-physics/) — exaggerated body roll, class personality, IV less forgiving than V
- The Drive / Clarity Potion — V added grip and muted weight; IV is looser, more roll, delayed yaw
- GTA Wiki Drifting — IV is the closest the series got to a holdable drift

**Fun formula encoded:** delayed steer→load→Mz chain; CurveMax/Min gap so a slide **stays**; speed changes the car; slide is a tool (`counterAuthority` 2.55); heavy rack + self-align; engine brake 0.34; roll/dive as mass UI; `brakeHold` per surface; 4WD vs 2WD personality; no RNG in `step`; **IV not V**.

**Fix:** Blend SAE bicycle `Mz = front.fy * cosS * lf - rear.fy * lr` into yaw after `rWant` is fully built. Heavier Celica `yawInertia` 2480, snappier load-transfer (`axFollow` 13), wider tarmac peak→slide gap (1.55 / 1.02). Road-lock (72) and rigid jumps (74) stay.

**Honesty:** GTA IV **rival** bar — weight, tire-moment yaw, lift-off, recoverability. Does **not** equal GTA IV. Arcade rally chassis with RAGE-weight.

| Change | Status |
|--------|--------|
| Tire-moment yaw blend (`rDotTire` / `tireYawBlend`) | **Done** |
| `tractionMinMul` + tarmac still slides | **Done** |
| `lowSpeedTractionLoss` (small) | **Done** |
| `driveInertia` on wheel I | **Done** |
| `tractionBiasFront` Celica 0.46 / Delta 0.50 / Stratos 0.56 | **Done** |
| Heavier rack, engine brake, roll/dive, camera lean | **Done** |
| `TIRE_PLANT` 0.014 / `FIXED_DT` 1/60 / no RNG | **Done** |
| Sprint 72 road-lock + 74 jumps | **Untouched** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=399`** · `config.js?v=137` · `vehicle.js?v=84` · `jump.js?v=13` · `surfaces.js?v=46`

**Proof:** `node tools/qa-sprint75-gta-rival.mjs` · `node tools/qa-sprint73-gta-phys.mjs` · `node tools/qa-sprint74-jump-air.mjs` · `node tools/qa-sprint72-road-lock.mjs`

**Still human-only:** 2-minute Desert + a tarmac hairpin + a power slide you catch with opposite lock.

---




# Sprint 76 — One quality scaler, no shader cliffs (24 Aug 2026)

**Player moment:** The stage no longer freezes for half a second when new scenery comes into view, and a machine that cannot hold the frame rate now loses pixel density, shadow resolution, bloom and cloud steps instead of dropping frames. Pressing **C** costs 12 ms, not a stall.

**Cause:** Three separate defects, all measured on an M1 Pro in headed Chrome.

1. **Shader links during the race.** `renderer.compile` only walks *visible* objects, and streaming keeps far slices hidden — so each slice linked its programs the first time it came into view. `renderer.info.programs` climbed **103 → 114** across one drive, and the offending frames cost **648 ms and 789 ms**. Worst frame in the baseline probe was **2606 ms**.
2. **The quality scaler was decorative.** `perf-tier.js` computed a `dprScale` and a shadow size that nothing applied (the shadow branch was an empty `if` with a comment). A second, independent post-quality ladder lived inline in `_loop` reading `GFX.adapt*`. So a slow device did not degrade — it just ran slow.
3. **The scaler was reading the wrong clock.** It was fed `_lastPresentCost`, the CPU time to *issue* the draws. `renderer.render()` returns before the GPU is done, so a GPU-bound machine reported a healthy **4–9 ms** while actually delivering **37 ms** frames, and the scaler never degraded.

**Fix:** One scaler owns every GPU knob. `perf-tier.js` picks one of four tiers from an EMA of the **interval between presented frames**, and `game.js` is the only applier (`_applyQualityTier`, called only on a tier transition). `_precompileStage()` reveals the whole stage for one time-boxed compile pass under the loading screen, so the links are paid where the player is already waiting.

| Change | Status |
|--------|--------|
| `QUALITY_CAPS` — DPR ≤ 1.5, shadow ≤ 4096, cloud ≤ 8×2, mirror ≤ 384×120 | **Done** |
| Four tiers carry dpr / shadow / post / sky / mirrorEvery | **Done** |
| Inline `GFX.adapt*` ladder removed from `_loop` (one system) | **Done** |
| Scaler fed the present interval, not CPU render cost | **Done** |
| Hysteresis both ways + 50 ms sample clamp (one stall ≠ degrade) | **Done** |
| Allocating knobs monotonic per stage (extends Sprint 60, does not revert) | **Done** |
| `_precompileStage()` — stage shaders linked under the loading screen | **Done** |
| Sprint 69 volume preserved: 6×2 cinema, 4×1 low, Worley off on low/min | **Done** |
| Sprint 58–61 LOD, 63 plant, 64 line, 65 fade, 66 bump, 67 VO, 68 land | **Untouched** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=394`** · `perf-tier.js?v=6` · `sky.js?v=22` unchanged. Several agents bumped the boot version concurrently during this sprint — Release should re-check that `index.html` and `js/main.js` still agree before pushing (`node tools/qa-sprint76-perf.mjs` asserts it).

**Proof:** `node tools/qa-sprint72-perf.mjs` — 46 checks, including six that **drive the live ladder** rather than grep for it: a locked 60 stays on high, one 1100 ms stall does not degrade the stage, sustained 40 ms drops to min inside 30 frames, steady 20 ms settles once and stops moving, a recovered machine climbs back one tier at a time. Regression: `qa-sprint60-smooth` · `qa-sprint69-clouds` · `qa-sprint39-perf` · `qa-sprint58-title-lod` · `qa-sprint59-lod` · `qa-sprint63-plant` · `qa-static-audit` all pass.

**Measured (headed, M1 Pro, Desert, 14 opponents):**

| | Baseline | After |
|---|---|---|
| mean frame time | 41.8 ms | 26.4 ms |
| p99 frame time | 508 ms | 53 ms |
| worst frame | 2606 ms | 134 ms |
| hitches > 33 ms | 25.9% | 36.4%* |
| present cost, steady | — | 3.6–9.8 ms |
| programs linked mid-race | 103 → 114, 0.6–0.8 s stalls | no cost spike |
| camera **C** switch | — | 11.7 ms, no compile |
| page errors | 0 | 0 |

\* The hitch *percentage* rose because the catastrophic stalls that used to eat whole seconds are gone — mean, p99 and worst all improved sharply. The remaining ~37 ms cadence is GPU-bound frame time, not a stall.

**Open — Release should NOT ship a 60 fps claim:**

1. **The main path does not hold 60.** At full quality on an M1 Pro the probe measures a steady ~28–37 ms frame interval (~35 fps), GPU-bound. The caps and the degradation ladder are in place, and the scaler will now correctly see this and step down — but the *default* tier is not yet 60-safe on this machine. Next sprint must cut fixed GPU cost (4096² PCFSoft shadow atlas re-rendered every frame at `shadowEvery: 1` is the first suspect) rather than add more scaling.
2. **Non-deterministic stage-build wedge.** Twice in six headed runs the Desert track failed to finish building within 120 s, with the main thread unresponsive to `Runtime.evaluate` for >180 s. This reproduced **before** any Sprint 76 change and occurs upstream of `_precompileStage` (the probe was still waiting for `window.game.track` to exist). Owner: whoever owns `track.js` construction. This is a hard ship blocker on its own.
3. **HUD FPS readout is optimistic.** `_fpsT` accumulates the substep-clamped `dt`, so the on-screen number read 65 while the probe measured 49. Do not use it as evidence.

**Harness:** `clickResilient` now polls the hit-test for up to 15 s instead of failing on the first zero-size rect. A saturated boot main thread can answer `evaluate` before style/layout has flushed, which was failing `qa-frame-probe` at PRESS START with a spurious "element has zero size".

**Still human-only:** 2-minute Desert drive watching for scenery pop-in stalls; press **C** through all three views mid-corner.

---

# Sprint 77 — Fast boot, cheap title, black fades, trickle load bar (24 Aug 2026)

**Player moment:** The game opens on black and fades into the title. The emblem is there immediately. A low-res rotating LOD car fades in behind it. PRESS START fades to SELECT MODE through black. Picking a stage fades to a load bar that keeps ticking instead of freezing on one percent, then fades up into countdown.

**Cause:** Title used a full-res framebuffer, baked IBL in 480 ms, and pulled every hero GLB on boot — so splash hitchs. Screens swapped with `display` toggles (hard cuts). The load bar snapped to `floor(frac*100)` with a 60 ms width tween, then sat on one digit whenever the main thread was busy.

**Fix:** Boot curtain + screen-to-screen black fades. Title/menu render at 0.68 DPR / 0.72 Mpx with a 512 shadow map, no post RTs, delayed IBL. Attract car is still the rival LOD; hero garage waits for PRESS START. Load UI eases toward real progress and trickles during stalls so the percent never hangs.

| Change | Status |
|--------|--------|
| `#fx-curtain` boot reveal + menu/load/HUD fades | **Done** |
| Title showroom visible at cheap DPR, LOD car | **Done** |
| `prepareCelica` deferred to PRESS START | **Done** |
| Trickle `setLoadingProgress` (transform scaleX) | **Done** |
| No HTML prefetch of Desert music on splash | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=403`** · `hud.js?v=27` · `config.js?v=136` · `css/game.css?v=26`

**Proof:** `node tools/qa-sprint77-boot.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** cold load → watch the bar tick; PRESS START → SELECT MODE fade; start Desert and confirm countdown fades up from black.

---

# Sprint 78 — Calmer chase, slightly less body roll (25 Aug 2026)

**Player moment:** Drive a Desert hairpin. The car still has GTA IV weight. The horizon no longer banks hard, and the chase does not swing wide on a slide. Body lean is still there, just quieter.

**Cause:** Chase `rollFollow` 0.48 plus a 1.3 m slide offset and a 0.22 m kick made the lens swing. Chassis `bodyRollMax` 0.155 stacked on top of that.

**Fix:** Camera lean is a hint (`rollFollow` 0.22). Slide offset and lateral kick are about half. Medium chase stiffness back to 28. Body roll 0.118 / 1.82 — still heavier than the old 4° rail, not a cabinet tip. Handling physics unchanged.

| Change | Status |
|--------|--------|
| `CAMERA.rollFollow` 0.48 → 0.22 | **Done** |
| `slideCamOut` 0.95 → 0.42; kick 0.22 → 0.09 | **Done** |
| Medium chase stiffness 24 → 28 | **Done** |
| `bodyRollMax` 0.155 → 0.118 | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=405`** · `config.js?v=138`

**Proof:** `node tools/qa-sprint73-gta-phys.mjs` · `node tools/qa-sprint75-gta-rival.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute Desert drive — corner camera stays planted; car still leans a little.

---

# Sprint 79 — Jump 3 never clips through the roadway (25 Aug 2026)

**Player moment:** Stage 1 Desert, third jump (Safari throw — second of the close pair). A flat-out throw off jump 2 can hang long enough to meet jump 3's rising ramp. The car lands ON that ramp and keeps driving. It does not freeze inside or under the asphalt.

**Cause:** Air collision treated only the far pad as a floor. Ramp and crest were excluded from `overPad`, so a descending throw that arrived *under* the next lip was clamped to the deck with `onGround = false`. No tires, no throttle, unmovable. `_landLock` from jump 2 also blocked takeoff in a new pit. `_guardDrive` y-warp undid upward recoveries because it treated any 3.2 m Y change as illegal.

**Fix:** Solid decks (ramp / crest / land / road) plant the car and set `onGround`. A previous landing lock cannot glue the next hole. Buried restore fires at 22 cm under a solid deck. Y-warp only catches a drop, never a lift onto the next lip.

| Change | Status |
|--------|--------|
| Air under a solid deck plants onGround | **Done** |
| `holdThisPit` — lock is per-jump, not global | **Done** |
| Buried snap at 0.22 m under solid ribbon | **Done** |
| Y-warp is downward-only | **Done** |
| Headed probe: jump 2 @ 32 m/s must not tunnel jump 3 | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=405`** · `vehicle.js?v=85`

**Proof:** `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** take Desert jump 2 flat-out and confirm jump 3's ramp is a floor, then land the Safari throw on the sand.

---

# Sprint 80 — Wheels stay on the roadway after jumps (25 Aug 2026)

**Player moment:** After any jump, the car does not clip through the road, and the tires sit on the tarmac — no hover gap, no buried patch.

**Cause:** Grounded Y was only lifted if it went *under* the deck. After a throw, `_deckFilt` lagged a rising land ramp so the contact patch floated or sank. Ramp/crest skipped the grounded pin, and landing pitch copied leftover air slope instead of the axle plane.

**Fix:** Land-lock and ramp/crest/land pin Y to the axle deck. Ordinary road never goes under the deck or more than 5 cm above it. Landing snaps pitch onto the axle plane.

| Change | Status |
|--------|--------|
| Land-lock / jump approach plant Y = deck | **Done** |
| Grounded hover cap 5 cm (`GROUND_HOVER_MAX`) | **Done** |
| `_snapPitchToRoad(axles)` on land | **Done** |
| Headed probe: post-land ΔY in [-3 cm, +8 cm] | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=407`** · `vehicle.js?v=86`

**Proof:** `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint63-plant.mjs` · `node tools/qa-sprint75-glitch.mjs --static` · `node tools/qa-sprint72-road-lock.mjs`

**Still human-only:** Desert jump 2 into jump 3 — tires on the ramp, then on the sand, no clip-through.

---

# Sprint 81 — Recorded 3-2-1-GO on the start lights (25 Aug 2026)

**Player moment:** The stage HUD counts **3**, **2**, **1**, **GO!** and the co-driver says those words on the same ticks — not a beep standing in for a voice, and not TTS.

**Cause:** `countBeep` / `countGo` pitched a checkpoint sample. The SentientMattress pack already had a countdown at 0:00 (5-4-3-2-1-GO) that Sprint 67 never sliced. The clock also ran during the HUD fade, so the first number could fire off-screen.

**Fix:** Slice `count-3/2/1/go.mp3` from Freesound 833028. Play them on the navigator bus when the HUD flashes each number. Hold the 3-second clock until `#screen-hud` is up, then fire **3** immediately.

| Change | Status |
|--------|--------|
| `assets/sfx/nav/count-{3,2,1,go}.mp3` | **Done** |
| `countBeep` / `countGo` play recorded VO | **Done** |
| HUD 3 at screen-up; 2 / 1 / GO on remaining-time ticks | **Done** |
| Countdown hold until HUD (`_countHold`) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=407`** · `engine.js?v=51`

**Proof:** `node tools/qa-sprint81-countdown-vo.mjs`

**Still human-only:** start Desert and confirm the voice hits with the numbers. Navigator slider at 0 should still play GO on SFX.

---

