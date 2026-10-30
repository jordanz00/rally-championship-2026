/**
 * stage-fun-metrics — shared analysis of a compiled stage spline.
 *
 * WHO THIS IS FOR: qa-stage-fun.mjs and any ad-hoc stage inspection.
 * WHAT IT DOES: builds the Track spline (no meshes) and measures elevation,
 *   grade, jumps, corners, checkpoints and straights from Track.points.
 * RUN: only via node --experimental-loader ./tools/qa-strip-query-loader.mjs
 */
import { COURSES } from "../../js/tracks/courses.js";
import { Track } from "../../js/tracks/track.js";

export const STAGE_IDS = ["desert", "forest", "mountain", "lakeside"];
const RES = 2; // m, resample step

/** Build a Track spline for one stage. */
export function buildStageTrack(id, course) {
  const def = course || COURSES[id];
  const t = new Track(def, { deferBuild: true });
  t._buildSpline(def.pieces, def);
  return t;
}

function interp(pts, d, key) {
  // pts sorted by dist
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pts[m].dist <= d) lo = m;
    else hi = m;
  }
  const a = pts[lo];
  const b = pts[hi];
  const span = Math.max(1e-6, b.dist - a.dist);
  const t = Math.min(1, Math.max(0, (d - a.dist) / span));
  return a[key] + (b[key] - a[key]) * t;
}

/** Group ramp..land runs into jumps. */
function findJumps(pts) {
  const jumps = [];
  let i = 0;
  while (i < pts.length) {
    if (pts[i].jumpKind === "ramp") {
      const i0 = i;
      let j = i;
      while (j < pts.length && pts[j].jumpKind) j++;
      const seg = pts.slice(i0, j);
      const by = (k) => seg.filter((p) => p.jumpKind === k);
      const ramp = by("ramp");
      const crest = by("crest");
      const gap = by("gap");
      const land = by("land");
      const yLip = (crest[crest.length - 1] || ramp[ramp.length - 1]).y;
      const yStart = pts[Math.max(0, i0 - 1)].y;
      const lipRef = ramp[Math.max(0, ramp.length - 4)];
      const lipEnd = crest[0] || ramp[ramp.length - 1];
      const lipGrade = (lipEnd.y - lipRef.y) / Math.max(0.01, lipEnd.dist - lipRef.dist);
      const gapStart = gap[0] ? gap[0].dist : lipEnd.dist;
      const gapEnd = gap.length ? gap[gap.length - 1].dist : gapStart;
      const landStart = land[0] ? land[0].dist : gapEnd;
      const landEnd = land.length ? land[land.length - 1].dist : gapEnd;
      const yLand = land.length ? land[land.length - 1].y : yLip;
      // landing grade = max |grade| over the pad + 10 m beyond
      let landG = 0;
      for (let k = 1; k < pts.length; k++) {
        if (pts[k].dist < landStart || pts[k].dist > landEnd + 10) continue;
        if (pts[k].jumpKind && pts[k].jumpKind !== "land") continue;
        const ds = Math.max(0.01, pts[k].dist - pts[k - 1].dist);
        landG = Math.max(landG, Math.abs((pts[k].y - pts[k - 1].y) / ds));
      }
      // exit grade = mean grade over 12..40 m after the pad
      const exitG =
        (interp(pts, landEnd + 40, "y") - interp(pts, landEnd + 12, "y")) / 28;
      jumps.push({
        dist: ramp[0].dist,
        lipDist: lipEnd.dist,
        landEnd,
        rampLen: lipEnd.dist - ramp[0].dist,
        rise: lipEnd.y - yStart,
        lipGrade,
        gapLen: gapEnd - gapStart,
        drop: yLip - (gap[gap.length - 1] ? gap[gap.length - 1].y : yLip),
        landLen: landEnd - landStart,
        lipLen: crest.length ? crest[crest.length - 1].dist - crest[0].dist : 0,
        gapStart,
        landStart,
        approachG: (interp(pts, ramp[0].dist, "y") - interp(pts, ramp[0].dist - 30, "y")) / 30,
        landDrop: yLip - yLand,
        landG,
        exitG,
        width: ramp[0].width,
        jumpDrop: ramp[0].jumpDrop,
        jumpThrow: ramp[0].jumpThrow,
        heading: ramp[0].heading,
        headingEnd: land.length ? land[land.length - 1].heading : ramp[0].heading,
      });
      i = j;
    } else i++;
  }
  return jumps;
}

/** Corner list from heading change on a 2 m grid. */
function findCorners(pts, len) {
  const n = Math.floor(len / RES);
  const h = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) h[i] = interp(pts, i * RES, "heading");
  // curvature over a 12 m chord
  const W = 6;
  const kur = new Float64Array(n + 1);
  for (let i = W; i < n - W; i++) kur[i] = (h[i + W] - h[i - W]) / (2 * W * RES);
  const TH = 1 / 300;
  const corners = [];
  let cur = null;
  let quiet = 0;
  for (let i = 0; i <= n; i++) {
    const k = kur[i];
    const on = Math.abs(k) > TH;
    if (on) {
      const sign = Math.sign(k);
      if (cur && cur.sign !== sign) {
        corners.push(cur);
        cur = null;
      }
      if (!cur) cur = { sign, i0: i, i1: i, ang: 0, kmax: 0 };
      cur.i1 = i;
      cur.ang += Math.abs(k) * RES;
      cur.kmax = Math.max(cur.kmax, Math.abs(k));
      quiet = 0;
    } else if (cur) {
      quiet += 1;
      if (quiet * RES > 14) {
        corners.push(cur);
        cur = null;
      }
    }
  }
  if (cur) corners.push(cur);
  return corners
    .map((c) => {
      const arc = (c.i1 - c.i0) * RES;
      const deg = (c.ang * 180) / Math.PI;
      const radius = arc / Math.max(1e-3, c.ang);
      return {
        dist: c.i0 * RES,
        end: c.i1 * RES,
        dir: c.sign > 0 ? "R" : "L",
        deg,
        radius,
        minRadius: 1 / Math.max(1e-6, c.kmax),
      };
    })
    .filter((c) => c.deg >= 14);
}

/** Classify a corner. Bands chosen against compiled (eased) radii. */
export function classifyCorner(c) {
  if (c.deg >= 80 && c.minRadius < 140) return "hairpin";
  if (c.radius >= 150 && c.deg >= 28) return "sweeper";
  if (c.minRadius < 85 && c.deg >= 50) return "tight";
  if (c.deg >= 28) return "medium";
  return "kink";
}

/** Chicane = two opposite corners within 45 m of each other. */
function countChicanes(corners) {
  let n = 0;
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    if (a.dir !== b.dir && b.dist - a.end < 45) n++;
  }
  return n;
}

/**
 * Ribbon crossings: pairs of road samples >120 m apart along the stage that
 * share XZ (within half-widths). Returns merged events with the Y gap, so a
 * layout edit that creates / removes a crossing is visible.
 */
export function findCrossings(pts) {
  const cell = 24;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const samp = [];
  for (let i = 0; i < pts.length; i += 2) samp.push(pts[i]);
  for (const p of samp) {
    const k = key(p.x, p.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const hits = [];
  for (const a of samp) {
    const cx = Math.floor(a.x / cell);
    const cz = Math.floor(a.z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get(`${cx + dx},${cz + dz}`);
        if (!arr) continue;
        for (const b of arr) {
          if (b.dist - a.dist < 120) continue;
          const xz = Math.hypot(a.x - b.x, a.z - b.z);
          if (xz < ((a.width || 12) + (b.width || 12)) * 0.5) hits.push({ a: a.dist, b: b.dist, dy: b.y - a.y });
        }
      }
    }
  }
  hits.sort((p, q) => p.a - q.a);
  const out = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && Math.abs(h.a - last.a1) < 40 && Math.abs(h.b - last.b1) < 40) {
      last.a1 = h.a;
      last.b1 = h.b;
      last.minDy = Math.min(last.minDy, Math.abs(h.dy));
    } else out.push({ a0: h.a, a1: h.a, b0: h.b, b1: h.b, minDy: Math.abs(h.dy) });
  }
  return out;
}

export function analyseStage(id, course) {
  const track = buildStageTrack(id, course);
  const pts = track.points;
  const len = track.length;
  // elevation (2 m grid), grades over 12 m chords outside jump zones
  const n = Math.floor(len / RES);
  const y = new Float64Array(n + 1);
  const jk = new Array(n + 1);
  for (let i = 0; i <= n; i++) y[i] = interp(pts, i * RES, "y");
  let pi = 0;
  for (let i = 0; i <= n; i++) {
    const d = i * RES;
    while (pi < pts.length - 1 && pts[pi + 1].dist <= d) pi++;
    jk[i] = pts[pi].jumpKind || null;
  }
  const jumps = findJumps(pts);
  const inJumpZone = (d) =>
    jumps.some((j) => d >= j.dist - 14 && d <= j.landEnd + 16);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i <= n; i++) {
    yMin = Math.min(yMin, y[i]);
    yMax = Math.max(yMax, y[i]);
  }
  // total climb on 8 m smoothed profile, non-jump only
  let climb = 0;
  let descent = 0;
  const S = 4;
  for (let i = S + 1; i < n - S; i++) {
    if (inJumpZone(i * RES)) continue;
    const a = (y[i + S] + y[i + S - 1]) / 2;
    const b = (y[i - S + 1] + y[i - S]) / 2;
    void a;
    void b;
  }
  const ys = [];
  for (let i = 0; i <= n; i += 5) ys.push(y[i]); // 10 m grid
  for (let i = 1; i < ys.length; i++) {
    const d = ys[i] - ys[i - 1];
    if (inJumpZone(i * 10)) continue;
    if (d > 0) climb += d;
    else descent -= d;
  }
  // grade histogram (12 m chord)
  const C = 6;
  const hist = { "0-2": 0, "2-4": 0, "4-6": 0, "6-8": 0, "8-10": 0, "10+": 0 };
  let gMax = 0;
  let gMaxAt = 0;
  let sustainedMax = 0;
  let sustainedAt = 0;
  const grades = new Float64Array(n + 1);
  let count = 0;
  for (let i = C; i < n - C; i++) {
    const d = i * RES;
    if (inJumpZone(d)) continue;
    const g = (y[i + C] - y[i - C]) / (2 * C * RES);
    grades[i] = g;
    const a = Math.abs(g) * 100;
    count++;
    if (a < 2) hist["0-2"]++;
    else if (a < 4) hist["2-4"]++;
    else if (a < 6) hist["4-6"]++;
    else if (a < 8) hist["6-8"]++;
    else if (a < 10) hist["8-10"]++;
    else hist["10+"]++;
    if (Math.abs(g) > gMax) {
      gMax = Math.abs(g);
      gMaxAt = d;
    }
  }
  // sustained grade: mean over 40 m windows
  const SW = 20;
  for (let i = SW; i < n - SW; i++) {
    const d = i * RES;
    if (inJumpZone(d - 40) || inJumpZone(d + 40)) continue;
    const g = Math.abs((y[i + SW] - y[i - SW]) / (2 * SW * RES));
    if (g > sustainedMax) {
      sustainedMax = g;
      sustainedAt = d;
    }
  }
  // kink = Δgrade between consecutive raw spline segments, non-jump neighbourhood
  // Bridge deck + aprons belong to the bridge contract (owned elsewhere): exempt.
  const bz = pts.filter((p) => p.bridge || /^bridge_/.test(p.visual || ""));
  const bridgeA = bz.length ? bz[0].dist - 40 : Infinity;
  const bridgeB = bz.length ? bz[bz.length - 1].dist + 40 : -Infinity;
  let kink = 0;
  let kinkAt = 0;
  for (let i = 2; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    if (a.jump || a.jumpKind || b.jump || b.jumpKind || c.jump || c.jumpKind) continue;
    if (inJumpZone(b.dist)) continue;
    if (b.dist >= bridgeA && b.dist <= bridgeB) continue;
    const d1 = b.dist - a.dist;
    const d2 = c.dist - b.dist;
    if (d1 < 0.2 || d2 < 0.2) continue;
    const dg = Math.abs((c.y - b.y) / d2 - (b.y - a.y) / d1);
    if (dg > kink) {
      kink = dg;
      kinkAt = b.dist;
    }
  }
  const corners = findCorners(pts, len).map((c) => ({ ...c, type: classifyCorner(c) }));
  const cornerMix = {};
  for (const c of corners) cornerMix[c.type] = (cornerMix[c.type] || 0) + 1;
  cornerMix.chicane = countChicanes(corners.filter((c) => c.type !== "kink"));
  // longest straight (curvature < 1/600)
  let straightBest = 0;
  let straightAt = 0;
  let run0 = 0;
  for (let i = 0; i <= n; i++) {
    const k = i >= 6 && i < n - 6 ? Math.abs((interp(pts, (i + 6) * RES, "heading") - interp(pts, (i - 6) * RES, "heading")) / 24) : 0;
    if (k > 1 / 420) {
      const l = (i - run0) * RES;
      if (l > straightBest) {
        straightBest = l;
        straightAt = run0 * RES;
      }
      run0 = i;
    }
  }
  if ((n - run0) * RES > straightBest) {
    straightBest = (n - run0) * RES;
    straightAt = run0 * RES;
  }
  // checkpoint detail
  const cps = (track.checkpoints || []).map((cd) => {
    const near = pts.filter((p) => Math.abs(p.dist - cd) < 18);
    const onJump = near.find((p) => p.jumpKind);
    let g = 0;
    for (let i = 1; i < near.length; i++) {
      g = Math.max(g, Math.abs((near[i].y - near[i - 1].y) / Math.max(0.01, near[i].dist - near[i - 1].dist)));
    }
    // crest = local curvature of y: |g(+20) - g(-20)|
    const gA = (interp(pts, cd + 20, "y") - interp(pts, cd, "y")) / 20;
    const gB = (interp(pts, cd, "y") - interp(pts, cd - 20, "y")) / 20;
    return { dist: cd, onJump: onJump ? onJump.jumpKind : null, grade: g, curv: Math.abs(gA - gB) };
  });
  return {
    id,
    track,
    len,
    yMin,
    yMax,
    range: yMax - yMin,
    climb,
    descent,
    hist,
    histCount: count,
    gMax,
    gMaxAt,
    sustainedMax,
    sustainedAt,
    kink,
    kinkAt,
    bridge: bz.length ? { a: bridgeA + 40, b: bridgeB - 40 } : null,
    jumps,
    corners,
    cornerMix,
    straightBest,
    straightAt,
    cps,
    crossings: findCrossings(pts),
  };
}

export function fmtStage(s) {
  const lines = [];
  lines.push(
    `${s.id.toUpperCase()}  len ${s.len.toFixed(0)} m  y ${s.yMin.toFixed(1)}..${s.yMax.toFixed(1)} (range ${s.range.toFixed(1)})  climb ${s.climb.toFixed(0)} / descent ${s.descent.toFixed(0)}`
  );
  const pc = (v) => ((v / Math.max(1, s.histCount)) * 100).toFixed(0);
  lines.push(
    `  grade hist (%time) ${Object.entries(s.hist).map(([k, v]) => `${k}:${pc(v)}`).join(" ")}  max ${(s.gMax * 100).toFixed(1)}% @${s.gMaxAt.toFixed(0)}  sustained40 ${(s.sustainedMax * 100).toFixed(1)}% @${s.sustainedAt.toFixed(0)}  kink ${s.kink.toFixed(4)} @${s.kinkAt.toFixed(0)}`
  );
  lines.push(`  longest straight ${s.straightBest.toFixed(0)} m @${s.straightAt.toFixed(0)}`);
  lines.push(`  corners ${s.corners.length}: ${JSON.stringify(s.cornerMix)}`);
  lines.push(
    "  " +
      s.corners
        .map((c) => `${c.dist.toFixed(0)}${c.dir}${c.deg.toFixed(0)}°r${c.radius.toFixed(0)}${c.type[0]}`)
        .join(" ")
  );
  for (const j of s.jumps) {
    lines.push(
      `  jump @${j.dist.toFixed(0)} ramp ${j.rampLen.toFixed(0)}m rise ${j.rise.toFixed(2)} lip ${(j.lipGrade * 100).toFixed(1)}% gap ${j.gapLen.toFixed(0)}m land ${j.landLen.toFixed(0)}m landG ${(j.landG * 100).toFixed(1)}% exitG ${(j.exitG * 100).toFixed(1)}% drop ${j.jumpDrop}`
    );
  }
  lines.push(
    "  checkpoints " +
      s.cps.map((c) => `${c.dist.toFixed(0)}(g${(c.grade * 100).toFixed(1)}%${c.onJump ? " JUMP:" + c.onJump : ""})`).join(" ")
  );
  lines.push(
    "  crossings " +
      (s.crossings.length
        ? s.crossings.map((c) => `${c.a0.toFixed(0)}~${c.b0.toFixed(0)}(dy≥${c.minDy.toFixed(1)})`).join(" ")
        : "none")
  );
  return lines.join("\n");
}
