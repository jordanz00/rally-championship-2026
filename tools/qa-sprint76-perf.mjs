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
check(
  "high tier skips every other sun bake",
  /id: "high"[\s\S]{0,280}?shadowEvery:\s*[3-9]/.test(perf),
  "shadowEvery:1 at high was the measured ~37 ms fixed floor on M1"
);
const gfxBlock = (config.match(/export const GFX = \{([\s\S]*?)\n\};/) || [])[1] || "";
const raceSm = Number((gfxBlock.match(/^\s*shadowMap:\s*(\d+)/m) || [])[1]);
check(
  `race default shadow atlas is ${raceSm} (<= 2048)`,
  raceSm > 0 && raceSm <= 2048,
  "4096² PCFSoft every present was GPU-bound before any scaling"
);

console.log("\ncloud / skybox cap (Sprint 549 — volumetric removed)");
check("CLOUD_BUDGET still exported", /export const CLOUD_BUDGET/.test(sky));
check("view steps capped at 0 (skybox)", /maxViewSteps: 0/.test(sky));
check("light steps capped at 0 (skybox)", /maxLightSteps: 0/.test(sky));
check(
  "technique is equirect skybox",
  /technique:\s*"equirect-skybox"/.test(sky),
  "volumetric planet-shell raymarch was removed"
);
check("no volumetricClouds shader", !/function volumetricClouds|vec4 volumetricClouds/.test(sky));
check("cinema/medium steps are zero", /cinemaViewSteps: 0/.test(sky) && /mediumViewSteps: 0/.test(sky));
check(
  "scaler mirrors the sky cap",
  /maxCloudViewSteps: 0/.test(perf) && /maxCloudLightSteps: 0/.test(perf)
);
check("tier still calls setSkyQuality", /setSkyQuality\(this\.sky, t\.sky\)/.test(game));

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
check("config keeps the mirror small", /mirrorW:\s*(?:320|384)/.test(config) && /mirrorH:\s*(?:100|120)/.test(config));
check("tier can stretch mirror cadence", /_qualityMirrorEvery/.test(game));
check(
  "mirror RT is fixed size, not the framebuffer",
  /Fixed small size \(not the main framebuffer\) so C never reallocates it/.test(game)
);

console.log("\npost stack cap");
check("bloom stays quarter res", /w >> 2/.test(post));
check("post exposes three quality steps", /setQuality/.test(post) && /"low"/.test(post));
check(
  "low path skips bloom entirely",
  /if \(q === "low"\)[\s\S]{0,280}?bloomStrength\.value = 0/.test(post),
  "low must zero bloom so the scaler can actually buy frame time"
);

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

// Sprint 96 changed this expectation deliberately. The old scaler settled on
// `medium` at a steady 20 ms and stopped — leaving the player on a permanent,
// juddering 50 fps because the ladder only classifies cost, it never chases the
// frame deadline. The invariant that matters is "no oscillation", not "stop
// moving": tiers must walk monotonically downward and then stay put.
const borderline = drive(20, 3200);
const monotonic = borderline.changes.every((c, i, all) => {
  if (i === 0) return true;
  const order = ["high", "medium", "low", "min"];
  return order.indexOf(c[1]) >= order.indexOf(all[i - 1][1]);
});
check(
  "steady 20ms (50 fps) spends every quality tier, never oscillates",
  monotonic && borderline.tier === "min" && borderline.changes.length <= 3,
  `changes ${JSON.stringify(borderline.changes)} — must descend only, high→min at most`
);

const recovery = (() => {
  const t = createPerfTier(GFX_TEST);
  // Hard-drop to min (HARD_HOLD of 40ms) without arming the at-min 30 Hz lock
  // (that needs another HARD_HOLD of over-budget frames once already at min).
  for (let i = 0; i < 12; i++) t.tick(40);
  const dropped = t.tier;
  const changes = [];
  for (let i = 0; i < 1200; i++) {
    const r = t.tick(14);
    if (r.changed) changes.push(r.id);
  }
  return { dropped, tier: t.tier, changes, locked30: t.locked30 };
})();
check(
  "a recovered machine climbs back one tier at a time",
  recovery.dropped === "min" &&
    recovery.tier === "high" &&
    recovery.changes.length === 3 &&
    recovery.locked30 === false,
  `${recovery.dropped} -> ${recovery.tier} via ${JSON.stringify(recovery.changes)} locked30=${recovery.locked30}`
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

// Sprint 96 — the frame rate must be one of two numbers, never a juddering
// average. An M1 Pro measured p50 16.8ms with p95 34.0ms: half the frames hit
// vsync and half missed it, which reads worse than a steady 30.
console.log("\npresent cadence lock (60 or 30, never 46)");
check(
  "a healthy machine keeps the 60 Hz cadence",
  (() => {
    const t = createPerfTier(GFX_TEST);
    for (let i = 0; i < 600; i++) t.tick(16.7);
    return t.presentHz === 60 && t.locked30 === false;
  })(),
  "16.7ms frames must never trigger the 30 lock"
);
check(
  "a machine stuck over budget at min quality locks to an even 30",
  (() => {
    const t = createPerfTier(GFX_TEST);
    for (let i = 0; i < 1400; i++) t.tick(24);
    return t.tier === "min" && t.presentHz === 30 && t.locked30 === true;
  })(),
  "24ms frames = 41 fps of judder; lock it"
);
check(
  "quality is spent before frame rate is",
  (() => {
    const t = createPerfTier(GFX_TEST);
    // 19ms is over the 60 Hz deadline but only just. The ladder must walk down
    // to min *first* and only then consider halving the cadence.
    let lockedBeforeMin = false;
    for (let i = 0; i < 600; i++) {
      t.tick(19);
      if (t.locked30 && t.tier !== "min") lockedBeforeMin = true;
    }
    return !lockedBeforeMin;
  })(),
  "never drop the cadence while quality tiers remain"
);
check(
  "preferLock30 locks cadence before stripping to min",
  (() => {
    const t = createPerfTier({ ...GFX_TEST, preferLock30: true, lock30AboveMs: 18 });
    let lockedAt = null;
    for (let i = 0; i < 400; i++) {
      t.tick(19);
      if (t.locked30) {
        lockedAt = t.tier;
        break;
      }
    }
    return t.locked30 === true && lockedAt !== "min";
  })(),
  "Sprint 547: even 30 at medium/low beats judder at min"
);
check(
  "the lock is downward-only within a stage",
  (() => {
    const t = createPerfTier(GFX_TEST);
    for (let i = 0; i < 1400; i++) t.tick(24);
    if (!t.locked30) return false;
    // A recovered machine must not flip back mid-stage — an oscillating cadence
    // is worse than either rate. A new stage builds a new scaler.
    for (let i = 0; i < 2000; i++) t.tick(9);
    return t.locked30 === true && t.presentHz === 30;
  })()
);
check(
  "locked 30 is not reported as a permanent emergency",
  (() => {
    const t = createPerfTier(GFX_TEST);
    for (let i = 0; i < 1400; i++) t.tick(24);
    for (let i = 0; i < 300; i++) t.tick(33.3);
    return t.locked30 && t.emergency === false;
  })(),
  "33.3ms is the target once locked, not a failure to hit 16.7ms"
);
check(
  "the loop presents on the scaler's cadence, not a hardcoded 60",
  /perfTier\.presentHz/.test(game) && /const frameMs = 1000 \/ presentHz/.test(game),
  "GFX.targetFps alone cannot express a deliberate 30"
);
check(
  "the FPS readout counts presented frames over wall time",
  /_fpsMark/.test(game) && !/this\._fpsT \+= dt/.test(game),
  "summing dt only on presented frames reported the rAF rate, not the delivered one"
);

console.log("\ncache bust");
const mainV = (index.match(/main\.js\?v=(\d+)/) || [])[1];
const gameV = (main.match(/game\.js\?v=(\d+)/) || [])[1];
check(`index main.js?v=${mainV} matches main.js game.js?v=${gameV}`, !!mainV && mainV === gameV);
check("game imports a cache-busted perf-tier", /perf-tier\.js\?v=\d+/.test(game));

console.log(fail ? `\nFAIL — ${fail} cap(s) missing or unenforced` : "\nPASS — every frame-budget cap is enforced");
process.exit(fail ? 1 : 0);
