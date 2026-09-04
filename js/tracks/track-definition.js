/**
 * TrackDefinition — intentional rally-stage authoring above the piece list.
 *
 * WHO THIS IS FOR: stage designers and Cursor (not random spline noise).
 * WHAT IT DOES: Segment vocabulary with gameplay purpose → compiles to the
 *   existing Track piece format (`straight` / `curve` / `jump` + flags).
 * HOW IT CONNECTS: courses.js / stages/* call compileTrackDefinition();
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
      medium_corner: { radius: 48, angle: 58 },
      tight_corner: { radius: 28, angle: 95 },
      hairpin: { radius: 18, angle: 155 },
      banked_corner: { radius: 52, angle: 72, bank: 0.12 },
      off_camber_corner: { radius: 40, angle: 64, bank: -0.08 },
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
  return course;
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
