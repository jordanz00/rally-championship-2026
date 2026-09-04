#!/usr/bin/env node
/**
 * qa-loading-progress.mjs — prove the loading % advances with real stage work.
 *
 * RUN: node tools/qa-loading-progress.mjs
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, pressKey, sleep,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const SNAP = `
  const loading = document.getElementById("screen-loading");
  const pctEl = document.getElementById("load-pct");
  const status = document.getElementById("load-status");
  const active = !!(loading && loading.classList.contains("active"));
  const text = pctEl ? pctEl.textContent || "" : "";
  const n = parseInt(String(text).replace(/\\D/g, ""), 10);
  const g = window.game;
  return {
    active,
    pct: Number.isFinite(n) ? n : -1,
    status: status ? status.textContent || "" : "",
    state: g ? g.state : ""
  };
`;

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  await goto(cdp, `${server.origin}/index.html?v=235`);
  await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 15000, label: "game boot" });
  await pressKey(cdp, "Enter");
  await waitFor(cdp, `const el = document.querySelector(".screen.active"); return el && el.id === "screen-menu" ? 1 : null;`, {
    timeout: 8000, label: "SELECT MODE"
  });
  // Curtain in-fade finishes ~400ms after the screen id flips — click after it.
  await sleep(500);
  await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
  await waitFor(cdp, `const el = document.querySelector(".screen.active"); return el && el.id === "screen-cars" ? 1 : null;`, {
    timeout: 10000, label: "cars"
  });
  await waitFor(
    cdp,
    `const b = document.querySelector("[data-car='celica']"); return b && !b.disabled ? 1 : null;`,
    { timeout: 20000, label: "celica ready" }
  );
  await sleep(400);
  await clickSelector(cdp, "[data-car='celica']", "CELICA");
  await waitFor(cdp, `const el = document.querySelector(".screen.active"); return el && el.id === "screen-courses" ? 1 : null;`, {
    timeout: 20000, label: "courses"
  });
  await sleep(400);

  // Drop idle preload so we measure a cold build (accurate % path), not the cache jump.
  await evaluate(cdp, `
    const g = window.game;
    if (!g) return 0;
    g._preloadToken = null;
    if (g._preloadedTrack) {
      try { g._preloadedTrack.dispose(); } catch (e) {}
      g._preloadedTrack = null;
      g._preloadedCourse = null;
    }
    return 1;
  `);

  const samplePromise = (async () => {
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const snap = await evaluate(cdp, SNAP);
      if (!snap) {
        await sleep(40);
        continue;
      }
      if (snap.active && snap.pct >= 0) {
        samples.push({ t: Date.now() - t0, pct: snap.pct, status: snap.status });
      }
      if (samples.length > 0 && (snap.state === "countdown" || snap.state === "race") && !snap.active) {
        break;
      }
      await sleep(40);
    }
    return samples;
  })();

  await clickSelector(cdp, "[data-course='desert']", "DESERT");
  const samples = await samplePromise;

  console.log(`samples: ${samples.length}`);
  const unique = [...new Set(samples.map((s) => s.pct))];
  console.log(`unique %: ${unique.join(", ")}`);
  console.log(`statuses: ${[...new Set(samples.map((s) => s.status))].join(" | ")}`);

  assert(samples.length >= 8, `expected many progress samples, got ${samples.length}`);
  assert(unique.length >= 5, `expected ≥5 distinct %, got ${unique.length}: ${unique.join(",")}`);

  for (let i = 1; i < samples.length; i++) {
    assert(
      samples[i].pct >= samples[i - 1].pct,
      `progress went backwards: ${samples[i - 1].pct}% → ${samples[i].pct}%`
    );
  }

  const maxPct = Math.max(...samples.map((s) => s.pct));
  assert(maxPct >= 86, `never reached post-track wiring (% max ${maxPct})`);
  // Final 99–100 can paint for a single frame before countdown — soft check.
  if (maxPct < 95) {
    console.log(`note: peak % was ${maxPct} (grid/final may finish between polls)`);
  }

  const mid = samples.filter((s) => s.pct >= 15 && s.pct <= 55);
  assert(mid.length >= 2, `expected mid-band terrain samples (15–55%), got ${mid.length}`);

  const plant = samples.filter((s) => /plant|prop|tree/i.test(s.status) || (s.pct >= 54 && s.pct <= 88));
  assert(plant.length >= 1, "expected planting / high-band progress samples");

  const fatal = errors.filter((e) => !/AudioContext|favicon/i.test(String(e)));
  assert(fatal.length === 0, `console errors: ${fatal.join("; ")}`);

  console.log("PASS  loading % advances monotonically with real stage work");
  await browser.close();
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL ", err.message || err);
  process.exit(1);
});
