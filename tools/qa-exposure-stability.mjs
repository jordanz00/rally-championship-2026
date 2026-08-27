#!/usr/bin/env node
/**
 * qa-exposure-stability.mjs — "the whole screen washes out" must never return.
 *
 * WHO THIS IS FOR: whoever owns the claim that Desert is correctly exposed.
 * WHAT IT DOES: boots a race and samples the real framebuffer at t ≈ 0, 1, 2,
 *   3, 5, 8 and 12 s, computing whole-frame mean luminance for each sample plus
 *   a snapshot of every GLOBAL brightness control (tone-map exposure, sun /
 *   hemi / ambient / fill intensity, bloom strength, quality tier). A ramp in
 *   the luminance series next to a ramp in one of those controls names the
 *   culprit; a flat series clears the exposure pipeline entirely.
 * HOW IT CONNECTS: pure QA. Reads game state, never writes it (except the
 *   throttle key, in --drive mode).
 *
 * WHY A GATE AND NOT A SCREENSHOT: a single frame cannot show a ramp. The
 *   reported defect was "starts fine, then ramps up over a few seconds", which
 *   is only visible as a time series.
 *
 * IMPORTANT: run HEADED. Under SwiftShader the frame is not the shipped image.
 *
 * RUN:  node tools/qa-exposure-stability.mjs                 (driving, desert)
 *       node tools/qa-exposure-stability.mjs --static
 *       node tools/qa-exposure-stability.mjs --course=forest
 *       node tools/qa-exposure-stability.mjs --keep          (keep PNG frames)
 * EXIT: 1 if whole-frame brightness drifts outside the band below.
 */

import fs from "node:fs";
import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, sleep,
} from "./lib/qa-harness.mjs";
import { lumaStats } from "./lib/png-luma.mjs";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const m = new RegExp(`--${name}=([^\\s]+)`).exec(argv.join(" "));
  return m ? m[1] : dflt;
};
const COURSE = arg("course", "desert");
const STATIC = argv.includes("--static");
const HEADLESS = argv.includes("--headless");
const MODE = STATIC ? "static" : "drive";

/** Seconds after the race goes live at which to grab a frame. */
const SAMPLE_TIMES = [0, 1, 2, 3, 5, 8, 12];

/**
 * Acceptance band.
 *
 * HOW THIS GATE AVOIDS MEASURING THE WRONG THING — read before loosening it:
 *
 * Whole-frame brightness on a MOVING car is dominated by scene content. Driving
 * out of a shaded start area into open dunes legitimately raises mean luminance
 * about 40%, and a spin into a sand bank raises it more. A band on the driving
 * series therefore fails on honest gameplay and would get "tuned" until it
 * asserted nothing. So the two halves are asserted separately:
 *
 *   1. STATIONARY samples — the scene is fixed, so ANY brightness drift is the
 *      pipeline. This is where the tight band applies.
 *   2. EVERY sample, moving or not — the global brightness controls must be
 *      CONSTANT. This is the direct catch for the defect class: an adaptive
 *      exposure loop, a per-frame `+=` on a light intensity or bloom strength,
 *      or a quality tier that shifts exposure would all move one of these
 *      numbers, whatever the car is doing.
 *
 * Assertion 2 is the real gate. It is exact rather than statistical, so it
 * cannot be satisfied by accident.
 */
const BAND = {
  /** Brightest / darkest across STATIONARY samples only. */
  maxStationaryRatio: 1.12,
  /** Any single frame this bright is a blown frame, moving or not. */
  maxMean: 0.72,
  /** A frame this dark means we broke lighting in the other direction. */
  minMean: 0.08,
  /** Share of near-white pixels that counts as "washed out". */
  maxClipped: 0.3,
  /** Speed under which a sample counts as stationary. */
  stationarySpeed: 1.5,
};

/**
 * Global brightness controls that must not move during a race, with the drift
 * tolerated for each. Anything non-zero here is a real per-frame accumulation.
 *
 * `cave` and `tunnelBlend` are excluded on purpose: they are SUPPOSED to ramp,
 * inside a tunnel. No stage puts a tunnel in the first 12 s, and the tunnel
 * blend is reported in the table so an unexpected one is visible.
 */
const FLAT_GLOBALS = {
  exposure: 0.005,
  sun: 0.01,
  fill: 0.01,
  hemi: 0.01,
  ambient: 0.01,
  skyRim: 0.01,
  contrast: 0.005,
  saturation: 0.005,
  skyExposure: 0.005,
};

let fail = 0;
/** @param {string} label @param {boolean} ok @param {string} [detail] */
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Every per-frame global that could brighten the whole image. */
const GLOBALS_EXPR = `(() => {
  const g = window.game;
  const post = g.post && g.post._compMat ? g.post._compMat.uniforms : null;
  return {
    exposure: g.renderer.toneMappingExposure,
    toneMapping: g.renderer.toneMapping,
    sun: g.sun ? g.sun.intensity : null,
    fill: g.fill ? g.fill.intensity : null,
    hemi: g.hemi ? g.hemi.intensity : null,
    ambient: g.ambient ? g.ambient.intensity : null,
    skyRim: g._skyRim ? g._skyRim.intensity : null,
    cave: g.caveLight ? g.caveLight.intensity : null,
    tunnelBlend: g._tunnelBlend != null ? Math.round(g._tunnelBlend * 1000) / 1000 : null,
    bloom: post ? post.bloomStrength.value : null,
    contrast: post ? post.contrast.value : null,
    saturation: post ? post.saturation.value : null,
    postQuality: g.post ? g.post.quality : null,
    tier: g.perfTier ? g.perfTier.tier : null,
    dpr: Math.round(g.renderer.getPixelRatio() * 100) / 100,
    skyExposure: g.sky && g.sky.material && g.sky.material.uniforms
      ? g.sky.material.uniforms.uExposure.value : null,
    raceTime: g.raceTime != null ? Math.round(g.raceTime * 100) / 100 : null,
    speed: g.player ? Math.round(g.player.speed * 10) / 10 : null,
  };
})()`;

async function main() {
  if (!findChrome()) throw new Error("no Chrome/Chromium found — set CHROME_PATH");
  console.log(`EXPOSURE STABILITY  ·  ${COURSE} · ${MODE}  ·  ${new Date().toISOString()}\n`);

  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: HEADLESS, width: 1280, height: 720 });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 30000, label: "window.game" });

    const gpu = await evaluate(cdp, `
      try {
        const c = document.createElement("canvas");
        const gl = c.getContext("webgl2") || c.getContext("webgl");
        const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
        const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : "none");
        return { renderer: String(r), software: /swiftshader|software|llvmpipe/i.test(String(r)) };
      } catch (e) { return { renderer: "probe failed", software: true }; }
    `);
    console.log(`GPU: ${gpu.renderer}${gpu.software ? "  (SOFTWARE — brightness still valid, perf is not)" : ""}\n`);

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
    await clickSelector(cdp, `[data-course='${COURSE}']`, COURSE.toUpperCase());
    await waitFor(cdp, `const g=window.game; return g&&g.track&&g.courseId==="${COURSE}"?1:null;`, { timeout: 240000, label: `${COURSE} track` });
    await waitFor(cdp, `return window.game && window.game.state === "race" ? 1 : null;`, { timeout: 180000, label: '"race" state' });

    // game._qaDrive is the engine's own QA input override. In static mode the
    // brake and handbrake are held so the car genuinely does not move — without
    // it the car creeps off the line and the "stationary" samples stop being a
    // controlled test of the pipeline.
    await evaluate(cdp, MODE === "drive"
      ? `window.game._qaDrive = { throttle: 1, steer: 0, brake: 0, handbrake: 0 }; 1`
      : `window.game._qaDrive = { throttle: 0, steer: 0, brake: 1, handbrake: 1 }; 1`);

    const rows = [];
    let prev = 0;
    for (const t of SAMPLE_TIMES) {
      const wait = (t - prev) * 1000;
      if (wait > 0) await sleep(wait);
      prev = t;
      const globals = await evaluate(cdp, `return ${GLOBALS_EXPR};`);
      const cap = await cdp.send("Page.captureScreenshot", { format: "png" });
      const png = Buffer.from(cap.data, "base64");
      const file = `/tmp/exposure-${COURSE}-${MODE}-t${t}.png`;
      fs.writeFileSync(file, png);
      // Crop the bottom fifth: the HUD is a fixed bright overlay and would
      // dilute a scene-brightness measurement without ever ramping.
      const luma = lumaStats(png, { skipBottomFraction: 0.2 });
      rows.push({ t, file, luma, globals });
    }

    await evaluate(cdp, `window.game._qaDrive = null; 1`);

    const line = "─".repeat(108);
    console.log(line);
    console.log("  t     mean    p50    p99   clip%   expo   sun   hemi   amb   fill   bloom  tier    spd   frame");
    console.log(line);
    for (const r of rows) {
      const g = r.globals;
      const n = (v, d = 2) => (v == null ? "  -  " : Number(v).toFixed(d));
      console.log(
        `  ${String(r.t).padStart(2)}s  ` +
        `${r.luma.mean.toFixed(4)}  ${r.luma.p50.toFixed(3)}  ${r.luma.p99.toFixed(3)}  ` +
        `${(r.luma.clipped * 100).toFixed(1).padStart(5)}   ` +
        `${n(g.exposure)}  ${n(g.sun)}  ${n(g.hemi)}  ${n(g.ambient)}  ${n(g.fill)}  ${n(g.bloom)}   ` +
        `${String(g.tier || "?").padEnd(6)} ${String(n(g.speed, 0)).padStart(4)}   ${r.file}`
      );
    }
    console.log(line);

    const means = rows.map((r) => r.luma.mean);
    const minMean = Math.min(...means);
    const maxMean = Math.max(...means);
    const maxClip = Math.max(...rows.map((r) => r.luma.clipped));

    // Reported for context, never asserted on a moving car — see BAND.
    const head = means.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
    const tail = means.slice(-2).reduce((a, b) => a + b, 0) / 2;
    const rampPct = head > 0 ? ((tail - head) / head) * 100 : 0;

    const still = rows.filter((r) => (r.globals.speed || 0) < BAND.stationarySpeed);
    const stillMeans = still.map((r) => r.luma.mean);
    const stillRatio = stillMeans.length >= 3 && Math.min(...stillMeans) > 0
      ? Math.max(...stillMeans) / Math.min(...stillMeans)
      : null;

    console.log(`whole-frame mean ......... ${minMean.toFixed(4)} … ${maxMean.toFixed(4)}   (all samples)`);
    console.log(`head→tail drift .......... ${rampPct >= 0 ? "+" : ""}${rampPct.toFixed(1)}%   (context only — scene content moves this)`);
    console.log(`stationary samples ....... ${still.length}/${rows.length}${stillRatio ? `   max/min ${stillRatio.toFixed(3)}×` : ""}`);
    console.log(`worst near-white share ... ${(maxClip * 100).toFixed(1)}%\n`);

    // 1. THE REAL GATE: no global brightness control may move.
    let worstName = "";
    let worstDrift = 0;
    let worstLimit = 1;
    for (const [key, limit] of Object.entries(FLAT_GLOBALS)) {
      const vals = rows.map((r) => r.globals[key]).filter((v) => v != null);
      if (vals.length < 2) continue;
      const drift = Math.max(...vals) - Math.min(...vals);
      if (drift / limit > worstDrift / worstLimit) {
        worstDrift = drift;
        worstLimit = limit;
        worstName = key;
      }
    }
    check(
      "no global brightness control drifts during the race",
      worstDrift <= worstLimit,
      worstName
        ? `worst is ${worstName} at ${worstDrift.toFixed(4)} (limit ${worstLimit})`
        : "nothing to compare"
    );

    // 2. With the scene held still, any brightness drift is the pipeline.
    if (stillRatio != null) {
      check(
        "brightness is flat while the car is stationary",
        stillRatio <= BAND.maxStationaryRatio,
        `max/min ${stillRatio.toFixed(3)}× over ${still.length} still samples (limit ${BAND.maxStationaryRatio}×)`
      );
    } else {
      console.log(`  skip  brightness-while-stationary — only ${still.length} still sample(s); run with --static`);
    }

    // 3. Sanity bounds that hold however the car is moving.
    check("no frame is blown out", maxMean <= BAND.maxMean, `brightest mean ${maxMean.toFixed(4)} (limit ${BAND.maxMean})`);
    check("no frame is black", minMean >= BAND.minMean, `darkest mean ${minMean.toFixed(4)} (floor ${BAND.minMean})`);
    check("near-white pixels stay bounded", maxClip <= BAND.maxClipped, `${(maxClip * 100).toFixed(1)}% (limit ${BAND.maxClipped * 100}%)`);

    if (errors.length) {
      console.log(`\n${errors.length} page error(s):`);
      for (const e of errors.slice(0, 6)) console.log(`  [${e.type}] ${e.text}`);
    }
    console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? `${fail} check(s) failed` : "exposure is stable over the first 12 s"}`);
    if (!argv.includes("--keep")) {
      console.log("frames kept in /tmp for inspection (all runs keep frames).");
    }
  } finally {
    await browser.close();
    await server.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(`FAIL  ${err.message}`);
  process.exit(1);
});
