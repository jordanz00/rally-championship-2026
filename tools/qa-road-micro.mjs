/**
 * QA — road micro-terrain and suspension response (Sprint 494).
 * node tools/qa-road-micro.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const micro = read("js/tracks/road-micro.js");
const track = read("js/tracks/track.js");
const vehicle = read("js/physics/vehicle.js");
const config = read("js/config.js");
const celica = read("js/cars/celica.js");

let pass = 0;
let fail = 0;

function check(label, ok, hint) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${hint ? ` — ${hint}` : ""}`);
  }
}

console.log("qa-road-micro.mjs");

check("roadMicroHeight exported", /export function roadMicroHeight/.test(micro));
check("patch bumps in micro module", /function patchBump/.test(micro));
check("query adds road micro height", /roadMicroHeight\(distAlong, lateral/.test(track));
check("road mesh vertices use lateral micro", /microL = roadMicroHeight/.test(track));
check("vehicle imports road-micro", /from "\.\.\/tracks\/road-micro/.test(vehicle));
check("corner wheel probes", /_wheelCornerProbe/.test(vehicle));
check("road roll from wheel heights", /roadRollGain/.test(config) && /this\._roadRoll/.test(vehicle));
check("wheel travel on draw pose", /wheelY/.test(vehicle) && /wheelTravelMax/.test(config));
check("applyWheelPose suspension Y", /wheelY\[i\]/.test(celica));
check("roadChatterScale raised", /roadChatterScale:\s*0\.12/.test(config));
check("gravel bump tuned up", /gravel:[\s\S]*?bump:\s*0\.052/m.test(config));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} (${pass} ok, ${fail} fail)`);
process.exit(fail ? 1 : 0);
