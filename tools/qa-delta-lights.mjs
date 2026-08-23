/**
 * Delta head/brake light wiring gates.
 * Run: node tools/qa-delta-lights.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "js/cars/celica.js"), "utf8");
const game = fs.readFileSync(path.join(root, "js/game.js"), "utf8");
const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("DELTA LIGHTS\n");

check(
  "hides full-length Light glass sheets",
  /isFullLengthLightSheetLabel/.test(src) && /scrubDeltaHeadArtifacts/.test(src)
);
check(
  "underscore Light_glass / Light_Glass_Bump match",
  /light\[\\s_\.-]\*glass/.test(src) || /light\[\\s_\.\-\]\*glass/.test(src)
);
check(
  "removes sheet meshes (dispose), not only visible=false",
  /isDeltaFullLengthLightSheet/.test(src) && /geometry\.dispose\(\)/.test(src)
);
check(
  "oversized Light_Front hides material (emitters stay visible)",
  /deltaFrontHousingHidden/.test(src) && /mats\[mi\]\.visible = false/.test(src)
);
check(
  "nests head emitters in Light Front housing",
  /nestHeadEmittersInLamp/.test(src) && /findFrontLightHousing/.test(src)
);
check(
  "findFrontLightHousing accepts underscores",
  /light\[\\s_\.-]\*front/.test(src) || /light\[\\s_\.\-\]\*front/.test(src)
);
check("strips headDummy floating boxes", /headDummy/.test(src) && /scrubDeltaHeadArtifacts/.test(src));
check("brake path still nests rear emitters", /nestBrakeEmittersInLamp/.test(src));
check(
  "named front lamp excludes light glass sheets",
  /isFullLengthLightSheetLabel\(label\) return false/.test(src) ||
    /isFullLengthLightSheetLabel\(label\)\) return false/.test(src)
);
check("cache-bust celica.js?v=93", /celica\.js\?v=93/.test(game), "game imports v93");
check("main → game v=295", /game\.js\?v=295/.test(main));
check("index → main v=295", /main\.js\?v=295/.test(index));

console.log(failed ? `\nFAIL  ·  ${failed}` : "\nPASS  ·  all checks");
process.exit(failed ? 1 : 0);
