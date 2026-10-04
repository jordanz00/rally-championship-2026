#!/usr/bin/env node
/**
 * qa-rival-livery.mjs — Group-A rival paint gate.
 *
 * WHO THIS IS FOR: the rival-livery close-out.
 * WHAT IT DOES: unique palette count, no Lambert-only pack cars, Physical
 *   lacquer with roughness/env, original sponsor copy, player hero paint
 *   left on the race dress path, attract/replay share createRivalCar.
 * HOW IT CONNECTS: run after bumping ?v= on celica / ai / game / main.
 *
 * RUN:  node tools/qa-rival-livery.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

function hexes(src) {
  const out = [];
  const re = /body:\s*(0x[0-9a-fA-F]+)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1].toLowerCase());
  return out;
}

console.log(`RIVAL LIVERY GATE  ·  ${new Date().toISOString()}\n`);

const livery = read("js/cars/rival-livery.js");
const celica = read("js/cars/celica.js");
const ai = read("js/ai.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");

check("rival-livery module exists", /export const RIVAL_LIVERIES/.test(livery), "RIVAL_LIVERIES");
check("eight authored looks", (livery.match(/id:\s*"/g) || []).length >= 8, "need 8 unique ids");

const bodies = hexes(livery);
const uniqueBodies = new Set(bodies);
check("unique body palette ≥ 8", uniqueBodies.size >= 8, `got ${uniqueBodies.size}: ${[...uniqueBodies].join(", ")}`);

const slots = [];
const slotRe = /id:\s*"([^"]+)"/g;
let sm;
while ((sm = slotRe.exec(livery))) slots.push(sm[1]);
check("unique livery ids ≥ 8", new Set(slots).size >= 8, `ids=${slots.join(",")}`);

const quoted = [...livery.matchAll(/["'`]([^"'`]{0,48})["'`]/g)].map((m) => m[1]).join("\n");
const banned = /castrol|toyota|michelin|martini|repsol|rothmans|marlboro|pirelli|subaru|555/i;
check("no copyrighted sponsor marks", !banned.test(quoted), "original copy only");
check("no candy tint names", !/hot-pink|electric-blue|castrol-green/.test(livery), "toy hues");

check("Physical lacquer", /new THREE\.MeshPhysicalMaterial/.test(livery), "getRivalPaintMaterial");
check("clearcoat on rivals", /clearcoat:\s*1/.test(livery), "clearcoat");
check("roughness authored", /roughness:\s*livery\.roughness/.test(livery), "roughness");
check("env-aware paint", /envMapIntensity:\s*1\.\d+/.test(livery), "envMapIntensity");
check("object-space panels", /vRivalLocal/.test(livery), "panel shader");
check("door numbers", /doorTexture|Impact/.test(livery) && /livery\.number/.test(livery), "readable numbers");
check("hue/dirt recycle", /shiftHex/.test(livery) && /wear/.test(livery), "14-car recycle");
check("dressRivalCar hook", /export function dressRivalCar/.test(livery), "shared dress");

check("celica imports rival-livery", /rival-livery\.js\?v=\d+/.test(celica), "import");
check("AI_TINTS is RIVAL_LIVERIES", /export const AI_TINTS = RIVAL_LIVERIES/.test(celica), "palette");
check("aiTintForIndex → livery", /return aiLiveryForIndex\(index\)/.test(celica), "index map");
check("cloneRival dresses livery", /dressRivalCar\(clone/.test(celica), "not hex-only clone");
check("empty tint still liveries", /aiLiveryForIndex\(variant\)/.test(celica), "attract/ghost");
check("no Lambert-only rival paint", !/cloneRival[\s\S]{0,400}MeshLambertMaterial/.test(celica), "Lambert pack");
check(
  "old candy palette gone",
  !/name:\s*"hot-pink"|name:\s*"castrol-green"|body:\s*0xff2a7a/.test(celica),
  "celica pack path"
);

check("player factory untouched", /export function createPlayerCar/.test(celica) && /dressPlayerCarRace\(root\)/.test(celica), "hero dress");
check("player not rival-dressed", !/createPlayerCar[\s\S]{0,500}dressRivalCar/.test(celica), "hero not junk");
check("title car not rival-dressed", !/createTitleCar[\s\S]{0,400}dressRivalCar/.test(celica), "pad hero stays");

check("AI uses tint+index", /createRivalCar\(aiTintForIndex\(index\), index, this\.chassisId\)/.test(ai), "race pack");
check("attract uses same factory", /createRivalCar\(/.test(game) && /aiTintForIndex\(i\)/.test(game), "attract liveries");
check("replay uses live pack", /_startBroadcastReplay/.test(game) && /this\.opponents/.test(game), "shared meshes");

const gameCelicaV = (game.match(/celica\.js\?v=(\d+)/) || [])[1] || "";
const aiCelicaV = (ai.match(/celica\.js\?v=(\d+)/) || [])[1] || "";
check(
  "garage singleton (game↔ai celica ?v=)",
  !!(gameCelicaV && aiCelicaV && gameCelicaV === aiCelicaV && Number(gameCelicaV) >= 227),
  `game=${gameCelicaV || "missing"} ai=${aiCelicaV || "missing"}`
);
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
check("cache bust chain", cacheOk && Number(gameV) >= 994, `main=${mainV} game=${gameV}`);
check("game imports ai.js?v=217+", Number((game.match(/ai\.js\?v=(\d+)/) || [])[1]) >= 217, "ai cache");

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Rival pack is Group-A lacquer, not toy hex"}`);
process.exit(fail ? 1 : 0);
