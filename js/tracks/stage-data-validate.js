/**
 * Stage data validation — fail-fast before / without full Three build.
 *
 * WHO THIS IS FOR: qa-validate, compileTrackDefinition, Cursor quality gates.
 * WHAT IT DOES: Validates course piece lists / TrackDefinitions for topology,
 *   ranges, tunnels, checkpoints. Returns structured issues.
 * HOW IT CONNECTS: docs/QUALITY_STANDARD.md · tools/qa-validate.mjs
 *
 * POWER BI MAPPING: none
 */

import { TrackConfig, TunnelConfig } from "./world-config.js?v=1";
import { SEGMENT_KINDS } from "./segment-kinds.js?v=1";
import { compileTrackDefinition } from "./track-definition.js?v=2";

/**
 * @typedef {{ severity: 'error'|'warn', code: string, message: string }} DataIssue
 */

/**
 * @param {object} piece
 * @param {number} index
 * @returns {DataIssue[]}
 */
function validatePiece(piece, index) {
  /** @type {DataIssue[]} */
  const issues = [];
  const tag = `piece[${index}]`;
  if (!piece || typeof piece !== "object") {
    issues.push({ severity: "error", code: "BAD_PIECE", message: `${tag} not an object` });
    return issues;
  }
  const type = piece.type;
  if (type !== "straight" && type !== "curve" && type !== "jump") {
    issues.push({
      severity: "error",
      code: "BAD_TYPE",
      message: `${tag} type=${type}`,
    });
    return issues;
  }
  const w = piece.width;
  if (w != null && (w < TrackConfig.minWidth || w > TrackConfig.maxWidth || !Number.isFinite(w))) {
    issues.push({
      severity: "error",
      code: "BAD_WIDTH",
      message: `${tag} width=${w}`,
    });
  }
  if (type === "straight") {
    const len = piece.length;
    if (!(len >= TrackConfig.minStraightLength) || !Number.isFinite(len)) {
      issues.push({
        severity: "error",
        code: "BAD_LENGTH",
        message: `${tag} length=${len}`,
      });
    }
    if (len > 0 && piece.dy != null && Number.isFinite(piece.dy)) {
      const grade = Math.abs(piece.dy) / len;
      if (grade > TrackConfig.maxGradePerMetre) {
        issues.push({
          severity: "warn",
          code: "STEEP_GRADE",
          message: `${tag} grade=${grade.toFixed(3)} > ${TrackConfig.maxGradePerMetre}`,
        });
      }
    }
  }
  if (type === "curve") {
    const r = piece.radius;
    const a = piece.angle;
    if (!(r >= TrackConfig.minCurveRadius) || !Number.isFinite(r)) {
      issues.push({
        severity: "error",
        code: "BAD_RADIUS",
        message: `${tag} radius=${r}`,
      });
    }
    if (!Number.isFinite(a) || Math.abs(a) > TrackConfig.maxAbsAngleDeg || Math.abs(a) < 1) {
      issues.push({
        severity: "error",
        code: "BAD_ANGLE",
        message: `${tag} angle=${a}`,
      });
    }
  }
  if (type === "jump") {
    for (const k of ["ramp", "rise", "gap", "land"]) {
      const v = piece[k];
      if (v != null && (!(v > 0) || !Number.isFinite(v))) {
        issues.push({
          severity: "error",
          code: "BAD_JUMP",
          message: `${tag}.${k}=${v}`,
        });
      }
    }
  }
  if (piece.surface && typeof piece.surface !== "string") {
    issues.push({
      severity: "error",
      code: "BAD_SURFACE",
      message: `${tag} surface invalid`,
    });
  }
  return issues;
}

/**
 * Approximate path length from pieces (metres).
 * @param {object[]} pieces
 * @returns {number}
 */
export function approxPieceLength(pieces) {
  let len = 0;
  for (const p of pieces || []) {
    if (p.type === "straight") len += p.length || 0;
    else if (p.type === "curve") {
      len += (Math.abs(p.angle || 0) * Math.PI) / 180 * (p.radius || 0);
    } else if (p.type === "jump") {
      len += (p.ramp || 0) + (p.lip || 0) + (p.gap || 0) + (p.land || 0);
    }
  }
  return len;
}

/**
 * Validate a course def (pieces or TrackDefinition-compiled).
 * @param {object} def
 * @returns {{ ok: boolean, errors: DataIssue[], warnings: DataIssue[], stats: object }}
 */
export function validateCourseData(def) {
  /** @type {DataIssue[]} */
  const errors = [];
  /** @type {DataIssue[]} */
  const warnings = [];

  if (!def || typeof def !== "object") {
    return {
      ok: false,
      errors: [{ severity: "error", code: "NO_DEF", message: "Missing course def" }],
      warnings: [],
      stats: {},
    };
  }

  const id = def.id || "?";
  if (!def.scenery) {
    errors.push({ severity: "error", code: "NO_SCENERY", message: `${id}: missing scenery` });
  }
  if (def.seed == null || !Number.isFinite(def.seed)) {
    warnings.push({
      severity: "warn",
      code: "NO_SEED",
      message: `${id}: missing seed (generation should be deterministic)`,
    });
  }

  const pieces = def.pieces;
  if (!Array.isArray(pieces) || pieces.length < 3) {
    errors.push({
      severity: "error",
      code: "NO_PIECES",
      message: `${id}: need pieces[]`,
    });
    return { ok: false, errors, warnings, stats: { id } };
  }

  for (let i = 0; i < pieces.length; i++) {
    for (const issue of validatePiece(pieces[i], i)) {
      if (issue.severity === "error") errors.push(issue);
      else warnings.push(issue);
    }
  }

  // Tunnel runs: contiguous true flags, min length
  let tunLen = 0;
  let inTun = false;
  let tunRuns = 0;
  for (const p of pieces) {
    if (p.tunnel) {
      if (!inTun) {
        tunRuns++;
        inTun = true;
        tunLen = 0;
      }
      if (p.type === "straight") tunLen += p.length || 0;
      else if (p.type === "curve") {
        tunLen += (Math.abs(p.angle || 0) * Math.PI) / 180 * (p.radius || 0);
      }
    } else if (inTun) {
      if (tunLen < TunnelConfig.minLength) {
        errors.push({
          severity: "error",
          code: "SHORT_TUNNEL",
          message: `${id}: tunnel run ~${tunLen.toFixed(0)}m < ${TunnelConfig.minLength}m`,
        });
      }
      inTun = false;
    }
  }
  if (inTun && tunLen < TunnelConfig.minLength) {
    errors.push({
      severity: "error",
      code: "SHORT_TUNNEL",
      message: `${id}: tunnel run ~${tunLen.toFixed(0)}m < ${TunnelConfig.minLength}m`,
    });
  }

  const length = approxPieceLength(pieces);
  if (length < TrackConfig.minStageLength) {
    errors.push({
      severity: "error",
      code: "SHORT_STAGE",
      message: `${id}: length ~${length.toFixed(0)}m < ${TrackConfig.minStageLength}m`,
    });
  }

  const cps = pieces.filter((p) => p.checkpoint).length;
  if (id === "desert" && cps < 1) {
    warnings.push({ severity: "warn", code: "CP_BUDGET", message: "desert expected ≥1 checkpoint" });
  }
  if (id === "forest" && cps < 2) {
    warnings.push({ severity: "warn", code: "CP_BUDGET", message: "forest expected ≥2 checkpoints" });
  }
  if (id === "mountain" && cps < 3) {
    warnings.push({ severity: "warn", code: "CP_BUDGET", message: "mountain expected ≥3 checkpoints" });
  }

  // Segment kinds on authored defs
  if (Array.isArray(def.segments)) {
    for (let i = 0; i < def.segments.length; i++) {
      const k = def.segments[i]?.kind;
      if (k && !SEGMENT_KINDS.includes(k)) {
        errors.push({
          severity: "error",
          code: "BAD_SEGMENT_KIND",
          message: `${id} segments[${i}] kind=${k}`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      id,
      pieces: pieces.length,
      length: Math.round(length),
      checkpoints: cps,
      tunnelRuns: tunRuns,
      authoredFrom: def.authoredFrom || "pieces",
      scenery: def.scenery,
      seed: def.seed,
    },
  };
}

/**
 * Validate a TrackDefinition by compiling then validating pieces.
 * @param {object} trackDef
 * @returns {{ ok: boolean, errors: DataIssue[], warnings: DataIssue[], stats: object, course?: object }}
 */
export function validateTrackDefinition(trackDef) {
  try {
    const course = compileTrackDefinition(trackDef);
    const report = validateCourseData(course);
    return { ...report, course };
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          severity: "error",
          code: "COMPILE_FAIL",
          message: e && e.message ? e.message : String(e),
        },
      ],
      warnings: [],
      stats: { id: trackDef?.id },
    };
  }
}
