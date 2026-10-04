#!/usr/bin/env node
/**
 * Proof that every cup stage plants a real start AND finish gantry:
 * planted poles, multi-vert Verlet cloth (not a 1-poly card), lit material.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function check(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const clothSrc = fs.readFileSync(path.join(ROOT, "js/tracks/flag-cloth.js"), "utf8");
const seatSrc = fs.readFileSync(path.join(ROOT, "js/tracks/seat-scenery.js"), "utf8");
const coursesSrc = fs.readFileSync(path.join(ROOT, "js/tracks/courses.js"), "utf8");

check("track imports createGantryBanner", /createGantryBanner/.test(trackSrc) && /flag-cloth\.js\?v=\d+/.test(trackSrc));
check("gates plant start gantry", /_addGantry\(start, "START"\)/.test(trackSrc));
check("gates plant finish gantry", /_addGantry\(finish, "FINISH"\)/.test(trackSrc));
check("both cup ends use createGantryBanner", (trackSrc.match(/createGantryBanner\(/g) || []).length >= 1);
check("no paper-thin stage-banner PlaneGeometry", !/new THREE\.PlaneGeometry\(span, bannerH\)/.test(trackSrc));
check("Kenney stretched gantry path removed", !/gantry_overhead_lights/.test(trackSrc) && !/gantrySteelMaterial/.test(trackSrc));
check("cloth builds taut gantry banners", /export function createGantryBanner/.test(clothSrc));
check("banner grid is not 1 poly", /BANNER_COLS = 18/.test(clothSrc) && /BANNER_ROWS = 7/.test(clothSrc));
check("banner is Verlet taut cloth", /banner: true/.test(clothSrc) && /taut: true/.test(clothSrc) && /satisfy\(/.test(clothSrc));
check("poles bury into land", /GANTRY_POLE_BURY/.test(clothSrc) && /stage-gantry-pole/.test(clothSrc));
check("skipSeat / keepY on gantry", /skipSeat/.test(clothSrc) && /keepY/.test(clothSrc));
check("seat-scenery honors keepY", /keepY/.test(seatSrc) && /skipSeat/.test(seatSrc));
check("readable championship wording", /RALLY CHAMPIONSHIP/.test(clothSrc) && /START/.test(clothSrc) && /FINISH/.test(clothSrc));
check("no Sega trademark lockup", !/SEGA/.test(clothSrc) && !/TOYOTA/.test(clothSrc));
check("PBR / lit banner material", /gantry-banner-cloth/.test(clothSrc) && /MeshStandardMaterial|MeshLambertMaterial/.test(clothSrc));

const cup = ["desert", "forest", "mountain", "lakeside"];
for (const id of cup) {
  check(
    `courses.js lists ${id}`,
    new RegExp(`id:\\s*"${id}"`).test(coursesSrc) || new RegExp(`${id}:`).test(coursesSrc)
  );
}
check("every Track build plants gates", /this\._addStageGates\(\)/.test(trackSrc));
check("async and sync builds both plant gates", (trackSrc.match(/this\._addStageGates\(\)/g) || []).length >= 2);

class FakeCanvas {
  constructor() {
    this.width = 4;
    this.height = 4;
  }
  getContext() {
    const data = { data: new Uint8ClampedArray(this.width * this.height * 4) };
    return {
      fillStyle: "#000",
      strokeStyle: "#000",
      font: "",
      textAlign: "center",
      textBaseline: "middle",
      lineWidth: 1,
      createLinearGradient() {
        return { addColorStop() {} };
      },
      fillRect() {},
      strokeRect() {},
      fillText() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      quadraticCurveTo() {},
      closePath() {},
      fill() {},
      stroke() {},
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

const { createGantryBanner, updateClothFlags } = await import("../js/tracks/flag-cloth.js");

const stages = ["desert", "forest", "mountain", "lakeside"];
for (const scenery of stages) {
  for (const label of ["START", "FINISH"]) {
    const banner = createGantryBanner({
      label,
      scenery,
      heading: 0.2,
      left: { x: -6, y: 1.2, z: 0 },
      right: { x: 6, y: 1.35, z: 0.4 },
      roadY: 1.4,
      seed: label === "FINISH" ? 7 : 3,
    });
    const tag = `${scenery} ${label}`;
    check(`${tag} group named`, banner.group.name === `stage-gantry-${label}`);
    check(`${tag} planted on min land Y`, Math.abs(banner.group.position.y - 1.2) < 1e-6);
    check(`${tag} skipSeat + keepY`, banner.group.userData.skipSeat === true && banner.group.userData.keepY === true);
    const poles = banner.group.children.filter((c) => /gantry-pole/.test(c.name || ""));
    check(`${tag} two planted poles`, poles.length === 2);
    const cloth = banner.group.children.find((c) => c.name === `stage-banner-${label}`);
    check(`${tag} cloth mesh exists`, !!cloth && cloth.geometry);
    const verts = cloth && cloth.geometry.attributes.position ? cloth.geometry.attributes.position.count : 0;
    check(`${tag} not a 1-poly card`, verts >= 18 * 7);
    const kind = cloth && cloth.material && cloth.material.userData && cloth.material.userData.kind;
    check(`${tag} cloth / PBR material`, kind === "gantry-banner-cloth");
    check(`${tag} double-sided or mapped`, !!(cloth && cloth.material && (cloth.material.side != null) && cloth.material.map));
    const before = Float32Array.from(banner.cur);
    updateClothFlags([banner], 1 / 30, 0.9, scenery, null);
    let moved = 0;
    let max = 0;
    for (let i = 0; i < banner.cur.length; i += 3) {
      if (banner.pin[i / 3]) continue;
      const d = Math.hypot(
        banner.cur[i] - before[i],
        banner.cur[i + 1] - before[i + 1],
        banner.cur[i + 2] - before[i + 2]
      );
      if (d > 1e-5) moved++;
      if (d > max) max = d;
    }
    check(`${tag} free cloth verts moved`, moved >= 8);
    check(`${tag} taut fabric-scale motion`, max > 0.0004 && max < 0.9);
  }
}

if (failed) {
  console.error(`Start/finish banner QA failed: ${failed}`);
  process.exit(1);
}
console.log("PASS  start/finish gantry banners");
