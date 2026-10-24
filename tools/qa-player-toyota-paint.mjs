#!/usr/bin/env node
/**
 * Static proof: player Celica keeps the GLB Toyota rally albedo (2k),
 * not flat PLAYER_BOX lacquer that wiped sponsor / works paint.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const celica = read("js/cars/celica.js");
const livery = read("js/cars/rival-livery.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const index = read("index.html");
const main = read("js/main.js");

const dressFn = celica.match(/function dressPlayerCarRace\([\s\S]*?\n\}/);
const dressBody = dressFn ? dressFn[0] : "";

check("hero GLB on disk", fs.existsSync(path.join(root, "assets/celica/gt4.glb")));
check("dress does not call box livery", !/applyPlayerBoxLivery/.test(dressBody));
check("dress keeps clearcoat upgrade", /upgradeRacePaint/.test(dressBody));
check("dress retopos shell", /retopoPlayerShell/.test(dressBody));
check("shell fixes flipped normals", /retopoShellWinding/.test(celica) && /reverseInwardOuterTriangles/.test(celica));
check("shell welds verts", /mergeVertices/.test(celica));
check("shell selective subdiv", /subdivideBodyOnce/.test(celica));
check("shell two subdiv passes", /SUBDIV_PASSES = 2/.test(celica) && /SUBDIV_TRI_BUDGET = 72000/.test(celica));
check("textures pin UV0 + clamp", /channel = 0/.test(celica) && /ClampToEdgeWrapping/.test(celica));
check("gt4 cache bust", /gt4\.glb\?v=2/.test(celica));
check("dress sharpens maps", /sharpenHeroTextures/.test(dressBody));
check("race paint keeps Grills as paint", /isTitleGrillTrim/.test(celica) && /applyTitleGrillMaterial/.test(celica));
check("race glass skips bare transparent", /isCabinWindowMaterial/.test(celica));
check("no box livery on title path", !/applyPlayerBoxLivery\(clone/.test(celica));
check("title prefers hero GLB", /const hero = templates\[chassis\]/.test(celica));
check("toyota paint flag", /toyotaRallyPaint/.test(celica));
check("anisotropy ≥16", /anisotropy = Math\.max\(live\.anisotropy \|\| 1, 16\)/.test(celica));
check("mapped paint stays white tint", /phys\.color\.setHex\(0xffffff\)/.test(celica));
check("rival-livery notes hero GLB", /Player hero keeps the GLB Toyota/.test(livery));

const gV = (game.match(/celica\.js\?v=(\d+)/) || [])[1];
const aV = (ai.match(/celica\.js\?v=(\d+)/) || [])[1];
check("garage singleton", gV === aV && Number(gV) >= 265, `game=${gV} ai=${aV}`);

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
check("boot 1133+", mainV >= 1133 && gameV === mainV, `main=${mainV} game=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  player Toyota rally paint restored from GLB");
