/**
 * qa-race-probe — drive the real game in a real browser and report the truth.
 *
 * WHO THIS IS FOR: anyone who needs to know whether a change actually works,
 * as opposed to whether it parses. Every performance claim in this project so
 * far came from static analysis; this is the only script that opens a WebGL
 * context, clicks PRESS START, starts a race, and measures frames.
 *
 * WHAT IT DOES:
 *   1. Boots the page and records every console error and uncaught exception.
 *   2. Walks the menu: PRESS START -> CHAMPIONSHIP -> car -> course.
 *   3. Holds throttle for a few seconds, sampling frame times and the
 *      three.js renderer counters.
 *   4. Reports whether the cars are real GLBs or procedural stand-ins.
 *
 * IMPORTANT CAVEAT: headless Chromium renders through SwiftShader (software).
 * Absolute frame times here are far worse than on real hardware and mean
 * nothing. Draw calls, triangle counts, program counts, material counts, and
 * asset provenance are exact and are the reason this script exists.
 *
 * USAGE: node tools/qa-race-probe.mjs [--course=desert] [--car=celica] [--seconds=6]
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Playwright and its browser live in .qa/ (gitignored) so this harness needs no
// package.json at the repo root and cannot collide with the static build.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
// Set unconditionally: the shell may already export a path to a temp cache that
// gets wiped between runs, and Playwright honours whatever is in the env.
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(repo, ".qa", "browsers");
const require = createRequire(path.join(repo, ".qa", "package.json"));
const { chromium } = require("playwright");
const fs = await import("node:fs");

/**
 * Find the downloaded browser ourselves.
 *
 * Playwright's own host-platform detection resolves a mac-x64 directory on this
 * arm64 machine and then reports the browser as missing, so we hand it the
 * binary directly instead of arguing with it.
 * @returns {string|undefined} path, or undefined to let Playwright decide
 */
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

const ORIGIN = process.env.RALLY_ORIGIN || "http://127.0.0.1:8765";
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? "true" : v];
  })
);
const COURSE = args.get("course") || "desert";
const CAR = args.get("car") || "celica";
const SECONDS = Number(args.get("seconds") || 6);
// Championship starts at its own round 1 regardless of what you pick, so a
// course-specific run has to go through practice.
const MODE = args.get("mode") || "practice";

/** Frames to ignore after the green light — stage upload skews the first ones. */
const WARMUP_FRAMES = 30;

function pct(list, p) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  // reducedMotion matters for correctness here, not just taste: PRESS START
  // carries an infinite 1px translate, and Playwright waits for a stable
  // bounding box before clicking, so it would time out on a button a human can
  // hit without trouble. The stylesheet already honours the setting.
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });

  const errors = [];
  const warnings = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error") errors.push(msg.text());
    else if (t === "warning") warnings.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`UNCAUGHT ${err.message}`));
  page.on("requestfailed", (req) => failedRequests.push(`${req.url()} ${req.failure()?.errorText}`));
  page.on("response", (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.url()} HTTP ${res.status()}`);
  });

  console.log(`\n=== qa-race-probe · ${MODE} · ${CAR} @ ${COURSE} · ${ORIGIN} ===\n`);

  await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });

  // --- 1. Boot -------------------------------------------------------------
  const bootOk = await page
    .waitForFunction(() => !!window.game && !!window.game.renderer, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  const bootError = await page.evaluate(() => {
    const el = document.getElementById("boot-error");
    return el && !el.hidden ? el.textContent.slice(0, 400) : null;
  });

  console.log(`boot         : ${bootOk ? "renderer live" : "NO RENDERER"}`);
  if (bootError) console.log(`boot-error   : ${bootError}`);

  // --- 2. Garage provenance ------------------------------------------------
  await page.waitForTimeout(2500); // let the GLB fetches settle
  /** Read car provenance out of the live scene graph. */
  const readGarage = () =>
    page.evaluate(() => {
    const g = window.game;
    const out = { player: null, rivalMeshes: null, rivalTris: null, rivalMats: null, isGlbRival: null };
    if (!g) return out;
    if (g.playerMesh) {
      let tris = 0;
      let meshes = 0;
      g.playerMesh.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.visible) return;
        meshes++;
        const pos = o.geometry.attributes.position;
        if (pos) tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
      });
      out.player = { name: g.playerMesh.name || "(unnamed)", meshes, tris: Math.round(tris) };

      // Which way does the bodyshell actually point? Game forward is +Z, so the
      // headlamps must sit at positive local Z. Comparing lamp clusters against
      // the car's own local frame settles orientation without eyeballing a
      // screenshot.
      const root = g.playerMesh;
      root.updateMatrixWorld(true);
      const toLocal = root.matrixWorld.clone().invert();
      const v = new (root.position.constructor)();
      const tally = { front: 0, frontN: 0, rear: 0, rearN: 0 };
      root.traverse((o) => {
        if (!o.isMesh) return;
        const n = `${o.name || ""} ${o.material && o.material.name ? o.material.name : ""}`.toLowerCase();
        // Skip the lamps the game itself adds: ensureBrakeLights/ensureHeadlights
        // place them at the assumed front and rear, so measuring those just
        // confirms our own assumption.
        if (o.userData.brake || o.userData.head) return;
        const isFront = /head.?light|headlamp|fog|spot|driving.?light|lamp.?pod/.test(n);
        const isRear = /brake|tail.?light|rear.?light|stop.?light|reverse/.test(n);
        if (!isFront && !isRear) return;
        o.getWorldPosition(v).applyMatrix4(toLocal);
        if (isFront) {
          tally.front += v.z;
          tally.frontN++;
        } else {
          tally.rear += v.z;
          tally.rearN++;
        }
      });
      out.facing = {
        frontLampZ: tally.frontN ? +(tally.front / tally.frontN).toFixed(2) : null,
        frontCount: tally.frontN,
        rearLampZ: tally.rearN ? +(tally.rear / tally.rearN).toFixed(2) : null,
        rearCount: tally.rearN,
      };
    }
    const rival = (g.opponents || []).map((o) => o.mesh).find(Boolean);
    if (rival) {
      let tris = 0;
      let meshes = 0;
      const mats = new Set();
      rival.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.visible) return;
        meshes++;
        [].concat(o.material || []).forEach((m) => m && mats.add(m.uuid));
        const pos = o.geometry.attributes.position;
        if (pos) tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
      });
      out.rivalMeshes = meshes;
      out.rivalTris = Math.round(tris);
      out.rivalMats = mats.size;
      out.isGlbRival = /rival|gt4|delta|stratos/i.test(rival.name || "");
      out.rivalName = rival.name || "(unnamed)";
      out.merged = rival.userData ? rival.userData.mergedPanels : undefined;
    }
    return out;
    });

  let garage = await readGarage();
  if (garage.player) {
    console.log(`player car   : ${garage.player.name} · ${garage.player.meshes} meshes · ${garage.player.tris} tris`);
  }
  if (garage.facing) {
    const f = garage.facing;
    const verdict =
      f.frontLampZ == null && f.rearLampZ == null
        ? "no lamps found to judge by"
        : f.frontLampZ != null && f.frontLampZ < 0
          ? "BACKWARDS — headlamps are at negative Z"
          : f.rearLampZ != null && f.rearLampZ > 0 && f.frontLampZ == null
            ? "BACKWARDS — brake lights are at positive Z"
            : "forward";
    console.log(
      `orientation  : headlamps z=${f.frontLampZ} (${f.frontCount}) · ` +
        `brake z=${f.rearLampZ} (${f.rearCount}) → ${verdict}`
    );
  }

  // --- 3. Walk the menu ----------------------------------------------------
  /**
   * Click and say so when it does not work. Swallowing these is how a dead
   * start button looked like a passing test.
   */
  const clickStep = async (selector, label) => {
    try {
      await page.click(selector, { timeout: 4000 });
      return true;
    } catch {
      /* fall through to a forced click before calling it broken */
    }
    // A click that lands and advances the screen makes its own button
    // disappear, so the retry then fails on a hidden element. That is success,
    // not failure — check before reporting.
    const gone = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return true;
      const r = el.getBoundingClientRect();
      return !r.width || !r.height;
    }, selector);
    if (gone) return true;
    try {
      await page.click(selector, { timeout: 3000, force: true });
      console.log(`  ! ${label}: needed a forced click (element never settled)`);
      return true;
    } catch (err) {
      console.log(`  ✗ ${label}: click on "${selector}" failed — ${String(err.message).split("\n")[0]}`);
      const blocker = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return "selector matches nothing";
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return `element has zero size (${r.width}x${r.height})`;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        const cs = getComputedStyle(el);
        const desc = (n) =>
          n ? `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${n.className ? "." + String(n.className).split(" ").join(".") : ""}` : "nothing";
        return (
          `at centre (${Math.round(cx)},${Math.round(cy)}) the top element is ${desc(hit)}; ` +
          `target is ${desc(el)} · display:${cs.display} visibility:${cs.visibility} ` +
          `opacity:${cs.opacity} pointer-events:${cs.pointerEvents} z-index:${cs.zIndex}`
        );
      }, selector);
      console.log(`    ↳ ${blocker}`);
      return false;
    }
  };

  await clickStep("#btn-start", "PRESS START");
  await page.waitForTimeout(400);
  await clickStep(`[data-menu="${MODE}"]`, MODE.toUpperCase());
  await page.waitForTimeout(400);
  await clickStep(`[data-car="${CAR}"]`, "car select");
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => window.game && window.game.state);
  await clickStep(`[data-course="${COURSE}"]`, "course select");

  const racing = await page
    .waitForFunction(() => window.game && (window.game.state === "race" || window.game.state === "countdown"), {
      timeout: 20000,
    })
    .then(() => true)
    .catch(() => false);
  console.log(`menu walk    : ${MODE} -> car reached "${state}" · race started: ${racing}`);
  if (!racing) {
    const s = await page.evaluate(() => window.game && window.game.state);
    console.log(`  stuck in state "${s}"`);
  }

  // Let the countdown finish. Measuring during it reads a stationary car on the
  // grid, which is not the frame anyone cares about.
  const green = await page
    .waitForFunction(() => window.game && window.game.state === "race", { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (!green) console.log(`  ! countdown never released; still "${await page.evaluate(() => window.game.state)}"`);
  garage = await readGarage();

  // --- 4. Measure ----------------------------------------------------------
  await page.evaluate(() => {
    window.__probe = { frames: [], last: performance.now(), peak: null };
    const tick = () => {
      const now = performance.now();
      window.__probe.frames.push(now - window.__probe.last);
      window.__probe.last = now;
      const info = window.game && window.game.renderer && window.game.renderer.info;
      if (info) {
        const snap = {
          calls: info.render.calls,
          tris: info.render.triangles,
          programs: info.programs ? info.programs.length : 0,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
        };
        if (!window.__probe.peak || snap.calls > window.__probe.peak.calls) window.__probe.peak = snap;
        window.__probe.lastInfo = snap;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Hold the throttle so the car actually drives through the stage.
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(SECONDS * 1000);
  await page.keyboard.up("ArrowUp");

  const perf = await page.evaluate(() => {
    const p = window.__probe;
    const g = window.game;
    return {
      frames: p.frames,
      peak: p.peak,
      last: p.lastInfo,
      speed: g && g.player ? Math.round(g.player.speed * 2.237) : null,
      progress: g && g.player ? Math.round(g.player.progress) : null,
      state: g && g.state,
      opponents: g && g.opponents ? g.opponents.length : 0,
    };
  });

  const frames = perf.frames.slice(WARMUP_FRAMES);
  console.log(`\n--- race ---`);
  console.log(`state        : ${perf.state} · ${perf.opponents} rivals · ${perf.speed} mph · ${perf.progress} m travelled`);
  if (garage.player) {
    console.log(`player car   : ${garage.player.name} · ${garage.player.meshes} meshes · ${garage.player.tris} tris`);
  }
  if (garage.facing) {
    const f = garage.facing;
    const backwards =
      (f.frontLampZ != null && f.frontLampZ < 0) ||
      (f.frontLampZ == null && f.rearLampZ != null && f.rearLampZ > 0);
    console.log(
      `orientation  : headlamps z=${f.frontLampZ} (${f.frontCount}) · brake z=${f.rearLampZ} (${f.rearCount}) → ` +
        `${f.frontLampZ == null && f.rearLampZ == null ? "no lamps to judge by" : backwards ? "BACKWARDS" : "forward"}`
    );
  }
  if (garage.rivalMeshes != null) {
    console.log(
      `rival car    : ${garage.rivalName} · ${garage.rivalMeshes} meshes · ${garage.rivalTris} tris · ` +
        `${garage.rivalMats} materials · merged groups: ${garage.merged ?? "n/a"} · real GLB: ${garage.isGlbRival}`
    );
  }
  if (perf.last) {
    console.log(
      `draw calls   : ${perf.last.calls} (peak ${perf.peak ? perf.peak.calls : "?"}) · ` +
        `${perf.last.tris.toLocaleString()} tris · ${perf.last.programs} shader programs`
    );
    console.log(`gpu memory   : ${perf.last.geometries} geometries · ${perf.last.textures} textures`);
  }
  if (frames.length) {
    console.log(
      `frame time   : median ${pct(frames, 50).toFixed(1)}ms · p95 ${pct(frames, 95).toFixed(1)}ms ` +
        `(SOFTWARE RENDERER — not indicative of real hardware)`
    );
  }

  // --- 5. Diagnostics ------------------------------------------------------
  const realErrors = errors.filter((e) => !/favicon/i.test(e));
  const realFailed = failedRequests.filter((r) => !/favicon/i.test(r));
  console.log(`\n--- diagnostics ---`);
  console.log(`console errors  : ${realErrors.length}`);
  realErrors.slice(0, 8).forEach((e) => console.log(`  ✗ ${e.slice(0, 220)}`));
  console.log(`failed requests : ${realFailed.length}`);
  realFailed.slice(0, 8).forEach((r) => console.log(`  ✗ ${r.slice(0, 180)}`));
  const notable = warnings.filter((w) => /garage|merge|streaming|shader|THREE/i.test(w));
  if (notable.length) {
    console.log(`notable warnings: ${notable.length}`);
    notable.slice(0, 8).forEach((w) => console.log(`  ! ${w.slice(0, 200)}`));
  }

  const shot = `tools/probe-${MODE}-${CAR}-${COURSE}.png`;
  await page.screenshot({ path: shot });
  console.log(`\nscreenshot   : ${shot}`);

  await browser.close();

  const pass = bootOk && racing && realErrors.length === 0;
  console.log(`\nVERDICT: ${pass ? "PASS" : "NEEDS ATTENTION"}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("probe crashed", err);
  process.exit(2);
});
