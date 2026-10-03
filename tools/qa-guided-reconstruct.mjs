#!/usr/bin/env node
/**
 * qa-guided-reconstruct.mjs — TSR-only vs TSR+guided proof.
 *
 * Forest ~600 m and Desert ~400 m. Uses tools/lib/qa-harness.mjs (never
 * Chrome.app under Cursor). Writes /tmp/guided and tools/qa-out/guided-*.png
 *
 * RUN:  RALLY_ORIGIN=http://127.0.0.1:8766 node tools/qa-guided-reconstruct.mjs
 * Never kills :8766.
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
const OUT_TMP = "/tmp/guided";
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
  const b = path.join(OUT_REPO, `guided-${name}`);
  fs.writeFileSync(a, buf);
  fs.writeFileSync(b, buf);
  return a;
}

async function shotPng(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  return saveBuf(Buffer.from(r.data, "base64"), name);
}

async function cropPng(cdp, name, clip) {
  const r = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 },
  });
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
    };
  `);
}

async function regions(cdp) {
  return evaluate(cdp, `
    const g = window.game;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const side = Math.round(Math.min(w, h) * 0.22);
    const clamp = (x, y) => ({
      x: Math.max(0, Math.min(w - side, Math.round(x - side / 2))),
      y: Math.max(0, Math.min(h - side, Math.round(y - side / 2))),
      width: side,
      height: side,
    });
    let cx = w * 0.5;
    let cy = h * 0.62;
    if (g && g.playerMesh && g.camera) {
      const p = g.playerMesh.position.clone();
      p.project(g.camera);
      cx = (p.x * 0.5 + 0.5) * w;
      cy = (-p.y * 0.5 + 0.5) * h;
    }
    return {
      car: clamp(cx, cy + side * 0.12),
      road: clamp(cx - side * 0.85, cy + side * 0.28),
      canopy: clamp(w * 0.22, h * 0.28),
      horizon: clamp(w * 0.5, h * 0.16),
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

async function measurePass(cdp) {
  return evaluate(cdp, `
    new Promise((resolve) => {
      const g = window.game;
      if (!g || !g.recon || !g.recon.enabled) {
        resolve({ ok: false, samples: [] });
        return;
      }
      g._reconMeasure = true;
      const samples = [];
      let n = 0;
      const tick = () => {
        n += 1;
        if (g.recon && g.recon.stats) samples.push(g.recon.stats.lastMs);
        if (n >= 44) {
          g._reconMeasure = false;
          resolve({ ok: true, samples, guided: !!(g.recon.stats && g.recon.stats.guided) });
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })
  `);
}

async function drive(cdp, ms) {
  await evaluate(cdp, `
    const g = window.game;
    g._qaDrive = { throttle: 1, steer: 0, brake: 0, handbrake: 0 };
    if (g.input) g.input._qaHold = g._qaDrive;
    g.state = "race";
    1
  `);
  await new Promise((r) => setTimeout(r, ms));
  await evaluate(cdp, `
    const g = window.game;
    g._qaDrive = { throttle: 0, steer: 0, brake: 0, handbrake: 0 };
    1
  `);
}

async function shootCrops(cdp, prefix) {
  const r = await regions(cdp);
  const names = [];
  for (const key of ["car", "road", "canopy", "horizon"]) {
    names.push(await cropPng(cdp, `${prefix}-${key}-2x.png`, r[key]));
  }
  return names;
}

async function runCase(browser, { course, metres, recon, tag }) {
  const { cdp } = browser;
  await preparePage(cdp);
  const url = `${ORIGIN}/index.html?tsr=quality&recon=${recon}`;
  console.log(`\n--- ${tag}  ${url} ---`);
  await goto(cdp, url);
  await walkToCourse(cdp, course);
  const planted = await plant(cdp, metres);
  console.log(`  plant  ${JSON.stringify(planted)}`);
  await new Promise((r) => setTimeout(r, 800));
  const stillPath = await shotPng(cdp, `${tag}-still.png`);
  await shootCrops(cdp, `${tag}-still`);
  console.log(`  still  ${stillPath}`);

  const raw = await measureFrames(cdp);
  const kept = (raw || []).filter((d) => d <= 200).slice(0, 40);
  const p50 = pct(kept, 50);
  const p95 = pct(kept, 95);
  console.log(`  frames kept=${kept.length} p50=${p50.toFixed(2)} p95=${p95.toFixed(2)}`);

  let pass = { ok: false, samples: [] };
  if (recon === "1") {
    pass = await measurePass(cdp);
    const ps = (pass.samples || []).filter((x) => Number.isFinite(x) && x < 50);
    pass.p50 = pct(ps, 50);
    pass.p95 = pct(ps, 95);
    console.log(`  pass   guided=${pass.guided} p50=${(pass.p50 || 0).toFixed(3)} p95=${(pass.p95 || 0).toFixed(3)}`);
  }

  await drive(cdp, 2000);
  const motionPath = await shotPng(cdp, `${tag}-motion.png`);
  await shootCrops(cdp, `${tag}-motion`);
  console.log(`  motion ${motionPath}`);
  const after = await evaluate(cdp, `
    const g = window.game;
    const snap = g.qaSnapshot ? g.qaSnapshot() : null;
    return { progress: g.player && g.player.progress, speed: g.player && g.player.speed, recon: snap && snap.recon };
  `);
  console.log(`  after  ${JSON.stringify(after)}`);
  return { plant: planted, p50, p95, stillPath, motionPath, pass, after };
}

async function main() {
  if (!findChrome()) {
    console.log(chromeUnavailableHint());
    process.exit(2);
  }
  fs.mkdirSync(OUT_TMP, { recursive: true });
  fs.mkdirSync(OUT_REPO, { recursive: true });
  console.log(`GUIDED RECONSTRUCT  ·  ${new Date().toISOString()}`);
  console.log(`origin   ${ORIGIN}`);

  const browser = await launchChrome({ headless: true, width: 1280, height: 720 });
  try {
    const forestOff = await runCase(browser, { course: "forest", metres: 600, recon: "0", tag: "forest-600-tsr" });
    const forestOn = await runCase(browser, { course: "forest", metres: 600, recon: "1", tag: "forest-600-guided" });
    const desertOff = await runCase(browser, { course: "desert", metres: 400, recon: "0", tag: "desert-400-tsr" });
    const desertOn = await runCase(browser, { course: "desert", metres: 400, recon: "1", tag: "desert-400-guided" });
    const summary = {
      origin: ORIGIN,
      forest: { tsr: forestOff, guided: forestOn },
      desert: { tsr: desertOff, guided: desertOn },
    };
    fs.writeFileSync(path.join(OUT_TMP, "guided-summary.json"), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(OUT_REPO, "guided-summary.json"), JSON.stringify(summary, null, 2));
    console.log(`\nSUMMARY  forest tsr ${forestOff.p50.toFixed(2)} / guided ${forestOn.p50.toFixed(2)} pass ${(forestOn.pass.p50 || 0).toFixed(3)}`);
    console.log(`         desert tsr ${desertOff.p50.toFixed(2)} / guided ${desertOn.p50.toFixed(2)} pass ${(desertOn.pass.p50 || 0).toFixed(3)}`);
  } finally {
    if (browser && browser.close) await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL  ${err.stack || err.message}`);
  process.exit(1);
});
