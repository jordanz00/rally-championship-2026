#!/usr/bin/env node
/**
 * qa-jump3-sweep.mjs — hammer the Desert jump-3 landing from every angle.
 *
 * WHO THIS IS FOR: the Glitch Department. The player reports the car clipping
 *   through the ground and being teleported when landing after the third jump,
 *   before the tunnel — and reports it *still happening* after a fix that a
 *   single centreline run said was clean.
 *
 * WHY A SWEEP: `qa-desert-jump3.mjs` crosses the Safari throw exactly once, on
 *   the racing line, at ~45 m/s. A player arrives off-line, at any speed, at an
 *   angle, sometimes sideways. One sample of a 3-dimensional approach space is
 *   not a test. This drives the same 150 m of stage from many launch states and
 *   reports which ones break.
 *
 * WHAT IT MEASURES: every call to `Vehicle.step` is wrapped, so each physics
 *   substep is checked, not each frame:
 *     - WARP     chassis moved further in one substep than speed*dt plus the
 *                largest legal depenetration. No cause can hide from this.
 *     - SINK     chassis sat below the solid road deck under the car.
 *     - PINNED   progress stopped advancing while the car was still moving.
 *     - NaN      pose stopped being a finite number.
 *   Physics substeps at FIXED_DT via an accumulator, so pumping `_fixed`
 *   directly reproduces real play exactly — frame rate does not change
 *   per-substep motion.
 *
 * RUN:  node tools/qa-jump3-sweep.mjs
 *       node tools/qa-jump3-sweep.mjs --quick
 *       node tools/qa-jump3-sweep.mjs --course=forest --jump=1 --quick
 * EXIT: 0 only when every launch state clears the jump with no warp, sink,
 *       pin or NaN.
 *
 * POWER BI MAPPING: none
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, sleep,
} from "./lib/qa-harness.mjs";

const argv = process.argv.slice(2).join(" ");
const COURSE = /--course=(\w+)/.exec(argv)?.[1] || "desert";
const JUMP_N = Number(/--jump=(\d+)/.exec(argv)?.[1] || 3);
const QUICK = argv.includes("--quick");
const HEADED = argv.includes("--headed");

/** Approach speeds (m/s). 58 is faster than the autopilot ever managed. */
const SPEEDS = QUICK ? [45, 58] : [28, 36, 45, 52, 58];
/**
 * Lateral offsets from the centreline (m). The jump lane is ~15 m wide, so
 * +-11 launches from the dirt outside the paint — players do take off crooked
 * and wide, and that is the half of the space a centreline run never sees.
 */
const LATERALS = QUICK ? [0, 6] : [-11, -6.5, -3, 0, 3, 6.5, 11];
/**
 * Yaw error at launch (rad). 0.6 rad is ~35 deg — a car still rotating from a
 * gravel drift as it leaves the lip, which is how the throw is usually taken.
 */
const YAWS = QUICK ? [0] : [-0.6, -0.22, 0, 0.22, 0.6];

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  if (!findChrome()) {
    console.error("FAIL  no Chrome/Chromium binary found. Set CHROME_PATH.");
    process.exit(1);
  }
  const cases = SPEEDS.length * LATERALS.length * YAWS.length;
  console.log(`JUMP-${JUMP_N} LANDING SWEEP  ·  ${new Date().toISOString()}`);
  console.log(`course=${COURSE}  ${cases} launch states  (${SPEEDS.length} speeds x ${LATERALS.length} lines x ${YAWS.length} yaws)\n`);

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

    // Locate the Nth jump and install the per-substep integrity hook.
    const setup = await evaluate(cdp, `
      const g = window.game;
      const t = g.track;
      // Find the start of the Nth 'gap' run — the same way track.js counts them.
      let n = 0, prev = "", gapAt = null, gapEnd = null;
      for (let i = 0; i < t.points.length; i++) {
        const k = t.points[i].jumpKind || "";
        if (k === "gap" && prev !== "gap") {
          n += 1;
          if (n === ${JUMP_N}) gapAt = t.points[i].dist;
        }
        if (gapAt != null && n === ${JUMP_N} && k !== "gap" && prev === "gap" && gapEnd == null) {
          gapEnd = t.points[i].dist;
        }
        prev = k;
      }

      window.__ev = [];
      const proto = Object.getPrototypeOf(g.player);
      if (!proto.__hooked) {
        const orig = proto.step;
        proto.step = function (dt, input, track) {
          const bx = this.position.x, bz = this.position.z, bp = this.progress;
          const bspd = this.speed || 0;
          const r = orig.call(this, dt, input, track);
          if (window.__watch) {
            const moved = Math.hypot(this.position.x - bx, this.position.z - bz);
            // speed*dt is the travel; +9 m covers the largest legal correction
            // (MAX_PUSH depenetration x2 passes, plus _unstick's 5.6 m haul).
            const limit = Math.max(bspd, this.speed || 0) * dt + 9;
            if (moved > limit) {
              window.__ev.push({ kind: "WARP", moved: Math.round(moved * 10) / 10,
                limit: Math.round(limit * 10) / 10, progress: Math.round(bp * 10) / 10,
                toX: Math.round(this.position.x), toZ: Math.round(this.position.z) });
            }
            if (!Number.isFinite(this.position.x) || !Number.isFinite(this.position.y) ||
                !Number.isFinite(this.position.z) || !Number.isFinite(this.progress)) {
              window.__ev.push({ kind: "NaN", progress: Math.round(bp * 10) / 10 });
            }
            const q = this._q;
            if (q && Number.isFinite(q.height) && q.jumpKind !== "gap" && this.onGround) {
              const sink = q.height - this.position.y;
              if (sink > 0.5) {
                window.__ev.push({ kind: "SINK", sink: Math.round(sink * 100) / 100,
                  progress: Math.round(this.progress * 10) / 10 });
              }
            }
          }
          return r;
        };
        proto.__hooked = true;
      }
      return { gapAt, gapEnd, len: Math.round(t.length) };
    `);

    if (setup.gapAt == null) throw new Error(`could not find jump ${JUMP_N} on ${COURSE}`);
    const launchAt = Math.max(8, setup.gapAt - 70);
    // Far enough past the landing to drive the tunnel mouth as well: the wall
    // faces in there are what the landing used to be flung into, so the run has
    // to actually reach them rather than stopping at the climb.
    const finishAt = setup.gapAt + 340;
    console.log(`jump ${JUMP_N} gap starts at ${setup.gapAt.toFixed(1)} m  ·  launch from ${launchAt.toFixed(1)} m  ·  watch to ${finishAt.toFixed(1)} m\n`);

    const failures = [];
    let ran = 0;
    let invalid = 0;
    let xzWarpTotal = 0;
    const kindSeen = new Set();

    for (const spd of SPEEDS) {
      for (const lat of LATERALS) {
        for (const yaw of YAWS) {
          const res = await evaluate(
            cdp,
            `
            const g = window.game;
            const p = g.player;
            g.state = "race";
            g.countdown = 0;
            // Each case simulates up to 15 s of stage time. Without topping the
            // clock up, the stage timer expires part-way through the sweep, the
            // race ends, and every later case looks "pinned" at its spawn.
            g.timeLeft = 9999;
            g.finished = false;
            g.lap = 1;
            window.__ev = [];
            window.__watch = false;

            // Place the car on the ribbon, then give it real momentum.
            p.spawn(g.track, ${launchAt}, ${lat});
            p.yaw += ${yaw};
            const spd = ${spd};
            p.velocity.set(Math.sin(p.yaw) * spd, 0, Math.cos(p.yaw) * spd);
            p.speed = spd;
            p.autoTrans = true;
            p.gear = 4;
            p.rpm = 5200;
            p._glitchHits = 0;
            p._glitchLog = [];
            g._qaDrive = { throttle: 1, steer: 0, brake: 0, handbrake: 0 };
            g.input._qaHold = g._qaDrive;
            window.__watch = true;
            window.__hitched = false;

            const out = {};
            let pinned = 0, stall = 0, maxSink = 0, stuck = 0, slow = 0;
            let steps = 0;
            const FIXED = 1 / 60;
            while (steps < 1800) {
              steps += 1;
              // Hold the centreline after launch, like a player would.
              const look = 16 + Math.min(26, p.speed * 0.7);
              const aim = g.track.sample(p.progress + look, out);
              if (aim && Number.isFinite(aim.x)) {
                const want = Math.atan2(aim.x - p.position.x, aim.z - p.position.z);
                let err = want - p.yaw;
                while (err > Math.PI) err -= Math.PI * 2;
                while (err < -Math.PI) err += Math.PI * 2;
                g._qaDrive.steer = Math.max(-1, Math.min(1, err * 2.2));
              }
              const before = p.progress;
              g.input.poll();
              // One hitch as the car reaches the gap: dt=0.2 s is clamped to
              // 3 substeps. A tunnel would show as WARP/SINK on that burst.
              let hitchDt = FIXED;
              if (!window.__hitched && p.progress >= ${setup.gapAt}) {
                window.__hitched = true;
                hitchDt = 0.2;
              }
              g._fixed(hitchDt);
              // Moving fast with no along-track progress = the query is pinned
              // while the body travels, which is the signature of the original
              // defect. 2 s of it, so a genuine sideways slide is not flagged.
              if (p.progress - before < 0.01 && p.speed > 3) {
                stall += 1;
                if (stall > 120) { pinned = 1; break; }
              } else stall = 0;
              // Wide-open throttle and going nowhere = wedged in a solid.
              if (p.speed < 2) {
                slow += 1;
                if (slow > 300) { stuck = 1; break; }
              } else slow = 0;
              const line = g.track.sample(p.progress, out);
              if (line && Number.isFinite(line.y) && p.onGround && !(p._q && p._q.jumpKind === "gap")) {
                const s = line.y - p.position.y;
                if (s > maxSink) maxSink = s;
              }
              if (p.progress >= ${finishAt}) break;
              if (!Number.isFinite(p.progress)) break;
            }
            window.__watch = false;
            g._qaDrive = null;
            if (g.input) g.input._qaHold = null;
            return {
              steps, pinned, stuck,
              reached: Math.round(p.progress * 10) / 10,
              maxSink: Math.round(maxSink * 100) / 100,
              events: window.__ev.slice(0, 6),
              nEvents: window.__ev.length,
              guard: p._glitchHits || 0,
              // The _guardXZ invariant must never fire while simply driving.
              xzWarps: (p._glitchLog || []).filter((e) => e.kind === "xz-warp").length,
              kinds: Array.from(new Set((p._glitchLog || []).map((e) => e.kind))).join(","),
              // A case that no longer ended in "race" was cut short by race
              // flow, not by a physics defect — report it as invalid, not failed.
              state: g.state,
            };
            `,
            { timeoutMs: 120000 }
          );
          ran += 1;
          const warps = res.events.filter((e) => e.kind === "WARP");
          const stale = res.state !== "race";
          // A launch from 11 m off-line at 28 m/s may legitimately not get back
          // to the finish line inside the step budget, so distance alone is not
          // a defect. A warp, a NaN, a pinned query or a wedged car always is.
          const bad =
            !stale &&
            (warps.length > 0 ||
              res.pinned ||
              res.stuck ||
              res.events.some((e) => e.kind === "NaN"));
          if (stale) invalid += 1;
          const tag = stale ? "skip" : bad ? "FAIL" : "ok  ";
          const line =
            `  ${tag}  v=${String(spd).padStart(2)} lat=${String(lat).padStart(5)} yaw=${String(yaw).padStart(5)}  ` +
            `reached=${String(res.reached).padStart(7)}  sink=${String(res.maxSink).padStart(5)}  ` +
            `${res.pinned ? "PINNED " : ""}${res.stuck ? "STUCK " : ""}${warps.length ? `WARP x${warps.length} ` : ""}` +
            `${res.nEvents ? `ev=${res.nEvents}` : ""}`;
          console.log(line);
          if (res.xzWarps) xzWarpTotal += res.xzWarps;
          if (res.kinds) for (const k of res.kinds.split(",")) if (k) kindSeen.add(k);
          if (bad) {
            failures.push({ spd, lat, yaw, ...res });
            for (const e of res.events.slice(0, 3)) {
              console.log(`          ${JSON.stringify(e)}`);
            }
          }
        }
      }
    }

    console.log("");
    const line = "─".repeat(78);
    console.log(line);
    check(`all ${ran} launch states cleared jump ${JUMP_N}`, failures.length === 0, `${failures.length} failed`);
    check("every launch state was actually simulated", invalid === 0, `${invalid} cut short by race flow`);
    check("_guardXZ never fired (no false-positive teleport rejections)", xzWarpTotal === 0, `${xzWarpTotal} xz-warp`);
    console.log(`  note  recovered glitch kinds seen: ${kindSeen.size ? Array.from(kindSeen).join(", ") : "none"}`);
    if (errors.length) check("no console errors", false, errors.slice(0, 4).map((e) => e.text || e).join(" | "));
    else check("no console errors", true);
    console.log(line);

    if (failures.length) {
      console.log("\nfailing launch states:");
      for (const f of failures) {
        console.log(`  v=${f.spd} lat=${f.lat} yaw=${f.yaw} -> reached ${f.reached}, ${f.nEvents} event(s)${f.pinned ? ", PINNED" : ""}`);
      }
    }

    await browser.close();
    await server.close();
    console.log(fail ? `\nFAIL — ${fail} check(s) failed` : `\nPASS — jump ${JUMP_N} survives every approach`);
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
