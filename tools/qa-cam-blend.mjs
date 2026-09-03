#!/usr/bin/env node
/**
 * qa-cam-blend.mjs — C-key camera must ease, not cut or hitch.
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
  "blend window is a short ease (0.18–0.28s)",
  blendTime && Number(blendTime[1]) >= 0.18 && Number(blendTime[1]) <= 0.28,
  blendTime ? `viewBlendTime=${blendTime[1]}` : "missing"
);

check(
  "C records blend origin; cabin seats mid-blend",
  /_startCamBlend\(\)/.test(game) &&
    /seatIn/.test(game) &&
    !/if \(mode && mode\.id === "pov"\) this\._applyCockpitCam\(\)/.test(game),
  "pose eases; cabin must not hitch-compile on the C press"
);

check(
  "FOV and near lerp with the pose",
  /_camBlendFromFov/.test(game) && /_camBlendFromNear/.test(game),
  "FOV used ease as a follow rate and snapped at the end of the blend"
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
  "every C-key mode switch starts a pose blend",
  /this\.camMode = \(this\.camMode \+ 1\) % CAMERA\.views\.length/.test(game) &&
    /_startCamBlend\(\)/.test(game) &&
    /_cycleCamera\(/.test(game),
  "POV / medium / far must all ease — no hard cut path"
);

check(
  "blend uses smootherstep so the ends do not snap",
  /blendU \* 6 - 15/.test(game),
  "quintic smootherstep on pose / FOV / near"
);

check(
  "cabin + mirror compile during load",
  /_warmPov\(\)/.test(game) && /this\.renderer\.compile\(this\.scene, this\._mirrorCam\)/.test(game),
  "first C must not hitch-compile shaders"
);

check(
  "setCockpitView uses the hide cache (no live GLB traverse)",
  /_povHideReady/.test(car) &&
    /_povKeepHidden/.test(car) &&
    !/root\.traverse\(\(obj\) => \{\s*\n\s*if \(obj\.userData && obj\.userData\.interiorKeepHidden\)/.test(car),
  "full GLB walk on C was a hitch"
);

const gameV = main.match(/game\.js\?v=(\d+)/);
const mainV = index.match(/main\.js\?v=(\d+)/);
check(
  "cache bust main↔game",
  gameV && mainV && gameV[1] === mainV[1] && Number(gameV[1]) >= 378,
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
      const startMode = g.camMode;
      const p0 = cam.position.clone();
      g._cycleCamera();
      const afterKey = {
        blendT: g._camBlendT,
        mode: g.camMode,
        dist: cam.position.distanceTo(p0)
      };
      const steps = [];
      let maxStep = 0;
      let prev = cam.position.clone();
      for (let i = 0; i < 18; i++) {
        g._chaseCam(1 / 60);
        const p = cam.position.clone();
        const step = p.distanceTo(prev);
        steps.push(step);
        if (step > maxStep) maxStep = step;
        prev = p;
      }
      const pEnd = cam.position;
      const traveled = pEnd.distanceTo(p0);
      return {
        startMode,
        nextMode: g.camMode,
        blendOnKey: afterKey.blendT,
        jumpedOnKey: afterKey.dist,
        maxStep,
        traveled,
        leftoverBlend: g._camBlendT,
        views: 3
      };
    `);
    check(
      "live C starts a blend without teleporting",
      sample && sample.blendOnKey > 0.1 && sample.jumpedOnKey < 0.05,
      sample
        ? `blendT=${sample.blendOnKey && sample.blendOnKey.toFixed(3)} jump=${sample.jumpedOnKey && sample.jumpedOnKey.toFixed(3)}`
        : "no sample"
    );
    check(
      "live pose eases (no single-frame cut)",
      sample && sample.maxStep > 0.02 && sample.maxStep < 3.2 && sample.traveled > sample.maxStep * 1.4,
      sample
        ? `maxStep=${sample.maxStep && sample.maxStep.toFixed(3)} travel=${sample.traveled && sample.traveled.toFixed(2)}`
        : "no sample"
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

await live();

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "camera eases, no cut"}`
);
process.exit(fail ? 1 : 0);
