#!/usr/bin/env node
/**
 * qa-sprint46-launch.mjs — Sprint 46 public deploy gate.
 *
 * RUN: node tools/qa-sprint46-launch.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function run(file) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", file)], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return { pass: r.status === 0, tail: (r.stdout || r.stderr || "").trim().split("\n").slice(-3).join(" · ") };
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`SPRINT 46 PUBLIC LAUNCH GATE  ·  ${new Date().toISOString()}\n`);

const index = read("index.html");
const readme = fs.existsSync(path.join(ROOT, "README.md")) ? read("README.md") : "";
const workflow = fs.existsSync(path.join(ROOT, ".github/workflows/pages.yml"))
  ? read(".github/workflows/pages.yml")
  : "";
const gitignore = read(".gitignore");
const { ok: cacheOk } = readCacheVersions(read("js/main.js"), index);

check("GitHub Pages workflow", /deploy-pages/.test(workflow), "missing .github/workflows/pages.yml");
check("README play URL", /github\.io\/rally-championship-2026/.test(readme), "README missing Pages URL");
check("index.html entry", /js\/main\.js\?v=\d+/.test(index), "missing versioned main.js");
check("cache bust main↔game", cacheOk, "main.js and index.html ?v= mismatch");
check(".gitignore excludes .qa", /\.qa\//.test(gitignore), "QA browsers must not ship");
check("no absolute /js paths", !/src="\/js\//.test(index), "breaks project Pages subpath");
check(
  "audio works off localhost",
  !/github\.io/.test(read("js/audio/engine.js")) || !/return true.*github/.test(read("js/audio/engine.js")),
  "audio must not mute on github.io"
);

console.log("\nRegression matrix\n");
const matrix = [
  "qa-car-scale.mjs",
  "qa-sprint35-40-matrix.mjs",
  "qa-sprint34-checkin.mjs",
];
for (const g of matrix) {
  process.stdout.write(`  ${g}… `);
  const r = run(g);
  if (r.pass) console.log("PASS");
  else {
    console.log("FAIL");
    if (r.tail) console.log(`        ${r.tail}`);
    fail += 1;
  }
}

console.log(fail ? `\nNO-GO · ${fail} failed` : "\nSHIP · Sprint 46 deploy-ready");
process.exit(fail ? 1 : 0);
