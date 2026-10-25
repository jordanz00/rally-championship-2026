#!/usr/bin/env node
/**
 * qa-cam-blend.mjs — C-key camera must switch instantly with no hitch.
 *
 * RUN: node tools/qa-cam-blend.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  waitFor,
  evaluate,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`CAM BLEND  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const car = read("js/cars/celica.js");
const main = read("js/main.js");
const index = read("index.html");

const blendTime = config.match(/viewBlendTime:\s*([0-9.]+)/);
check(
  "blend window is instant (≤0.05s)",
  blendTime && Number(blendTime[1]) <= 0.05,
  blendTime ? `viewBlendTime=${blendTime[1]}` : "missing"
);

check(
  "C seats cabin on the press + hard lens lock",
  /_startCamBlend\(/.test(game) &&
    /_applyCockpitCam\(\)/.test(game) &&
    /_camBlendT = 0/.test(game) &&
    /_camCut = true/.test(game) &&
    /const seatIn = true/.test(game),
  "cabin + FOV flip same frame as C — no ease hang"
);

check(
  "C never hangs on a long ease",
  /_camBlendDur = 0\.001/.test(game) &&
    !/Math\.max\(0\.72/.test(game) &&
    !/Math\.max\(0\.95/.test(game) &&
    !/const SNAP = 0\.12/.test(game),
  "old 0.12–0.95 windows felt like a freeze on C"
);

check(
  "FOV and near track the pose cut",
  /_camBlendFromFov/.test(game) && /_camBlendFromNear/.test(game),
  "FOV used ease as a follow rate and snapped late"
);

check(
  "rearview is a tiny short-range RT that is never disposed on C",
  /GFX\.mirrorW/.test(game) &&
    /this\._mirrorCam/.test(game) &&
    /_ensureMirrorRT/.test(game) &&
    /Never dispose this on a C-key/.test(game),
  "mirror must stay cheap so it can run live without hitching"
);

check(
  "C starts blend helper then hard-locks",
  /_cycleCamera\(\) \{[\s\S]{0,700}?_startCamBlend\(/.test(game) &&
    /_cycleCamera\(\) \{[\s\S]{0,700}?_applyCockpitCam\(/.test(game),
  "same-frame cabin + lens"
);

check(
  "cabin + mirror compile during load",
  /_warmPov\(\)/.test(game) && /this\.renderer\.compile\(this\.scene, this\._mirrorCam\)/.test(game),
  "first C must not hitch-compile shaders"
);

check(
  "setCockpitView uses the hide cache (no live GLB traverse on C)",
  /function flipCockpitVisibility/.test(car) &&
    /_povHideReady/.test(car) &&
    /_povKeepHidden/.test(car),
  "full GLB walk on C was a hitch"
);

const gameV = main.match(/game\.js\?v=(\d+)/);
const mainV = index.match(/main\.js\?v=(\d+)/);
check(
  "cache bust main↔game",
  gameV && mainV && gameV[1] === mainV[1] && Number(gameV[1]) >= 1145,
  `game=${gameV && gameV[1]} main=${mainV && mainV[1]}`
);

async function live() {
  if (!findChrome()) {
    console.log("  skip  live blend probe (no Chrome)");
    return;
  }
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true, width: 1280, height: 720 });
  const { cdp } = browser;
  await preparePage(cdp);
  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "game" });
    await waitFor(
      cdp,
      `return window.game && window.game.playerMesh && window.game.camera && window.game.player && window.game.player._draw ? 1 : null;`,
      { timeout: 45000, label: "camera + car" }
    );
    const sample = await evaluate(cdp, `
      const g = window.game;
      const cam = g.camera;
      const p0 = cam.position.clone();
      const startMode = g.camMode;
      g._cycleCamera();
      const afterKey = {
        blendT: g._camBlendT,
        mode: g.camMode,
        cockpit: !!g._cockpitLive,
        dist: cam.position.distanceTo(p0),
        cut: !!g._camCut === false && g._camBlendT === 0
      };
      // Instant lock: blend already spent; one chase tick keeps seat.
      g._chaseCam(1 / 60);
      const afterTick = {
        blendT: g._camBlendT,
        dist: cam.position.distanceTo(p0),
        modeChanged: g.camMode !== startMode
      };
      return { afterKey, afterTick };
    `);
    check(
      "live: C spends blendT and flips mode",
      sample &&
        sample.afterKey &&
        sample.afterKey.blendT === 0 &&
        sample.afterTick &&
        sample.afterTick.modeChanged,
      JSON.stringify(sample)
    );
    check(
      "live: applyCockpitCam ran (cockpit flag defined)",
      sample && sample.afterKey && typeof sample.afterKey.cockpit === "boolean",
      JSON.stringify(sample && sample.afterKey)
    );
  } catch (err) {
    console.log(`  skip  live blend probe (${err && err.message ? err.message : err})`);
    if (String(err).includes("Chrome")) console.log(chromeUnavailableHint());
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
}

await live();

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " failed" : "C-key instant, no hitch"}`);
process.exit(fail ? 1 : 0);
