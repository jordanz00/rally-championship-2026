#!/usr/bin/env node
/**
 * qa-guard-xz.mjs — prove the teleport guard actually catches a teleport.
 *
 * WHO THIS IS FOR: anyone touching `_guardXZ` / `_guardDrive` in
 *   `js/physics/vehicle.js`, or anything that writes `player.position`.
 *
 * WHY IT EXISTS: `_guardXZ` is the promise that "the car can never be
 *   teleported again". Until this tool, that promise rested on code that had
 *   never once fired — every other suite only proved it does NOT false-positive.
 *   An untested safety net is worse than none, because it stops you looking.
 *
 * HOW IT INJECTS: `Vehicle.step` calls `track.query` mid-step, after
 *   `_capturePrev()` has stashed the pre-step pose and before `_guardDrive`
 *   runs at the end. Wrapping `track.query` on the live Track instance lets a
 *   bogus offset be written into `player.position` from inside the step — the
 *   exact shape of the original defect, where an unbounded tunnel wall face
 *   flung the car 573 m during depenetration.
 *
 * WHAT IT PROVES:
 *   1. REJECT    a 200 m mid-step warp is refused, logged as `xz-warp`, and the
 *                car carries on driving normally afterwards.
 *   2. ALLOW     a large but *legal* correction (inside speed*dt + 12 m) passes
 *                through untouched — the guard is not simply refusing motion.
 *   3. ESCALATE  40 consecutive warps trip the fallback to `_restoreGoodPose`,
 *                and the car ends on the ribbon still driving, not frozen.
 *
 * All patching happens at runtime in the page. No diagnostic code is added to
 * any shipped game file.
 *
 * RUN:  node tools/qa-guard-xz.mjs
 *       node tools/qa-guard-xz.mjs --headed
 * EXIT: 0 only when the guard rejects, allows and escalates correctly.
 *
 * POWER BI MAPPING: none
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

const HEADED = process.argv.includes("--headed");
/** Size of the synthetic teleport (m) — far past any legal correction. */
const WARP_M = 200;
/** A large correction that is still inside the budget (speed*dt + 12 m). */
const LEGAL_M = 5;
/** Consecutive injected warps used to trip the escalation path. */
const ESCALATE_N = 40;

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
    console.error(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }
  console.log(`XZ TELEPORT GUARD  ·  ${new Date().toISOString()}\n`);

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
    await clickSelector(cdp, "[data-course='desert']", "DESERT");
    await waitFor(
      cdp,
      `const g=window.game;
       return g && (g.state==="countdown"||g.state==="race") && g.player && g.track ? 1 : null;`,
      { timeout: 180000, label: "desert loaded" }
    );

    // Install the mid-step injector and a spy on the escalation fallback.
    await evaluate(cdp, `
      const g = window.game, t = g.track, p = g.player;
      window.__inject = null;
      window.__restores = 0;
      if (!t.__qaPatched) {
        const orig = t.query.bind(t);
        t.query = function (x, z, out, hint) {
          const r = orig(x, z, out, hint);
          const inj = window.__inject;
          if (inj && inj.count > 0) {
            inj.count -= 1;
            // Mid-step position corruption, exactly as a bad collider did.
            g.player.position.x += inj.dx;
            g.player.position.z += inj.dz;
          }
          return r;
        };
        t.__qaPatched = true;
      }
      // Spy on the prototype, not the instance: the guard resolves the method
      // against the whole chain, and rivals share it. Both recovery entry
      // points count — _restoreCheckpoint is the current one and falls back to
      // _restoreGoodPose when the track cannot be sampled.
      const proto = Object.getPrototypeOf(p);
      if (!proto.__qaSpy) {
        for (const name of ["_restoreCheckpoint", "_restoreGoodPose"]) {
          const orig = proto[name];
          if (typeof orig !== "function") continue;
          proto[name] = function (track) {
            if (this === window.game.player) window.__restores += 1;
            return orig.call(this, track);
          };
        }
        proto.__qaSpy = true;
      }
      return {
        spy: proto.__qaSpy === true,
        hasCheckpoint: typeof p._restoreCheckpoint === "function"
      };
    `);

    /**
     * Place the car, inject `dx` on the next N steps, and report what happened.
     * @param {number} dx metres of synthetic warp per injected step
     * @param {number} injectSteps how many steps to inject on
     * @param {number} settleSteps steps to run afterwards with no injection
     */
    const trial = async (dx, injectSteps, settleSteps) => evaluate(cdp, `
      const g = window.game, p = g.player;
      g.state = "race";
      g.countdown = 0;
      g.timeLeft = 9999;
      p.spawn(g.track, 120, 0);
      p.velocity.set(Math.sin(p.yaw) * 25, 0, Math.cos(p.yaw) * 25);
      p.speed = 25;
      p.autoTrans = true;
      p.gear = 4;
      p.rpm = 4600;
      p._glitchHits = 0;
      p._glitchLog = [];
      window.__restores = 0;
      g._qaDrive = { throttle: 1, steer: 0, brake: 0, handbrake: 0 };
      g.input._qaHold = g._qaDrive;

      const warps = () => (p._glitchLog || []).filter((e) => e.kind === "xz-warp").length;
      // spawn() sets _glitchIgnore = 8: a grace window where _guardDrive skips
      // every check, including _guardXZ. Injecting inside it tests nothing, so
      // burn it off first and start from a clean glitch log.
      for (let i = 0; i < 16; i++) {
        g.input.poll();
        g._fixed(1 / 60);
      }
      p._glitchHits = 0;
      p._glitchLog = [];
      p._xzWarps = 0;

      let maxMoved = 0;
      const moves = [];
      for (let i = 0; i < ${injectSteps}; i++) {
        const bx = p.position.x, bz = p.position.z;
        window.__inject = { dx: ${dx}, dz: 0, count: 1 };
        g.input.poll();
        g._fixed(1 / 60);
        const moved = Math.hypot(p.position.x - bx, p.position.z - bz);
        moves.push(Math.round(moved * 100) / 100);
        if (moved > maxMoved) maxMoved = moved;
      }
      window.__inject = null;
      const warpsAfterInject = warps();
      const consecutive = p._xzWarps || 0;
      const progressAfterInject = p.progress;

      // Settle: no injection. The car must keep driving, not freeze.
      for (let i = 0; i < ${settleSteps}; i++) {
        g.input.poll();
        g._fixed(1 / 60);
      }
      const line = g.track.sample(p.progress, {});
      const lateral = line && Number.isFinite(line.x)
        ? Math.hypot(p.position.x - line.x, p.position.z - line.z) : null;
      g._qaDrive = null;
      g.input._qaHold = null;
      return {
        warps: warpsAfterInject,
        consecutive,
        restores: window.__restores,
        maxMoved: Math.round(maxMoved * 100) / 100,
        firstMoves: moves.slice(0, 3),
        // Legal budget for one step at 25 m/s: 25/60 + 12 = 12.4 m.
        budget: Math.round((25 / 60 + 12) * 100) / 100,
        settledProgress: Math.round(p.progress * 10) / 10,
        drovenAfter: Math.round((p.progress - progressAfterInject) * 10) / 10,
        speed: Math.round(p.speed * 10) / 10,
        lateral: lateral == null ? null : Math.round(lateral * 10) / 10,
        roadHalf: line && line.width ? Math.round(line.width * 5) / 10 : null,
        finite: typeof p._isFinitePose === "function" ? !!p._isFinitePose() : true
      };
    `, { timeoutMs: 120000 });

    // --- 1. REJECT ---------------------------------------------------------
    const rej = await trial(WARP_M, 1, 90);
    console.log(`  REJECT     injected ${WARP_M}m  ·  moved=${rej.maxMoved}m (budget ${rej.budget}m)  warps=${rej.warps}  drove ${rej.drovenAfter}m after  speed=${rej.speed}`);
    check("a 200 m mid-step warp is rejected", rej.maxMoved < rej.budget, `moved=${rej.maxMoved}m`);
    check("the rejection is logged as xz-warp", rej.warps === 1, `${rej.warps} entries`);
    check("the car keeps driving after a rejection", rej.drovenAfter > 20 && rej.finite, `+${rej.drovenAfter}m, finite=${rej.finite}`);
    check("one warp does not trigger escalation", rej.restores === 0, `${rej.restores} restores`);

    // --- 2. ALLOW ----------------------------------------------------------
    const legal = await trial(LEGAL_M, 1, 60);
    console.log(`  ALLOW      injected ${LEGAL_M}m  ·  moved=${legal.maxMoved}m (budget ${legal.budget}m)  warps=${legal.warps}`);
    check("a large but legal correction is NOT rejected", legal.warps === 0, `${legal.warps} xz-warp`);
    check("the legal correction actually moved the car", legal.maxMoved > LEGAL_M * 0.6, `moved=${legal.maxMoved}m`);

    // --- 3. ESCALATE -------------------------------------------------------
    const esc = await trial(WARP_M, ESCALATE_N, 150);
    console.log(`  ESCALATE   ${ESCALATE_N} warps  ·  warps=${esc.warps}  consecutive=${esc.consecutive}  restores=${esc.restores}  lateral=${esc.lateral}m (road half ${esc.roadHalf}m)  drove ${esc.drovenAfter}m after  speed=${esc.speed}\n`);
    check(`${ESCALATE_N} consecutive warps are all rejected`, esc.warps >= 30, `${esc.warps} xz-warp`);
    check("escalation falls back to the checkpoint restore", esc.restores >= 1, `${esc.restores} restores`);
    // Corroborates the spy: the counter resets to 0 only in the escalation
    // branch, so 40 rejections ending at 10 means it tripped at exactly 30.
    check("the warp counter reset at the escalation threshold", esc.consecutive === esc.warps - 30,
      `consecutive=${esc.consecutive} after ${esc.warps} warps`);
    check("the car recovers onto the ribbon", esc.lateral != null && esc.roadHalf != null && esc.lateral <= esc.roadHalf + 10, `lateral=${esc.lateral}m`);
    check("the car is not frozen after escalation", esc.drovenAfter > 20, `+${esc.drovenAfter}m in 150 steps`);
    check("pose stays finite throughout", esc.finite === true);

    const fatal = errors.filter((e) => e.type === "error" || e.type === "exception");
    check("no console errors", fatal.length === 0, fatal.slice(0, 3).map((e) => e.text || e).join(" | "));

    await browser.close();
    await server.close();
    console.log(fail ? `\nFAIL — ${fail} check(s) failed` : `\nPASS — the teleport guard rejects, allows and escalates correctly`);
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
