#!/usr/bin/env node
/**
 * Headless proof that start/finish cloth is a Verlet sim, not a Kenney mesh.
 * Finish plants a 10-flag checkered row with independent phase/seed dynamics.
 * Mocks a canvas so flag-cloth.js can build textures in Node.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function check(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    process.exitCode = 1;
  }
}

const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const clothSrc = fs.readFileSync(path.join(ROOT, "js/tracks/flag-cloth.js"), "utf8");
check("track imports flag-cloth", /flag-cloth\.js\?v=\d+/.test(trackSrc));
check("gates plant cloth flags", /_plantClothFlags\(start, "START"\)/.test(trackSrc));
check("finish plants cloth flags", /_plantClothFlags\(finish, "FINISH"\)/.test(trackSrc));
check("finish plants checker row of 10", /_plantFinishCheckerRow/.test(trackSrc));
check("finish drops overhead banner blob", /label !== "FINISH"/.test(trackSrc) && /stage-banner/.test(trackSrc));
check("Kenney gate flags removed", !/flagKind/.test(trackSrc) && !/propGeometry\("flag_checkers"\)/.test(trackSrc));
check("update ticks cloth", /_tickClothFlags/.test(trackSrc));
check("Verlet springs present", /satisfy\(|STRUCT_ITERS|MAX_STRETCH/.test(clothSrc));
check("uses LIGHTING.wind", /LIGHTING\[scenery\]/.test(clothSrc) || /L\.wind/.test(clothSrc));
check("not a UV wiggle shader", !/sin\s*\(\s*uv/.test(clothSrc));
check("per-flag phase/seed independence", /phase/.test(clothSrc) && /gustPhase/.test(clothSrc) && /turbPhase/.test(clothSrc) && /opts\.seed/.test(clothSrc));

class FakeCanvas {
  constructor() {
    this.width = 4;
    this.height = 4;
  }
  getContext() {
    const data = { data: new Uint8ClampedArray(this.width * this.height * 4) };
    return {
      fillStyle: "#000",
      createLinearGradient() {
        return { addColorStop() {} };
      },
      fillRect() {},
      getImageData() {
        return data;
      },
      putImageData() {},
    };
  }
}

globalThis.document = {
  createElement(tag) {
    if (tag === "canvas") return new FakeCanvas();
    return { style: {} };
  },
};
globalThis.window = globalThis;
globalThis.performance = { now: () => 16 };
globalThis.HTMLCanvasElement = FakeCanvas;

const { createClothFlag, updateClothFlags, stageWind } = await import(
  "../js/tracks/flag-cloth.js"
);

const desert = stageWind("desert", 1.2);
const forest = stageWind("forest", 1.2);
check("desert wind stronger than forest", Math.hypot(desert.x, desert.z) > Math.hypot(forest.x, forest.z));

const a = stageWind("desert", 1.2, { phase: 0, gustPhase: 0 });
const b = stageWind("desert", 1.2, { phase: 2.4, gustPhase: 5.1 });
check(
  "gust phase desyncs stage wind",
  Math.hypot(a.x - b.x, a.z - b.z) > 1e-4
);

const flag = createClothFlag({
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  side: 1,
  kind: "red",
  scenery: "desert",
  nx: 1,
  nz: 0,
  seed: 1,
});
const before = Float32Array.from(flag.cur);
updateClothFlags([flag], 1 / 30, 0.8, "desert", null);
let moved = 0;
let max = 0;
for (let i = 0; i < flag.cur.length; i += 3) {
  const col = (i / 3) % 8;
  if (col === 0) continue;
  const dx = flag.cur[i] - before[i];
  const dy = flag.cur[i + 1] - before[i + 1];
  const dz = flag.cur[i + 2] - before[i + 2];
  const d = Math.hypot(dx, dy, dz);
  if (d > 1e-4) moved++;
  if (d > max) max = d;
}
check("free cloth verts moved", moved >= 20);
check("motion is finite fabric-scale", max > 0.002 && max < 1.8);
check("pinned hoist column stays", Math.abs(flag.cur[0] - before[0]) < 1e-6);

const f0 = createClothFlag({
  x: 10,
  y: 0,
  z: 0,
  heading: 0,
  side: 1,
  kind: "checkers",
  scenery: "desert",
  nx: 1,
  nz: 0,
  seed: 0,
});
const f1 = createClothFlag({
  x: 10.2,
  y: 0,
  z: 0,
  heading: 0,
  side: 1,
  kind: "checkers",
  scenery: "desert",
  nx: 1,
  nz: 0,
  seed: 1,
});
check("neighbour seeds differ", f0.seed !== f1.seed && f0.phase !== f1.phase);
const snap0 = Float32Array.from(f0.cur);
const snap1 = Float32Array.from(f1.cur);
updateClothFlags([f0, f1], 1 / 30, 1.4, "desert", null);
let diverge = 0;
for (let i = 3; i < f0.cur.length; i += 3) {
  const col = (i / 3) % 8;
  if (col === 0) continue;
  const d0 = Math.hypot(f0.cur[i] - snap0[i], f0.cur[i + 1] - snap0[i + 1], f0.cur[i + 2] - snap0[i + 2]);
  const d1 = Math.hypot(f1.cur[i] - snap1[i], f1.cur[i + 1] - snap1[i + 1], f1.cur[i + 2] - snap1[i + 2]);
  diverge += Math.abs(d0 - d1);
}
check("independent cloth motion (not synced)", diverge > 0.01);

const alongMatch = trackSrc.match(/alongSlots\s*=\s*\[([^\]]+)\]/);
const slots = alongMatch ? alongMatch[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
check("finish row has five along slots × two sides (=10)", slots.length === 5);

if (!process.exitCode) console.log("PASS  cloth flag sim");
