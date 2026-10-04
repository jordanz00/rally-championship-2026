#!/usr/bin/env node
/**
 * qa-desert-1654.mjs — Stage 1 second Safari landing stays a road, not a wall.
 *
 * The checkpoint after the land pad crosses the start-town ribbon (~250 m).
 * Flyover separation used to lift that checkpoint into a 25–27% hill, so the
 * car stopped dead at 1654 m.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-desert-1654.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileTrackDefinition } from "../js/tracks/track-definition.js";
import { DESERT_DEFINITION } from "../js/tracks/stages/desert-definition.js";
import {
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  waitFor,
  clickSelector,
  pressKey,
  evaluate,
} from "./lib/qa-harness.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");

const STEP = 3.2;
const LIFT_GRADE_MAX = 0.18;
const CLEAR = 7.4;
/** Authored land recover is ~1.4%. A flyover wall was 25%+. */
const LAND_GRADE_MAX = 0.12;

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`DESERT 1654 LANDING  ·  ${new Date().toISOString()}\n`);
console.log("static");

check(
  "game imports current track.js",
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 411,
  "stale cache would keep the flyover wall"
);
check(
  "flyover skip on jump arrival",
  /_jumpArrivalNear/.test(trackSrc) && /jumpKind === "land"/.test(trackSrc),
  "_separateOverlappingRibbon must not lift a land pad"
);
check(
  "lift ramp stops at jump posts",
  /pts\[k\]\.jump \|\| pts\[k\]\.jumpKind/.test(trackSrc),
  "back-ramp must not walk through the Safari land"
);
check(
  "landing collider scrub",
  /Jump land pads/.test(trackSrc) && /d1 \+ 52/.test(trackSrc),
  "env spheres on the arrival deck must be stripped"
);

const course = compileTrackDefinition(DESERT_DEFINITION);
const pieces = course.pieces;
let x = 0;
let y = course.startY || 0;
let z = 0;
let heading = 0;
let width = course.startWidth || 12;
let surface = pieces[0]?.surface || "dirt";
let dist = 0;
const raw = [{ x, y, z, heading, width, surface, dist, tunnel: false, jumpKind: null }];

for (const piece of pieces) {
  if (piece.width) width = piece.width;
  if (piece.surface) surface = piece.surface;
  const dy = piece.dy || 0;
  if (piece.type === "straight") {
    const n = Math.max(1, Math.round(piece.length / STEP));
    const ds = piece.length / n;
    const dyi = dy / n;
    for (let i = 0; i < n; i++) {
      heading += (piece.bend || 0) / n;
      x += Math.sin(heading) * ds;
      z += Math.cos(heading) * ds;
      y += dyi;
      dist += ds;
      raw.push({
        x, y, z, heading, width, surface, dist,
        tunnel: !!piece.tunnel, jump: !!piece.jump, jumpKind: null,
      });
    }
  } else if (piece.type === "curve") {
    const angle = (piece.angle * Math.PI) / 180;
    const radius = piece.radius;
    const n = Math.max(2, Math.round((Math.abs(angle) * radius) / STEP));
    const da = angle / n;
    for (let i = 0; i < n; i++) {
      heading += da;
      const ds = Math.abs(da) * radius;
      x += Math.sin(heading) * ds;
      z += Math.cos(heading) * ds;
      y += dy / n;
      dist += ds;
      raw.push({
        x, y, z, heading, width: piece.width || width, surface, dist,
        tunnel: !!piece.tunnel, jump: !!piece.jump, jumpKind: null,
      });
    }
  } else if (piece.type === "jump") {
    const ramp = piece.ramp || 26;
    const rise = piece.rise || 3.4;
    const lip = piece.lip || 7;
    const gap = piece.gap || 20;
    const drop = piece.drop || 2.6;
    const land = piece.land || 24;
    const dropFast = Math.min(11, Math.max(8, gap * 0.4));
    const flyover = Math.max(10, gap - dropFast + 4);
    const easeInSine = (t) => 1 - Math.cos((t * Math.PI) / 2);
    const easeInOutSine = (t) => 0.5 - 0.5 * Math.cos(t * Math.PI);
    const easeRampLip = (t) => {
      const cut = 0.68;
      if (t <= cut) return easeInSine(t);
      const kCut = easeInSine(cut);
      return kCut + (1 - kCut) * ((t - cut) / (1 - cut));
    };
    const pushPhase = (len, dyTotal, kind, easeFn) => {
      const step = kind === "ramp" ? 1.05 : 1.35;
      const n = Math.max(2, Math.round(len / step));
      const ease = typeof easeFn === "function" ? easeFn : null;
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const k0 = ease ? ease(t0) : t0;
        const k1 = ease ? ease(t1) : t1;
        const ds = len / n;
        x += Math.sin(heading) * ds;
        z += Math.cos(heading) * ds;
        y += dyTotal * (k1 - k0);
        dist += ds;
        const air = kind === "ramp" || kind === "crest" || kind === "gap";
        raw.push({
          x, y, z, heading, width, surface, dist,
          tunnel: false, jump: air || kind === "land", jumpKind: kind,
        });
      }
    };
    pushPhase(ramp, rise, "ramp", easeRampLip);
    pushPhase(Math.max(5, lip), 0, "crest", null);
    pushPhase(dropFast, -drop, "gap", easeInOutSine);
    pushPhase(flyover, 0, "gap", null);
    pushPhase(land, drop * 0.18, "land", easeInOutSine);
  }
}

for (let i = 1; i < raw.length - 1; i++) {
  if (raw[i].jumpKind !== "land" || raw[i + 1].jumpKind === "land") continue;
  const prev = raw[i - 1];
  if (!prev || prev.jumpKind !== "land") continue;
  const landDs = Math.max(0.01, raw[i].dist - prev.dist);
  const landG = (raw[i].y - prev.y) / landDs;
  if (Math.abs(landG) < 0.025) continue;
  const targetY = raw[i].y;
  let j0 = i;
  while (j0 > 0 && raw[j0].jumpKind === "land" && raw[i].dist - raw[j0].dist < 8) j0 -= 1;
  if (raw[j0].jumpKind !== "land") j0 += 1;
  const spanD = raw[i].dist - raw[j0].dist;
  if (spanD < 2.5) continue;
  const y0 = raw[j0].y;
  for (let j = j0 + 1; j <= i; j++) {
    const t = (raw[j].dist - raw[j0].dist) / spanD;
    raw[j].y = y0 + (targetY - y0) * t * t * (3 - 2 * t);
  }
}

const pts = raw.map((p) => ({
  ...p,
  nx: Math.cos(p.heading),
  nz: -Math.sin(p.heading),
}));

function liftRampEnd(j, dir, half) {
  let end = j;
  for (let s = 1; s <= half; s++) {
    const k = j + dir * s;
    if (k < 0 || k >= pts.length) break;
    if (pts[k].tunnel || pts[k].underpass) break;
    if (pts[k].jump || pts[k].jumpKind) break;
    end = k;
  }
  return end;
}

function jumpArrivalNear(j, metres = 64) {
  const d0 = pts[j].dist;
  for (let k = j; k >= 0; k--) {
    if (d0 - pts[k].dist > metres) break;
    if (pts[k].jump || pts[k].jumpKind) return true;
  }
  return false;
}

const n = pts.length;
const half = 24;
let applied = 0;
for (let pass = 0; pass < 6; pass++) {
  let hits = 0;
  for (let i = 0; i < n; i += 2) {
    const a = pts[i];
    if (a.jumpKind === "gap" || a.jumpKind === "crest" || a.jumpKind === "ramp") continue;
    for (let j = i + 24; j < n; j += 2) {
      const b = pts[j];
      if (b.tunnel || b.underpass || a.underpass) continue;
      if (b.jumpKind === "gap" || b.jumpKind === "crest" || b.jumpKind === "ramp") continue;
      if (b.jump || b.jumpKind === "land" || jumpArrivalNear(j, 64)) continue;
      const along = b.dist - a.dist;
      if (along < 80) continue;
      const xz = Math.hypot(b.x - a.x, b.z - a.z);
      const need = (a.width + b.width) * 0.5 + 3;
      if (xz >= need) continue;
      if (b.y - a.y >= CLEAR || a.y - b.y >= CLEAR) continue;
      const lift = a.y + CLEAR - b.y;
      if (lift <= 0.05) continue;
      const j0 = liftRampEnd(j, -1, half);
      const j1 = liftRampEnd(j, 1, half);
      if (j0 >= j || j1 <= j) continue;
      const runBack = b.dist - pts[j0].dist;
      const runFwd = pts[j1].dist - b.dist;
      const room = Math.min(runBack, runFwd);
      if (lift * 1.5 > LIFT_GRADE_MAX * room) continue;
      hits += 1;
      applied += 1;
      for (let k = j0; k <= j1; k++) {
        const span = k < j ? runBack : runFwd;
        if (span <= 1e-6) continue;
        const t = 1 - Math.abs(pts[k].dist - b.dist) / span;
        if (t <= 0) continue;
        pts[k].y += lift * t * t * (3 - 2 * t);
      }
    }
  }
  if (!hits) break;
}

console.log("\nspline");
check("Desert compiles", dist > 2500 && dist < 3600, `${dist.toFixed(1)} m`);

let land0 = null;
let land1 = null;
for (const p of pts) {
  if (p.jumpKind === "land" && p.dist > 1500) {
    if (land0 == null) land0 = p.dist;
    land1 = p.dist;
  }
}
check(
  "second Safari land covers 1654 m",
  land0 != null && land0 < 1654 && land1 > 1654,
  `${land0?.toFixed(1)}–${land1?.toFixed(1)}`
);

let worst = 0;
let worstAt = 0;
let prev = null;
for (const p of pts) {
  if (p.dist < 1618 || p.dist > 1718) continue;
  if (prev) {
    const g = (p.y - prev.y) / Math.max(0.01, p.dist - prev.dist);
    if (g > worst) {
      worst = g;
      worstAt = p.dist;
    }
  }
  prev = p;
}
check(
  "landing / checkpoint grade under 12%",
  worst <= LAND_GRADE_MAX,
  `worst ${(worst * 100).toFixed(1)}% at ${worstAt.toFixed(1)} m`
);

const y1654 = pts.reduce((best, p) =>
  Math.abs(p.dist - 1654.1) < Math.abs(best.dist - 1654.1) ? p : best
);
check(
  "1654 m stays on the authored deck (~2.3 m)",
  Math.abs(y1654.y - 2.25) < 0.6,
  `y=${y1654.y.toFixed(2)}`
);
check("no flyover writes on the landing corridor", applied === 0, `${applied} lifts`);

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.log("\nSKIP headed  ·  no Chrome");
  console.log("\nPASS");
  process.exit(0);
}

console.log("\nheaded live Track.points");
const server = await startServer(ROOT);
const browser = await launchChrome({ headless: true });
try {
  const { cdp } = browser;
  await preparePage(cdp);
  await goto(cdp, `${server.origin}/index.html`);
  await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "game" });
  await pressKey(cdp, "Enter");
  await waitFor(
    cdp,
    `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-menu"?1:null;`,
    { timeout: 8000, label: "menu" }
  );
  await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
  await waitFor(
    cdp,
    `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-cars"?1:null;`,
    { timeout: 12000, label: "cars" }
  );
  await waitFor(
    cdp,
    `const b=document.querySelector("[data-car='celica']"); return b&&!b.disabled?1:null;`,
    { timeout: 20000, label: "celica" }
  );
  await clickSelector(cdp, "[data-car='celica']", "CELICA");
  await waitFor(
    cdp,
    `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-courses"?1:null;`,
    { timeout: 25000, label: "courses" }
  );
  await clickSelector(cdp, "[data-course='desert']", "DESERT");
  await waitFor(
    cdp,
    `return window.game && (window.game.state === "countdown" || window.game.state === "race")
       ? window.game.courseId : null;`,
    { timeout: 120000, label: "desert boot" }
  );
  const live = await evaluate(cdp, `(() => {
    const pts = window.game && window.game.track && window.game.track.points;
    if (!pts || !pts.length) return null;
    let worst = 0;
    let worstAt = 0;
    let y1654 = null;
    let prev = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.dist < 1618 || p.dist > 1718) continue;
      if (Math.abs(p.dist - 1654.1) < 1.2) y1654 = p.y;
      if (prev) {
        const g = (p.y - prev.y) / Math.max(0.01, p.dist - prev.dist);
        if (g > worst) { worst = g; worstAt = p.dist; }
      }
      prev = p;
    }
    return { worst, worstAt, y1654, n: pts.length };
  })()`);
  if (!live) {
    check("live Track.points", false, "no spline after boot");
  } else {
    check(
      "live landing grade under 12%",
      live.worst <= LAND_GRADE_MAX,
      `worst ${(live.worst * 100).toFixed(1)}% at ${live.worstAt.toFixed(1)} m`
    );
    check(
      "live 1654 m on authored deck",
      Number.isFinite(live.y1654) && Math.abs(live.y1654 - 2.25) < 0.8,
      `y=${live.y1654 != null ? live.y1654.toFixed(2) : "na"}`
    );
  }
} catch (err) {
  check("headed desert boot", false, err && err.message ? err.message : String(err));
} finally {
  if (browser && browser.close) await browser.close();
  if (server && server.close) server.close();
}

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}
console.log("\nPASS");
