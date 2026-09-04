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
  "rim chrome shaded before glass (opaque)",
  /!isChrome &&[\s\S]*!isRubber &&/.test(src) && /if \(isChrome\) \{[\s\S]*?transparent = false/.test(src),
  "transparent rim materials must not become 0.48 glass"
);
check("wheel hub materials isolated from lamps", /function isolateWheelHubMaterials/.test(src));
check(
  "nests head emitters in Light Front housing",
  /nestHeadEmittersInLamp/.test(src) && /findFrontLightHousing/.test(src)
);
check(
  "findFrontLightHousing accepts underscores",
  /light\[\\s_\.-]\*front/.test(src) || /light\[\\s_\.\-\]\*front/.test(src)
);
check("strips headDummy floating boxes", /headDummy/.test(src) && /scrubDeltaHeadArtifacts/.test(src));
check("picks modeled tail lenses instead of floating pads", /pickBrakeLampMeshes/.test(src) && /isTailLampLensMesh/.test(src));
check("brake glow sits on visible covers (combi / TailLight / Light Rear)", /isVisibleTailCover/.test(src) && /combi_glass_b/.test(src));
check("brake on punches glass opacity so the cover reads", /_brakeRestOpacity/.test(src) && /opacity = on \? 0\.94/.test(src));
check("brake glow uses lens AABB, not mesh pivot", /function lampLocalCenter/.test(src));
check(
  "named front lamp excludes light glass sheets",
  /isFullLengthLightSheetLabel\(label\) return false/.test(src) ||
    /isFullLengthLightSheetLabel\(label\)\) return false/.test(src)
);
check("cache-bust celica.js?v=156+", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 146, "game imports celica");
check("main → game v=453+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 453);
check("index → main v=453+", Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 453);

console.log(failed ? `\nFAIL  ·  ${failed}` : "\nPASS  ·  all checks");
process.exit(failed ? 1 : 0);
