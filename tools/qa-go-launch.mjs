#!/usr/bin/env node
/**
 * qa-go-launch.mjs — lights-out must never reverse the car.
 *
 * Stage 3 (Mountain) was the player report: accelerate at GO, the car slid
 * backward a few frames, then throttle won. Countdown skips Vehicle.step, so
 * load-time collide / env leftover Δv applied on the first race frame.
 *
 * RUN: node tools/qa-go-launch.mjs
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
  clickResilient,
  evaluate,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(HERE);

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(repo, rel), "utf8");
}

console.log(`GO LAUNCH — NO REVERSE  ·  ${new Date().toISOString()}\n`);

const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const index = read("index.html");
const main = read("js/main.js");

check(
  "Vehicle.freezeLaunch / settleStartGrid / stripLaunchReverse",
  /freezeLaunch\(\)/.test(vehicle) &&
    /settleStartGrid\(track\)/.test(vehicle) &&
    /stripLaunchReverse\(\)/.test(vehicle),
  "missing launch lock API"
);
check(
  "LAUNCH_HOLD_S armed",
  /LAUNCH_HOLD_S\s*=\s*0\.\d+/.test(vehicle),
  "missing lights-out window"
);
check(
  "game freezes grid after load collide",
  /_freezeGridMotion\(/.test(game) && /_armLightsOut\(/.test(game),
  "game.js missing grid / GO freeze"
);
const vehGame = (game.match(/vehicle\.js\?v=(\d+)/) || [])[1];
const vehAi = (ai.match(/vehicle\.js\?v=(\d+)/) || [])[1];
check(
  "game.js and ai.js share vehicle.js version",
  vehGame && vehGame === vehAi,
  `game=${vehGame} ai=${vehAi}`
);
const mainV = (index.match(/main\.js\?v=(\d+)/) || [])[1];
const gameV = (main.match(/game\.js\?v=(\d+)/) || [])[1];
check(
  "index.html and main.js share boot version",
  mainV && mainV === gameV,
  `index main=${mainV} import game=${gameV}`
);

if (!findChrome()) {
  console.log(`\n  skip  headed Mountain probe — ${chromeUnavailableHint()}`);
  console.log(`\n${fail ? "FAIL" : "PASS"}  ·  static GO-launch contracts`);
  process.exit(fail ? 1 : 0);
}

const server = await startServer(ROOT);
const browser = await launchChrome({ headless: true, width: 1280, height: 720 });
const { cdp } = browser;
await preparePage(cdp);

try {
  await goto(cdp, `${server.origin}/index.html`);
  await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "window.game" });
  await clickResilient(cdp, "#btn-start", "PRESS START");
  await waitFor(
    cdp,
    `const e = document.querySelector(".screen.active"); return e && e.id === "screen-menu" ? 1 : null;`,
    { timeout: 15000, label: "SELECT MODE" }
  );
  await clickResilient(cdp, "[data-menu='practice']", "PRACTICE");
  await waitFor(
    cdp,
    `const e = document.querySelector(".screen.active"); return e && e.id === "screen-cars" ? 1 : null;`,
    { timeout: 15000, label: "SELECT CAR" }
  );
  await waitFor(
    cdp,
    `const b = document.querySelector("[data-car='celica']"); return b && !b.disabled ? 1 : null;`,
    { timeout: 25000, label: "Celica selectable" }
  );
  await clickResilient(cdp, "[data-car='celica']", "CELICA");
  await waitFor(
    cdp,
    `const e = document.querySelector(".screen.active"); return e && e.id === "screen-courses" ? 1 : null;`,
    { timeout: 20000, label: "SELECT COURSE" }
  );
  await clickResilient(cdp, "[data-course='mountain']", "MOUNTAIN");
  await waitFor(
    cdp,
    `return window.game && (window.game.state === "countdown" || window.game.state === "race") && window.game.player && window.game.track ? 1 : null;`,
    { timeout: 120000, label: "Mountain countdown" }
  );

  const sample = await evaluate(cdp, `
    const g = window.game;
    const p = g.player;
    const track = g.track;
    const input = { steer: 0, throttle: 1, brake: 0, handbrake: 0, shiftUp: false, shiftDown: false };

    function bodyVx(car) {
      const fx = Math.sin(car.yaw);
      const fz = Math.cos(car.yaw);
      return car.velocity.x * fx + car.velocity.z * fz;
    }

    function probe(label, dist, lateral, poison) {
      p.spawn(track, dist, lateral);
      if (poison) {
        const fx = Math.sin(p.yaw);
        const fz = Math.cos(p.yaw);
        p.velocity.x = -fx * 4.2;
        p.velocity.z = -fz * 4.2;
        p._axDrive = -6;
      }
      if (g._armLightsOut) g._armLightsOut();
      else if (p.freezeLaunch) p.freezeLaunch();
      const x0 = p.position.x;
      const z0 = p.position.z;
      const fx0 = Math.sin(p.yaw);
      const fz0 = Math.cos(p.yaw);
      const prog0 = p.progress;
      let minVx = 0;
      let minAlong = 0;
      let lastVx = 0;
      for (let i = 0; i < 24; i++) {
        p.step(1 / 60, input, track);
        if (p.stripLaunchReverse) p.stripLaunchReverse();
        lastVx = bodyVx(p);
        if (lastVx < minVx) minVx = lastVx;
        const along = (p.position.x - x0) * fx0 + (p.position.z - z0) * fz0;
        if (along < minAlong) minAlong = along;
      }
      return {
        label,
        minVx,
        lastVx,
        minAlong,
        progressDelta: p.progress - prog0,
        leftoverAfterFreeze: poison ? bodyVx(p) : 0,
        slope: p._slope,
        launchHold: p._launchHold
      };
    }

    const leftover = (() => {
      p.spawn(track, p.progress || 8, 0);
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      p.velocity.x = -fx * 5;
      p.velocity.z = -fz * 5;
      if (p.freezeLaunch) p.freezeLaunch();
      return bodyVx(p);
    })();

    return {
      course: g.courseId,
      leftoverAfterFreeze: leftover,
      practice: probe("practice", 8, 0, false),
      p1: probe("champ-p1", 16, -1.1, false),
      p15: probe("champ-p15", 16 + 14 * 13, -1.22, false),
      poisoned: probe("poison-reverse", 8, 0, true)
    };
  `);

  check("Mountain track live", sample && sample.course === "mountain", `course=${sample && sample.course}`);
  check(
    "freezeLaunch kills leftover reverse Δv",
    sample && Math.abs(sample.leftoverAfterFreeze) < 0.05,
    `leftover vx=${sample && sample.leftoverAfterFreeze}`
  );

  for (const row of [sample.practice, sample.p1, sample.p15, sample.poisoned]) {
    if (!row) {
      check("probe row", false, "missing");
      continue;
    }
    check(
      `${row.label} no reverse vx`,
      row.minVx > -0.12,
      `minVx=${row.minVx.toFixed(3)}`
    );
    check(
      `${row.label} no backward XZ`,
      row.minAlong > -0.08,
      `minAlong=${row.minAlong.toFixed(3)} m`
    );
    check(
      `${row.label} throttle actually launches`,
      row.lastVx > 2.5,
      `lastVx=${row.lastVx.toFixed(2)}`
    );
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "GO launch never reverses"}`
);
process.exit(fail ? 1 : 0);
