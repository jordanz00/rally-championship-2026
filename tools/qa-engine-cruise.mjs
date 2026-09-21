#!/usr/bin/env node
/**
 * qa-engine-cruise.mjs — top speed is a 4th-gear pull, not a limiter scream.
 *
 * RUN: node tools/qa-engine-cruise.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`ENGINE CRUISE / VMAX  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const powertrain = read("js/audio/powertrain.js");
const index = read("index.html");
const main = read("js/main.js");
const game = read("js/game.js");
const ai = read("js/ai.js");

const upWot = Number((config.match(/upWot:\s*([\d.]+)/) || [])[1]);
check("WOT upshift in the working band", upWot > 0 && upWot <= 0.84, `upWot=${upWot}`);

const aero = Number((config.match(/aeroDrag:\s*([\d.]+)/) || [])[1]);
check("aero wall owns Vmax", aero >= 0.4, `aeroDrag=${aero}`);

const chassisGears = config.match(/gears:\s*\[\s*0,\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\]/);
const fourth = chassisGears ? Number(chassisGears[4]) : NaN;
check("overdrive 4th (Celica/Delta)", fourth > 0.5 && fourth <= 0.75, `4th=${fourth}`);

const stratos = config.match(/id:\s*"stratos"[\s\S]*?gears:\s*\[\s*0,\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)\s*\]/);
const s4 = stratos ? Number(stratos[1]) : NaN;
check("overdrive 4th (Stratos)", s4 > 0.5 && s4 <= 0.72, `4th=${s4}`);

check(
  "high-speed drive fade",
  /lerp\(1\.44,\s*0\.34/.test(vehicle),
  "tqDrive must fall off toward Vmax"
);
check(
  "soft redline instead of a slam",
  /red \* 0\.86/.test(vehicle) && /limN \* limN/.test(vehicle),
  "torque eases as RPM leaves the working band"
);
check(
  "torque drops after 7k",
  /r < 7000/.test(vehicle) && /\(r - 7000\) \* 0\.18/.test(vehicle),
  "past the cruise band must not make more speed"
);
check("_autoShift binds this.spec", /_autoShift\(dt\) \{\s*const s = this\.spec;/.test(vehicle));
check(
  "load bed does not scream in cruise",
  /cruise/.test(powertrain) && /rpmN - 0\.72/.test(powertrain),
  "WOT in 4th should stay chesty"
);

const mainV = (index.match(/main\.js\?v=(\d+)/) || [])[1];
const gameV = (main.match(/game\.js\?v=(\d+)/) || [])[1];
check("index.html and main.js share boot version", mainV && mainV === gameV, `index=${mainV} main→game=${gameV}`);

const vehGame = (game.match(/vehicle\.js\?v=(\d+)/) || [])[1];
const vehAi = (ai.match(/vehicle\.js\?v=(\d+)/) || [])[1];
check("game.js and ai.js share vehicle.js version", vehGame && vehGame === vehAi, `game=${vehGame} ai=${vehAi}`);
check("vehicle.js >= 166", Number(vehGame) >= 166, `vehicle.js?v=${vehGame}`);
check("config.js >= 239", Number((game.match(/config\.js\?v=(\d+)/) || [])[1]) >= 239);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "engine cruise / Vmax armed"}`);
process.exit(fail ? 1 : 0);
