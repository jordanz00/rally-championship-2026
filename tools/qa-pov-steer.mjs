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
const driver = read("js/cars/pov-driver.js");
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

check(
  "POV driver arms grip the steer spin",
  /function attachPovDriverArms/.test(car) &&
    /pov-driver-grips/.test(driver) &&
    /spin\.add\(grips\)/.test(driver) &&
    /userData\.povDriver/.test(car) &&
    /poseArm/.test(anim) &&
    /ud\.povDriver/.test(anim),
  "hands parented to spin; sleeves track the gripping wrists"
);

check(
  "each hand has four wrapped fingers plus an opposing thumb",
  /finger-index/.test(driver) &&
    /finger-pinky/.test(driver) &&
    /addWrappedFinger/.test(driver) &&
    /addWrappedThumb/.test(driver) &&
    /phalange-\$\{i\}/.test(driver) &&
    /userData\.phalanges = 3/.test(driver),
  "index/middle/ring/pinky + thumb; three phalanges wrap the tube"
);

check(
  "10/2 clock and overlay emissive gloves",
  /clock = side > 0 \? 0\.62/.test(driver) &&
    /emissiveMap: GLOVE_MAP/.test(driver) &&
    /toneMapped: false/.test(driver),
  "layer-1 overlay needs emissive + toneMapped false"
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
  "cache bust cockpit-anim.js?v>=5",
  animV && Number(animV[1]) >= 5,
  animV ? `got ${animV[1]}` : "missing"
);
check(
  "cache bust celica.js?v>=202",
  celicaV && Number(celicaV[1]) >= 202,
  celicaV ? `got ${celicaV[1]}` : "missing"
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
      const grips = spin && spin.getObjectByName("pov-driver-grips");
      const handL = spin && spin.getObjectByName("hand-L");
      const handR = spin && spin.getObjectByName("hand-R");
      let fingers = 0;
      let thumbs = 0;
      let phalanges = 0;
      let layer = -1;
      if (grips) {
        grips.traverse((o) => {
          if (/^finger-/.test(o.name)) fingers += 1;
          if (o.name === "thumb") thumbs += 1;
          if (/^phalange-/.test(o.name)) phalanges += 1;
          if (o.isMesh && layer < 0) layer = o.layers.mask;
        });
      }
      return {
        hasSpin: !!spin,
        hasGlb: !!glb,
        parentName,
        gripsParent: grips && grips.parent ? grips.parent.name : "",
        fingers,
        thumbs,
        phalanges,
        clockL: handL && handL.userData ? handL.userData.clock : null,
        clockR: handR && handR.userData ? handR.userData.clock : null,
        overlayLayer: layer,
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
    if (sample.gripsParent) {
      check(
        "gloves parent to steer-spin",
        sample.gripsParent === "steer-spin",
        `parent="${sample.gripsParent}"`
      );
      check(
        "live finger count is 4+4 with two thumbs",
        sample.fingers === 8 && sample.thumbs === 2,
        `fingers=${sample.fingers} thumbs=${sample.thumbs}`
      );
      check(
        "live phalanges wrap both hands (3×4 + 2×2)",
        sample.phalanges >= 16,
        `phalanges=${sample.phalanges}`
      );
      check(
        "live 10/2 clock",
        sample.clockL != null &&
          Math.abs(sample.clockL - 0.62) < 0.02 &&
          sample.clockR != null &&
          Math.abs(sample.clockR - (Math.PI - 0.62)) < 0.02,
        `L=${sample.clockL} R=${sample.clockR}`
      );
      check(
        "glove meshes live on the POV overlay layer",
        (sample.overlayLayer & 2) === 2,
        `mask=${sample.overlayLayer}`
      );
    } else {
      console.log("  skip  live glove graph (title LOD has no cabin — static wrap contract still applies)");
    }
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
