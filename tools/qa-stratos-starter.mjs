/**
 * Stratos starter-car gates.
 * Run: node tools/qa-stratos-starter.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const celica = fs.readFileSync(path.join(root, "js/cars/celica.js"), "utf8");
const game = fs.readFileSync(path.join(root, "js/game.js"), "utf8");
const config = fs.readFileSync(path.join(root, "js/config.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8");
const glb = path.join(root, "assets/stratos/stratos.glb");

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("STRATOS STARTER\n");

check("stratos.glb on disk", fs.existsSync(glb), `${(fs.statSync(glb).size / 1024) | 0} KB`);
check("loads with Celica/Delta at boot", /Promise\.all\(\["celica", "delta", "stratos"\]/.test(celica));
check("config not locked", /stratos:[\s\S]*?locked:\s*false/.test(config));
check("unlocked by default in game", /this\.stratosUnlocked = true/.test(game));
check("SELECT CAR button enabled", /data-car="stratos">STRATOS HF/.test(index) && !/data-car="stratos" disabled/.test(index));
check("pickCar no championship lock", !/_pickCar\(id\) \{\s*if \(id === "stratos" && !this\.stratosUnlocked\)/.test(game));
check("cache-bust game.js?v=267", /game\.js\?v=267/.test(main));

console.log(failed ? `\nFAIL  ·  ${failed}` : "\nPASS  ·  all checks");
process.exit(failed ? 1 : 0);
