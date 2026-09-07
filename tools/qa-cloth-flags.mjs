#!/usr/bin/env node
/**
 * Headless proof that start/finish cloth is a Verlet sim, not a Kenney mesh.
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
check("Kenney gate flags removed", !/flagKind/.test(trackSrc) && !/propGeometry\("flag_checkers"\)/.test(trackSrc));
check("update ticks cloth", /_tickClothFlags/.test(trackSrc));
check("Verlet springs present", /satisfy\(|STRUCT_ITERS|MAX_STRETCH/.test(clothSrc));
check("uses LIGHTING.wind", /LIGHTING\[scenery\]/.test(clothSrc) || /L\.wind/.test(clothSrc));
check("not a UV wiggle shader", !/sin\s*\(\s*uv/.test(clothSrc));

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

if (!process.exitCode) console.log("PASS  cloth flag sim");
