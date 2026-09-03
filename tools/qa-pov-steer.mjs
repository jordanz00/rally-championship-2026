#!/usr/bin/env node
/**
 * qa-pov-steer.mjs — POV steering wheel must spin on the column, not tumble.
 *
 * RUN: node tools/qa-pov-steer.mjs
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

console.log(`POV STEER WHEEL  ·  ${new Date().toISOString()}\n`);

const car = read("js/cars/celica.js");
const anim = read("js/cars/cockpit-anim.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");

check(
  "GLB rim is parented under a column spin group",
  /function armSteerSpin/.test(car) &&
    /function localSpaceBox/.test(car) &&
    /function localDiscAxis/.test(car) &&
    /steer-spin/.test(car) &&
    /armSteerSpin\(root, node\)/.test(car),
  "bindGlbSteeringWheel must arm a +Z column pivot from local-space disc axis"
);

check(
  "world AABB is not the spin axis",
  !/function thinnestLocalAxis/.test(car) && !/rotateOnAxis\(ax/.test(anim),
  "do not rotateOnAxis from a world-AABB axis"
);

check(
  "cockpit anim spins rotation.z on the pivot",
  /steerSpin \|\| ud\.steerWheel/.test(anim) && /wheel\.rotation\.z = anim\.wheelZ/.test(anim),
  "same column spin as the procedural torus"
);

const celicaV = game.match(/celica\.js\?v=(\d+)/);
const animV = game.match(/cockpit-anim\.js\?v=(\d+)/);
const gameV = main.match(/game\.js\?v=(\d+)/);
const mainV = index.match(/main\.js\?v=(\d+)/);
check(
  "cache bust celica.js?v>=110",
  celicaV && Number(celicaV[1]) >= 110,
  celicaV ? `got ${celicaV[1]}` : "missing"
);
check(
  "cache bust cockpit-anim.js?v>=4",
  animV && Number(animV[1]) >= 4,
  animV ? `got ${animV[1]}` : "missing"
);
check(
  "cache bust main↔game",
  gameV && mainV && gameV[1] === mainV[1] && Number(gameV[1]) >= 344,
  `game=${gameV && gameV[1]} main=${mainV && mainV[1]}`
);

async function live() {
  if (!findChrome()) {
    console.log("  skip  live title-car probe (no Chrome)");
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
      `const m = window.game && window.game.playerMesh; return m && m.userData && (m.userData.steerSpin || m.userData.steerWheel) ? 1 : null;`,
      { timeout: 45000, label: "player car with wheel" }
    );
    const sample = await evaluate(cdp, `
      const g = window.game;
      const mesh = g.playerMesh;
      const ud = mesh.userData;
      const spin = ud.steerSpin;
      const glb = ud.glbSteerWheel;
      const parentName = glb && glb.parent ? glb.parent.name : "";
      const hub0 = spin ? { x: spin.position.x, y: spin.position.y, z: spin.position.z } : null;
      g.player.steer = 0.45;
      for (let i = 0; i < 90; i++) g._syncPlayerMesh(1);
      const z = spin ? spin.rotation.z : (ud.steerWheel ? ud.steerWheel.rotation.z : 0);
      const hub1 = spin ? { x: spin.position.x, y: spin.position.y, z: spin.position.z } : null;
      const hubMove = hub0 && hub1
        ? Math.hypot(hub1.x - hub0.x, hub1.y - hub0.y, hub1.z - hub0.z)
        : 99;
      return {
        hasSpin: !!spin,
        hasGlb: !!glb,
        parentName,
        z,
        hubMove,
        steer: g.player.steer
      };
    `);
    check(
      "title car has a steer spin node",
      sample.hasSpin,
      JSON.stringify(sample)
    );
    if (sample.hasGlb) {
      check(
        "modeled rim is a child of steer-spin",
        sample.parentName === "steer-spin",
        `parent="${sample.parentName}"`
      );
    }
    check(
      "lock turns the wheel around the column",
      Math.abs(sample.z) > 0.35,
      `rotation.z=${Number(sample.z).toFixed(3)}`
    );
    check(
      "hub stays planted while the rim turns",
      sample.hubMove < 0.002,
      `hub moved ${Number(sample.hubMove).toFixed(4)} m`
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

await live();

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "POV wheel spins on the column"}`
);
process.exit(fail ? 1 : 0);
