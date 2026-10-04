#!/usr/bin/env node
/**
 * qa-pov-hands.mjs — POV racing gloves wrap the rim; sleeves track the wrists.
 *
 * Player moment: C into cockpit. Hands grip 10/2. Each finger is a real digit
 * on the tube. Turn and the arms follow.
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
check("fingers wrap the tube", /function addWrappedFinger/.test(driver) && /function tubePoint/.test(driver) && /function orientOnTube/.test(driver));
check("thumb wraps the inner rim", /function addWrappedThumb/.test(driver) && /userData\.digit = "thumb"/.test(driver));
check(
  "four named fingers plus thumb per hand",
  /finger-index/.test(driver) &&
    /finger-middle/.test(driver) &&
    /finger-ring/.test(driver) &&
    /finger-pinky/.test(driver) &&
    /userData\.phalanges = 3/.test(driver) &&
    /userData\.phalanges = 2/.test(driver)
);
check(
  "digits are sculpted phalanges, not grip capsules",
  /function phalanxGeo/.test(driver) &&
    /function knuckleGeo/.test(driver) &&
    /function tipGeo/.test(driver) &&
    !/capsuleAlongY/.test(driver) &&
    !/CapsuleGeometry/.test(driver)
);
check("hands parent to steer-spin", /spin\.add\(grips\)/.test(driver));
check("fixed-length sleeve IK", /upperLen/.test(anim) && /foreLen/.test(anim) && /Math\.acos\(cosA\)/.test(anim));
check("hands are not twisted off the rim", !/gripLean/.test(anim) && /Gloves stay locked to the rim/.test(anim));
check("gloves emit in the POV overlay", /emissiveMap: GLOVE_MAP/.test(driver) && /toneMapped: false/.test(driver));
check("grips sit at 10 and 2", /clock = side > 0 \? 0\.62/.test(driver));
check("celica imports pov-driver.js?v=4+", Number((car.match(/pov-driver\.js\?v=(\d+)/) || [])[1]) >= 4);
check(
  "celica split still resolves rival-livery if imported",
  !/rival-livery\.js/.test(car) || fs.existsSync(path.join(ROOT, "js/cars/rival-livery.js"))
);
check("game imports cockpit-anim.js?v=8+", Number((game.match(/cockpit-anim\.js\?v=(\d+)/) || [])[1]) >= 8);
check("game imports celica.js?v=227+", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 227);
check("boot cache is 993+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 993);
check("index boots main.js?v=993+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 993);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "POV racing gloves grip the rim"}`);
process.exit(fail ? 1 : 0);
