#!/usr/bin/env node
/**
 * qa-perf-attribute.mjs — where does the frame budget actually go?
 *
 * WHO THIS IS FOR: Performance Engineering, before touching any renderer knob.
 * WHAT IT DOES: drives to a live Desert race with the full pack, freezes the
 *   quality scaler so nothing re-grades mid-measurement, then A/B tests one GPU
 *   subsystem at a time — off, sample, back on — and prints the cost of each.
 * HOW IT CONNECTS: reads/writes live `window.game` fields only. It never edits
 *   config or any source file, so nothing it does persists past the run.
 *
 * WHY INDEPENDENT A/B: a cumulative "turn things off one by one" pass was tried
 *   first and produced nonsense (removing post-processing appeared to *cost*
 *   15 ms) because the auto tier-scaler kept re-grading and the car drove into
 *   different scenery density. Each row here runs at an identical frozen tier
 *   and is compared to a baseline re-measured in the same conditions.
 *
 * RUN:  node tools/qa-perf-attribute.mjs
 *       node tools/qa-perf-attribute.mjs --seconds=5 --tier=high
 * EXIT: 0 always — this is a measurement tool, not a gate.
 *
 * POWER BI MAPPING: none
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickResilient, installFrameRecorder, startRecording, stopRecording, sleep,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

const argv = process.argv.slice(2).join(" ");
const SECONDS = Number(/--seconds=(\d+)/.exec(argv)?.[1] || 4);
const TIER = /--tier=(high|medium|low|min)/.exec(argv)?.[1] || "";

/** @param {number[]} sorted @param {number} p */
function pct(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/**
 * Sample the live race and return frame-time stats.
 * @param {any} cdp
 * @returns {Promise<{n:number, mean:number, p50:number, p95:number, over:number}>}
 */
async function sample(cdp) {
  await installFrameRecorder(cdp);
  await startRecording(cdp);
  await sleep(SECONDS * 1000);
  const deltas = await stopRecording(cdp);
  if (deltas.length < 4) return { n: 0, mean: NaN, p50: NaN, p95: NaN, over: NaN };
  const sorted = deltas.slice().sort((a, b) => a - b);
  return {
    n: deltas.length,
    mean: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    p50: pct(sorted, 0.5),
    p95: pct(sorted, 0.95),
    over: deltas.filter((d) => d > 16.6).length / deltas.length
  };
}

/** Each entry switches one subsystem off, then restores exactly what it found. */
const TOGGLES = [
  {
    label: "post-process stack",
    off: `if (window.game.post) { window.__post = window.game.post.enabled; window.game.post.enabled = false; } 1`,
    on: `if (window.game.post) window.game.post.enabled = window.__post; 1`
  },
  {
    label: "sun shadow map",
    off: `window.__sh = window.game.renderer.shadowMap.enabled; window.game.renderer.shadowMap.enabled = false; 1`,
    on: `window.game.renderer.shadowMap.enabled = window.__sh; 1`
  },
  {
    label: "cabin mirror + cube reflections",
    off: `window.__mir = window.game._renderMirror; window.__ref = window.game._updateReflections;
          window.game._renderMirror = function(){}; window.game._updateReflections = function(){}; 1`,
    on: `window.game._renderMirror = window.__mir; window.game._updateReflections = window.__ref; 1`
  },
  {
    label: "volumetric sky / clouds",
    off: `if (window.game.sky) { window.__sky = window.game.sky.visible; window.game.sky.visible = false; } 1`,
    on: `if (window.game.sky) window.game.sky.visible = window.__sky; 1`
  },
  {
    label: "rival pack (14 cars)",
    off: `window.__op = []; for (const o of window.game.opponents) { if (o.mesh) { window.__op.push([o.mesh, o.mesh.visible]); o.mesh.visible = false; } } 1`,
    on: `for (const p of (window.__op || [])) p[0].visible = p[1]; 1`
  },
  {
    label: "pixel ratio → 1.0",
    off: `window.__d1 = window.game._perfDprScale;
          window.game._perfDprScale = (window.__d1 == null ? 1 : window.__d1) * (1.0 / window.game.renderer.getPixelRatio());
          window.game._onResize(); 1`,
    on: `window.game._perfDprScale = window.__d1; window.game._onResize(); 1`
  },
  {
    label: "pixel ratio → 0.75",
    off: `window.__d2 = window.game._perfDprScale;
          window.game._perfDprScale = (window.__d2 == null ? 1 : window.__d2) * (0.75 / window.game.renderer.getPixelRatio());
          window.game._onResize(); 1`,
    on: `window.game._perfDprScale = window.__d2; window.game._onResize(); 1`
  },
];

async function main() {
  if (!findChrome()) {
    console.error(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }
  console.log(`RALLY PERF ATTRIBUTION  ·  ${new Date().toISOString()}`);
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: false, width: 1600, height: 900 });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "window.game" });

    const gpu = await evaluate(cdp, `
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : "none");
      return { renderer: String(r), software: /swiftshader|software|llvmpipe/i.test(String(r)), dpr: window.devicePixelRatio };
    `);
    console.log(`GPU:    ${gpu.renderer}`);
    console.log(`devicePixelRatio: ${gpu.dpr}`);
    if (gpu.software) console.log("        ^ SOFTWARE RASTERISER — numbers are meaningless.\n");
    else console.log("");

    await clickResilient(cdp, "#btn-start", "PRESS START");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-menu"?1:null;`, { timeout: 15000, label: "SELECT MODE" });
    await clickResilient(cdp, "[data-menu='championship']", "CHAMPIONSHIP");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-cars"?1:null;`, { timeout: 15000, label: "SELECT CAR" });
    await clickResilient(cdp, "[data-car='celica']", "CELICA");
    await waitFor(cdp, `return window.game && window.game.track ? 1 : null;`, { timeout: 120000, label: "track build" });
    await waitFor(cdp, `return window.game && window.game.state === "race" ? 1 : null;`, { timeout: 180000, label: '"race" state' });

    // Drive through the game's own QA hook, steering along the racing line.
    // Two earlier attempts failed here: a bare dispatched keydown left the car
    // at 5 kph (unrepresentative scenery load), and holding throttle with zero
    // steer drove straight off-course into ungenerated terrain, where
    // track.update() blocked the main thread for over 180 s.
    await evaluate(cdp, `
      const g = window.game;
      g._qaDrive = { throttle: 0.9, steer: 0, brake: 0 };
      const out = {};
      window.__autoStop = false;
      window.__auto = function () {
        if (window.__autoStop) return;
        const p = g.player, t = g.track;
        if (p && t && t.sample) {
          const tgt = t.sample(p.progress + 20, out);
          if (tgt) {
            const want = Math.atan2(tgt.x - p.position.x, tgt.z - p.position.z);
            let err = want - p.yaw;
            while (err > Math.PI) err -= Math.PI * 2;
            while (err < -Math.PI) err += Math.PI * 2;
            g._qaDrive.steer = Math.max(-1, Math.min(1, err * 1.8));
            // Hold a realistic rally pace rather than pinning the limiter.
            g._qaDrive.throttle = p.speed > 30 ? 0.4 : 0.95;
          }
        }
        requestAnimationFrame(window.__auto);
      };
      requestAnimationFrame(window.__auto);
      1
    `);
    await sleep(6000);
    const drove = await evaluate(cdp, `return {
      speed: Math.round(window.game.player.speed),
      onRoad: !!(window.game.player._q && window.game.player._q.onRoad),
      progress: Math.round(window.game.player.progress)
    };`);
    console.log(`autopilot: speed ${drove.speed}, progress ${drove.progress} m, onRoad ${drove.onRoad}`);

    // Freeze the scaler. Without this the tier moves between rows and every
    // delta is meaningless.
    const frozen = await evaluate(cdp, `
      const g = window.game;
      if (!g.perfTier) return { tier: "none" };
      ${TIER ? `g._applyQualityTier({ id: "${TIER}", dpr: 1, shadow: 3072, post: "${TIER}", sky: "${TIER}", mirrorEvery: 1, changed: true });` : ""}
      const cur = g.perfTier.current();
      g.perfTier.tick = function () { return Object.assign({}, cur, { changed: false }); };
      return { tier: cur.id, ema: Math.round(g.perfTier.emaMs * 10) / 10 };
    `);

    const info = await evaluate(cdp, `return {
      opponents: window.game.opponents.length,
      shadow: window.game.sun && window.game.sun.shadow ? window.game.sun.shadow.mapSize.width : 0,
      shadowOn: window.game.renderer.shadowMap.enabled,
      post: !!(window.game.post && window.game.post.enabled),
      dpr: window.game.renderer.getPixelRatio(),
      w: window.game.renderer.domElement.width,
      h: window.game.renderer.domElement.height,
      speed: Math.round(window.game.player.speed)
    };`);
    const mpix = (info.w * info.h) / 1e6;
    console.log(`racing desert · ${info.opponents} rivals · speed ${info.speed}`);
    console.log(`tier FROZEN at "${frozen.tier}" (ema ${frozen.ema}ms) · shadowAtlas ${info.shadow}${info.shadowOn ? "" : " (off)"} · post ${info.post}`);
    console.log(`framebuffer ${info.w}x${info.h} = ${mpix.toFixed(2)} Mpix at renderer DPR ${info.dpr.toFixed(3)}`);
    console.log(`sampling ${SECONDS}s per row, baseline re-measured between rows\n`);

    const line = "─".repeat(88);
    console.log(line);
    console.log(`${"subsystem".padEnd(34)} ${"base p50".padStart(9)} ${"off p50".padStart(9)} ${"saved".padStart(8)} ${"off p95".padStart(9)} ${"fps off".padStart(8)}`);
    console.log(line);

    const results = [];
    for (const t of TOGGLES) {
      const base = await sample(cdp);
      await evaluate(cdp, t.off);
      await sleep(600);
      const off = await sample(cdp);
      await evaluate(cdp, t.on);
      await sleep(600);
      const saved = base.p50 - off.p50;
      results.push({ label: t.label, base: base.p50, off: off.p50, saved, p95: off.p95 });
      console.log(
        `${t.label.padEnd(34)} ${base.p50.toFixed(2).padStart(9)} ${off.p50.toFixed(2).padStart(9)} ` +
          `${((saved >= 0 ? "+" : "") + saved.toFixed(2)).padStart(8)} ${off.p95.toFixed(2).padStart(9)} ${(1000 / off.p50).toFixed(1).padStart(8)}`
      );
    }
    console.log(line);

    results.sort((a, b) => b.saved - a.saved);
    console.log("\nRANKED BY FRAME TIME RECOVERED (p50):");
    for (const r of results) {
      const bar = "█".repeat(Math.max(0, Math.round(Math.max(0, r.saved))));
      console.log(`  ${r.label.padEnd(34)} ${r.saved.toFixed(2).padStart(7)} ms  ${bar}`);
    }
    console.log(`\n  locked-60 budget ..... 16.67 ms`);
    console.log(`  locked-30 budget ..... 33.33 ms`);
    console.log(line);

    if (errors.length) {
      console.log(`\n${errors.length} page error(s):`);
      for (const e of errors.slice(0, 6)) console.log(`  [${e.type}] ${e.text}`);
    }

    await browser.close();
    await server.close();
    process.exit(0);
  } catch (err) {
    console.error(`\nFAIL  ${err.message}`);
    if (errors.length) for (const e of errors.slice(0, 6)) console.error(`  [${e.type}] ${e.text}`);
    try { await browser.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
