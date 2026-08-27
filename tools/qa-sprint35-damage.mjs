#!/usr/bin/env node
/**
 * qa-sprint35-damage.mjs — body damage is off; sparks remain.
 *
 * RUN: node tools/qa-sprint35-damage.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else {
    console.log(`  FAIL  ${l} — ${d || ""}`);
    fail++;
  }
}

const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const effects = fs.readFileSync(path.join(ROOT, "js/effects.js"), "utf8");
const hud = fs.readFileSync(path.join(ROOT, "js/ui/hud.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

console.log("SPRINT 35 — NO BODY DAMAGE MODEL\n");
check("game does not apply mesh dents", !/applyImpactDamage/.test(game) && !/accumulateDamage/.test(game));
check("game does not import damage.js", !/assets\/damage\.js/.test(game));
check("sparks still burst on hits", /this\.sparks\.burst/.test(game));
check("sparks class", /export class ImpactSparks/.test(effects) && /AdditiveBlending/.test(effects));
check("BODY meter stays hidden", /bodyWrap\.hidden = true/.test(hud));
check("cache-bust chain", cacheOk && Number(gameV) >= 450, `main=${mainV} game=${gameV}`);
void index;
console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
