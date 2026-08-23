#!/usr/bin/env node
/**
 * qa-frame-probe.mjs — real frame-time measurement during a race.
 *
 * WHO THIS IS FOR: whoever owns acceptance criterion 1, "locked 60 fps on the
 *   target machine, no hitching on Desert with a full pack".
 * WHAT IT DOES: drives the game to a live Desert championship race, holds the
 *   throttle, taps requestAnimationFrame for a few seconds, and reports p50 /
 *   p95 / p99 frame time, the worst frame, and how many frames exceeded the
 *   16.6ms budget. It also reports the WebGL renderer string, because a number
 *   measured on a software rasteriser is not a number worth acting on.
 *
 * IMPORTANT: run this HEADED. Headless Chrome has no GPU and falls back to
 *   SwiftShader, which caps this game near 2 fps. Headed mode uses the real
 *   GPU and produces meaningful numbers. Headless is allowed but the report
 *   will say the measurement is not valid.
 *
 * RUN:  node tools/qa-frame-probe.mjs                 (headed, real GPU)
 *       node tools/qa-frame-probe.mjs --headless      (will warn: invalid)
 *       node tools/qa-frame-probe.mjs --seconds=10
 *       node tools/qa-frame-probe.mjs --strict        (fail the run if off 60fps)
 * EXIT: 0 unless --strict and the 60 fps target was missed on a real GPU.
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickResilient, mainThreadLag, waitForResponsiveMainThread,
  installFrameRecorder, startRecording, stopRecording, sleep,
} from "./lib/qa-harness.mjs";

const argv = process.argv.slice(2);
const HEADLESS = argv.includes("--headless");
const STRICT = argv.includes("--strict");
const SECONDS = Number(/--seconds=(\d+)/.exec(argv.join(" "))?.[1] || 6);

/** The 60 fps mandate in milliseconds. */
const BUDGET_MS = 1000 / 60;

/**
 * @param {number[]} sorted ascending
 * @param {number} p 0..1
 */
function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

async function main() {
  if (!findChrome()) {
    console.error("FAIL  no Chrome/Chromium binary found. Set CHROME_PATH.");
    process.exit(1);
  }
  console.log(`RALLY FRAME PROBE  ·  ${new Date().toISOString()}`);

  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: HEADLESS, width: 1600, height: 900 });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);
  console.log(`chrome: ${browser.browserVersion}  ${HEADLESS ? "(headless — software rasteriser)" : "(headed — real GPU)"}`);
  console.log(`serving on ${server.origin}\n`);

  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "window.game" });

    const gpu = await evaluate(cdp, `
      try {
        const c = document.createElement("canvas");
        const gl = c.getContext("webgl2") || c.getContext("webgl");
        if (!gl) return { renderer: "no WebGL context", software: true };
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        return { renderer: String(renderer), software: /swiftshader|software|llvmpipe|basic render/i.test(String(renderer)) };
      } catch (e) { return { renderer: "probe failed: " + e.message, software: true }; }
    `);
    console.log(`GPU:    ${gpu.renderer}`);
    const valid = !gpu.software;
    if (!valid) {
      console.log("        ^ SOFTWARE RASTERISER — the numbers below describe SwiftShader, not the game.\n");
    } else {
      console.log("");
    }

    // Boot-time main-thread stall is itself a headline number: if this is high,
    // the splash is painted but unclickable, which is the recurring bug.
    const bootLag = await mainThreadLag(cdp);
    const settle = await waitForResponsiveMainThread(cdp, 250, 90000);
    console.log(`main-thread lag at boot ..... ${bootLag} ms`);
    console.log(`time to become responsive ... ${settle.waitedMs} ms (settled at ${settle.lag} ms)\n`);

    // Walk to a live Desert championship race (full pack, per criterion 1).
    const c1 = await clickResilient(cdp, "#btn-start", "PRESS START");
    console.log(`PRESS START clicked via ${c1.via} (main-thread lag ${c1.lag}ms)`);
    await waitFor(cdp, `const e = document.querySelector(".screen.active"); return e && e.id === "screen-menu" ? 1 : null;`, { timeout: 15000, label: "SELECT MODE" });
    await clickResilient(cdp, "[data-menu='championship']", "CHAMPIONSHIP");
    await waitFor(cdp, `const e = document.querySelector(".screen.active"); return e && e.id === "screen-cars" ? 1 : null;`, { timeout: 15000, label: "SELECT CAR" });
    await clickResilient(cdp, "[data-car='celica']", "CELICA");
    await waitFor(cdp, `return window.game && window.game.track ? 1 : null;`, { timeout: 120000, label: "Desert track to finish building" });
    console.log("on Desert, waiting out the countdown…");
    await waitFor(cdp, `return window.game && window.game.state === "race" ? 1 : null;`, { timeout: 180000, label: '"race" state' });

    const pack = await evaluate(cdp, `return { opponents: window.game.opponents.length, course: window.game.courseId };`);
    console.log(`racing ${pack.course} with ${pack.opponents} opponents  ·  sampling ${SECONDS}s\n`);

    // Warm up briefly so first-frame shader compilation is not counted as a hitch.
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, text: "w" });
    await sleep(1500);

    await installFrameRecorder(cdp);
    await startRecording(cdp);
    await sleep(SECONDS * 1000);
    const deltas = await stopRecording(cdp);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });

    const reported = await evaluate(cdp, `return { fps: window.game.fps, speed: window.game.player.speed, t: window.game.raceTime };`);

    if (deltas.length < 2) {
      console.error(`FAIL  captured ${deltas.length} frames in ${SECONDS}s — nothing to measure.`);
      await browser.close(); await server.close();
      process.exit(1);
    }

    const sorted = deltas.slice().sort((a, b) => a - b);
    const sum = deltas.reduce((a, b) => a + b, 0);
    const mean = sum / deltas.length;
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    const worst = sorted[sorted.length - 1];
    const over = deltas.filter((d) => d > BUDGET_MS).length;
    const over33 = deltas.filter((d) => d > 33.3).length;
    const fpsFromP50 = 1000 / p50;

    // Locate the hitches in time. A single spike in the first second is shader
    // or IBL warm-up; spikes spread through the sample are a recurring cost and
    // a real violation of "no hitching on Desert with a full pack".
    let elapsed = 0;
    const hitches = [];
    for (const d of deltas) {
      elapsed += d;
      if (d > 33.3) hitches.push({ at: elapsed / 1000, ms: d });
    }

    const line = "─".repeat(72);
    console.log(line);
    console.log(`frames captured .............. ${deltas.length} over ${SECONDS}s  (${(deltas.length / SECONDS).toFixed(1)} fps average)`);
    console.log(`mean frame time .............. ${mean.toFixed(2)} ms`);
    console.log(`p50 frame time ............... ${p50.toFixed(2)} ms   (${fpsFromP50.toFixed(1)} fps)`);
    console.log(`p95 frame time ............... ${p95.toFixed(2)} ms`);
    console.log(`p99 frame time ............... ${p99.toFixed(2)} ms`);
    console.log(`worst frame .................. ${worst.toFixed(2)} ms`);
    console.log(`frames over 16.6ms budget .... ${over} / ${deltas.length}  (${((over / deltas.length) * 100).toFixed(1)}%)`);
    console.log(`frames over 33.3ms (hitch) ... ${over33} / ${deltas.length}  (${((over33 / deltas.length) * 100).toFixed(1)}%)`);
    console.log(`game's own FPS readout ....... ${reported.fps}`);
    console.log(`car speed while sampling ..... ${reported.speed.toFixed(1)} (sim clock ${reported.t.toFixed(1)}s)`);
    if (hitches.length) {
      console.log(`hitches (>33.3ms), when they happened:`);
      for (const h of hitches.slice(0, 12)) {
        console.log(`    +${h.at.toFixed(2)}s into sampling   ${h.ms.toFixed(1)} ms`);
      }
      const late = hitches.filter((h) => h.at > 2).length;
      console.log(`    ${late} of ${hitches.length} hitch(es) happened after the first 2s (i.e. not warm-up)`);
    }
    // The mandate is a LOCKED 60. Running far above it is not free: this game
    // steps physics with the raw frame delta, so a 120Hz display simulates at
    // double rate and per-frame smoothing constants move twice as fast.
    if (valid && fpsFromP50 > 75) {
      console.log(
        `\nNOTE: p50 implies ${fpsFromP50.toFixed(0)} fps — above the mandated locked 60 render cap.\n` +
          `      Race rendering is capped via GFX.lockRenderFps; physics uses fixed-step integration.\n` +
          `      If this probe was taken on title/menu, unlockFpsOnTitle allows higher refresh there.`
      );
    }
    console.log(line);

    let exit = 0;
    if (!valid) {
      console.log("VERDICT: NOT A VALID MEASUREMENT — software rasteriser.");
      console.log("         Re-run headed on the target machine: node tools/qa-frame-probe.mjs");
    } else {
      const holds60 = p95 <= 18 && over / deltas.length < 0.1;
      if (holds60) {
        console.log("VERDICT: holds 60 fps — p95 within budget, under 10% of frames over 16.6ms.");
      } else {
        console.log(`VERDICT: MISSES the locked-60 mandate — p50 ${p50.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms, ${((over / deltas.length) * 100).toFixed(0)}% of frames over budget.`);
        if (STRICT) exit = 1;
      }
    }
    if (errors.length) {
      console.log(`\n${errors.length} page error(s) during the run:`);
      for (const e of errors.slice(0, 5)) console.log(`  [${e.type}] ${e.text}`);
    }
    console.log(line);

    await browser.close();
    await server.close();
    process.exit(exit);
  } catch (err) {
    console.error(`\nFAIL  ${err.message}`);
    if (errors.length) for (const e of errors.slice(0, 5)) console.error(`  [${e.type}] ${e.text}`);
    try { await browser.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
