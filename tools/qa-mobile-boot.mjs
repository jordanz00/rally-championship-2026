#!/usr/bin/env node
/**
 * qa-mobile-boot.mjs — Android Chrome / iPhone Safari boot contract.
 *
 * RUN: node tools/qa-mobile-boot.mjs
 *
 * Proves the rotate overlay is gone, phones skip WebTSR/LOOK compile,
 * WebGPU is never required on the phone path, and boot cache-bust is live.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`MOBILE BOOT  ·  ${new Date().toISOString()}\n`);

const index = read("index.html");
const css = read("css/game.css");
const main = read("js/main.js");
const game = read("js/game.js");
const touch = read("js/ui/touch-controls.js");
const policy = read("js/gfx/tsr-policy.js");
const mobile = read("js/gfx/mobile-present.js");
const factory = read("js/gfx/renderer-factory.js");
const caps = read("js/gfx/capabilities.js");
const sdk = read("js/gfx/browser-reconstruct-sdk/index.js");

const nagRe =
  /orient-hint|Turn the phone sideways|landscape-please|please rotate|rotate-device|rotate overlay|turn your phone/i;

check("no rotate overlay in index.html", !nagRe.test(index), "index must not nag to rotate");
check("no #orient-hint in css/game.css", !/#orient-hint/.test(css) && !nagRe.test(css), "CSS overlay styles must be gone");
check(
  "no rotate nag in touch-controls.js",
  !nagRe.test(touch) && !/hintEl/.test(touch),
  "touch overlay must not show a portrait rotate modal"
);
check(
  "no rotate nag in main.js / game.js",
  !nagRe.test(main) && !nagRe.test(game),
  "engine must not lock or modal on orientation"
);
check(
  "no orientation lock",
  !/screen\.orientation\.lock/.test(touch) &&
    !/screen\.orientation\.lock/.test(game) &&
    !/screen\.orientation\.lock/.test(main) &&
    !/screen\.orientation\.lock/.test(index),
  "must not call screen.orientation.lock"
);

check(
  "touch HUD still exists",
  /id="touch-hud"/.test(index) &&
    /id="touch-gas"/.test(index) &&
    /id="touch-steer"/.test(index) &&
    /export class TouchControls/.test(touch),
  "phone pedals / steer must remain"
);

check("policy skips TSR on phones", /isPhonePresentBudget\(\)\) return false/.test(policy), "wantsHeavyWebTsr must refuse phones");
check(
  "policy takes cheap present on phones",
  /isPhonePresentBudget\(\)\) return true/.test(policy),
  "wantsMobilePresent must arm phones"
);
check(
  "mobile present is lazy FXAA",
  /export function createMobilePresent/.test(mobile) &&
    /ensureMaterials/.test(mobile) &&
    /FXAA/.test(mobile) &&
    /created on first race present/.test(mobile),
  "phone shaders must not compile on title first paint"
);
check(
  "game lazy-boots mobile present, not TSR, on phones",
  /_bootMobilePresent\(\)/.test(game) &&
    /wantsHeavyWebTsr\(\)/.test(game) &&
    /wantsMobilePresent\(\)/.test(game) &&
    /Phones never enter this path/.test(game),
  "title must not construct createWebTsr on isPhonePlay"
);
check(
  "shader fail falls back to raw present",
  /WebTSR\/LOOK failed — raw present/.test(game) &&
    /mobile FXAA failed — raw present/.test(game) &&
    /mobile present skipped/.test(game) &&
    /reconstruct SDK skipped/.test(game) &&
    /FXAA failed — raw present/.test(mobile),
  "uncaught shader exception on title is a boot bug"
);

check("mobile-present has no WebGPU import", !/from ["'].*webgpu/i.test(mobile), "phone FXAA must stay on three.module.js");
check("tsr-policy has no WebGPU import", !/from ["'].*webgpu/i.test(policy), "device policy must not pull WebGPU");
check("touch-controls has no WebGPU import", !/from ["'].*webgpu/i.test(touch), "overlay must not pull WebGPU");
check("main.js has no WebGPU import", !/from ["'].*webgpu/i.test(main), "boot entry must not pull WebGPU");
check("SDK has no WebGPU import", !/from ["'].*webgpu/i.test(sdk), "createWebTsr host must not require WebGPU");
check(
  "index remaps WebGPU only on ?webgpu=1|native",
  /webgpu=\(\?:1\|native\)/.test(index) && /if \(!\/\[\?&\]webgpu=/.test(index),
  "default phone boot must stay on three.module.js WebGL"
);
check(
  "phones force WebGL unless ?webgpu=native",
  /phone && !forceNative/.test(caps) && /skipWebGpu = phoneGl && !wantNative/.test(factory),
  "iPhone / Android must not construct WebGPURenderer"
);
check(
  "WebGL retry ladder still armed",
  /createWebGLRendererSafe/.test(factory) && /failIfMajorPerformanceCaveat:\s*false/.test(factory),
  "Android often rejects the first high-performance context"
);

check(
  "Android fill-rate caps tightened",
  /android \? 560000/.test(game) &&
    /android \? 0\.65/.test(game) &&
    /android \? 256/.test(game) &&
    /GFX\.preferLock30 = true/.test(game),
  "mid-range Android must not keep cinema pixel / shadow budgets"
);
check(
  "phones skip full-stage attract on title",
  /Track\.create on title OOMs/.test(game) && /SHOWROOM LIVE/.test(game),
  "Safari / Android must not Track.create during splash"
);
check(
  "phones cap championship pack size",
  /phonePlay\) n = Math\.min\(n, 2\)/.test(game),
  "14 AI cars melt mid-range GPUs"
);
check(
  "phones keep a light practice pack",
  /phonePlay \? 2 : Math\.max\(10/.test(game),
  "practice must not force 10+ rivals on phones"
);

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
const cssV = Number((index.match(/game\.css\?v=(\d+)/) || [])[1] || 0);
const sdkV = Number((game.match(/browser-reconstruct-sdk\/index\.js\?v=(\d+)/) || [])[1] || 0);
const policyV = Number((sdk.match(/tsr-policy\.js\?v=(\d+)/) || [])[1] || 0);
const mobileV = Number((sdk.match(/mobile-present\.js\?v=(\d+)/) || [])[1] || 0);

check("boot cache-bust main.js", mainV >= 1101, `index boots main.js?v=${mainV} (>=1101)`);
check("boot cache-bust game.js", gameV >= 1101 && gameV === mainV, `main imports game.js?v=${gameV} (match main ${mainV})`);
check(
  "iOS desktop-UA still phone",
  /iosTouchMac/.test(touch) && /ontouchend/.test(touch),
  "Request Desktop Website must not run Track.create attract"
);
check(
  "phones defer title GLB",
  /HTML splash first/.test(game) && /_titleCarWarm = isPhonePlay\(\) \? null/.test(game),
  "no rival parse in constructor on phones"
);
check(
  "phone garage skips hero pack fill",
  /garagePhoneLite/.test(read("js/cars/celica.js")) &&
    /!phone && !rivalTemplates/.test(read("js/cars/celica.js")),
  "no 7MB hero fallback on iPhone"
);
check("no rival.glb preload", !/preload[^>]+rival\.glb/.test(index), "preload races module parse");
check("__rallyPhoneLite before modules", /__rallyPhoneLite = true/.test(index));
check(
  "phones cap pack ≤2",
  /phonePlay\) n = Math\.min\(n, 2\)/.test(game) && /phonePlay \? 2 :/.test(game),
  "handset pack must stay tiny"
);
check("no modulepreload", !/rel="modulepreload"/.test(index), "iPhone first paint");
check("no phone title HDR", /No HDR \/ PMREM on iPhone/.test(game));
check(
  "phones skip menu prop-kit warm",
  /Phones: PRESS START already starts WebGL/.test(game),
  "no desert kit parse on SELECT MODE"
);
check(
  "Android fill caps tight",
  /android \? 560000/.test(game) && /android \? 0\.65/.test(game),
  "Adreno fill-rate budget"
);
check("boot cache-bust css", cssV >= 71, `index loads game.css?v=${cssV} (>=71)`);
check("gfx policy cache-bust", policyV >= 982 && mobileV >= 982 && sdkV >= 989, `policy ${policyV} / mobile ${mobileV} / sdk ${sdkV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  mobile boot — no rotate nag, WebGL phone path, cache-bust live");
