#!/usr/bin/env node
/** qa-sprint40-telemetry.mjs — Sprint 40 WRC content + ghosts + telemetry */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else { console.log(`  FAIL  ${l} — ${d}`); fail++; }
}

const courses = fs.readFileSync(path.join(ROOT, "js/tracks/courses.js"), "utf8");
const ghost = fs.readFileSync(path.join(ROOT, "js/telemetry/ghost.js"), "utf8");
const tel = fs.readFileSync(path.join(ROOT, "js/telemetry/live-qa.js"), "utf8");
const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const config = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8");

console.log("SPRINT 40 WRC + GHOSTS + TELEMETRY\n");
check("Act 8 desert extension", /Act 8.*Sprint 40/.test(courses));
check("Act 8 mountain extension", /mountain:[\s\S]*Act 8 \(Sprint 40\)/.test(courses));
check("ghost recorder", /GhostRecorder/.test(ghost) && /saveBest/.test(ghost));
check("live telemetry", /LiveTelemetry/.test(tel) && /exportJSON/.test(tel));
check("game ghost record", /ghostRecorder/.test(game) && /GhostPlayer/.test(game));
check("stage time bumped", /desert: 108/.test(config));
check("GPT brief doc", fs.existsSync(path.join(ROOT, "docs/GPT-OPTIMIZATION-BRIEF.md")));
console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
