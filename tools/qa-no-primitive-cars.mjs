#!/usr/bin/env node
/**
 * qa-no-primitive-cars.mjs — NO box / primitive cars for anyone but a real GLB.
 *
 * Owner rule (2026-10-29): non-player cars must be real rally car models, never
 * primitive boxes. Not as a fallback, not on phones, not while loading.
 *
 * RUN: node tools/qa-no-primitive-cars.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`NO PRIMITIVE CARS  ·  ${new Date().toISOString()}\n`);

const celica = read("js/cars/celica.js");
const ai = read("js/ai.js");
const game = read("js/game.js");

for (const banned of [
  "softPhoneCar",
  "soft-body",
  "soft-cabin",
  "buildGenericRival",
  "buildSaturnCar",
  "buildSaturnCelica",
  "buildSaturnDelta",
  "buildSaturnStratos",
  "assembleLoftCar",
  "getRivalShare",
]) {
  check(`celica.js has no ${banned}`, !celica.includes(banned));
}

const start = celica.indexOf("export function createRivalCar");
const end = celica.indexOf("\n}\n", start);
const rivalFn = celica.slice(start, end);
check("createRivalCar builds no primitive geometry", !/BoxGeometry|CylinderGeometry|SphereGeometry|CapsuleGeometry/.test(rivalFn));
check("createRivalCar returns a marker, not a shape, when no GLB", /missingCarMarker\(chassis\)/.test(rivalFn));
const markerStart = celica.indexOf("function missingCarMarker");
const marker = celica.slice(markerStart, celica.indexOf("\n}\n", markerStart));
check("missingCarMarker adds no mesh", !/new THREE\.Mesh/.test(marker) && /missingCar = true/.test(marker));
check("Opponent skips missing-GLB rivals", /userData\.missingCar/.test(ai));
check("ghost skips missing-GLB car", /ghostMesh\.userData\.missingCar/.test(game));
check("attract reel skips missing-GLB car", /car\.userData\.missingCar/.test(game));

// Every garage chassis ships a real rival LOD with a car-sized triangle budget.
for (const id of ["celica", "delta", "stratos"]) {
  const file = path.join(ROOT, `assets/${id}/rival.glb`);
  if (!fs.existsSync(file)) {
    check(`assets/${id}/rival.glb exists`, false);
    continue;
  }
  const buf = fs.readFileSync(file);
  const json = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString());
  let tris = 0;
  for (const m of json.meshes || []) {
    for (const p of m.primitives) {
      if (p.indices != null) tris += json.accessors[p.indices].count / 3;
    }
  }
  check(`${id} rival LOD is a real car (>= 5000 tris)`, tris >= 5000, `${Math.round(tris)} tris`);
}

console.log(`\n${fail ? "FAIL  ·  " + fail + " check(s)" : "PASS  ·  every non-player car is a real GLB or absent"}`);
process.exit(fail ? 1 : 0);
