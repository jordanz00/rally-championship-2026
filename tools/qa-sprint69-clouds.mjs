#!/usr/bin/env node
/**
 * Sprint 69 — originally volumetric cumulus; Sprint 549 replaced with HDR skybox.
 * Keeps the sprint entry point; delegates to qa-sky-skybox.mjs.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
console.log("SPRINT 69 → SKYBOX (Sprint 549)\n");
const r = spawnSync(process.execPath, [path.join(ROOT, "tools/qa-sky-skybox.mjs")], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
