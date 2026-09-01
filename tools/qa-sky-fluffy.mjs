#!/usr/bin/env node
/**
 * qa-sky-fluffy.mjs — redirected: volumetric fluffy march removed (Sprint 549).
 * Asserts equirect HDR skybox path. Prefer tools/qa-sky-skybox.mjs.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const r = spawnSync(process.execPath, [path.join(ROOT, "tools/qa-sky-skybox.mjs")], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
