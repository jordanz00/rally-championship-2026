#!/usr/bin/env node
/**
 * qa-sprint70-camera.mjs — POV rearview stays lit, cheap RT, smooth C-key.
 *
 * RUN: node tools/qa-sprint70-camera.mjs
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
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`SPRINT 70 CAMERA / POV MIRROR  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const car = read("js/cars/celica.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check(
  "mirror RT is 256×80 (readable, S50 hitch budget)",
  /mirrorW:\s*256/.test(config) && /mirrorH:\s*80/.test(config)
);
check(
  "RT is created, asserted, and rebuilt on context restore",
  /_ensureMirrorRT\(\)/.test(game) &&
    /_bindMirrorContext\(\)/.test(game) &&
    /webglcontextlost/.test(game) &&
    /webglcontextrestored/.test(game) &&
    /UnsignedByteType/.test(game)
);
check(
  "C never disposes the rearview target",
  /Never dispose this on a C-key/.test(game) &&
    !/_mirrorRT\.dispose\(\)/.test(game.replace(/_ensureMirrorRT[\s\S]*?return this\._mirrorRT;/, ""))
);
check(
  "capture runs after solid pack paint, before ghost restore",
  game.indexOf("_paintBlockingPack(0)") < game.indexOf("this._renderMirror()") &&
    game.indexOf("this._renderMirror()") < game.indexOf("_paintBlockingPack(1)")
);
check(
  "empty glass always captures; last frame may skip one tick",
  /_mirrorHasImage/.test(game) &&
    /_mirrorDefer > 0 && this\._mirrorHasImage/.test(game) &&
    /this\._mirrorHasImage = true/.test(game)
);
check(
  "cheap mirror pass skips shadows, post, dust, and tire marks",
  /shadowMap\.enabled = false/.test(game.slice(game.indexOf("_captureMirror"))) &&
    /dust\.points/.test(game) &&
    /tireMarks\.mesh/.test(game) &&
    /NoToneMapping/.test(game)
);
check(
  "glass map is rebound every POV frame so a switch cannot leave null",
  /setCockpitMirrorMap\(this\.playerMesh, this\._mirrorRT\.texture\)/.test(game) &&
    /_renderMirror\(\) \{[\s\S]{0,400}setCockpitMirrorMap/.test(game)
);
check(
  "POV cabin is seated LHD with a wider in-car FOV",
  /Always LHD/.test(car) &&
    /clamp\(eyeX,\s*-0\.5,\s*-0\.22\)/.test(car) &&
    /fov:\s*76/.test(car) &&
    /binnacleHood/.test(car)
);
check(
  "cabin fill light is allocated at boot (no C-key light compile)",
  /this\._cabinFill = new THREE\.PointLight/.test(game) &&
    /NUM_POINT_LIGHTS never changes on C/.test(game)
);
check(
  "every camera mode eases with smootherstep; POV compiles at load",
  /_startCamBlend\(\)/.test(game) &&
    /blendU \* 6 - 15/.test(game) &&
    /_warmPov\(\)/.test(game) &&
    /this\.renderer\.compile\(this\.scene, this\._mirrorCam\)/.test(game)
);
check(
  "drift chase stays readable (yaw→travel, capped outside)",
  /slideYawBlend:\s*0\.6/.test(config) &&
    /yawStiffnessSlide:\s*1[456]/.test(config) &&
    /slideCamOut:\s*0\.1[0-9]/.test(config) &&
    /slideLookAhead:\s*[3-5]\./.test(config) &&
    /slideKickMax:\s*0\.0[3-5]/.test(config) &&
    /slideYawBlend/.test(game) &&
    /slideLookAhead/.test(game)
);
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 504 && /config\.js\?v=15[6-9]|config\.js\?v=1[6-9]\d/.test(game),
  `main=${mainV} game=${gameV}`
);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "POV mirror + camera blend armed"}`
);
process.exit(fail ? 1 : 0);
