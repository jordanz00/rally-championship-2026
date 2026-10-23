#!/usr/bin/env node
/**
 * Stage beauty pack — longer / wider / vista landmarks / soft blends.
 * RUN: node tools/qa-stage-beauty.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`STAGE BEAUTY  ·  ${new Date().toISOString()}\n`);

const { COURSES } = await import(pathToFileURL(path.join(ROOT, "js/tracks/courses.js")).href);
const { validateCourseData } = await import(
  pathToFileURL(path.join(ROOT, "js/tracks/stage-data-validate.js")).href
);

function approxLen(c) {
  let len = 0;
  for (const p of c.pieces || []) {
    if (p.length) len += p.length;
    else if (p.radius && p.angle) len += Math.abs((p.radius * p.angle * Math.PI) / 180);
    if (p.ramp) len += (p.ramp || 0) + (p.gap || 0) + (p.land || 0);
  }
  return len;
}

const floors = { desert: 3600, forest: 5600, mountain: 4200, lakeside: 3600 };
const widthFloor = { desert: 24, forest: 25, mountain: 22, lakeside: 22 };

for (const id of Object.keys(floors)) {
  const c = COURSES[id];
  const gate = validateCourseData(c);
  const len = approxLen(c);
  const widths = (c.pieces || []).map((p) => p.width).filter(Boolean);
  const wMin = Math.min(...widths);
  check(`${id} quality gate`, gate.ok, gate.ok ? "" : gate.errors.map((e) => e.message).join("; "));
  check(`${id} longer stage`, len >= floors[id], `len~${Math.round(len)}`);
  check(`${id} wider lane`, wMin >= widthFloor[id], `wMin=${wMin}`);
}

const desert = read("js/tracks/stages/desert-definition.js");
const forest = read("js/tracks/stages/forest-definition.js");
const mountain = read("js/tracks/stages/mountain-definition.js");
const lakeside = read("js/tracks/stages/lakeside-definition.js");
check("desert dune vista", /dune_vista/.test(desert) && /landmark: true/.test(desert));
check("forest glade vista", /forest_glade/.test(forest));
check("mountain alpine vista", /alpine_vista/.test(mountain));
check("lakeside lake vista", /lake_vista/.test(lakeside));

const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust", cacheOk && Number(mainV) >= 1093, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "stages longer, wider, vista-rich"}`);
process.exit(fail ? 1 : 0);
