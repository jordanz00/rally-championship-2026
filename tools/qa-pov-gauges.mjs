#!/usr/bin/env node
/**
 * qa-pov-gauges.mjs — POV speedo/tach must match the chase HUD cluster.
 *
 * RUN: node tools/qa-pov-gauges.mjs
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

console.log(`POV GAUGES  ·  ${new Date().toISOString()}\n`);

const car = read("js/cars/celica.js");
const hud = read("js/ui/hud.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");

check(
  "HUD and POV share 7:30→4:30 canvas radians",
  /const GAUGE_START = Math\.PI \* 0\.75/.test(hud) &&
    /const GAUGE_SWEEP = Math\.PI \* 1\.5/.test(hud) &&
    /const GAUGE_START = Math\.PI \* 0\.75/.test(car) &&
    /const GAUGE_SWEEP = Math\.PI \* 1\.5/.test(car),
  "GAUGE_START/SWEEP must match js/ui/hud.js"
);

check(
  "POV speedo is MPH 0–140 like chase AnalogDial",
  /POV_SPEED_MAX_MPH = 140/.test(car) &&
    /KMH_TO_MPH/.test(car) &&
    /speedKmh \|\| 0\) \* KMH_TO_MPH/.test(car) &&
    /max:\s*140/.test(hud),
  "do not keep a km/h 0–250 in-car scale"
);

check(
  "needle blade is along +X (3 o'clock rest convention)",
  /BoxGeometry\(blade, thick/.test(car) &&
    /pivot\.rotation\.z = -GAUGE_START/.test(car) &&
    /spdT = -\(GAUGE_START \+ GAUGE_SWEEP/.test(car),
  "3D needle must use the canvas angle, negated for Y-up clockwise"
);

check(
  "cluster lookAt the seat so discs face the driver",
  /cluster\.lookAt\(rig\.eyeX/.test(car) &&
    !/face\.rotation\.y = Math\.PI/.test(car) &&
    !/face\.scale\.x = -1/.test(car) &&
    !/g\.scale\.x = -1/.test(car),
  "lookAt the eye; no Y=180 / negative scale (those show the blank back)"
);

check(
  "A-pillars are not in the cockpit cabin",
  !/pillarL/.test(car.slice(car.indexOf("function attachCockpit"))) &&
    !/BoxGeometry\(0\.05, 0\.55, 0\.07\)/.test(car),
  "procedural windshield-frame arms must not sit in the POV lens"
);

check(
  "tach spring is overdamped (no idle jitter)",
  /springNeedle\(root\.userData\._rpmGauge, rpmT, dt, 22, 1\.08\)/.test(car) &&
    /springNeedle\(root\.userData\._spdGauge, spdT, dt, 14, 1\.12\)/.test(car) &&
    !/zeta:\s*0\.48/.test(car) &&
    !/wn:\s*34/.test(car) &&
    !/performance\.now\(\)/.test(car.slice(car.indexOf("function updateCockpit"))),
  "overdamped springs; no performance.now() idle shake on the needles"
);

check(
  "tach left / speedo right, tach max 9",
  /rpmDial\.group\.position\.set\(-POV_GAUGE_R/.test(car) &&
    /speedDial\.group\.position\.set\(POV_GAUGE_R/.test(car) &&
    /const rpmMax = 9/.test(car),
  "ST205 / chase layout"
);

const celicaV = game.match(/celica\.js\?v=(\d+)/);
const gameV = main.match(/game\.js\?v=(\d+)/);
const mainV = index.match(/main\.js\?v=(\d+)/);
check(
  "cache bust celica.js?v>=111",
  celicaV && Number(celicaV[1]) >= 111,
  celicaV ? `got ${celicaV[1]}` : "missing"
);
check(
  "cache bust main↔game",
  gameV && mainV && gameV[1] === mainV[1] && Number(gameV[1]) >= 345,
  `game=${gameV && gameV[1]} main=${mainV && mainV[1]}`
);

async function live() {
  if (!findChrome()) {
    console.log("  skip  live needle probe (no Chrome)");
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
      `
        const g = window.game;
        if (!g) return null;
        try {
          if (typeof g._promotePlayerCar === "function") g._promotePlayerCar();
        } catch (err) { /* GLB not ready yet */ }
        const m = g.playerMesh;
        return m && m.userData && m.userData.speedNeedle ? 1 : null;
      `,
      { timeout: 60000, label: "player car with POV needles" }
    );
    const sample = await evaluate(cdp, `
      const START = Math.PI * 0.75;
      const SWEEP = Math.PI * 1.5;
      const g = window.game;
      const mesh = g.playerMesh;
      const spd = mesh.userData.speedNeedle;
      const rpm = mesh.userData.rpmNeedle;
      const restExpect = -START;
      const halfExpect = -(START + SWEEP * 0.5);
      g.player.speed = 0;
      g.player.rpm = 0;
      mesh.userData._spdGauge = { x: restExpect, v: 0 };
      mesh.userData._rpmGauge = { x: restExpect, v: 0 };
      g._syncPlayerMesh(1);
      const restZ = spd.rotation.z;
      const restRpmZ = rpm.rotation.z;
      // 70 MPH → 0.5 of the 140 scale. 4.5k RPM → 0.5 of the 9 scale.
      g.player.speed = 70 / 2.236936292;
      g.player.rpm = 4500;
      for (let i = 0; i < 120; i++) g._syncPlayerMesh(1);
      const halfZ = spd.rotation.z;
      const halfRpmZ = rpm.rotation.z;
      const wrap = (a) => {
        let x = a;
        while (x > Math.PI) x -= Math.PI * 2;
        while (x < -Math.PI) x += Math.PI * 2;
        return x;
      };
      return {
        restZ,
        restRpmZ,
        halfZ,
        halfRpmZ,
        restErr: Math.abs(wrap(restZ - restExpect)),
        halfErr: Math.abs(wrap(halfZ - halfExpect)),
        rpmRestErr: Math.abs(wrap(restRpmZ - restExpect)),
        rpmHalfErr: Math.abs(wrap(halfRpmZ - halfExpect)),
        vmax: mesh.userData.gaugeVmax,
        rpmMax: mesh.userData.gaugeRpmMax,
        mphLabel: true,
      };
    `);
    check(
      "live rest needles sit on 0 (7:30)",
      sample && sample.restErr < 0.08 && sample.rpmRestErr < 0.08,
      sample ? `spd Δ=${sample.restErr && sample.restErr.toFixed(3)} rpm Δ=${sample.rpmRestErr && sample.rpmRestErr.toFixed(3)}` : "no sample"
    );
    check(
      "live 70 mph / 4.5k rpm sit at 12 o'clock",
      sample && sample.halfErr < 0.12 && sample.rpmHalfErr < 0.12,
      sample
        ? `spd Δ=${sample.halfErr && sample.halfErr.toFixed(3)} rpm Δ=${sample.rpmHalfErr && sample.rpmHalfErr.toFixed(3)} z=${sample.halfZ && sample.halfZ.toFixed(3)}`
        : "no sample"
    );
    check(
      "live scales are 140 MPH / 9k RPM",
      sample && sample.vmax === 140 && sample.rpmMax === 9,
      sample ? `vmax=${sample.vmax} rpmMax=${sample.rpmMax}` : "no sample"
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

await live();

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "POV gauges match chase HUD"}`
);
process.exit(fail ? 1 : 0);
