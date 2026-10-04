#!/usr/bin/env node
/**
 * QA — rain vs car OBB and road clip (no browser).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  rainHitsCarLocal,
  rainHitsCarSegment,
  clipSegmentToY,
  clipCarHitT,
  rainCrossesDeck,
} from "../js/weather/rain.js";

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../js/weather/rain.js"),
  "utf8"
);

let failed = 0;
function check(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

// Identity car: +Z forward, +X right.
const FX = 0;
const FZ = 1;
const RX = 1;
const RZ = 0;

check("hood hit", rainHitsCarLocal(0, 0.8, 1.1, FX, FZ, RX, RZ) === "hood");
check("roof hit", rainHitsCarLocal(0, 1.2, 0, FX, FZ, RX, RZ) === "roof");
check("glass hit", rainHitsCarLocal(0, 1.05, 1.1, FX, FZ, RX, RZ) === "glass");
check("miss above", rainHitsCarLocal(0, 2.4, 0, FX, FZ, RX, RZ) === "");
check("miss beside", rainHitsCarLocal(3, 0.8, 0, FX, FZ, RX, RZ) === "");
check("deck miss", rainHitsCarLocal(0, -0.2, 0, FX, FZ, RX, RZ) === "");

const seg = rainHitsCarSegment(0, 3, 1, 0, 0.4, 1, 0, 0, 0, FX, FZ, RX, RZ);
check("falling streak hits car", !!seg);

const t = clipCarHitT(0, 3, 1, 0, 0.2, 1, 0, 0, 0, FX, FZ, RX, RZ);
check("clip t in range", t >= 0 && t <= 1);
check("clip is not the tail", t < 0.99);

check("road clip at deck", Math.abs(clipSegmentToY(2, -1, 0.4) - (2 - 0.4) / 3) < 1e-6);
check("already under deck", clipSegmentToY(-0.2, -1, 0.4) === 0);
check("crossing fires a crown", rainCrossesDeck(2, -1, 0.4) === true);
check("air streak is silent", rainCrossesDeck(2, 1, 0.4) === false);
check("already under is silent", rainCrossesDeck(-0.2, -1, 0.4) === false);
check("road crowns are not additive", !/blending: THREE\.AdditiveBlending/.test(SRC));
check("road crowns use normal blend", /blending: THREE\.NormalBlending/.test(SRC));
check("crossing helper is the road gate", /rainCrossesDeck\(ay, by, deck\)/.test(SRC));
check("dead splashes park off the deck", /pos\[i \* 3 \+ 1\] = -80/.test(SRC) || /pos\[i3 \+ 1\] = -80/.test(SRC));

if (failed) {
  console.error(`Rain collide QA failed: ${failed}`);
  process.exit(1);
}
console.log("Rain collide QA passed.");
