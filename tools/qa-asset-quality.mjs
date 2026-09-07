#!/usr/bin/env node
/**
 * Asset quality gate — perceptual PASS/REJECT for Forest hero environment.
 *
 * WHO THIS IS FOR: anyone about to "improve the environment."
 * WHAT IT DOES: reads docs/env-asset-registry.json, inspects GLBs, and FAILS
 *   if a forbidden/low-poly file is marked PASS, if PBR claims are lies, or
 *   if reconstructionPass is marked complete while Forest trees are REJECT.
 * HOW IT CONNECTS: environment reconstruction Pass 1. Not a substitute for
 *   headed Forest inspection. Automated QA of the *other* scripts can pass
 *   while this gate still prints INCOMPLETE.
 *
 * RUN: node tools/qa-asset-quality.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REG_PATH = path.join(ROOT, "docs", "env-asset-registry.json");

function inspectGlb(abs) {
  const buf = fs.readFileSync(abs);
  if (buf.slice(0, 4).toString() !== "glTF") return null;
  const jsonLen = buf.readUInt32LE(12);
  const js = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  let tris = 0;
  for (const mesh of js.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.indices != null) {
        tris += Math.floor((js.accessors[prim.indices]?.count || 0) / 3);
      } else {
        const pos = prim.attributes?.POSITION;
        if (pos != null) tris += Math.floor((js.accessors[pos]?.count || 0) / 3);
      }
    }
  }
  let nrm = 0;
  let rough = 0;
  for (const mat of js.materials || []) {
    if (mat.normalTexture) nrm += 1;
    if (mat.pbrMetallicRoughness?.metallicRoughnessTexture) rough += 1;
  }
  return {
    bytes: buf.length,
    tris,
    meshes: (js.meshes || []).length,
    images: (js.images || []).length,
    normalMaps: nrm,
    roughnessMaps: rough,
  };
}

const GATE_KEYS = [
  "silhouette",
  "material",
  "groundContact",
  "textureRepetition",
  "scale",
  "lod",
  "visualTarget",
  "verdict",
];

const ALLOWED = new Set(["PASS", "REJECT", "PARTIAL"]);

let fail = 0;
function check(ok, label, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`ASSET QUALITY GATE  ·  ${new Date().toISOString()}\n`);

check(fs.existsSync(REG_PATH), "registry present", "missing docs/env-asset-registry.json");
if (fail) {
  console.log("\nFAIL  ·  no registry");
  process.exit(1);
}

const reg = JSON.parse(fs.readFileSync(REG_PATH, "utf8"));
const never = new Set(reg.neverPassFiles || []);
const assets = Array.isArray(reg.assets) ? reg.assets : [];

check(reg.schemaVersion === 1, "schemaVersion 1", `got ${reg.schemaVersion}`);
check(reg.stageFocus === "forest", "Pass 1 is Forest-only", `stageFocus=${reg.stageFocus}`);
check(reg.complete === false || reg.complete === true, "complete is boolean", "complete missing");

console.log("");
console.log(
  `${"id".padEnd(24)} ${"12m".padEnd(8)} ${"silh".padEnd(8)} ${"mat".padEnd(8)} ${"grd".padEnd(8)} ${"uv".padEnd(8)} ${"lod".padEnd(8)} ${"target".padEnd(8)} ${"VERDICT"}`
);
console.log("-".repeat(104));

for (const a of assets) {
  const row = [
    String(a.id || "").slice(0, 24).padEnd(24),
    String(a.heroDistanceM ?? "").padEnd(8),
    String(a.silhouette || "").padEnd(8),
    String(a.material || "").padEnd(8),
    String(a.groundContact || "").padEnd(8),
    String(a.textureRepetition || "").padEnd(8),
    String(a.lod || "").padEnd(8),
    String(a.visualTarget || "").padEnd(8),
    a.verdict,
  ].join(" ");
  console.log(row);

  for (const k of GATE_KEYS) {
    check(ALLOWED.has(a[k]), `${a.id} ${k} enum`, `${a[k]}`);
  }

  const files = a.files || [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const exists = fs.existsSync(abs);
    if (a.verdict === "PASS" || a.status === "HAVE") {
      check(exists, `${a.id} file ${rel}`, "missing on disk");
    }
    if (!exists) continue;
    if (never.has(rel.replace(/\\/g, "/")) || never.has(rel)) {
      check(a.verdict !== "PASS", `${a.id} never-pass file cannot be PASS`, rel);
      check(a.visualTarget !== "PASS", `${a.id} never-pass visualTarget`, rel);
    }
    const info = inspectGlb(abs);
    if (!info) continue;
    if (a.verdict === "PASS" && a.material === "PASS") {
      check(
        info.normalMaps > 0,
        `${a.id} PBR normal map`,
        `${path.basename(rel)} has ${info.normalMaps} normalTexture(s)`
      );
    }
  }

  if (a.verdict === "PASS") {
    check(a.visualTarget === "PASS", `${a.id} PASS requires visualTarget PASS`, a.visualTarget);
    check(a.silhouette === "PASS", `${a.id} PASS requires silhouette PASS`, a.silhouette);
  }
  if (a.verdict === "REJECT") {
    check(a.visualTarget !== "PASS", `${a.id} REJECT cannot claim visualTarget PASS`, a.visualTarget);
  }
}

const trees = assets.find((a) => a.id === "FOREST_TREE_LARGE");
check(!!trees, "FOREST_TREE_LARGE row exists", "required category missing");
if (trees) {
  check(trees.verdict === "REJECT", "Forest trees are REJECT until a hero library exists", trees.verdict);
  check(trees.status === "MISSING", "Forest trees status MISSING", trees.status);
}

const boulder = assets.find((a) => a.id === "FOREST_ROCK_BOULDER");
check(!!boulder && boulder.verdict === "PASS", "Forest hero boulder stays PASS", boulder?.verdict);

if (reg.complete === true) {
  const blockers = assets.filter(
    (a) =>
      ["FOREST_TREE_LARGE", "FOREST_ROCK_BOULDER", "FOREST_LOG"].includes(a.id) && a.verdict !== "PASS"
  );
  check(blockers.length === 0, "complete:true requires trees+rocks+logs PASS", blockers.map((b) => b.id).join(","));
}

const kit = fs.readFileSync(path.join(ROOT, "js", "tracks", "prop-kit.js"), "utf8");
const track = fs.readFileSync(path.join(ROOT, "js", "tracks", "track.js"), "utf8");
check(/FOREST_HERO_KINDS/.test(kit), "prop-kit exports Forest hero kinds", "missing FOREST_HERO_KINDS");
check(/forest_hero_boulder_a/.test(track), "track plants Forest hero boulders", "hero rocks not referenced");
check(
  /low_poly_forest_tree_pack/.test(kit),
  "current close trees still come from the Sketchfab pack (honest)",
  "pack load path changed — update the registry"
);

console.log("");
const incomplete = trees && trees.verdict === "REJECT";
if (fail) {
  console.log(`FAIL  ·  ${fail} honesty/quality check(s) failed`);
  console.log("Do not mark Forest trees PASS. Acquire hero GLBs or leave the existing pack.");
  process.exit(1);
}
if (incomplete) {
  console.log("INCOMPLETE  ·  Forest Pass 1 is not done.");
  console.log("Hero rocks/logs: PASS. Hero trees: REJECT / MISSING.");
  console.log("Do not generate cylinder/cone/icosphere trees to close this gate.");
  console.log("See docs/ASSET-ACQUISITION-MANIFEST.md");
  process.exit(1);
}
console.log("PASS  ·  Forest hero trees, rocks, and logs all meet the quality bar");
process.exit(0);
