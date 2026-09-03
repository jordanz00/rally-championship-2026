/**
 * Pace-call picker — soonest turn or jump from racing-line geometry.
 *
 * WHO THIS IS FOR: Track.noteAt and the Sprint 67 / 91 QA gates.
 * WHAT IT DOES: looks ahead and returns the nearest turn or jump, once per
 *   arc / crest. Easy / medium / hard / hairpin left or right, or jump.
 *   Long easy/medium arcs add LONG + MAYBE (AM3 / Kenneth Ibrahim: player
 *   must judge the corner). No gravel, tunnel, mud, cobbles, crest, or finish.
 *   Left = positive heading (matches courses.js curve `angle`).
 * HOW IT CONNECTS: track.js sample() feeds heading / jump / landmark posts.
 */

/** Metres of heading change used to notice a corner. */
const DETECT_ARC = 48;
/** Ignore kinks smaller than this across DETECT_ARC. */
const MIN_TURN_DEG = 12;
const SCAN_STEP = 6;
const TURN_LEAD = 12;
const JUMP_LEAD = 8;
const EASY_MAX = 42;
const MEDIUM_MAX = 95;
/** Tightest grade — Desert bowl / linked pins are 148–172°. */
const HAIRPIN_MIN = 135;
/**
 * Arc length (m) for a "long … maybe" call — sweepers the driver must judge,
 * not a short kink that already has a firm grade.
 */
const LONG_ARC_M = 64;
/** Slightly shorter arcs can still take MAYBE when the grade is easy/medium. */
const MAYBE_ARC_M = 48;

/**
 * Wrap a heading delta onto (−π, π].
 * @param {number} dh
 */
export function wrapHeading(dh) {
  let x = dh;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * Signed heading change (radians) over DETECT_ARC metres from `d`.
 * @param {(d:number)=>?{heading?:number,jump?:boolean}} sample
 * @param {number} d
 * @param {number} length
 */
function turnWindow(sample, d, length) {
  const p0 = sample(Math.max(0, d));
  if (!p0 || p0.jump) return { dh: 0, deg: 0 };
  const p1 = sample(Math.min(length - 1, d + DETECT_ARC));
  if (!p1) return { dh: 0, deg: 0 };
  const dh = wrapHeading((p1.heading || 0) - (p0.heading || 0));
  return { dh, deg: Math.abs(dh) * (180 / Math.PI) };
}

/**
 * @param {number} at metres along the stage (arc start — stable id)
 * @param {number} dh signed heading change (radians)
 * @param {number} deg absolute degrees of the whole arc
 * @param {number} [arcLen] metres of same-direction arc (for long/maybe)
 */
export function makeTurnNote(at, dh, deg, arcLen = 0) {
  const dir = dh > 0 ? "LEFT" : "RIGHT";
  const side = dir.toLowerCase();
  let severity = 1;
  let grade = "easy";
  if (deg > HAIRPIN_MIN) {
    severity = 4;
    grade = "hairpin";
  } else if (deg > MEDIUM_MAX) {
    severity = 3;
    grade = "hard";
  } else if (deg > EASY_MAX) {
    severity = 2;
    grade = "medium";
  }
  const len = Math.max(0, arcLen || 0);
  // Hairpins are definitive — no "maybe". Long easy/medium = judge yourself.
  const isLong = grade !== "hairpin" && len >= LONG_ARC_M;
  const maybe =
    grade !== "hairpin" &&
    severity <= 2 &&
    (isLong || len >= MAYBE_ARC_M);

  const gradeLabel = grade.toUpperCase();
  const text = `${isLong ? "LONG " : ""}${gradeLabel} ${dir}${maybe ? " MAYBE" : ""}`;
  let spoken =
    grade === "hairpin"
      ? `Hairpin ${side}`
      : `${grade.charAt(0).toUpperCase()}${grade.slice(1)} ${side}`;
  if (isLong && grade !== "hairpin") spoken = `Long ${spoken.toLowerCase()}`;
  if (maybe) spoken = `${spoken} maybe`;

  return {
    id: `${dir}-${severity}-${Math.round(at)}`,
    kind: "turn",
    dir,
    severity,
    at,
    text,
    speech: spoken,
    clip: `${grade}-${side}`,
    long: isLong,
    maybe,
    arcLen: len,
  };
}

/**
 * Walk back to the first jump flag in this run so one crest has one id.
 * @param {(d:number)=>?{jump?:boolean}} sample
 * @param {number} d
 * @param {number} floor
 */
function jumpRunStart(sample, d, floor) {
  let start = d;
  while (start > floor) {
    const prev = sample(start - 4);
    if (!prev || !prev.jump) break;
    start -= 4;
  }
  return start;
}

/**
 * Expand a detected kink into the full same-direction arc.
 * @param {(d:number)=>?{heading?:number,jump?:boolean}} sample
 * @param {number} d
 * @param {number} length
 * @param {number} sign
 */
function expandArc(sample, d, length, sign) {
  let start = d;
  while (start - SCAN_STEP >= 0) {
    const prev = turnWindow(sample, start - SCAN_STEP, length);
    if (prev.deg < MIN_TURN_DEG || Math.sign(prev.dh) !== sign) break;
    start -= SCAN_STEP;
  }
  let end = d;
  while (end + SCAN_STEP < length - 1) {
    const next = turnWindow(sample, end + SCAN_STEP, length);
    if (next.deg < MIN_TURN_DEG || Math.sign(next.dh) !== sign) break;
    end += SCAN_STEP;
  }
  return { start, end };
}

/**
 * Soonest turn or jump inside the look-ahead window.
 * Jumps lose to a nearer turn. A far hairpin never beats the next easy bend.
 * Each geometric arc has one id (its start), so a sweeper is not re-called.
 *
 * @param {(d:number)=>?{heading?:number,jump?:boolean,landmark?:boolean}} sample
 * @param {number} dist current progress (m)
 * @param {number} look look-ahead (m)
 * @param {number} length stage length (m)
 */
export function pickPaceNote(sample, dist, look, length) {
  const far = Math.min(length - 1, dist + look);
  const here = sample(dist);
  const onJump = !!(here && here.jump);

  let jumpAt = Infinity;
  let jumpStart = 0;
  if (!onJump) {
    for (let d = dist + JUMP_LEAD; d <= far; d += 4) {
      const p = sample(d);
      if (!p || !p.jump) continue;
      jumpStart = jumpRunStart(sample, d, dist + 4);
      jumpAt = jumpStart;
      break;
    }
  }

  let turnAt = Infinity;
  let turnNote = null;
  for (let d = dist + TURN_LEAD; d <= far; d += SCAN_STEP) {
    const win = turnWindow(sample, d, length);
    if (win.deg < MIN_TURN_DEG) continue;
    const sign = Math.sign(win.dh) || 1;
    const arc = expandArc(sample, d, length, sign);
    if (arc.start + TURN_LEAD < dist) {
      d = Math.max(d, arc.end);
      continue;
    }
    const a = sample(arc.start);
    const b = sample(Math.min(length - 1, arc.end + DETECT_ARC));
    if (!a || !b) continue;
    const dhTot = wrapHeading((b.heading || 0) - (a.heading || 0));
    const degTot = Math.abs(dhTot) * (180 / Math.PI);
    if (degTot < MIN_TURN_DEG) {
      d = Math.max(d, arc.end);
      continue;
    }
    const arcLen = Math.max(0, arc.end - arc.start);
    turnNote = makeTurnNote(arc.start, dhTot, degTot, arcLen);
    turnAt = arc.start;
    break;
  }

  if (jumpAt === Infinity && !turnNote) return null;
  if (jumpAt <= turnAt) {
    return {
      id: `jump-${Math.round(jumpStart)}`,
      kind: "jump",
      dir: "AHEAD",
      severity: 3,
      at: jumpStart,
      text: "JUMP",
      speech: "Jump",
      clip: "jump",
      long: false,
      maybe: false,
    };
  }
  return turnNote;
}
