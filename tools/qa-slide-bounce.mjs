#!/usr/bin/env node
/**
 * QA — slide / drift plant uses the ribbon plane, not washboard height.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "js/physics/vehicle.js"), "utf8");
let failed = 0;
function check(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

check("stable deck helper exists", /_stableDeckY\(q, fallback\)/.test(src));
check("pin uses ribbon minus micro", /baseHeight - \(q\.roadMicro/.test(src));
check("maneuver pin is the glue", /_pinManeuverDeck\(\)/.test(src));
check(
  "no raw query hop in last-word plant",
  !/this\.position\.y = this\._q\.height - TIRE_PLANT/.test(src)
);
check("roll damp while planted", /_keepDeckPlanted\(\) \{\n[\s\S]*?_suspRollRate \*= Math\.exp/.test(src) || /ground && this\._keepDeckPlanted\(\)/.test(src));
check("ay smoothed in a slide", /_keepDeckPlanted\(\) \? 0\.12/.test(src));

if (failed) {
  console.error(`Slide bounce QA failed: ${failed}`);
  process.exit(1);
}
console.log("Slide bounce QA passed.");
