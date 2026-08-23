#!/usr/bin/env node
/**
 * qa-sprint35-40-matrix.mjs — Sprints 35–40 full gate matrix.
 * RUN: node tools/qa-sprint35-40-matrix.mjs
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gates = [
  "qa-sprint35-damage.mjs",
  "qa-sprint36-pace.mjs",
  "qa-sprint37-audio.mjs",
  "qa-sprint38-physics.mjs",
  "qa-sprint39-perf.mjs",
  "qa-sprint40-telemetry.mjs",
  "qa-static-audit.mjs",
];

let fail = 0;
console.log("SPRINTS 35–40 MATRIX\n");
for (const g of gates) {
  process.stdout.write(`  ${g}… `);
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", g)], { encoding: "utf8" });
  if (r.status === 0) console.log("PASS");
  else { console.log("FAIL"); fail++; }
}
console.log(fail ? `\nNO-GO · ${fail} failed` : "\nSHIP · Sprints 35–40 PASS");
process.exit(fail ? 1 : 0);
