#!/usr/bin/env node
/**
 * qa-headed-worldvalidate.mjs — headed Pass-0 world geometry gate.
 *
 * WHO THIS IS FOR: Director / Cursor after "Begin headed world-validation".
 * WHAT IT DOES: Boots real Chrome, builds each championship stage with
 *   ?worldvalidate=1, reads Track._geomReport + tunnel mouth samples.
 * HOW IT CONNECTS: tools/lib/qa-harness.mjs · world-geometry-validator.js
 *
 * RUN:  RALLY_QA_ALLOW_CHROME=1 node tools/qa-headed-worldvalidate.mjs
 *       … --headed   (watch)
 * EXIT: 0 all stages GREEN · 1 any RED / timeout / console hard error
 */

import {
  ROOT,
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  evaluate,
  waitFor,
  clickSelector,
  sleep,
  chromeUnavailableHint,
} from "./lib/qa-harness.mjs";

const HEADED = process.argv.includes("--headed");
const COURSES = ["desert", "forest", "mountain", "lakeside"];
const BUILD_TIMEOUT_MS = 180000;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * @param {import('./lib/qa-harness.mjs').CdpSession} cdp
 * @param {string} courseId
 */
async function loadCourse(cdp, courseId) {
  await evaluate(
    cdp,
    `
    const g = window.game;
    if (!g) throw new Error("no game");
    g.mode = "practice";
    g.carId = g.carId || "celica";
    g._beginRace(${JSON.stringify(courseId)});
    return 1;
  `
  );
  const ready = await waitFor(
    cdp,
    `
    const g = window.game;
    if (!g || !g.track || !g.track._geomReport) return null;
    if (g.courseId !== ${JSON.stringify(courseId)}) return null;
    if (g.state !== "countdown" && g.state !== "race" && g.state !== "loading") {
      // loading may be via screen only
    }
    const el = document.querySelector(".screen.active");
    if (el && el.id === "screen-loading") return null;
    if (!g.track.points || g.track.points.length < 10) return null;
    return {
      state: g.state,
      course: g.courseId,
      length: g.track.length,
      report: g.track._geomReport,
      tunnels: (g.track._tunnelVolumes || []).map((v) => ({
        id: v.id, dist0: v.dist0, dist1: v.dist1, width: v.width, margin: v.margin
      })),
      mouths: (g.track._tunnelMouthPrisms || []).length,
    };
  `,
    { timeout: BUILD_TIMEOUT_MS, label: `${courseId} track + geomReport` }
  );
  return ready;
}

/**
 * Extra tunnel mouth probes — ground vs road at entrance/exit ± pads.
 * @param {import('./lib/qa-harness.mjs').CdpSession} cdp
 */
async function probeTunnels(cdp) {
  return evaluate(
    cdp,
    `
    const g = window.game;
    const track = g && g.track;
    if (!track || !track.points) return { probes: [] };
    const pts = track.points;
    const vols = track._tunnelVolumes || [];
    const scenery = track._def && track._def.scenery;
    const probes = [];
    for (const vol of vols) {
      for (const [label, dist] of [
        ["approach", vol.dist0 - 12],
        ["entrance", vol.dist0],
        ["mid", (vol.dist0 + vol.dist1) * 0.5],
        ["exit", vol.dist1],
        ["departure", vol.dist1 + 12],
      ]) {
        let best = null;
        let bestD = 1e9;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.abs(pts[i].dist - dist);
          if (d < bestD) { bestD = d; best = pts[i]; }
        }
        if (!best) continue;
        let gy = null;
        try {
          if (typeof track._groundHeight === "function") {
            gy = track._groundHeight(best.x, best.z, scenery);
          }
        } catch (e) {
          gy = null;
        }
        const delta = gy == null ? null : best.y - gy;
        probes.push({
          vol: vol.id,
          label,
          dist: best.dist,
          tunnel: !!best.tunnel,
          roadY: best.y,
          groundY: gy,
          delta,
          width: best.width,
        });
      }
    }
    return { probes, mouthPrisms: (track._tunnelMouthPrisms || []).length };
  `
  );
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }

  console.log("════════════════════════════════════════════════════════");
  console.log("RALLY HEADED WORLD-VALIDATION  ·  Pass 0");
  console.log(`browser: ${chrome}${HEADED ? " (headed)" : " (headless)"}`);
  console.log("════════════════════════════════════════════════════════\n");

  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: !HEADED });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  /** @type {{ id: string, ok: boolean, report: object, tunnels: object, probes: object[] }[]} */
  const results = [];
  let failed = 0;

  try {
    await goto(cdp, `${server.origin}/index.html?worldvalidate=1&perf=medium`);
    await waitFor(
      cdp,
      `return window.game && document.getElementById("screen-title") ? 1 : null;`,
      { timeout: 60000, label: "game boot" }
    );
    await sleep(1500);

    // Title → menu
    await evaluate(cdp, `
      try { if (window.game && window.game._leaveTitle) window.game._leaveTitle(); } catch (e) {}
      return 1;
    `);
    await waitFor(
      cdp,
      `const el = document.querySelector(".screen.active"); return el && el.id === "screen-menu" ? 1 : null;`,
      { timeout: 20000, label: "menu" }
    );

    // Warm a car path via practice UI once (garage)
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `return [...document.querySelectorAll("[data-car]")].some((b) => !b.disabled) ? 1 : null;`,
      { timeout: 45000, label: "car selectable" }
    );
    await evaluate(cdp, `
      const b = document.querySelector("[data-car='celica']");
      if (b && !b.disabled) b.click();
      return 1;
    `);
    // If that started desert, wait for it then we'll reload each course
    await waitFor(
      cdp,
      `
      const g = window.game;
      if (!g) return null;
      if (g.track && g.track._geomReport) return 1;
      const el = document.querySelector(".screen.active");
      if (el && el.id === "screen-loading") return null;
      return null;
    `,
      { timeout: BUILD_TIMEOUT_MS, label: "first practice track" }
    ).catch(() => null);

    for (const id of COURSES) {
      console.log(`── ${id.toUpperCase()} ──`);
      const t0 = Date.now();
      let ready;
      try {
        ready = await loadCourse(cdp, id);
      } catch (err) {
        console.error(`  ✗ build failed: ${err.message || err}`);
        failed++;
        results.push({ id, ok: false, report: null, tunnels: [], probes: [] });
        continue;
      }
      const probe = await probeTunnels(cdp);
      const report = ready.report;
      const ok = !!report && report.ok;
      if (!ok) failed++;
      console.log(`  ${ok ? "✓ GREEN" : "✗ RED"}  length=${(ready.length || 0).toFixed?.(0) ?? ready.length}m  ${(Date.now() - t0) / 1000 | 0}s`);
      console.log(
        `  float=${report?.stats?.floatRoad ?? "?"} bury=${report?.stats?.buryRoad ?? "?"} tunnels=${report?.stats?.tunnelVolumes ?? 0} mouths=${ready.mouths}`
      );
      if (report?.errors?.length) {
        for (const e of report.errors.slice(0, 12)) {
          console.log(`  RED [${e.code}] ${e.message}`);
        }
      }
      if (report?.warnings?.length) {
        for (const w of report.warnings.slice(0, 8)) {
          console.log(`  ! [${w.code}] ${w.message}`);
        }
      }
      if (probe.probes?.length) {
        console.log("  tunnel probes:");
        for (const p of probe.probes) {
          const d =
            p.delta == null ? "n/a" : `${p.delta >= 0 ? "+" : ""}${p.delta.toFixed(2)}m`;
          console.log(
            `    ${p.vol} ${p.label.padEnd(10)} dist=${p.dist.toFixed(0)} tunnel=${p.tunnel} Δroad-ground=${d}`
          );
        }
      }
      results.push({
        id,
        ok,
        report,
        tunnels: ready.tunnels,
        probes: probe.probes || [],
      });
      console.log("");
    }

    const hardErrs = errors.filter(
      (e) => !/404|Failed to load|net::|AudioContext|favicon/i.test(String(e))
    );
    if (hardErrs.length) {
      console.log("Console / exception hard errors:");
      for (const e of hardErrs.slice(0, 15)) console.log(`  · ${String(e).slice(0, 200)}`);
      failed += hardErrs.length > 0 ? 1 : 0;
    }

    console.log("════════════════════════════════════════════════════════");
    for (const r of results) {
      console.log(`  ${r.id.padEnd(10)} ${r.ok ? "GREEN" : "RED"}`);
    }
    if (failed) {
      console.log(`\nFAIL  ·  ${failed} issue group(s) — fix generators, re-run.`);
      process.exitCode = 1;
    } else {
      console.log("\nPASS  ·  all championship stages GREEN");
    }
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    try {
      await server.close();
    } catch {
      /* ignore */
    }
  }
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
