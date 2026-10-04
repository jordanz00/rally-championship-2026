#!/usr/bin/env node
/**
 * qa-webtsr-sdk.mjs — static contract for the WebTSR suite.
 *
 * WHO THIS IS FOR: the WebTSR plan close-out. Proves createWebTsr +
 *   presentScene + appearance flag + G-buffer abort + luma clamp +
 *   no stacked RCAS + LOOK default on (desktop) + mobile cheap present +
 *   no “DLSS 5” live label + no WebGPU-required phone path.
 * WHAT IT DOES: reads the SDK / upscaler / appearance / game / lab
 *   sources and fails on any missing contract line. No WebGL.
 * HOW IT CONNECTS: run after bumping ?v= on the reconstruct graph.
 *
 * RUN:  node tools/qa-webtsr-sdk.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const files = {
  sdk: "js/gfx/browser-reconstruct-sdk/index.js",
  tsr: "js/gfx/tsr-upscaler.js",
  appear: "js/gfx/appearance-net.js",
  mobile: "js/gfx/mobile-present.js",
  policy: "js/gfx/tsr-policy.js",
  game: "js/game.js",
  html: "index.html",
  main: "js/main.js",
  lab: "tools/webtsr-lab.html",
  docs: "docs/WEBTSR.md",
};

let failed = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function must(cond, msg) {
  if (cond) {
    console.log(`  PASS  ${msg}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL  ${msg}`);
}

function main() {
  console.log("WebTSR suite contract");
  const src = {};
  for (const [key, rel] of Object.entries(files)) {
    src[key] = read(rel);
  }

  must(src.sdk.includes("export function createWebTsr"), "createWebTsr factory");
  must(src.sdk.includes("export function createBrowserReconstruct"), "createBrowserReconstruct alias");
  must(src.sdk.includes("get presentScene()"), "presentScene getter");
  must(src.sdk.includes("appearance: true"), "WEBTSR_SUITE.appearance");
  must(src.sdk.includes("frameGeneration: false"), "no frame generation");
  must(src.sdk.includes("webgpuRequired: false"), "WebGPU not required");
  must(src.sdk.includes("mobilePresent: true"), "WEBTSR_SUITE.mobilePresent");
  must(src.sdk.includes("applyGuided(camera)"), "applyGuided after TSR");
  must(src.sdk.includes("applyAppearance(camera)"), "applyAppearance after guided");
  must(src.sdk.includes("skipPresentSharp"), "no stacked RCAS when residual/LOOK on");
  must(src.sdk.includes("tsr.writeNormals = !!(appear && appear.enabled)"), "normals gated on LOOK");
  must(src.sdk.includes("writeNormals: opts.writeNormals === true"), "normals default off at construct");
  must(src.sdk.includes("createMobilePresent"), "SDK re-exports mobile present");
  must(src.sdk.includes("wantsHeavyWebTsr"), "SDK re-exports device policy");
  must(!/from ["'].*webgpu/i.test(src.sdk), "SDK has no WebGPU import");
  must(!/from ["'].*webgpu/i.test(src.mobile), "mobile present has no WebGPU import");
  must(!/from ["'].*webgpu/i.test(src.policy), "policy has no WebGPU import");

  must(src.tsr.includes("NORMAL_BUDGET_MS = 1.5"), "normal budget 1.5 ms");
  must(src.tsr.includes("export const NORMAL_BUDGET_MS"), "normal budget exported");
  must(src.tsr.includes("this.writeNormals = opts.writeNormals === true"), "upscaler normals opt-in");
  must(src.tsr.includes("this._normalsAborted = true"), "abort normals over budget");
  must(src.tsr.includes("this._normalMsN >= 2 && ms > NORMAL_BUDGET_MS"), "abort from frame 2");
  must(src.tsr.includes("setSize(w, h)"), "TsrUpscaler.setSize");
  must(src.tsr.includes("wall = step"), "tunnel-mouth depth wall reject");
  must(src.tsr.includes("Specular lock"), "specular swim reject");
  must(src.tsr.includes("export const TSR_CAR_HISTORY_KILL = true"), "car history kill exported");
  must(src.tsr.includes("Car silhouette: drop history (colour-only)"), "car silhouette colour-only");
  must(src.tsr.includes("Do not dilate the vector"), "velocity vector not dilated onto road");
  must(src.tsr.includes("Final car kill"), "final car kill before blend");
  must(src.tsr.includes("TSR_DEFAULT_MODE = \"quality\""), "desktop IMAGE default is Quality");
  must(src.sdk.includes("TSR_CAR_HISTORY_KILL"), "SDK re-exports car history kill");

  must(src.appear.includes("APPEAR_DEFAULT = true"), "APPEAR_DEFAULT true on desktop");
  must(src.appear.includes("APPEAR_LUMA_HEADROOM"), "luma headroom constant");
  must(src.appear.includes("float cap = srcL * uHeadroom"), "luma clamp in shader");
  must(src.appear.includes("Never stacked with TSR present RCAS"), "no stacked RCAS note");
  must(src.appear.includes("hand-authored") || src.appear.includes("authored GLSL"), "hand kernels, not a train");
  must(src.appear.includes("let enabled = supported && APPEAR_DEFAULT"), "createAppearance starts at default");
  must(src.appear.includes("COMPOSE_FRAG") || src.appear.includes("Full-res compose"), "residual compose, not blit-replace");
  must(src.appear.includes("uPassthrough"), "LOOK first-frame passthrough");

  must(src.mobile.includes("export function createMobilePresent"), "createMobilePresent factory");
  must(src.mobile.includes("FXAA"), "phone present is FXAA");
  must(src.mobile.includes("ensureMaterials"), "phone shaders lazy");
  must(src.policy.includes("export function wantsHeavyWebTsr"), "wantsHeavyWebTsr");
  must(src.policy.includes("export function wantsMobilePresent"), "wantsMobilePresent");
  must(src.policy.includes("isPhonePlay"), "policy reuses isPhonePlay");
  must(src.policy.includes("perf === \"low\""), "policy honours ?perf=low");

  must(src.game.includes("createWebTsr(this.renderer, {"), "game uses createWebTsr");
  must(src.game.includes("appearance: true"), "appearance handle created");
  must(src.game.includes("parseAppearParams()"), "?appear= flag");
  must(src.game.includes("this.appear.enabled = appearOpts.enabled === true"), "LOOK follows parseAppearParams");
  must(src.game.includes("Skipping the pad was why"), "title and race both present through TSR");
  must(src.game.includes("_syncTsrBadge"), "live TSR badge");
  must(src.html.includes('id="tsr-badge"'), "HUD TSR badge");
  must(src.game.includes("inner.writeNormals = !!(this.appear && this.appear.enabled)"), "boot normals follow LOOK");
  must(src.game.includes("skipPresentSharp"), "game skips present RCAS with LOOK");
  must(src.game.includes("_bootWebTsr()"), "desktop TSR lazy boot");
  must(src.game.includes("_bootMobilePresent()"), "phone present lazy boot");
  must(src.game.includes("wantsHeavyWebTsr()"), "game uses device policy");
  must(src.game.includes("this.tsr.render(this.scene, this.camera"), "race presents through TSR");
  must(src.game.includes("presentScene"), "race uses presentScene");

  must(src.html.includes('id="opt-appear"'), "Pause LOOK checkbox");
  must(/id="opt-appear-val">ON/.test(src.html), "Pause LOOK label starts ON");
  must(!/DLSS\s*5/i.test(src.html), "live UI never says DLSS 5");
  must(!/DLSS\s*5/i.test(src.lab), "lab never says DLSS 5");
  must(!/DLSS\s*5/i.test(src.game), "game never says DLSS 5");

  const mainV = Number((src.html.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
  const gameV = Number((src.main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
  const sdkV = Number((src.game.match(/browser-reconstruct-sdk\/index\.js\?v=(\d+)/) || [])[1] || 0);
  const tsrV = Number((src.sdk.match(/tsr-upscaler\.js\?v=(\d+)/) || [])[1] || 0);
  must(mainV >= 1011, `index boots main.js?v=${mainV} (>=1011)`);
  must(gameV >= 1011, `main imports game.js?v=${gameV} (>=1011)`);
  must(sdkV >= 1011, `game imports SDK ?v=${sdkV} (>=1011)`);
  must(tsrV >= 988, `SDK imports tsr-upscaler.js?v=${tsrV} (>=988)`);

  must(src.lab.includes("createWebTsr"), "lab uses createWebTsr");
  must(!/id="appear"[^>]*checked/.test(src.lab), "lab LOOK checkbox unchecked");
  must(src.lab.includes("recon.appear.enabled = false"), "lab forces appear off at boot");
  must(/browser-reconstruct-sdk\/index\.js\?v=988/.test(src.lab), "lab cache-bust 988");

  must(src.docs.includes("APPEAR_DEFAULT"), "WEBTSR.md records APPEAR_DEFAULT");
  must(src.docs.includes("LOOK on") || src.docs.includes("LOOK ON") || src.docs.includes("LOOK is on"), "WEBTSR.md records desktop LOOK on");
  must(src.docs.includes("Not cloned"), "WEBTSR.md records no frame generation");
  must(src.docs.includes("mobile") || src.docs.includes("phone") || src.docs.includes("iPhone"), "WEBTSR.md records phone path");
  must(src.docs.includes("createMobilePresent") || src.docs.includes("FXAA"), "WEBTSR.md records cheap phone present");
  must(!/Implemented NVIDIA DLSS 5/.test(src.docs.replace(/Do not write:[\s\S]*?That claim is false\./, "")), "WEBTSR.md never claims we implemented DLSS 5");

  if (failed) {
    console.error(`\nFAIL  ${failed} contract check(s)`);
    process.exit(1);
  }
  console.log("\nPASS  WebTSR suite contract");
}

main();
