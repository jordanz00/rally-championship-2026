#!/usr/bin/env node
/**
 * qa-pov-hands.mjs — POV gloves wrap the rim; sleeves track the wrists.
 *
 * Player moment: C into cockpit. Hands grip 9/3. Turn and the arms follow.
 *
 * RUN: node tools/qa-pov-hands.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`POV HANDS  ·  ${new Date().toISOString()}\n`);

const driver = read("js/cars/pov-driver.js");
const anim = read("js/cars/cockpit-anim.js");
const car = read("js/cars/celica.js");
const game = read("js/game.js");
const main = read("js/main.js");
const html = read("index.html");

check("rim is measured in spin-local space", /export function measureSpinRim/.test(driver) && /spin\.matrixWorld/.test(driver));
check("fingers wrap the tube", /function addWrappedFinger/.test(driver) && /function tubePoint/.test(driver));
check("thumb wraps the inner rim", /function addWrappedThumb/.test(driver));
check("hands parent to steer-spin", /spin\.add\(grips\)/.test(driver));
check("fixed-length sleeve IK", /upperLen/.test(anim) && /foreLen/.test(anim) && /Math\.acos\(cosA\)/.test(anim));
check("hands are not twisted off the rim", !/gripLean/.test(anim) && /Gloves stay locked to the rim/.test(anim));
check("gloves emit in the POV overlay", /emissiveMap: GLOVE_MAP/.test(driver) && /toneMapped: false/.test(driver));
check("grips sit at 10 and 2", /clock = side > 0 \? 0\.62/.test(driver));
check("celica imports pov-driver.js?v=3+", Number((car.match(/pov-driver\.js\?v=(\d+)/) || [])[1]) >= 3);
check("game imports cockpit-anim.js?v=7+", Number((game.match(/cockpit-anim\.js\?v=(\d+)/) || [])[1]) >= 7);
check("game imports celica.js?v=225+", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 225);
check("boot cache is 977+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 977);
check("index boots main.js?v=977+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 977);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "POV gloves grip the rim"}`);
process.exit(fail ? 1 : 0);
