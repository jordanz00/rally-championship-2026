#!/usr/bin/env node
/**
 * Sprint 69 — volumetric cumulus sky (planet-shell raymarch, stage palettes).
 *
 * RUN: node tools/qa-sprint69-clouds.mjs
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

console.log(`SPRINT 69 VOLUMETRIC CLOUDS  ·  ${new Date().toISOString()}\n`);

const sky = read("js/sky.js");
const game = read("js/game.js");
const config = read("js/config.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check(
  "sky module exports volume path",
  /export function createSky/.test(sky) &&
    /export function applySky/.test(sky) &&
    /export function tickSky/.test(sky) &&
    /export const CLOUD_BUDGET/.test(sky)
);
check(
  "technique is planet-shell raymarch (not a painted skybox)",
  /technique:\s*"planet-shell-raymarch"/.test(sky) &&
    /const float PLANET_R/.test(sky) &&
    /CLOUD_INNER/.test(sky) &&
    /CLOUD_OUTER/.test(sky) &&
    /vec2 raySphere\(/.test(sky)
);
check(
  "view raymarch has a bounded step loop",
  /const int MAX_VIEW = 10/.test(sky) &&
    /for \(int i = 0; i < MAX_VIEW; i\+\+\)/.test(sky) &&
    /cinemaViewSteps:\s*10/.test(sky) &&
    /lowViewSteps:\s*5/.test(sky)
);
check(
  "no temporal hash dither on the cloud march",
  !/dither = hash13/.test(sky) && /t = t0 \+ dt \* 0\.5/.test(sky)
);
check(
  "weather field is seamless 3D, not atan azimuth",
  /float fbm\(vec3 p/.test(sky) && !/atan\(view\.z, view\.x\)/.test(sky)
);
check("sky sphere is dense (no faceted dome)", /SphereGeometry\(1,\s*64,\s*40\)/.test(sky));
check(
  "Beer-Lambert + sun self-shadow + HG phase",
  /exp\(-stepOd\)/.test(sky) &&
    /sunOptical\(/.test(sky) &&
    /hgPhase\(/.test(sky) &&
    /powder/.test(sky)
);
check(
  "3D noise + Worley/ridged cumulus (not a JPEG)",
  /float fbm\(vec3 p/.test(sky) &&
    /worleyPuff\(/.test(sky) &&
    /ridged/.test(sky) &&
    /islands/.test(sky) &&
    /cloudDensity\(vec3 p/.test(sky)
);
check(
  "energy-conserving over-sky composite (not mix-by-length)",
  /col = col \* \(1\.0 - clouds\.a\) \+ clouds\.rgb/.test(sky)
);
check(
  "old 4-sample shell-only thickness pass is gone",
  !/for \(int i = 0; i < 4; i\+\+\) \{\s*float t = float\(i\) \* 0\.11/.test(sky)
);
check(
  "stage palettes: desert, forest, mountain, lakeside, title",
  /desert:\s*\{[^}]*lit:/.test(sky) &&
    /forest:\s*\{[^}]*lit:/.test(sky) &&
    /mountain:\s*\{[^}]*lit:/.test(sky) &&
    /lakeside:\s*\{[^}]*lit:/.test(sky) &&
    /title:\s*\{[^}]*lit:/.test(sky) &&
    /STAGE_CLOUD_PALETTES/.test(sky)
);
check(
  "title attract has a visible cumulus floor",
  /title: \{[^}]*cover: 0\.3[0-9]/.test(sky) &&
    /stageId === "title"/.test(sky)
);
check(
  "LIGHTING still owns per-stage cover (fog/sun stay in config)",
  /cloudCover:\s*0\.\d+/.test(config) &&
    (config.match(/cloudCover:/g) || []).length >= 4
);
check(
  "sky still uses stage sun / fog / wind",
  /uSun\.value\.set/.test(sky) &&
    /L\.wind/.test(sky) &&
    /L\.fog/.test(sky) &&
    /fog: false/.test(sky)
);
check(
  "runtime marks the volume path",
  /userData\.volumetricClouds = true/.test(sky) &&
    /userData\.cloudTechnique = CLOUD_BUDGET\.technique/.test(sky)
);
check(
  // Sprint 76 moved the call into _applyQualityTier so one scaler owns every
  // knob; the behaviour (cloud steps follow the tier) is unchanged.
  "perf tier can drop steps (graceful degradation)",
  /export function setSkyQuality/.test(sky) &&
    (/setSkyQuality\(this\.sky, this\.perfTier\.tier\)/.test(game) ||
      /setSkyQuality\(this\.sky, t\.sky\)/.test(game))
);
check(
  "title + race both apply palettes",
  /applySky\(this\.sky, L, "title"\)/.test(game) && /applySky\(this\.sky, L, courseId\)/.test(game)
);
check("game imports sky.js?v=25+", Number((game.match(/sky\.js\?v=(\d+)/) || [])[1]) >= 25);
check(
  "no leftover flat cloud sprite as the only sky",
  /name = "pbr-sky"/.test(sky) &&
    !/new THREE\.Sprite/.test(sky) &&
    !/CloudSprite/.test(sky) &&
    !/skybox\.jpe?g/.test(sky)
);
check("cache-bust chain", cacheOk && Number(gameV) >= 376, `main=${mainV} game=${gameV}`);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "volumetric cumulus sky armed"}`
);
process.exit(fail ? 1 : 0);
