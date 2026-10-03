#!/usr/bin/env node
/**
 * qa-appear.mjs — Quality TSR vs TSR+LOOK proof.
 *
 * Forest ~600 m and Desert ~400 m. Appearance on vs ?appear=0.
 * Uses tools/lib/qa-harness.mjs. Never kills :8766.
 *
 * RUN:  RALLY_ORIGIN=http://127.0.0.1:8766 node tools/qa-appear.mjs
 */

import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  waitFor,
  evaluate,
  clickResilient,
  chromeUnavailableHint,
} from "./lib/qa-harness.mjs";

const ORIGIN = process.env.RALLY_ORIGIN || "http://127.0.0.1:8766";
const OUT_TMP = "/tmp/appear";
const OUT_REPO = path.join(ROOT, "tools", "qa-out");

function pct(list, p) {
  if (!list.length) return NaN;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function saveBuf(buf, name) {
  fs.mkdirSync(OUT_TMP, { recursive: true });
  fs.mkdirSync(OUT_REPO, { recursive: true });
  const a = path.join(OUT_TMP, name);
  const b = path.join(OUT_REPO, `appear-${name}`);
  fs.writeFileSync(a, buf);
  fs.writeFileSync(b, buf);
  return a;
}

async function shotPng(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  return saveBuf(Buffer.from(r.data, "base64"), name);
}

async function walkToCourse(cdp, course) {
  await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 30000, label: "game" });
  await clickResilient(cdp, "#btn-start", "PRESS START");
  await clickResilient(cdp, '[data-menu="practice"]', "PRACTICE");
  await waitFor(
    cdp,
    `const b = document.querySelector("[data-car='celica']"); return b && !b.disabled ? 1 : null;`,
    { timeout: 90000, label: "celica" }
  );
  await clickResilient(cdp, "[data-car='celica']", "CELICA");
  await waitFor(
    cdp,
    `const e = document.querySelector(".screen.active"); return e && e.id === "screen-courses" ? 1 : null;`,
    { timeout: 30000, label: "courses" }
  );
  await clickResilient(cdp, `[data-course='${course}']`, course.toUpperCase());
  await waitFor(
    cdp,
    `const g = window.game; return g && g.track && g.courseId === "${course}" && g.player ? 1 : null;`,
    { timeout: 240000, label: course }
  );
}

async function plant(cdp, metres) {
  return evaluate(cdp, `
    const g = window.game;
    if (!g || !g.player || !g.track) return { ok: false };
    g.state = "race";
    g.countdown = 0;
    g._countHold = false;
    g._presentFrozen = false;
    g._gridCamHold = 0;
    g.player.spawn(g.track, ${metres}, 0);
    if (g.tsr) g.tsr.reset();
    if (g._syncPackMeshes) g._syncPackMeshes(1);
    g._camSnap = true;
    if (g._chaseCam) g._chaseCam(1 / 60);
    if (g._syncWorldStream) g._syncWorldStream();
    const snap = g.qaSnapshot ? g.qaSnapshot() : null;
    return {
      ok: true,
      progress: g.player.progress,
      course: g.courseId,
      tsr: snap && snap.tsr,
      recon: snap && snap.recon,
      appear: snap && snap.appear,
    };
  `);
}

async function measureFrames(cdp) {
  return evaluate(cdp, `
    new Promise((resolve) => {
      const dts = [];
      let last = 0;
      const tick = (now) => {
        if (last) dts.push(now - last);
        last = now;
        if (dts.length >= 48) resolve(dts);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })
  `);
}

async function runCase(browser, { course, metres, appear, tag }) {
  const { cdp } = browser;
  await preparePage(cdp);
  const url = `${ORIGIN}/index.html?v=926&tsr=quality&recon=1&appear=${appear}`;
  console.log(`\\n--- ${tag}  ${url} ---`);
  await goto(cdp, url);
  await walkToCourse(cdp, course);
  const planted = await plant(cdp, metres);
  console.log(`  plant  ${JSON.stringify(planted)}`);
  await new Promise((r) => setTimeout(r, 800));
  const stillPath = await shotPng(cdp, `${tag}-still.png`);
  console.log(`  still  ${stillPath}`);

  const raw = await measureFrames(cdp);
  const kept = (raw || []).filter((d) => d <= 200).slice(0, 40);
  const p50 = pct(kept, 50);
  const p95 = pct(kept, 95);
  const snap = await evaluate(cdp, `
    const g = window.game;
    return g && g.qaSnapshot ? g.qaSnapshot() : null;
  `);
  console.log(`  frames kept=${kept.length} p50=${p50.toFixed(2)} p95=${p95.toFixed(2)}`);
  console.log(`  snap   normalMs=${snap && snap.tsr ? snap.tsr.normalMs : "?"} appear=${JSON.stringify(snap && snap.appear)}`);
  return { plant: planted, p50, p95, stillPath, snap, kept: kept.length };
}

async function main() {
  if (!findChrome()) {
    console.log(chromeUnavailableHint());
    process.exit(2);
  }
  fs.mkdirSync(OUT_TMP, { recursive: true });
  fs.mkdirSync(OUT_REPO, { recursive: true });
  console.log(`APPEAR  ·  ${new Date().toISOString()}`);
  console.log(`origin   ${ORIGIN}`);

  const browser = await launchChrome({ headless: false, width: 1280, height: 720 });
  try {
    const forestOff = await runCase(browser, { course: "forest", metres: 600, appear: "0", tag: "forest-600-lookoff" });
    const forestOn = await runCase(browser, { course: "forest", metres: 600, appear: "1", tag: "forest-600-lookon" });
    const desertOff = await runCase(browser, { course: "desert", metres: 400, appear: "0", tag: "desert-400-lookoff" });
    const desertOn = await runCase(browser, { course: "desert", metres: 400, appear: "1", tag: "desert-400-lookon" });
    const summary = {
      origin: ORIGIN,
      forest: { off: forestOff, on: forestOn },
      desert: { off: desertOff, on: desertOn },
      defaultOn: forestOn.p50 <= 33,
    };
    fs.writeFileSync(path.join(OUT_TMP, "appear-summary.json"), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(OUT_REPO, "appear-summary.json"), JSON.stringify(summary, null, 2));
    console.log(`\\nSUMMARY  forest off ${forestOff.p50.toFixed(2)} / look ${forestOn.p50.toFixed(2)}`);
    console.log(`         desert off ${desertOff.p50.toFixed(2)} / look ${desertOn.p50.toFixed(2)}`);
    console.log(`         default LOOK ${summary.defaultOn ? "ON" : "OFF"} (Forest look p50 <= 33)`);
  } finally {
    if (browser && browser.close) await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL  ${err.stack || err.message}`);
  process.exit(1);
});
