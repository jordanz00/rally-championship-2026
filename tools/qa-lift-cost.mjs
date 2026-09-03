#!/usr/bin/env node
/**
 * qa-lift-cost.mjs — what share of a stage build is the flyover separator?
 *
 * Boots once, then times `Track.prototype._separateOverlappingRibbon` against
 * the whole build on the next rebuild. A *relative* number like this survives a
 * loaded machine, where absolute build times are meaningless (a 44 s Desert
 * build was measured at load average 17.6).
 *
 * RUN:  node tools/qa-lift-cost.mjs
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, sleep,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

async function main() {
  if (!findChrome()) throw new Error(chromeUnavailableHint());
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true, width: 1024, height: 640 });
  const { cdp } = browser;
  await preparePage(cdp);
  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "window.game" });
    await clickSelector(cdp, "#btn-start", "PRESS START");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-menu"?1:null;`, { timeout: 60000, label: "menu" });
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `const s=document.querySelector(".screen.active");
       if(!s||s.id!=="screen-cars") return null;
       const b=document.querySelector("[data-car='celica']");
       return b && !b.disabled ? 1 : null;`,
      { timeout: 60000, label: "cars" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-courses"?1:null;`, { timeout: 60000, label: "courses" });
    await clickSelector(cdp, "[data-course='desert']", "DESERT");
    await waitFor(
      cdp,
      `const g=window.game; return g && g.track && g.courseId==="desert" ? 1 : null;`,
      { timeout: 180000, label: "desert track" }
    );

    // The Track class is not global, but a built instance exposes it.
    await evaluate(cdp, `
      const proto = Object.getPrototypeOf(window.game.track);
      window.__lift = { calls: 0, ms: 0, ramps: 0 };
      const orig = proto._separateOverlappingRibbon;
      proto._separateOverlappingRibbon = function () {
        const t0 = performance.now();
        const r = orig.apply(this, arguments);
        window.__lift.ms += performance.now() - t0;
        window.__lift.calls += 1;
        return r;
      };
      const origRamp = proto._liftRampEnd;
      if (origRamp) {
        proto._liftRampEnd = function () {
          window.__lift.ramps += 1;
          return origRamp.apply(this, arguments);
        };
      }
      1
    `);

    for (const course of ["forest", "desert", "mountain"]) {
      await evaluate(cdp, `
        window.__prevTrack = window.game.track;
        window.__lift = { calls: 0, ms: 0, ramps: 0 };
        window.__t0 = Date.now();
        setTimeout(() => window.game._beginRace(${JSON.stringify(course)}), 0);
        1
      `);
      let out = null;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline && !out) {
        await sleep(500);
        try {
          out = await evaluate(cdp, `
            const g = window.game;
            if (!g || !g.track || g.courseId !== ${JSON.stringify(course)}) return null;
            if (window.__prevTrack && g.track === window.__prevTrack) return null;
            return {
              buildMs: Date.now() - window.__t0,
              liftMs: Math.round(window.__lift.ms * 100) / 100,
              calls: window.__lift.calls,
              ramps: window.__lift.ramps,
              len: Math.round(g.track.length)
            };
          `, { timeoutMs: 5000 });
        } catch { /* main thread busy — keep polling */ }
      }
      if (!out) {
        console.log(`  ${course.padEnd(9)} did not finish inside 180 s`);
        continue;
      }
      const share = out.buildMs > 0 ? ((out.liftMs / out.buildMs) * 100).toFixed(3) : "?";
      console.log(
        `  ${course.padEnd(9)} build ${String(out.buildMs).padStart(6)} ms  ·  ` +
          `_separateOverlappingRibbon ${String(out.liftMs).padStart(8)} ms in ${out.calls} call(s)  ·  ` +
          `${share}% of build  ·  _liftRampEnd x${out.ramps}`
      );
    }

    await browser.close();
    await server.close();
  } catch (err) {
    console.error("FAIL", err.message || err);
    try { await browser.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
