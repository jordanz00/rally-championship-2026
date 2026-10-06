#!/usr/bin/env node
/**
 * qa-pov-hands.mjs — POV cockpit uses the CC0 rigged hands, not block fingers.
 *
 * Player moment: C into cockpit. A real left and right hand grip 9/3.
 * Turn and the arms follow the wrists.
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
const attr = read("assets/driver/ATTRIBUTION.txt");

const glbL = path.join(ROOT, "assets/driver/hand-grip-l.glb");
const glbR = path.join(ROOT, "assets/driver/hand-grip-r.glb");

check("left grip GLB is on disk", fs.existsSync(glbL) && fs.statSync(glbL).size > 500000);
check("right grip GLB is on disk", fs.existsSync(glbR) && fs.statSync(glbR).size > 500000);
check(
  "hands load the rigged GLBs",
  /hand-grip-l\.glb/.test(driver) && /hand-grip-r\.glb/.test(driver) && /GLTFLoader/.test(driver) && /cloneRig/.test(driver)
);
check(
  "finger rig is seated, not rebuilt from primitives",
  /Index_Proximal_L/.test(driver) &&
    /function seatRig/.test(driver) &&
    !/function digitGeo/.test(driver) &&
    !/function addWrappedFinger/.test(driver) &&
    !/function palmGeo/.test(driver) &&
    !/CapsuleGeometry/.test(driver) &&
    !/BoxGeometry/.test(driver)
);
check("skinned clone rebinds bones", /node\.isSkinnedMesh/.test(driver) && /skeleton\.bones/.test(driver));
check("rim is measured in spin-local space", /export function measureSpinRim/.test(driver) && /spin\.matrixWorld/.test(driver));
check("hands parent to steer-spin", /spin\.add\(grips\)/.test(driver));
check("fixed-length sleeve IK", /upperLen/.test(anim) && /foreLen/.test(anim) && /Math\.acos\(cosA\)/.test(anim));
check("hands are not twisted off the rim", !/gripLean/.test(anim) && /Gloves stay locked to the rim/.test(anim));
check(
  "skin emits in the POV overlay",
  /emissiveMap: SKIN_MAP/.test(driver) && /toneMapped: false/.test(driver) && /pov-hand-light/.test(driver)
);
check("grips sit at 9 and 3", /CLOCK_9_3 = 0\.14/.test(driver) && /clock = side > 0 \? CLOCK_9_3/.test(driver));
check("license is CC0 and attributed", /CC0/.test(attr) && /MakeHuman/.test(attr) && /godot-xr-tools/.test(attr));
check("celica imports pov-driver.js?v=11+", Number((car.match(/pov-driver\.js\?v=(\d+)/) || [])[1]) >= 11);
check(
  "celica split still resolves rival-livery if imported",
  !/rival-livery\.js/.test(car) || fs.existsSync(path.join(ROOT, "js/cars/rival-livery.js"))
);
check("game imports cockpit-anim.js?v=9+", Number((game.match(/cockpit-anim\.js\?v=(\d+)/) || [])[1]) >= 9);
check("game imports celica.js?v=240+", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 240);
check("boot cache is 1057+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 1057);
check("index boots main.js?v=1057+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1057);
check(
  "grip keeps the exported fist and seats it on the tube",
  /function poseGrip/.test(driver) &&
    !/bone\.rotation\.set\(0, 0, 0\)/.test(driver) &&
    /arm\.quaternion/.test(driver)
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "rigged hands grip the rim"}`);
process.exit(fail ? 1 : 0);
