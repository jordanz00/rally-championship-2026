/**
 * TrackDefinition — intentional rally-stage authoring above the piece list.
 *
 * WHO THIS IS FOR: stage designers and Cursor (not random spline noise).
 * WHAT IT DOES: Segment vocabulary with gameplay purpose → compiles to the
 *   existing Track piece format (`straight` / `curve` / `jump` + flags).
 * HOW IT CONNECTS: courses.js / stages/* call compileTrackDefinition();
 *   sculptRoadElevation rolls the grade after the play-lane ease.
 *   Track.create still consumes pieces only. No track.js rewrite.
 *
 * POWER BI MAPPING: none
 */

import { SEGMENT_KINDS } from "./segment-kinds.js?v=1";

/** @typedef {'left'|'right'} TurnDir */

/**
 * @typedef {{
 *   kind: string,
 *   length?: number,
 *   radius?: number,
 *   angle?: number,
 *   direction?: TurnDir,
 *   width?: number,
 *   dy?: number,
 *   bank?: number,
 *   surface?: string,
 *   surfaceOut?: string,
 *   tunnel?: boolean,
 *   landmark?: boolean,
 *   sweep?: boolean,
 *   checkpoint?: boolean,
 *   ramp?: number,
 *   rise?: number,
 *   lip?: number,
 *   gap?: number,
 *   drop?: number,
 *   land?: number,
 *   purpose?: string,
 *   visual?: string,
 *   difficulty?: number,
 * }} TrackSegment
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   subtitle?: string,
 *   difficulty?: string,
 *   fog?: number,
 *   sky?: number,
 *   offroad?: string,
 *   scenery?: string,
 *   startWidth?: number,
 *   startY?: number,
 *   seed?: number,
 *   barriers?: boolean,
 *   identity?: string,
 *   segments: TrackSegment[],
 * }} TrackDefinition
 */

/**
 * Supported segment kinds (authoring vocabulary).
 * @type {readonly string[]}
 */
export { SEGMENT_KINDS };
/**
 * @param {TurnDir|undefined} dir
 * @param {number} absAngle
 * @returns {number} signed degrees (+ = left)
 */
function signedAngle(dir, absAngle) {
  const a = Math.abs(absAngle || 0);
  return (dir === "right" ? -1 : 1) * a;
}

/**
 * Compile one authoring segment into one or more Track pieces.
 * @param {TrackSegment} seg
 * @param {{ surface: string, width: number }} ctx
 * @returns {object[]}
 */
export function compileSegment(seg, ctx) {
  const kind = seg.kind || "straight";
  const surface = seg.surface || ctx.surface;
  const width = seg.width != null ? seg.width : ctx.width;
  const dy = seg.dy || 0;
  const purpose = seg.purpose;
  const base = {
    surface,
    width,
    dy,
    checkpoint: !!seg.checkpoint,
    landmark: !!seg.landmark,
    sweep: !!seg.sweep,
    tunnel: !!seg.tunnel,
    bank: seg.bank || 0,
    purpose,
    visual: seg.visual,
  };

  /** @type {object[]} */
  const out = [];

  if (kind === "jump") {
    out.push({
      type: "jump",
      ramp: seg.ramp ?? 16,
      rise: seg.rise ?? 2.2,
      lip: seg.lip ?? 5,
      gap: seg.gap ?? 12,
      drop: seg.drop ?? 1.6,
      land: seg.land ?? 24,
      surface,
      width,
      purpose,
    });
    return out;
  }

  if (kind === "s_bend") {
    const r = seg.radius ?? 42;
    const a = Math.abs(seg.angle ?? 56);
    const firstDir = seg.direction === "right" ? "right" : "left";
    const secondDir = firstDir === "left" ? "right" : "left";
    const link = Math.max(10, (seg.length || 28) * 0.35);
    out.push({
      type: "curve",
      radius: r,
      angle: signedAngle(firstDir, a),
      ...base,
      dy: dy * 0.45,
    });
    out.push({
      type: "straight",
      length: link,
      surface,
      width,
      dy: dy * 0.1,
      purpose: purpose ? `${purpose} (link)` : "s_bend_link",
    });
    out.push({
      type: "curve",
      radius: r * 0.92,
      angle: signedAngle(secondDir, a * 0.95),
      surface: seg.surfaceOut || surface,
      width,
      dy: dy * 0.45,
      landmark: !!seg.landmark,
      purpose,
    });
    return out;
  }

  if (
    kind === "fast_sweeper" ||
    kind === "medium_corner" ||
    kind === "tight_corner" ||
    kind === "hairpin" ||
    kind === "banked_corner" ||
    kind === "off_camber_corner"
  ) {
    const defaults = {
      fast_sweeper: { radius: 120, angle: 70, sweep: true },
      medium_corner: { radius: 56, angle: 54 },
      tight_corner: { radius: 52, angle: 74 },
      hairpin: { radius: 50, angle: 108 },
      banked_corner: { radius: 64, angle: 64, bank: 0.12 },
      off_camber_corner: { radius: 52, angle: 58, bank: -0.08 },
    };
    const d = defaults[kind] || { radius: 50, angle: 60 };
    const radius = seg.radius ?? d.radius;
    const angle = signedAngle(seg.direction, seg.angle ?? d.angle);
    let elev = dy;
    if (kind === "banked_corner" && !seg.dy) elev = 1.2;
    if (kind === "off_camber_corner" && !seg.dy) elev = -0.8;
    out.push({
      type: "curve",
      radius,
      angle,
      surface: seg.surfaceOut && kind !== "surface_transition" ? surface : surface,
      surfaceOut: seg.surfaceOut,
      width,
      dy: elev,
      bank: seg.bank != null ? seg.bank : d.bank || 0,
      checkpoint: !!seg.checkpoint,
      landmark: !!seg.landmark,
      sweep: !!(seg.sweep || d.sweep),
      tunnel: !!seg.tunnel,
      purpose,
      visual: seg.visual,
    });
    return out;
  }

  if (kind === "crest" || kind === "dip" || kind === "compression") {
    const len = seg.length ?? (kind === "crest" ? 36 : kind === "dip" ? 32 : 28);
    const elev =
      seg.dy != null
        ? seg.dy
        : kind === "crest"
          ? 3.2
          : kind === "dip"
            ? -2.4
            : -1.2;
    out.push({
      type: "straight",
      length: len,
      surface,
      width,
      dy: elev,
      purpose: purpose || kind,
      visual: seg.visual,
    });
    return out;
  }

  if (kind === "surface_transition") {
    out.push({
      type: "straight",
      length: seg.length ?? 48,
      surface,
      surfaceOut: seg.surfaceOut || surface,
      width,
      dy,
      purpose: purpose || "surface_transition",
    });
    return out;
  }

  if (kind === "tunnel") {
    const len = seg.length ?? 56;
    if (seg.angle && seg.radius) {
      out.push({
        type: "curve",
        radius: seg.radius,
        angle: signedAngle(seg.direction, seg.angle),
        surface,
        width,
        dy,
        tunnel: true,
        purpose: purpose || "tunnel",
        visual: seg.visual,
      });
    } else {
      out.push({
        type: "straight",
        length: len,
        surface,
        width,
        dy,
        tunnel: true,
        purpose: purpose || "tunnel",
        visual: seg.visual,
      });
    }
    return out;
  }

  if (kind === "bridge") {
    // No separate bridge mesh (Sprint 524 cut floating bridges). Authored as
    // an elevated open section the terrain skirts under.
    out.push({
      type: "straight",
      length: seg.length ?? 42,
      surface,
      width: width * 1.05,
      dy: dy || 2.5,
      landmark: true,
      purpose: purpose || "bridge",
      visual: seg.visual || "bridge_span",
    });
    return out;
  }

  if (kind === "narrow_section" || kind === "open_section") {
    const len = seg.length ?? 40;
    const w =
      seg.width != null
        ? seg.width
        : kind === "narrow_section"
          ? Math.max(7.5, width * 0.88)
          : width * 1.15;
    out.push({
      type: "straight",
      length: len,
      surface,
      surfaceOut: seg.surfaceOut,
      width: w,
      dy,
      purpose: purpose || kind,
    });
    return out;
  }

  // straight (default)
  out.push({
    type: "straight",
    length: seg.length ?? 60,
    surface,
    surfaceOut: seg.surfaceOut,
    width,
    dy,
    checkpoint: !!seg.checkpoint,
    tunnel: !!seg.tunnel,
    purpose: purpose || "straight",
    visual: seg.visual,
  });
  return out;
}

/**
 * Compile a TrackDefinition into a CourseDef compatible with Track.create.
 * @param {TrackDefinition} def
 * @returns {object} course def with `pieces` and `authoredFrom: 'TrackDefinition'`
 */
/**
 * Playable lane — wider ribbon, opened corners. Tight hooks open the most;
 * sweepers still ease so every stage turn is holdable.
 */
/** Wider lane + opened corners — easy power-slide championship ribbon. */
/** Slide ribbon: narrow enough to hang attitude, wide enough to catch. */
const PLAY_WIDTH = 1.48;
const PLAY_TIGHT_RADIUS = 1.68;
const PLAY_MEDIUM_RADIUS = 1.34;
const PLAY_SWEEP_RADIUS = 1.22;
const PLAY_SPEED_TIGHT = 1.32;
const PLAY_SPEED_SWEEP = 1.2;
/** Open hairpin hooks — was 0.9 / floor 112 and still felt like a wall. */
const PLAY_HAIRPIN_ANGLE = 0.82;
const PLAY_WIDTH_MIN = 7.5;
const PLAY_WIDTH_MAX = 40;
const PLAY_TUNNEL_EXTRA = 2.8;
const PLAY_STRAIGHT = 2.35;
const PLAY_FINISH_PAD = {
  desert: 320,
  forest: 360,
  mountain: 320,
  lakeside: 280,
  physlab: 48,
};

/**
 * @param {number} w
 * @returns {number}
 */
export function easePlayWidth(w) {
  if (!Number.isFinite(w)) return w;
  return Math.round(Math.min(PLAY_WIDTH_MAX, Math.max(PLAY_WIDTH_MIN, w * PLAY_WIDTH)) * 10) / 10;
}

/**
 * @param {number} r
 * @returns {number}
 */
export function easePlayRadius(r, speedLane = false) {
  if (!Number.isFinite(r)) return r;
  const mid = speedLane ? PLAY_MEDIUM_RADIUS : 1.16;
  const sweep = speedLane ? PLAY_SWEEP_RADIUS : 1;
  const s = r < 50 ? PLAY_TIGHT_RADIUS : r < 90 ? mid : sweep;
  const extra = speedLane ? (r < 50 ? PLAY_SPEED_TIGHT : PLAY_SPEED_SWEEP) : 1;
  return Math.round(r * s * extra * 10) / 10;
}

/**
 * Shave sharp non-hairpin bends. Hairpins keep their authored hook.
 * @param {number} angle
 * @param {number} radius
 * @returns {number}
 */
export function easePlayAngle(angle, radius, speedLane = false) {
  if (!Number.isFinite(angle)) return angle;
  const a = Math.abs(angle);
  // Hairpins stay a hook, but open enough to hold at championship pace.
  if (a >= 100) {
    const eased = Math.max(92, a * PLAY_HAIRPIN_ANGLE);
    return angle < 0 ? -eased : eased;
  }
  if (speedLane && radius < 70 && a > 52) {
    const eased = Math.max(40, a * 0.76);
    return angle < 0 ? -eased : eased;
  }
  if (radius < 60 && a > 55) {
    const eased = Math.max(42, a * 0.8);
    return angle < 0 ? -eased : eased;
  }
  if (a > 68) {
    const eased = Math.max(48, a * 0.88);
    return angle < 0 ? -eased : eased;
  }
  return angle;
}

/**
 * @param {object} piece
 * @returns {object}
 */
/**
 * @param {number} len
 * @returns {number}
 */
export function easePlayLength(len) {
  if (!Number.isFinite(len) || len < 4) return len;
  return Math.round(Math.min(480, Math.max(4, len * PLAY_STRAIGHT)) * 10) / 10;
}

/**
 * @param {object} piece
 * @param {boolean} [scaleStraight]
 * @returns {object}
 */
export function easePlayPiece(piece, scaleStraight = true, speedLane = false) {
  const out = { ...piece };
  if (out.width != null) {
    out.width = easePlayWidth(out.width);
    if (out.tunnel) {
      out.width = Math.round(Math.min(PLAY_WIDTH_MAX, out.width + PLAY_TUNNEL_EXTRA) * 10) / 10;
    }
  }
  if (out.radius != null) {
    const r0 = out.radius;
    out.radius = easePlayRadius(r0, speedLane);
    if (out.angle != null) out.angle = easePlayAngle(out.angle, r0, speedLane);
  }
  if (scaleStraight && out.type === "straight" && out.length) {
    out.length = easePlayLength(out.length);
  }
  return out;
}

/**
 * @param {object} course
 * @returns {object}
 */
export function easePlayCourse(course) {
  const pieces = course.pieces || [];
  let scaleFrom = 0;
  if (course.id === "desert") {
    let jumps = 0;
    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i].type === "jump") {
        jumps += 1;
        if (jumps >= 3) {
          scaleFrom = i + 1;
          break;
        }
      }
    }
  }
  const next = pieces.map((p, i) => {
    const afterSafari = course.id !== "desert" || i >= scaleFrom;
    return easePlayPiece(p, afterSafari, afterSafari);
  });
  const pad = PLAY_FINISH_PAD[course.id] || 0;
  if (pad > 0 && next.length) {
    const last = next[next.length - 1];
    if (last.type === "straight") {
      last.length = Math.min(480, (last.length || 0) + pad);
    }
  }
  return {
    ...course,
    startWidth: easePlayWidth(course.startWidth),
    pieces: next,
  };
}

/** Metres per hill chord — short enough that a crest is not sliced off flat. */
const HILL_CHUNK_M = 32;

/**
 * Rolling grade per stage. Cap stays under the 7.4 m flyover gap so a later
 * ribbon still clears an earlier one. Quiet zones hold the grid and jump
 * landings. Forest 3180–3900 is eased so that deck stays under a 5% grade.
 */
const HILL_PROFILE = {
  desert: {
    cap: 3.25,
    fade: 72,
    startQuiet: 24,
    jumpPre: 34,
    jumpPost: 92,
    trend: 0.7,
    waves: [
      { amp: 2.45, k: 84, phase: 0.35 },
      { amp: 1.4, k: 36, phase: 1.65 },
      { amp: 0.85, k: 18, phase: 0.55 },
    ],
  },
  forest: {
    cap: 3.15,
    fade: 80,
    startQuiet: 28,
    jumpPre: 30,
    jumpPost: 64,
    trend: 0.4,
    deck: { from: 3180, to: 3900, keep: 0.38, fade: 110 },
    waves: [
      { amp: 2.3, k: 78, phase: 0.55 },
      { amp: 1.25, k: 34, phase: 2.05 },
      { amp: 0.8, k: 17.5, phase: 0.2 },
    ],
  },
  mountain: {
    cap: 3.35,
    fade: 70,
    startQuiet: 22,
    jumpPre: 30,
    jumpPost: 52,
    trend: 1.5,
    waves: [
      { amp: 2.55, k: 70, phase: 0.2 },
      { amp: 1.45, k: 32, phase: 1.35 },
      { amp: 0.9, k: 16.5, phase: 2.4 },
    ],
  },
  lakeside: {
    cap: 3.0,
    fade: 74,
    startQuiet: 26,
    jumpPre: 32,
    jumpPost: 70,
    trend: 0.55,
    waves: [
      { amp: 2.15, k: 76, phase: 0.8 },
      { amp: 1.2, k: 31, phase: 2.2 },
      { amp: 0.78, k: 16, phase: 0.15 },
    ],
  },
};

/**
 * @param {number} t
 * @returns {number}
 */
function smoothstep01(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * Spline length of one piece, matching Track._buildSpline.
 * @param {object} piece
 * @returns {number}
 */
function pieceRunMetres(piece) {
  if (!piece) return 0;
  if (piece.type === "straight") return piece.length || 0;
  if (piece.type === "curve") {
    return ((Math.abs(piece.angle || 0) * Math.PI) / 180) * (piece.radius || 0);
  }
  if (piece.type === "jump") {
    const ramp = piece.ramp || 26;
    const lip = Math.max(5, piece.lip || 7);
    const gap = piece.gap || 20;
    const land = piece.land || 24;
    const dropFast = Math.min(11, Math.max(8, gap * 0.4));
    const flyover = Math.max(10, gap - dropFast + 4);
    return ramp + lip + dropFast + flyover + land;
  }
  return 0;
}

/**
 * Break a long straight or sweeper into short chords so a hill can rise and fall.
 * Hairpins and the Forest finish-left stay one piece (QA pins 3469 and 3485).
 * @param {object} piece
 * @returns {object[]}
 */
function splitDrivePiece(piece) {
  if (!piece || piece.type === "jump") return [piece];
  const run = pieceRunMetres(piece);
  if (!(run > 0)) return [piece];
  if (piece.type === "curve") {
    if (Math.abs(piece.angle || 0) >= 100) return [piece];
    if (/finish/i.test(piece.purpose || "")) return [piece];
    if (run < 110) return [piece];
  } else if (run < 56) {
    return [piece];
  }
  const n = Math.max(2, Math.round(run / HILL_CHUNK_M));
  /** @type {object[]} */
  const out = [];
  let consumed = 0;
  const switchAt = piece.type === "curve" ? 0.55 : 0.45;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const share = isLast ? run - consumed : run / n;
    const frac0 = consumed / run;
    const frac1 = (consumed + share) / run;
    consumed += share;
    const chunk = { ...piece };
    if (piece.type === "straight") chunk.length = share;
    else chunk.angle = (piece.angle || 0) * (share / run);
    chunk.dy = (piece.dy || 0) * (share / run);
    if (piece.surfaceOut) {
      if (frac0 >= switchAt) {
        chunk.surface = piece.surfaceOut;
        delete chunk.surfaceOut;
      } else if (frac1 <= switchAt) {
        delete chunk.surfaceOut;
      }
    }
    if (i > 0) {
      chunk.landmark = false;
      delete chunk.visual;
    }
    if (!isLast) chunk.checkpoint = false;
    out.push(chunk);
  }
  return out;
}

/**
 * @param {number} s
 * @param {{a:number,b:number}[]} zones
 * @param {number} fade
 * @returns {number}
 */
function hillWindow(s, zones, fade) {
  let w = 1;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (s >= z.a && s <= z.b) return 0;
    if (s < z.a && z.a - s < fade) w = Math.min(w, smoothstep01((z.a - s) / fade));
    else if (s > z.b && s - z.b < fade) w = Math.min(w, smoothstep01((s - z.b) / fade));
  }
  return w;
}

/**
 * @param {number} s
 * @param {object} spec
 * @param {{a:number,b:number}[]} zones
 * @param {number} total
 * @returns {number}
 */
/**
 * Forest 3180–3900 must stay a fast deck. Ease the hill there; full rolls elsewhere.
 * @param {number} s
 * @param {object} spec
 * @returns {number}
 */
function deckScale(s, spec) {
  const d = spec.deck;
  if (!d) return 1;
  if (s >= d.from && s <= d.to) return d.keep;
  if (s < d.from && d.from - s < d.fade) {
    return d.keep + (1 - d.keep) * smoothstep01((d.from - s) / d.fade);
  }
  if (s > d.to && s - d.to < d.fade) {
    return d.keep + (1 - d.keep) * smoothstep01((s - d.to) / d.fade);
  }
  return 1;
}

function stageHill(s, spec, zones, total) {
  let y = spec.trend ? spec.trend * Math.sin((Math.PI * s) / Math.max(1, total)) : 0;
  const waves = spec.waves;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    y += w.amp * Math.sin(s / w.k + w.phase);
  }
  const capped = spec.cap * Math.tanh(y / spec.cap);
  return capped * hillWindow(s, zones, spec.fade) * deckScale(s, spec);
}

/**
 * Lay a rolling grade on a compiled course. XZ and jump throws stay.
 * @param {object} course
 * @returns {object}
 */
export function sculptRoadElevation(course) {
  const spec = HILL_PROFILE[course && course.id];
  if (!spec || !Array.isArray(course.pieces)) return course;
  /** @type {object[]} */
  const pieces = [];
  for (let i = 0; i < course.pieces.length; i++) {
    const parts = splitDrivePiece(course.pieces[i]);
    for (let j = 0; j < parts.length; j++) pieces.push(parts[j]);
  }
  const runs = pieces.map((p) => pieceRunMetres(p));
  let total = 0;
  for (let i = 0; i < runs.length; i++) total += runs[i];
  /** @type {{a:number,b:number}[]} */
  const zones = [{ a: 0, b: spec.startQuiet }];
  let s = 0;
  for (let i = 0; i < pieces.length; i++) {
    const run = runs[i];
    const p = pieces[i];
    if (p.type === "jump") zones.push({ a: s - spec.jumpPre, b: s + run + spec.jumpPost });
    s += run;
  }
  s = 0;
  for (let i = 0; i < pieces.length; i++) {
    const run = runs[i];
    const p = pieces[i];
    const s1 = s + run;
    if (p.type !== "jump" && run > 0) {
      p.dy = (p.dy || 0) + (stageHill(s1, spec, zones, total) - stageHill(s, spec, zones, total));
    }
    s = s1;
  }
  course.pieces = pieces;
  return course;
}

export function compileTrackDefinition(def) {
  if (!def || !Array.isArray(def.segments)) {
    throw new Error("compileTrackDefinition: def.segments required");
  }
  /** @type {object[]} */
  const pieces = [];
  let surface = def.segments[0]?.surface || "tarmac";
  let width = def.startWidth || 10;

  for (const seg of def.segments) {
    const compiled = compileSegment(seg, { surface, width });
    for (const p of compiled) {
      pieces.push(p);
      if (p.surface) surface = p.surface;
      if (p.surfaceOut) surface = p.surfaceOut;
      if (p.width) width = p.width;
    }
  }

  const course = {
    id: def.id,
    name: def.name,
    subtitle: def.subtitle || "",
    difficulty: def.difficulty || "medium",
    fog: def.fog,
    sky: def.sky,
    offroad: def.offroad || "grass",
    scenery: def.scenery || def.id,
    startWidth: def.startWidth || 10,
    startY: def.startY || 0,
    seed: def.seed || 1,
    barriers: !!def.barriers,
    identity: def.identity || "",
    authoredFrom: "TrackDefinition",
    segments: def.segments,
    pieces,
  };
  return sculptRoadElevation(easePlayCourse(course));
}

/**
 * Summarize segment purposes for docs / QA.
 * @param {TrackDefinition} def
 * @returns {{ kind: string, purpose: string, visual?: string }[]}
 */
export function describeTrackRhythm(def) {
  return (def.segments || []).map((s) => ({
    kind: s.kind,
    purpose: s.purpose || "",
    visual: s.visual || "",
  }));
}
