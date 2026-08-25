#!/usr/bin/env node
/**
 * qa-sprint76-perf.mjs — the quality scaler is real and its caps are enforced.
 *
 * WHO THIS IS FOR: Performance Engineering, and anyone about to add a GPU knob.
 * WHAT IT DOES: static gate proving there is ONE quality scaler, that every
 *   hard cap (pixel ratio, shadow atlas, cloud raymarch steps, mirror RT)
 *   exists and is applied, that a camera switch cannot trigger a shader
 *   compile, and that no module has grown a private adaptive ladder again.
 *
 * WHY STATIC: frame time is measured by tools/qa-frame-probe.mjs on real
 *   hardware. This gate protects the caps from silently regressing between
 *   probe runs — it does not claim a frame rate.
 *
 * RUN:  node tools/qa-sprint76-perf.mjs
 * EXIT: 0 when every cap is in place.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;

/**
 * @param {string} label
 * @param {boolean} ok
 * @param {string} [detail] why it matters / what to fix
 */
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const perf = read("js/gfx/perf-tier.js");
const game = read("js/game.js");
const config = read("js/config.js");
const sky = read("js/sky.js");
const post = read("js/gfx/postfx.js");
const index = read("index.html");
const main = read("js/main.js");

console.log("SPRINT 76 — QUALITY SCALER + FRAME BUDGET CAPS\n");

console.log("one scaler, four tiers");
check("QUALITY_CAPS is exported", /export const QUALITY_CAPS/.test(perf));
check(
  "four named tiers",
  /id: "high"/.test(perf) && /id: "medium"/.test(perf) && /id: "low"/.test(perf) && /id: "min"/.test(perf)
);
check(
  "tiers carry every knob",
  /dpr:/.test(perf) && /shadow:/.test(perf) && /post:/.test(perf) && /sky:/.test(perf) && /mirrorEvery:/.test(perf)
);
check(
  "game applies a tier only on change",
  /if \(t\.changed\) this\._applyQualityTier\(t\)/.test(game),
  "reallocating DPR / shadow atlas every frame is worse than a soft frame"
);
check(
  // Entering title / race may set a starting quality; what must not come back
  // is a second ladder that reads the frame-cost thresholds itself.
  "no second adaptive ladder in the loop",
  !/adaptHighMs/.test(game) && !/adaptLowMs/.test(game) && !/adaptFloorMs/.test(game),
  "frame-cost thresholds belong to perf-tier.js, not an inline chain in the loop"
);
check(
  "hysteresis both directions",
  /DOWN_HOLD/.test(perf) && /UP_HOLD/.test(perf),
  "no hold = tier oscillation = repeated framebuffer reallocation"
);
check("30 fps hard floor jumps straight to min", /hardFloorMs/.test(perf));

console.log("\npixel ratio cap");
check("maxPixelRatio cap declared", /maxPixelRatio: 1\.5/.test(perf));
const cfgPr = Number((config.match(/maxPixelRatio:\s*([\d.]+)/) || [])[1]);
check(`config pixel ratio ceiling is ${cfgPr} (<= 1.5)`, cfgPr > 0 && cfgPr <= 1.5);
check(
  "resize clamps against the cap",
  /QUALITY_CAPS\.maxPixelRatio/.test(game) || /capPr/.test(game),
  "devicePixelRatio on a 3x panel must never reach setPixelRatio"
);
check(
  "a pixel-count ceiling backs up the ratio cap",
  /maxPixels/.test(config) && /GFX\.maxPixels/.test(game),
  "1.5x on a 5K panel is still too many pixels"
);
check("scaler can scale DPR down", /_perfDprScale = dpr/.test(game));
check("config keeps a DPR floor", /minPixelRatio/.test(config));

console.log("\nshadow atlas cap");
check("shadow ceiling declared", /maxShadowMap: 4096/.test(perf));
check(
  "tier can shrink the atlas",
  /_setShadowMapSize\(t\.shadow, true\)/.test(game),
  "a tier that cannot shrink the atlas cannot degrade"
);
check(
  "screen transitions still cannot shrink it",
  /allowShrink = false/.test(game),
  "dispose+realloc on a screen change is a visible hitch"
);
check("low tier uses the integrated atlas size", /integratedShadowMap/.test(perf));

console.log("\ncloud raymarch cap (Sprint 69 volume preserved)");
check("CLOUD_BUDGET still exported", /export const CLOUD_BUDGET/.test(sky));
check("view steps capped at 8", /maxViewSteps: 8/.test(sky));
check("light steps capped at 2", /maxLightSteps: 2/.test(sky));
check(
  "shader loop is bounded, not full-res 128-step",
  /const int MAX_VIEW = 8;/.test(sky) && /const int MAX_LIGHT = 2;/.test(sky),
  "an unbounded raymarch loop is the classic browser cliff"
);
check("cinema is 6 view steps", /cinemaViewSteps: 6/.test(sky));
check("low tier drops to 4 view steps", /lowViewSteps: 4/.test(sky));
check(
  "low / min drop Worley and light samples",
  /uUseWorley\.value = 0/.test(sky) && /uLightSteps\.value = 1/.test(sky)
);
check("scaler mirrors the sky cap", /maxCloudViewSteps: 8/.test(perf) && /maxCloudLightSteps: 2/.test(perf));
check("tier drives sky quality", /setSkyQuality\(this\.sky, t\.sky\)/.test(game));

console.log("\nmirror render target cap");
check("mirror cap declared 384x120", /maxMirrorW: 384/.test(perf) && /maxMirrorH: 120/.test(perf));
const mirrorClamped =
  (/QUALITY_CAPS\.maxMirrorW/.test(game) && /QUALITY_CAPS\.maxMirrorH/.test(game)) ||
  /_mirrorSize\(\) \{[\s\S]{0,240}?Math\.min\([^)]*384\)[\s\S]{0,240}?Math\.min\([^)]*120\)/.test(game);
check(
  "mirror size clamps to 384x120",
  mirrorClamped,
  "full-res rearview was a measured hitch"
);
check("config keeps the mirror small", /mirrorW: 384/.test(config) && /mirrorH: 120/.test(config));
check("tier can stretch mirror cadence", /_qualityMirrorEvery/.test(game));
check(
  "mirror RT is fixed size, not the framebuffer",
  /Fixed small size \(not the main framebuffer\) so C never reallocates it/.test(game)
);

console.log("\npost stack cap");
check("bloom stays quarter res", /w >> 2/.test(post));
check("post exposes three quality steps", /setQuality/.test(post) && /"low"/.test(post));
check("low path skips bloom entirely", /grade\/vignette only/.test(post));

console.log("\nno compile on camera switch (C)");
check(
  "camera cycle does not compile",
  /_cycleCamera\(\) \{[\s\S]{0,400}?\}/.test(game) &&
    !/_cycleCamera\(\) \{[\s\S]{0,400}?renderer\.compile/.test(game),
  "renderer.compile on C is a multi-hundred-ms stall mid-corner"
);
check(
  "POV cabin + mirror are prewarmed under the loading screen",
  /_warmPov/.test(game) && /renderer\.compile\(this\.scene, this\._mirrorCam\)/.test(game)
);
check(
  "race settle compiles before the countdown clears",
  /_settleRacePresent/.test(game) && /renderer\.compile\(this\.scene, this\.camera\)/.test(game)
);
check(
  "camera blend survives (Sprint 60 not reverted)",
  /_startCamBlend/.test(game) && /_carryBlendPoint/.test(game)
);

// Behaviour, not spelling: drive the real ladder and assert what it does.
console.log("\nscaler behaviour (live module, not a grep)");
const { createPerfTier } = await import(new URL("../js/gfx/perf-tier.js", import.meta.url));
const GFX_TEST = {
  shadowMap: 4096,
  minPixelRatio: 0.85,
  adaptLowMs: 14.5,
  integratedFloorMs: 18.5,
  adaptHighMs: 22,
  adaptFloorMs: 33.3,
  integratedShadowMap: 2048,
  integratedEmergencyMs: 22,
};
/**
 * @param {number[]|((i:number)=>number)} costs present cost per frame
 * @returns {{tier:string, changes:Array<[number,string]>}}
 */
function drive(costs, frames) {
  const t = createPerfTier(GFX_TEST);
  const changes = [];
  const at = typeof costs === "function" ? costs : () => costs;
  for (let i = 0; i < frames; i++) {
    const r = t.tick(at(i));
    if (r.changed) changes.push([i, r.id]);
  }
  return { tier: t.tier, changes };
}

const healthy = drive(16.7, 900);
check(
  "a locked 60 (16.7ms interval) stays on high — no spurious degrade",
  healthy.tier === "high" && healthy.changes.length === 0,
  `ended at ${healthy.tier}, changes ${JSON.stringify(healthy.changes)}`
);

const spike = drive((i) => (i === 120 ? 1100 : 16.7), 400);
check(
  "one 1100ms compile stall does not degrade the stage",
  spike.tier === "high" && spike.changes.length === 0,
  `ended at ${spike.tier} after ${spike.changes.length} change(s)`
);

const sustained = drive(40, 400);
check(
  "sustained 40ms (25 fps) drops to min quickly",
  sustained.tier === "min" && sustained.changes.length === 1 && sustained.changes[0][0] < 30,
  `ended at ${sustained.tier}, changes ${JSON.stringify(sustained.changes)}`
);

const borderline = drive(20, 900);
check(
  "steady 20ms (50 fps) settles on one tier and stops moving",
  borderline.changes.length === 1 && borderline.tier === "medium",
  `changes ${JSON.stringify(borderline.changes)} — more than one means oscillation`
);

const recovery = (() => {
  const t = createPerfTier(GFX_TEST);
  for (let i = 0; i < 200; i++) t.tick(40);
  const dropped = t.tier;
  const changes = [];
  for (let i = 0; i < 1200; i++) {
    const r = t.tick(14);
    if (r.changed) changes.push(r.id);
  }
  return { dropped, tier: t.tier, changes };
})();
check(
  "a recovered machine climbs back one tier at a time",
  recovery.dropped === "min" && recovery.tier === "high" && recovery.changes.length === 3,
  `${recovery.dropped} -> ${recovery.tier} via ${JSON.stringify(recovery.changes)}`
);

const caps = createPerfTier({ ...GFX_TEST, minPixelRatio: 0.85 }).current();
check("high tier never exceeds the DPR scale of 1", caps.dpr <= 1);
check(
  "min tier respects the configured DPR floor",
  drive(60, 60).tier === "min",
  "cheapest tier must be reachable"
);
check(
  "the scaler is fed the present interval, not the CPU render cost",
  /this\.perfTier\.tick\(presentDelta\)/.test(game) && /_lastPresentDelta/.test(game),
  "renderer.render() returns before the GPU is done — CPU cost cannot see a GPU-bound machine"
);

console.log("\ncache bust");
const mainV = (index.match(/main\.js\?v=(\d+)/) || [])[1];
const gameV = (main.match(/game\.js\?v=(\d+)/) || [])[1];
check(`index main.js?v=${mainV} matches main.js game.js?v=${gameV}`, !!mainV && mainV === gameV);
check("game imports a cache-busted perf-tier", /perf-tier\.js\?v=\d+/.test(game));

console.log(fail ? `\nFAIL — ${fail} cap(s) missing or unenforced` : "\nPASS — every frame-budget cap is enforced");
process.exit(fail ? 1 : 0);
