#!/usr/bin/env node
/** qa-car-scale.mjs — hero/rival share lengthM + oriented fitToRallyCar */
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
check("lengthM on all chassis", (config.match(/lengthM:/g) || []).length >= 6);
check("garage syncs from CARS.lengthM", /CARS\[id\]\?\.lengthM/.test(celica));
check("fit measures +Z axis", /axisSpan\(root, "z"\)/.test(celica));
check("uniform scale setScalar", /root\.scale\.setScalar\(targetLen \/ len\)/.test(celica));
check("hero plants after merge", /mergeBodyPanels\(root, \{ protectPov: true \}\)[\s\S]*plantOnContactPatch\(root\)/.test(celica));
check("no rival-only y sink", !/root\.position\.y -= 0\.045/.test(celica));
console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
