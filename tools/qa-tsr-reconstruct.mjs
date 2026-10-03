#!/usr/bin/env node
/**
 * qa-tsr-reconstruct.mjs — legal TSR vs native proof on Forest ~600 m.
 *
 * WHO THIS IS FOR: the reconstruct sprint. Proves the in-engine TSR path
 *   presents a full-res frame (not NVIDIA DLSS).
 * WHAT IT DOES: boots practice Forest twice (?tsr=off then ?tsr=quality),
 *   plants the same 600 m spawn, grabs still + mid-motion PNGs, and measures
 *   40 rAF samples ignoring gaps >200 ms.
 * HOW IT CONNECTS: Playwright in .qa/. Uses the preview server — never kills
 *   8766. Writes /tmp/tsr and tools/qa-out.
 *
 * RUN:  RALLY_ORIGIN=http://127.0.0.1:8766 node tools/qa-tsr-reconstruct.mjs
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(repo, ".qa", "browsers");
const require = createRequire(path.join(repo, ".qa", "package.json"));
const { chromium } = require("playwright");

const ORIGIN = process.env.RALLY_ORIGIN || "http://127.0.0.1:8766";
const OUT_TMP = "/tmp/tsr";
const OUT_REPO = path.join(repo, "tools", "qa-out");

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!fs.existsSync(root)) return undefined;
  for (const dir of fs.readdirSync(root)) {
    if (!/^chromium/.test(dir)) continue;
    for (const sub of fs.readdirSync(path.join(root, dir))) {
      const shell = path.join(root, dir, sub, "chrome-headless-shell");
      if (fs.existsSync(shell)) return shell;
      const app = path.join(root, dir, sub, "Chromium.app/Contents/MacOS/Chromium");
      if (fs.existsSync(app)) return app;
    }
  }
  return undefined;
}

function pct(list, p) {
  if (!list.length) return NaN;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function saveShot(buf, name) {
  fs.mkdirSync(OUT_TMP, { recursive: true });
  fs.mkdirSync(OUT_REPO, { recursive: true });
  const a = path.join(OUT_TMP, name);
  const b = path.join(OUT_REPO, name);
  fs.writeFileSync(a, buf);
  fs.writeFileSync(b, buf);
  return a;
}

async function walkToForest(page, errors) {
  const click = async (sel, label) => {
    try {
      await page.click(sel, { timeout: 8000 });
      return true;
    } catch {
      /* retry force */
    }
    try {
      await page.click(sel, { timeout: 4000, force: true });
      return true;
    } catch (err) {
      errors.push(`${label}: ${String(err.message).split("\n")[0]}`);
      return false;
    }
  };

  await page.waitForFunction(() => !!window.game, { timeout: 30000 });
  await page.waitForTimeout(400);
  await click("#btn-start", "PRESS START");
  await page.waitForTimeout(500);
  await click('[data-menu="practice"]', "PRACTICE");
  await page.waitForTimeout(500);
  await page.waitForFunction(() => {
    const b = document.querySelector("[data-car='celica']");
    return b && !b.disabled;
  }, { timeout: 90000 });
  await click("[data-car='celica']", "CELICA");
  await page.waitForTimeout(400);
  await page.waitForFunction(() => {
    const e = document.querySelector(".screen.active");
    return e && e.id === "screen-courses";
  }, { timeout: 30000 });
  await click("[data-course='forest']", "FOREST");
  await page.waitForFunction(
    () => window.game && window.game.track && window.game.courseId === "forest" && window.game.player,
    { timeout: 240000 }
  );
}

async function plant600(page) {
  return page.evaluate(() => {
    const g = window.game;
    if (!g || !g.player || !g.track) return { ok: false, why: "no game" };
    g.state = "race";
    g.countdown = 0;
    g._countHold = false;
    g._presentFrozen = false;
    g._gridCamHold = 0;
    g.player.spawn(g.track, 600, 0);
    if (g.tsr) g.tsr.reset();
    if (g._syncPackMeshes) g._syncPackMeshes(1);
    g._camSnap = true;
    if (g._chaseCam) g._chaseCam(1 / 60);
    if (g._syncWorldStream) g._syncWorldStream();
    const snap = g.qaSnapshot ? g.qaSnapshot() : null;
    return {
      ok: true,
      progress: g.player.progress,
      tsr: snap && snap.tsr,
      dpr: g.renderer ? g.renderer.getPixelRatio() : 0,
      shadow: g.sun && g.sun.shadow ? g.sun.shadow.mapSize.x : 0,
      mode: g.tsr ? g.tsr.mode : "none",
      active: !!(g.tsr && g.tsr.active),
    };
  });
}

async function measureFrames(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const dts = [];
        let last = 0;
        const need = 48;
        const tick = (now) => {
          if (last) dts.push(now - last);
          last = now;
          if (dts.length >= need) resolve(dts);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
  );
}

async function drive(page, ms) {
  await page.evaluate(() => {
    const g = window.game;
    g._qaDrive = { throttle: 1, steer: 0, brake: 0, handbrake: 0 };
    if (g.input) g.input._qaHold = g._qaDrive;
    g.state = "race";
  });
  await page.waitForTimeout(ms);
  await page.evaluate(() => {
    const g = window.game;
    g._qaDrive = { throttle: 0, steer: 0, brake: 0, handbrake: 0 };
  });
}

async function runMode(browser, mode, errors) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  const localErr = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") localErr.push(msg.text());
  });
  page.on("pageerror", (err) => localErr.push(`UNCAUGHT ${err.message}`));

  const url = `${ORIGIN}/index.html?tsr=${mode}`;
  console.log(`\n--- ${mode}  ${url} ---`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await walkToForest(page, localErr);
  const plant = await plant600(page);
  console.log(`  plant  progress=${plant.progress}  tsr=${plant.mode} active=${plant.active} dpr=${plant.dpr} shadow=${plant.shadow}`);
  if (plant.tsr) console.log(`  tsr    ${JSON.stringify(plant.tsr)}`);

  await page.waitForTimeout(700);
  const still = await page.screenshot({ type: "png" });
  const stillPath = saveShot(still, `forest-600-tsr-${mode}-still.png`);
  console.log(`  still  ${stillPath}`);

  const raw = await measureFrames(page);
  const kept = raw.filter((d) => d <= 200).slice(0, 40);
  const p50 = pct(kept, 50);
  console.log(`  frames raw=${raw.length} kept=${kept.length} p50=${p50.toFixed(2)} ms  (ignored ${raw.length - kept.length} gaps >200 ms)`);

  await drive(page, 3000);
  const motion = await page.screenshot({ type: "png" });
  const motionPath = saveShot(motion, `forest-600-tsr-${mode}-motion.png`);
  console.log(`  motion ${motionPath}`);

  const after = await page.evaluate(() => {
    const g = window.game;
    const snap = g.qaSnapshot ? g.qaSnapshot() : null;
    const info = {
      progress: g.player ? g.player.progress : null,
      speed: g.player ? g.player.speed : null,
      resets: g.tsr ? g.tsr.stats.resets : null,
      velMeshes: g.tsr ? g.tsr.stats.velMeshes : null,
      tsrErr: window.__rallyTsrError || null,
    };
    return { snap, info };
  });
  console.log(`  after  progress=${after.info.progress} speed=${after.info.speed} resets=${after.info.resets} vel=${after.info.velMeshes}`);

  const fx = localErr.filter((e) => /Cannot create property 'fx'|tsr|TSR|WebGL|shader/i.test(e));
  if (fx.length) {
    console.log(`  errors ${fx.length}:`);
    for (const e of fx.slice(0, 8)) console.log(`    ${e.slice(0, 220)}`);
  } else {
    console.log(`  errors none matching TSR / fx / WebGL`);
  }
  errors.push(...localErr);
  await page.close();
  return { plant, p50, kept: kept.length, stillPath, motionPath, errors: localErr, after };
}

async function main() {
  fs.mkdirSync(OUT_TMP, { recursive: true });
  fs.mkdirSync(OUT_REPO, { recursive: true });
  const exe = findChromium();
  console.log(`TSR RECONSTRUCT  ·  ${new Date().toISOString()}`);
  console.log(`origin   ${ORIGIN}`);
  console.log(`chrome   ${exe || "(playwright default)"}`);

  const browser = await chromium.launch({
    executablePath: exe,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  const errors = [];
  try {
    const off = await runMode(browser, "off", errors);
    const quality = await runMode(browser, "quality", errors);
    const summary = {
      origin: ORIGIN,
      off: { p50: off.p50, kept: off.kept, plant: off.plant, still: off.stillPath, motion: off.motionPath },
      quality: {
        p50: quality.p50,
        kept: quality.kept,
        plant: quality.plant,
        still: quality.stillPath,
        motion: quality.motionPath,
      },
      fxErrors: errors.filter((e) => /Cannot create property 'fx'/.test(e)),
    };
    const jsonPath = path.join(OUT_TMP, "tsr-summary.json");
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(OUT_REPO, "tsr-summary.json"), JSON.stringify(summary, null, 2));
    console.log(`\nSUMMARY  off p50=${off.p50.toFixed(2)} ms  quality p50=${quality.p50.toFixed(2)} ms`);
    console.log(`  TypeError fx: ${summary.fxErrors.length ? summary.fxErrors[0] : "none"}`);
    console.log(`  wrote ${jsonPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL  ${err.stack || err.message}`);
  process.exit(1);
});
