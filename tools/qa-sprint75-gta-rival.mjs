#!/usr/bin/env node
/**
 * qa-sprint75-gta-rival.mjs — GTA IV rival: tire-moment yaw + IV principles.
 *
 * Honest bar: arcade RAGE-weight in a rally chassis. NOT "equals GTA IV."
 *
 * RUN: node tools/qa-sprint75-gta-rival.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function num(src, key) {
  const m = src.match(new RegExp(key + ":\\s*([0-9.]+)"));
  return m ? Number(m[1]) : NaN;
}

function importV(src, file) {
  const m = src.match(new RegExp(file.replace(/\./g, "\\.") + "\\?v=(\\d+)"));
  return m ? Number(m[1]) : 0;
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`SPRINT 75 GTA IV RIVAL  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("tireYawBlend in HANDLING", /tireYawBlend:\s*0\.\d+/.test(config), `= ${num(config, "tireYawBlend")}`);
check("rDotTire in _integrate", /rDotTire/.test(vehicle) && /speedBlend/.test(vehicle) && /tireYawBlend/.test(vehicle));
check("yawInertia used in _integrate", /s\.yawInertia/.test(vehicle) && /const Izz/.test(vehicle));
check(
  "Mz = front.fy * cosS * lf - rear.fy * lr",
  /front\.fy \* cosS \* lf - rear\.fy \* lr/.test(vehicle)
);
check("tractionMinMul (CurveMin/CurveMax gap)", /tractionMinMul:\s*0\.\d+/.test(config) && /tractionMinMul/.test(vehicle));
check("lowSpeedTractionLoss (fLowSpeedTractionLossMult analog)", /lowSpeedTractionLoss:\s*0\.\d+/.test(config) && /lowSpeedTractionLoss/.test(vehicle));
check("driveInertia analog", /driveInertia:\s*1\.\d+/.test(config) && /driveInertia/.test(vehicle));
check("tractionBiasFront (Sultan vs Comet)", /tractionBiasFront:\s*0\.\d+/.test(config) && /tractionBiasFront/.test(vehicle));
check("IV sources cited in HANDLING", /gtamods\.com\/wiki\/Handling\.dat/.test(config) && /Handling\.cfg\/GTAIV/.test(config));
check("IV not V (looser, not glued)", /IV not V/.test(config) || /IV not V/.test(vehicle));
check("engineBrake >= 0.3", num(config, "engineBrake") >= 0.3, `= ${num(config, "engineBrake")}`);
check("Celica steerReturn >= 100", num(config, "steerReturn") >= 100, `= ${num(config, "steerReturn")}`);
check("CAMERA rollFollow >= 0.45", num(config, "rollFollow") >= 0.45, `= ${num(config, "rollFollow")}`);
check("CAMERA speedFov >= 0.28", num(config, "speedFov") >= 0.28, `= ${num(config, "speedFov")}`);
check("TIRE_PLANT unchanged", /const TIRE_PLANT\s*=\s*0\.014/.test(vehicle));
check("no Math.random() in vehicle.js", !/Math\.random\s*\(/.test(vehicle));
check(
  "arcade recoverability armed",
  /counterAuthority:\s*2\.\d+/.test(config) && /handbrakeYawKick:\s*[3-9]\./.test(config),
  `counter=${num(config, "counterAuthority")} kick=${num(config, "handbrakeYawKick")}`
);
check("Stratos still snappier than Celica", /steerSpeed:\s*122/.test(config) && /steerSpeed:\s*112/.test(config));
check("tarmac still stops (brakeHold 1)", /tarmac:[\s\S]{0,900}?brakeHold:\s*1(?:\.0)?[\s\S]{0,80}?brakeYaw:\s*0\.08/.test(config));
check("tarmac still slides (IV, not glued)", num(config, "muSlide") <= 1.1 && num(config, "muPeak") >= 1.4);

const vehCfg = importV(vehicle, "config.js");
const gameCfg = importV(game, "config.js");
const gameVeh = importV(game, "vehicle.js");
const aiVeh = importV(ai, "vehicle.js");
check("game.js imports new vehicle + config", gameVeh >= 84 && gameCfg >= 137, `vehicle=${gameVeh} config=${gameCfg}`);
check("ai.js imports new vehicle + config", aiVeh >= 84 && importV(ai, "config.js") >= 137, `vehicle=${aiVeh}`);
check("vehicle.js imports config >= 137", vehCfg >= 137, `v=${vehCfg}`);
check("cache-bust chain", cacheOk && Number(gameV) >= 399, `main=${mainV} game=${gameV}`);
check("FIXED_DT still 1/60", /FIXED_DT\s*=\s*1\s*\/\s*60/.test(config));
check("road-lock still in step", /_keepOnRibbon\(/.test(vehicle) && /_stashGoodPose\(/.test(vehicle));

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "GTA IV rival: tire-moment yaw + weight + recoverability"}`
);
process.exit(fail ? 1 : 0);
