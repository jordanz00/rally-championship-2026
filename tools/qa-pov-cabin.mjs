#!/usr/bin/env node
/**
 * POV cabin — hero GLB modeled interior when present; procedural fallback.
 * RUN: node tools/qa-pov-cabin.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

console.log(`POV CABIN  ·  ${new Date().toISOString()}\n`);

const car = read("js/cars/celica.js");
const game = read("js/game.js");
const cfg = read("js/config.js");
const pbr = read("js/gfx/pbr.js");
const index = read("index.html");

check("cabin Physical materials", /MeshPhysicalMaterial/.test(car) && /cabinGrainMap/.test(car));
check("seat bolsters + headrest", /bolsterL/.test(car) && /headrest|head\.position/.test(car));
check("tunnel + center stack", /Transmission tunnel|tunnel = new THREE\.Mesh/.test(car) && /center stack|stack = new THREE\.Mesh/.test(car));
check("door armrests", /armL/.test(car) && /sillL/.test(car));
check("cabin ver bump", /CABIN_VER = 3/.test(car));
check("tag GLB cabin", /function tagGlbCabin/.test(car) && /hasGlbCabin/.test(car));
check("POV shows glbCabin", /_povGlbCabin/.test(car) && /useGlbCabin/.test(car));
check("slim fill when GLB", /_cabinMode = useGlbCabin \? "glb" : "procedural"/.test(car));
check("cabin IBL in armRaceCarReflections", /isCabin/.test(pbr) && /cabinPlastic/.test(pbr));
check("warm cabin fill ≥1.0", /_cabinFill\.intensity = 1\.05/.test(game));
check("POV FOV widened", /id:\s*["']pov["'][\s\S]{0,500}fov:\s*84/.test(cfg));
check("celica?v=272+", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 272);
check("boot 1145+", Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1145);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "POV cabin dressed"}`);
process.exit(fail ? 1 : 0);
