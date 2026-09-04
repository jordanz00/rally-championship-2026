#!/usr/bin/env node
/**
 * Rally quality gate — all stages data validation + static audit hook.
 *
 * WHO THIS IS FOR: Cursor / CI / humans before calling a stage or system complete.
 * WHAT IT DOES: Validates every COURSES entry; prints per-stage ✓/✗ report;
 *   exits non-zero on critical failures. See docs/QUALITY_STANDARD.md.
 *
 * Usage: node tools/qa-validate.mjs
 */

import { COURSES, COURSE_ORDER } from "../js/tracks/courses.js";
import { validateCourseData } from "../js/tracks/stage-data-validate.js";
import { MOUNTAIN_DEFINITION } from "../js/tracks/stages/mountain-definition.js";
import { validateTrackDefinition } from "../js/tracks/stage-data-validate.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const ids = [...COURSE_ORDER];
if (COURSES.lakeside) ids.push("lakeside");
if (COURSES.physlab) ids.push("physlab");

let critical = 0;
let warns = 0;

console.log("════════════════════════════════════════════════════════");
console.log("RALLY QUALITY GATE  ·  stage data validation");
console.log("docs/QUALITY_STANDARD.md");
console.log("════════════════════════════════════════════════════════\n");

for (const id of ids) {
  const def = COURSES[id];
  const report = validateCourseData(def);
  const mark = report.ok ? "✓" : "✗";
  console.log(`${id.toUpperCase()}  ${mark}`);
  console.log(
    `  Track topology · pieces=${report.stats.pieces} length≈${report.stats.length}m authored=${report.stats.authoredFrom}`
  );
  console.log(
    `  Seed=${report.stats.seed} scenery=${report.stats.scenery} tunnels=${report.stats.tunnelRuns} CPs=${report.stats.checkpoints}`
  );
  if (report.ok) {
    console.log("  ✓ Course data");
  } else {
    critical += report.errors.length;
    for (const e of report.errors) console.log(`  ✗ [${e.code}] ${e.message}`);
  }
  for (const w of report.warnings) {
    warns++;
    console.log(`  ! [${w.code}] ${w.message}`);
  }
  // Pass 1: championship stages must be TrackDefinition-authored.
  if (id !== "physlab" && def.authoredFrom !== "TrackDefinition") {
    critical++;
    console.log(`  ✗ [PASS1] expected authoredFrom=TrackDefinition, got ${def.authoredFrom || "pieces"}`);
  } else if (id !== "physlab") {
    console.log("  ✓ Pass 1 TrackDefinition");
  }
  console.log("");
}

// Mountain TrackDefinition re-compile gate
const mt = validateTrackDefinition(MOUNTAIN_DEFINITION);
console.log(`MOUNTAIN DEFINITION RECOMPILE  ${mt.ok ? "✓" : "✗"}`);
if (!mt.ok) {
  critical += mt.errors.length;
  for (const e of mt.errors) console.log(`  ✗ [${e.code}] ${e.message}`);
} else {
  console.log("  ✓ Fail-fast compile + data gate");
}
console.log("");

// Shared system presence (files exist)
const required = [
  "js/tracks/track-definition.js",
  "js/tracks/track-clearance.js",
  "js/tracks/tunnel-volume.js",
  "js/tracks/world-geometry-validator.js",
  "js/tracks/world-config.js",
  "js/tracks/stage-data-validate.js",
  "docs/QUALITY_STANDARD.md",
  "docs/ALL_STAGES_AAA_STANDARD.md",
  "docs/AAA_VISUAL_TARGET.md",
  "docs/AGENT_ARCHITECTURE.md",
  "docs/ART_DIRECTION.md",
  "docs/CURSOR_SHOWCASE.md",
];
console.log("SHARED SYSTEMS");
for (const rel of required) {
  try {
    await import(`file://${join(root, rel)}`).catch(() => null);
  } catch {
    /* ignore — check via fs */
  }
}
import { accessSync, constants } from "node:fs";
for (const rel of required) {
  try {
    accessSync(join(root, rel), constants.R_OK);
    console.log(`  ✓ ${rel}`);
  } catch {
    console.log(`  ✗ missing ${rel}`);
    critical++;
  }
}
console.log("");

// Static audit (syntax / imports / cache-bust)
console.log("STATIC AUDIT");
const audit = spawnSync(process.execPath, [join(root, "tools/qa-static-audit.mjs")], {
  cwd: root,
  encoding: "utf8",
});
if (audit.status === 0) {
  console.log("  ✓ qa-static-audit.mjs");
} else {
  console.log("  ✗ qa-static-audit.mjs failed");
  critical++;
  if (audit.stdout) console.log(audit.stdout.split("\n").slice(-15).join("\n"));
  if (audit.stderr) console.log(audit.stderr.split("\n").slice(-10).join("\n"));
}

console.log("\n════════════════════════════════════════════════════════");
if (critical > 0) {
  console.log(`FAIL  ·  ${critical} critical issue(s)  ·  ${warns} warning(s)`);
  console.log("Do not call the task complete. Fix or report blocker.");
  process.exit(1);
}
console.log(`PASS  ·  all stages data OK  ·  ${warns} warning(s)`);
console.log("Next: headed visual QA + ?worldvalidate=1 on each stage.");
process.exit(0);
