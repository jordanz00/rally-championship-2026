#!/usr/bin/env node
/** qa-car-scale.mjs — hero/rival share lengthM + inner-scene fitToRallyCar */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else {
    console.log(`  FAIL  ${l} — ${d}`);
    fail++;
  }
}

const config = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8");
const celica = fs.readFileSync(path.join(ROOT, "js/cars/celica.js"), "utf8");

console.log("CAR SCALE (hero + rival parity)\n");
check("lengthM on rally chassis", (config.match(/lengthM:/g) || []).length >= 3);
check("Celica lengthM 4.37", /celica:[\s\S]*?lengthM:\s*4\.37/.test(config) || /lengthM:\s*4\.37/.test(config));
check("Delta lengthM 3.85", /delta:[\s\S]*?lengthM:\s*3\.85/.test(config));
check("Stratos lengthM 3.71", /stratos:[\s\S]*?lengthM:\s*3\.71/.test(config));
check("no Focus ST spec", !/id:\s*"focus"/.test(config));
check("garage syncs from CARS.lengthM", /CARS\[id\]\?\.lengthM/.test(celica));
check("fit measures +Z axis", /axisSpan\(root, "z"\)/.test(celica));
check(
  "length from visible meshes",
  /visibleMeshBounds\(root\)/.test(celica) && /isFitHelperMesh/.test(celica)
);
check("scale inner GLB not wrapper", /inner\.scale\.multiplyScalar\(targetLen \/ len\)/.test(celica));
check("wrapper stays identity scale", /root\.scale\.set\(1, 1, 1\)/.test(celica));
check(
  "hero plants after merge",
  /mergeBodyPanels\(root, \{ protectPov: true \}\)[\s\S]*plantOnContactPatch\(root\)/.test(celica)
);
check("no rival-only y sink", !/root\.position\.y -= 0\.045/.test(celica));
check("hero and rival both fit", (celica.match(/fitToRallyCar\(root, spec\)/g) || []).length >= 2);
console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
