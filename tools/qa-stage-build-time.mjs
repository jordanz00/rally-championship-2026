#!/usr/bin/env node
/**
 * qa-stage-build-time.mjs — how long does a stage take to build, really?
 *
 * WHO THIS IS FOR: whoever owns `track.js` construction. `docs/QA-REPORT.md`
 *   carries a long-standing "non-deterministic stage-build wedge" as a hard
 *   ship blocker: roughly 2 in 6 headed runs, the Desert track fails to finish
 *   inside 120 s and the main thread stops answering `Runtime.evaluate`.
 *
 * WHY THIS EXISTS: every existing probe that hits the wedge costs a full boot
 *   plus a heavy scene assertion (~5 minutes) and yields exactly one sample, so
 *   nobody can tell a real regression from the documented flake. This boots
 *   once and then rebuilds stages back to back, giving many timed samples per
 *   minute and a clear answer to "is this build slow, wedged, or fine?".
 *
 * A stage that will not load is not a functional stage, so this is a
 * playability gate, not a profiling curiosity.
 *
 * RUN:  node tools/qa-stage-build-time.mjs
 *       node tools/qa-stage-build-time.mjs --rounds=9 --budget=45000
 * EXIT: 0 when every build finishes inside the budget and the main thread stays
 *       responsive throughout.
 *
 * POWER BI MAPPING: none
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, sleep,
} from "./lib/qa-harness.mjs";

const argv = process.argv.slice(2).join(" ");
const ROUNDS = Number(/--rounds=(\d+)/.exec(argv)?.[1] || 9);
const BUDGET_MS = Number(/--budget=(\d+)/.exec(argv)?.[1] || 45000);
const ORDER = ["desert", "forest", "mountain"];

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
  console.log(`STAGE BUILD TIME  ·  ${new Date().toISOString()}`);
  console.log(`${ROUNDS} rebuilds  ·  budget ${BUDGET_MS} ms per stage\n`);

  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true, width: 1280, height: 720 });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);
  const rows = [];

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

    for (let r = 0; r < ROUNDS; r++) {
      const course = ORDER[r % ORDER.length];
      const t0 = Date.now();
      let wedged = false;
      let ms = 0;
      let len = 0;

      if (r === 0) {
        await clickSelector(cdp, `[data-course='${course}']`, course.toUpperCase());
      } else {
        await evaluate(
          cdp,
          `window.__prevTrack = window.game.track;
           window.game._qaDrive = null;
           if (window.game.input) window.game.input._qaHold = null;
           setTimeout(() => window.game._beginRace(${JSON.stringify(course)}), 0);
           1`,
          { timeoutMs: 10000 }
        );
      }

      // Poll rather than one long wait, so an unresponsive main thread is
      // distinguishable from a merely slow build.
      let unresponsive = 0;
      while (Date.now() - t0 < BUDGET_MS) {
        await sleep(400);
        let got = null;
        try {
          got = await evaluate(
            cdp,
            `const g = window.game;
             if (!g || !g.track || g.courseId !== ${JSON.stringify(course)}) return null;
             if (window.__prevTrack && g.track === window.__prevTrack) return null;
             return { len: Math.round(g.track.length), state: g.state };`,
            { timeoutMs: 4000 }
          );
        } catch {
          unresponsive += 1;
        }
        if (got) {
          ms = Date.now() - t0;
          len = got.len;
          break;
        }
      }
      if (!len) {
        wedged = true;
        ms = Date.now() - t0;
      }
      rows.push({ course, ms, len, wedged, unresponsive });
      const tag = wedged ? "WEDGED" : `${ms} ms`;
      console.log(
        `  ${String(r + 1).padStart(2)}. ${course.padEnd(9)} ${String(tag).padStart(10)}` +
          `  len=${len || "?"}${unresponsive ? `  (main thread unresponsive ${unresponsive}x)` : ""}`
      );
      // Let the scene settle so the next rebuild starts from a quiet frame.
      await sleep(600);
    }

    const built = rows.filter((r) => !r.wedged);
    const worst = built.reduce((m, r) => Math.max(m, r.ms), 0);
    const median = built.length
      ? built.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(built.length / 2)]
      : 0;
    const wedges = rows.filter((r) => r.wedged);

    console.log("");
    console.log(`built ${built.length}/${rows.length}  ·  median ${median} ms  ·  worst ${worst} ms`);
    for (const c of ORDER) {
      const mine = built.filter((r) => r.course === c).map((r) => r.ms);
      if (mine.length) {
        console.log(`  ${c.padEnd(9)} ${mine.map((m) => `${m}ms`).join(", ")}`);
      }
    }
    console.log("");

    check(`every stage built inside ${BUDGET_MS} ms`, wedges.length === 0, `${wedges.length} wedged: ${wedges.map((w) => w.course).join(", ") || "none"}`);
    check("main thread stayed responsive", rows.every((r) => r.unresponsive === 0), `${rows.reduce((s, r) => s + r.unresponsive, 0)} unresponsive poll(s)`);
    if (errors.length) check("no console errors", false, errors.slice(0, 4).map((e) => e.text || e).join(" | "));
    else check("no console errors", true);

    await browser.close();
    await server.close();
    console.log(fail ? `\nFAIL — ${fail} check(s) failed` : "\nPASS — stage builds are quick and repeatable");
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
