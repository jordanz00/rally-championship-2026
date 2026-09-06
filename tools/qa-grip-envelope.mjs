#!/usr/bin/env node
/**
 * qa-grip-envelope.mjs — progressive grip (bite → peak → breakaway → catch).
 *
 * Player moment: the car tells you you are approaching the limit, then that
 * you have crossed it, then that you can still save it. No random tires.
 * Jump launch energy is not in scope for this gate.
 *
 * RUN: node tools/qa-grip-envelope.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

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

/** Mirror of vehicle.js tireEnvelopeFalloff — must stay in lockstep. */
function tireEnvelopeFalloff(over, peakHold, soft) {
  if (over <= peakHold) return 0;
  const t = Math.max(0, Math.min(1, (over - peakHold) / Math.max(1.15, soft)));
  return t * t * (3 - 2 * t);
}

console.log(`GRIP ENVELOPE  ·  ${new Date().toISOString()}\n`);

const vehicle = read("js/physics/vehicle.js");
const config = read("js/config.js");
const jump = read("js/physics/jump.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");

check("named envelope helper", /function tireEnvelopeFalloff\(over, peakHold, soft\)/.test(vehicle));
check("peak hold before breakaway", /tirePeakHold/.test(vehicle) && /tirePeakHold:\s*1\.0[5-9]/.test(config));
check("wide slide soft", /tireSlideSoft:\s*3\.\d+/.test(config));
check("recover floor", /tireRecoverFloor:\s*0\.[3-5]/.test(config) && /tireRecoverFloor/.test(vehicle));
check("pedal load into Fz", /pedalLoadBlend/.test(vehicle) && /pedalLoadBlend:\s*0\.3/.test(config));
check("no binary latG clip", !/rearSliding \|\| frontSliding/.test(vehicle));
check("progressive latG uses envelope", /tireEnvelopeFalloff\(overA/.test(vehicle));
check("no RNG in vehicle step", !/Math\.random\(/.test(vehicle));
check("no RNG in jump model", !/Math\.random\(/.test(jump));

const peakHold = 1.08;
const soft = 3.15;
const a = tireEnvelopeFalloff(1.0, peakHold, soft);
const b = tireEnvelopeFalloff(peakHold, peakHold, soft);
const c = tireEnvelopeFalloff(1.2, peakHold, soft);
const d = tireEnvelopeFalloff(2.2, peakHold, soft);
const e = tireEnvelopeFalloff(peakHold + Math.max(1.15, soft), peakHold, soft);
const a2 = tireEnvelopeFalloff(1.2, peakHold, soft);
check("plateau at peak (over=1)", a === 0, `falloff=${a}`);
check("plateau at peakHold", b === 0, `falloff=${b}`);
check("breakaway has started by 1.2", c > 0 && c < 0.2, `falloff=${c.toFixed(3)}`);
check("deeper slip is more slide", d > c, `${d.toFixed(3)} > ${c.toFixed(3)}`);
check("full slide at peakHold+soft", e === 1, `falloff=${e}`);
check("deterministic repeat", c === a2);

function surfaceBlock(id) {
  const re = new RegExp(`id: "${id}"[\\s\\S]*?muPeak:\\s*([0-9.]+)`);
  const m = config.match(re);
  return m ? Number(m[1]) : NaN;
}
const muTarmac = surfaceBlock("tarmac");
const muGravel = surfaceBlock("gravel");
const muSand = surfaceBlock("sand");
const muGrass = surfaceBlock("grass");
const muMud = surfaceBlock("mud");
check(
  "surface hierarchy tarmac>gravel>sand>grass>mud",
  muTarmac > muGravel && muGravel > muSand && muSand > muGrass && muGrass > muMud,
  `µ ${muTarmac} / ${muGravel} / ${muSand} / ${muGrass} / ${muMud}`
);
check("grass weak lateral vs tarmac", muGrass < muTarmac * 0.55);
check("mud traction-limited", muMud < 0.72);
check("recoverable slideGripMul", /slideGripMul:\s*0\.[3-5]/.test(config));

const gameVeh = (game.match(/vehicle\.js\?v=(\d+)/) || [])[1];
const aiVeh = (ai.match(/vehicle\.js\?v=(\d+)/) || [])[1];
check("game/ai vehicle singleton", gameVeh && gameVeh === aiVeh, `v=${gameVeh}`);
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
check("index→main→game cache", cacheOk, `game=${gameV} main=${mainV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "grip envelope armed"}`);
process.exit(fail ? 1 : 0);
