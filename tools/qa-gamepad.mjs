#!/usr/bin/env node
/**
 * qa-gamepad.mjs — DualShock / any-slot Bluetooth must actually drive the car.
 *
 * WHO THIS IS FOR: anyone changing js/input.js.
 * WHAT IT PROVES (static):
 *   1. Driving does not read only pads[0] — rumble already walked every slot.
 *   2. Sony HID (empty mapping) uses Cross as gas, not Square.
 *   3. Analog triggers can come from axes that rest at -1.
 *   4. Cache-bust on input.js is wired from game.js.
 *
 * RUN: node tools/qa-gamepad.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`GAMEPAD / DUALSHOCK BT GATE  ·  ${new Date().toISOString()}\n`);

const input = read("js/input.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");

check("picks a live pad, not only index 0", /_pickGamepad\(/.test(input) && /_padLooksDriveable\(/.test(input));
check("listens for gamepadconnected", /gamepadconnected/.test(input));
check("Sony DualShock / DualSense id match", /dualshock|dualsense|054c/.test(input));
check("Sony raw Cross = gas", /faceGas = sonyRaw \? 1 : 0/.test(input));
check("Sony analog trigger rest at -1", /_axisAsTrigger/.test(input) && /a < -0\.82/.test(input));
check("D-pad steer fallback", /_down\(gp, 14\)/.test(input));
check("input cache ≥43", /input\.js\?v=(\d+)/.test(game) && Number((game.match(/input\.js\?v=(\d+)/) || [])[1]) >= 43);

const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust chain", cacheOk, `game=${gameV} main=${mainV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "gamepad Bluetooth mapping armed"}`);
process.exit(fail ? 1 : 0);
