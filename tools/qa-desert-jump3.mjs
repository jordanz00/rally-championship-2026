#!/usr/bin/env node
/**
 * qa-desert-jump3.mjs — drive Desert far enough to actually reach the jumps.
 *
 * WHO THIS IS FOR: the Glitch Department, chasing "the car clips through the
 *   ground and gets teleported when landing after the third jump, before the
 *   tunnel", plus "stage 1 bugs out before the end of the first section".
 *
 * WHY THIS EXISTS: qa-sprint75-glitch.mjs holds throttle with **zero steer**,
 *   so the car leaves the road in the first corner and the run ends after ~46 m
 *   of a ~2.4 km stage. It has therefore never reached jump 1, let alone the
 *   Safari throw at ~990 m. It reported PASS while the stage was broken.
 *
 * WHAT IT DOES: pumps `game._fixed(1/60)` directly with a centreline autopilot,
 *   plus one 0.2 s hitch at the Safari-throw gap (jump 3) so a frame spike
 *   cannot tunnel the car. Other courses hitch at the first gap after 50 m.
 *   Every step is checked against the road surface under the car, and every
 *   `_glitchLog` entry is reported with the along-track distance where it fired.
 *
 * Desert geometry (from js/tracks/courses.js), along-track metres:
 *   jump 1  ~468–531      jump 2  ~893–953
 *   jump 3  ~987–1103  ← the Safari throw: ramp 30, rise 5.2, gap 26, drop 3.6
 *   tunnel starts ~1284
 *
 * RUN:  node tools/qa-desert-jump3.mjs
 *       node tools/qa-desert-jump3.mjs --course=forest
 *       node tools/qa-desert-jump3.mjs --headed --metres=1400
 * EXIT: 0 when the stage is driven to the target distance with no teleport,
 *       no bury and no NaN.
 *
 * POWER BI MAPPING: none
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, sleep,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

const argv = process.argv.slice(2).join(" ");
const HEADED = argv.includes("--headed");
const COURSE = /--course=(\w+)/.exec(argv)?.[1] || "desert";
const TARGET_M = Number(/--metres=(\d+)/.exec(argv)?.[1] || 1400);
const VERBOSE = argv.includes("--verbose");

/** Metres of along-track movement in one 1/60 step that cannot be driving. */
const TELEPORT_STEP_M = 12;
/** Metres below the road deck that is a clip-through, not suspension travel. */
const BURY_M = 0.9;

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function fmt(n) {
  return n == null || Number.isNaN(n) ? "na" : Number(n).toFixed(2);
}

/**
 * Classify a buried guard hit from the per-tick physics pipe.
 * These are the three decisive cases, not extra colliders.
 */
function classifyPipe(e) {
  const p = e.pipe || {};
  const prev = p.prevY;
  const air = p.afterAir;
  const dest = p.destFloorAtAir != null ? p.destFloorAtAir : p.destFloor;
  if (e.pen != null && e.pen <= 0.15) return "FALSE_RAMP";
  if (Number.isFinite(prev) && Number.isFinite(air) && air < prev - 4 && !p.hit) {
    return "TUNNEL";
  }
  if (p.normalY < 0) return "BAD_RESOLVE";
  if (Number.isFinite(air) && Number.isFinite(dest) && air < dest - 1 && p.hit) {
    return "CAUGHT";
  }
  return "RESIDUAL";
}

/**
 * Drive the loaded stage with a centreline autopilot, pumping fixed steps.
 * Returns the trace plus every glitch the vehicle guard recorded.
 * @param {any} cdp
 */
async function driveStage(cdp) {
  const CHUNK = 600;
  const MAX_STEPS = 20000;
  let steps = 0;
  const trace = [];
  let glitchLog = [];
  let done = false;
  let lastProgress = 0;
  let warps = [];

  while (steps < MAX_STEPS && !done) {
    const pack = await evaluate(
      cdp,
      `
      const g = window.game;
      if (!g || !g.player || !g.track) return { error: "no game" };
      const p = g.player, t = g.track;
      if (${steps === 0 ? "true" : "false"}) {
        g.state = "race";
        g.countdown = 0;
        g._qaDrive = { throttle: 1, steer: 0, brake: 0, handbrake: 0 };
        g.input._qaHold = g._qaDrive;
        p.autoTrans = true;
        if (p.gear < 1) p.gear = 1;
        // Trap the warp at its source. Physics writes position.x/z through
        // ordinary assignment, so an accessor on the live Vector3 catches the
        // exact call site of any jump no integration step could produce.
        window.__warps = [];
        window.__hitched = false;
        const pos = p.position;
        let _x = pos.x, _z = pos.z;
        const trap = (name, get, set) => Object.defineProperty(pos, name, {
          configurable: true,
          get,
          set(v) {
            if (Number.isFinite(v) && Number.isFinite(get()) && Math.abs(v - get()) > 40 && window.__warps.length < 4) {
              window.__warps.push({
                axis: name, from: Math.round(get() * 10) / 10, to: Math.round(v * 10) / 10,
                progress: Math.round(p.progress * 10) / 10,
                stack: new Error("warp").stack
              });
            }
            set(v);
          }
        });
        trap("x", () => _x, (v) => { _x = v; });
        trap("z", () => _z, (v) => { _z = v; });
      }
      const out = {};
      const trace = [];
      let done = false;
      try {
        for (let i = 0; i < ${CHUNK}; i++) {
          // --- centreline autopilot -------------------------------------
          // Aim at a point ahead on the spline and ease off for tight bends,
          // so the car stays on the painted lane for the whole stage.
          const look = 16 + Math.min(26, p.speed * 0.7);
          const aim = t.sample(p.progress + look, out);
          let steer = 0;
          if (aim && Number.isFinite(aim.x)) {
            const want = Math.atan2(aim.x - p.position.x, aim.z - p.position.z);
            let err = want - p.yaw;
            while (err > Math.PI) err -= Math.PI * 2;
            while (err < -Math.PI) err += Math.PI * 2;
            steer = Math.max(-1, Math.min(1, err * 2.2));
          }
          g._qaDrive.steer = steer;
          const tight = Math.abs(steer);
          g._qaDrive.throttle = tight > 0.55 ? 0.25 : tight > 0.3 ? 0.6 : 1;
          g._qaDrive.brake = tight > 0.75 && p.speed > 22 ? 0.5 : 0;

          const beforeProgress = p.progress;
          const beforeY = p.position.y;
          const bx = p.position.x;
          const bz = p.position.z;
          const hitchFloor = ${COURSE === "desert" ? 900 : 50};
          const hitch =
            !window.__hitched &&
            p._q &&
            p._q.jumpKind === "gap" &&
            p.progress > hitchFloor;
          if (hitch) window.__hitched = true;
          g.input.poll();
          g._fixed(hitch ? 0.2 : 1 / 60);

          // --- per-step integrity sample --------------------------------
          const q = p._q || {};
          const line = t.sample(p.progress, out);
          const roadY = line && Number.isFinite(line.y) ? line.y : null;
          const lateral = line && Number.isFinite(line.x)
            ? Math.hypot(p.position.x - line.x, p.position.z - line.z)
            : null;
          const step = p.progress - beforeProgress;
          const finite = typeof p._isFinitePose === "function" ? p._isFinitePose() : true;
          const sample = {
            progress: Math.round(p.progress * 10) / 10,
            step: Math.round(step * 100) / 100,
            x: Math.round(p.position.x * 10) / 10,
            z: Math.round(p.position.z * 10) / 10,
            // World-space distance the chassis moved this step. At 44 m/s a
            // 1/60 s step is 0.73 m; anything far above that is a warp, not
            // integration.
            moved: Math.round(Math.hypot(p.position.x - bx, p.position.z - bz) * 100) / 100,
            y: Math.round(p.position.y * 100) / 100,
            roadY: roadY == null ? null : Math.round(roadY * 100) / 100,
            lateral: lateral == null ? null : Math.round(lateral * 10) / 10,
            width: line && line.width ? line.width : null,
            speed: Math.round(p.speed * 10) / 10,
            onGround: !!p.onGround,
            jumpKind: q.jumpKind || "",
            tunnel: !!(line && line.tunnel),
            finite: !!finite
          };
          trace.push(sample);
          if (p.progress >= ${TARGET_M}) { done = true; break; }
          if (!finite) { done = true; break; }
        }
      } catch (err) {
        return { error: String(err && err.message ? err.message : err), trace, glitchLog: p._glitchLog || [] };
      }
      return {
        error: null,
        trace,
        glitchLog: p._glitchLog || [],
        hits: p._glitchHits || 0,
        done,
        progress: p.progress,
        warps: window.__warps || []
      };
      `,
      { timeoutMs: 180000 }
    );
    if (pack.error) throw new Error(`pump: ${pack.error}`);
    trace.push(...(pack.trace || []));
    glitchLog = pack.glitchLog || glitchLog;
    if (pack.warps && pack.warps.length) warps = pack.warps;
    steps += CHUNK;
    done = !!pack.done;
    if (pack.progress === lastProgress) break;
    lastProgress = pack.progress;
  }
  return { trace, glitchLog, steps, warps };
}

async function main() {
  if (!findChrome()) {
    console.error(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }
  console.log(`DESERT JUMP-3 / STAGE INTEGRITY DRIVE  ·  ${new Date().toISOString()}`);
  console.log(`course=${COURSE}  target=${TARGET_M} m\n`);

  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: !HEADED, width: 1280, height: 720 });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "window.game" });
    await clickSelector(cdp, "#btn-start", "PRESS START");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-menu"?1:null;`, { timeout: 60000, label: "SELECT MODE" });
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `const s=document.querySelector(".screen.active");
       if(!s||s.id!=="screen-cars") return null;
       const b=document.querySelector("[data-car='celica']");
       return b && !b.disabled ? 1 : null;`,
      { timeout: 60000, label: "Celica selectable" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-courses"?1:null;`, { timeout: 60000, label: "SELECT COURSE" });
    await clickSelector(cdp, `[data-course='${COURSE}']`, COURSE.toUpperCase());
    await waitFor(
      cdp,
      `const g=window.game;
       return g && (g.state==="countdown"||g.state==="race") && g.courseId===${JSON.stringify(COURSE)} && g.player && g.track ? 1 : null;`,
      { timeout: 180000, label: `${COURSE} loaded` }
    );

    const meta = await evaluate(cdp, `return { length: Math.round(window.game.track.length), course: window.game.courseId };`);
    console.log(`stage length ${meta.length} m\n`);

    const { trace, glitchLog, steps, warps } = await driveStage(cdp);

    if (warps.length) {
      console.log(`POSITION WARP TRAPPED (${warps.length}):`);
      for (const w of warps) {
        console.log(`  position.${w.axis} ${w.from} -> ${w.to} at progress ${w.progress}`);
        for (const l of String(w.stack).split("\n").slice(1, 9)) console.log(`      ${l.trim()}`);
      }
      console.log("");
    }

    // --- analysis -----------------------------------------------------------
    const reached = trace.length ? trace[trace.length - 1].progress : 0;
    const teleports = [];
    const buries = [];
    const nans = [];
    const offRoad = [];
    // Progress stuck while the car is still moving is the freeze half of the
    // bug: the guard pins the query and the stage can never be finished.
    let frozen = 0;
    let stall = 0;
    for (const s of trace) {
      if (s.step === 0 && s.speed > 3) {
        stall += 1;
        if (stall > 30) frozen += 1;
      } else stall = 0;
    }
    for (const s of trace) {
      if (Math.abs(s.step) > TELEPORT_STEP_M) teleports.push(s);
      if (
        s.onGround &&
        s.roadY != null &&
        !s.jumpKind &&
        s.y < s.roadY - BURY_M
      ) buries.push(s);
      if (!s.finite) nans.push(s);
      if (s.lateral != null && s.width && s.lateral > s.width * 0.5 + 14) offRoad.push(s);
    }

    console.log(`drove ${reached.toFixed(0)} m of ${meta.length} m in ${steps} fixed steps (${trace.length} samples)`);
    console.log(`furthest point reached: ${reached.toFixed(0)} m\n`);

    // Where did it break, in stage terms?
    const ZONES = [
      { name: "opening straight + teaching turns", from: 0, to: 468 },
      { name: "jump 1 (short hop)", from: 468, to: 531 },
      { name: "snaky gravel corridor", from: 531, to: 893 },
      { name: "jump 2 (medium)", from: 893, to: 953 },
      { name: "JUMP 3 — Safari throw", from: 953, to: 1103 },
      { name: "landing flat + checkpoint climb", from: 1103, to: 1284 },
      { name: "tunnel", from: 1284, to: 1600 },
    ];
    if (COURSE === "desert") {
      console.log("incidents by stage zone:");
      for (const z of ZONES) {
        const inZone = (arr) => arr.filter((s) => s.progress >= z.from && s.progress < z.to).length;
        const t = inZone(teleports), b = inZone(buries), o = inZone(offRoad);
        const g = glitchLog.filter((e) => (e.progress || 0) >= z.from && (e.progress || 0) < z.to);
        const flag = t || b || g.length ? "  <<<" : "";
        console.log(
          `  ${String(z.from).padStart(5)}–${String(z.to).padEnd(5)} ${z.name.padEnd(34)} ` +
            `teleport=${t} bury=${b} offroad=${o} guard=${g.length}${flag}`
        );
      }
      console.log("");
    }

    if (glitchLog.length) {
      console.log(`vehicle guard fired ${glitchLog.length} time(s) (first 20):`);
      const byKind = {};
      for (const e of glitchLog) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
      console.log(`  kinds: ${JSON.stringify(byKind)}`);
      for (const e of glitchLog.slice(0, 20)) {
        console.log(
          `    ${String(e.kind).padEnd(14)} progress=${(e.progress || 0).toFixed(1)} ` +
            `y=${(e.y != null ? e.y : 0).toFixed(2)}` +
            (e.pen != null ? ` pen=${Number(e.pen).toFixed(3)}` : "") +
            (e.floor != null ? ` floor=${Number(e.floor).toFixed(2)}` : "") +
            (e.prevY != null ? ` prevY=${Number(e.prevY).toFixed(2)}` : "")
        );
        if (e.kind === "buried" || e.kind === "under-world") {
          const p = e.pipe || {};
          const cls = classifyPipe(e);
          console.log(
            `      ${cls}  pipe prevY=${fmt(p.prevY)} afterAir=${fmt(p.afterAir)} ` +
              `destAtAir=${fmt(p.destFloorAtAir)} destFloor=${fmt(p.destFloor)} ` +
              `hit=${p.hit} pen=${fmt(p.pen)} nY=${p.normalY} sweep=${p.sweepCrossed} ` +
              `resolvedY=${fmt(p.resolvedY)} kind=${p.kind} velY=${fmt(p.velY)}`
          );
        }
      }
      console.log("");
    }

    if (teleports.length) {
      console.log(`teleports (along-track step > ${TELEPORT_STEP_M} m in one 1/60 s):`);
      for (const s of teleports.slice(0, 12)) {
        console.log(`    progress=${s.progress} step=${s.step} m  y=${s.y} roadY=${s.roadY} speed=${s.speed} jumpKind="${s.jumpKind}"`);
      }
      console.log("");
    }
    if (buries.length) {
      console.log(`clip-through (chassis > ${BURY_M} m under the deck, on ground, not a pit):`);
      for (const s of buries.slice(0, 12)) {
        console.log(`    progress=${s.progress} y=${s.y} roadY=${s.roadY} (${(s.roadY - s.y).toFixed(2)} m under) speed=${s.speed}`);
      }
      console.log("");
    }

    if (VERBOSE) {
      const from = Number(/--from=(\d+)/.exec(argv)?.[1] || 950);
      const to = Number(/--to=(\d+)/.exec(argv)?.[1] || 1200);
      console.log(`trace ${from}–${to} m (jump 3 and its landing):`);
      for (const s of trace.filter((x) => x.progress >= from && x.progress <= to).slice(0, 120)) {
        console.log(
          `    p=${String(s.progress).padStart(7)} step=${String(s.step).padStart(6)} moved=${String(s.moved).padStart(7)} ` +
            `xz=(${String(s.x).padStart(7)},${String(s.z).padStart(8)}) y=${String(s.y).padStart(7)} ` +
            `roadY=${String(s.roadY).padStart(7)} lat=${String(s.lateral).padStart(6)} v=${String(s.speed).padStart(5)} ` +
            `${s.onGround ? "ground" : "air   "} ${s.jumpKind || "-"}`
        );
      }
      console.log("");
    }

    const line = "─".repeat(76);
    console.log(line);
    if (COURSE === "desert") {
      check(`drove past jump 3 (needs > 1103 m)`, reached > 1103, `reached ${reached.toFixed(0)} m`);
    }
    check(`reached the target ${TARGET_M} m`, reached >= TARGET_M - 5, `reached ${reached.toFixed(0)} m`);
    check("no teleport", teleports.length === 0, `${teleports.length} found`);
    check("no clip-through", buries.length === 0, `${buries.length} found`);
    check("no NaN pose", nans.length === 0, `${nans.length} found`);
    // Severity split. A `buried` of a few cm on a ramp is ground-following
    // catch-up that the guard corrects inside the same physics step, so the
    // player never renders sunk. A warp, NaN or pinned query is a real defect.
    const SEVERE = new Set(["teleport", "nan-pose", "spline-snap", "y-warp", "long-air"]);
    const severe = glitchLog.filter(
      (e) => SEVERE.has(e.kind) || (e.floor != null && e.y != null && e.floor - e.y > 0.35)
    );
    const minor = glitchLog.length - severe.length;
    check(
      "no severe guard recovery (warp / NaN / pinned query / deep bury)",
      severe.length === 0,
      `${severe.length} severe, ${minor} minor ramp catch-up`
    );
    check("car never froze (progress kept advancing)", frozen === 0, `${frozen} stalled sample(s)`);
    if (errors.length) {
      check("no console errors", false, errors.slice(0, 4).map((e) => e.text || e).join(" | "));
    } else check("no console errors", true);
    console.log(line);

    await browser.close();
    await server.close();
    console.log(fail ? `\nFAIL — ${fail} check(s) failed` : "\nPASS — stage driven clean");
    process.exit(fail ? 1 : 0);
  } catch (err) {
    console.error(`\nFAIL  ${err.message}`);
    if (errors.length) for (const e of errors.slice(0, 6)) console.error(`  [${e.type}] ${e.text}`);
    try { await browser.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
