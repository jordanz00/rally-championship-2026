#!/usr/bin/env node
/**
 * Static proof: player accel stays soft vs the pack — no GO free-pass.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const vehicle = read("js/physics/vehicle.js");
const burnout = read("js/physics/burnout-drive.js");
const config = read("js/config.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const index = read("index.html");
const main = read("js/main.js");

check("no first-260m commit free pass", !/progress < 260/.test(vehicle));
check(
  "player pull always soft",
  /!this\.ai && this\.throttle > 0\.2 && axTire > 0/.test(vehicle) &&
    /axTire \*= lerp\(0\.52, 0\.68/.test(vehicle)
);
check("GO rush drive toned", /GO_RUSH_DRIVE = 1\.28/.test(vehicle));
check("burnout drive v6", /_burnoutDriveV6/.test(burnout) && /launchBoost = 1\.92/.test(burnout));
check("rush torque soft", /h \* 0\.48/.test(burnout));
check("AI skill floor raised", /skillFloor: 0\.8/.test(config));
check("vehicle singleton", /vehicle\.js\?v=207/.test(game) && /vehicle\.js\?v=207/.test(ai));
check("burnout import v6", /burnout-drive\.js\?v=6/.test(vehicle));

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
check("boot main/game aligned", mainV >= 1086 && gameV === mainV, `main=${mainV} game=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  player pack pace — soft pull, no GO free-pass");
