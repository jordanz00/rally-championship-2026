/**
 * Pace-call picker — soonest turn or jump from racing-line geometry.
 *
 * WHO THIS IS FOR: Track.noteAt and the Sprint 67 QA gate.
 * WHAT IT DOES: looks ahead and returns the nearest turn or jump. No gravel,
 *   tunnel, mud, cobbles, crest, or finish lines. Left = positive heading.
 * HOW IT CONNECTS: track.js sample() feeds heading / jump / landmark posts.
 */

/** Metres of heading change used to notice a corner. */
const DETECT_ARC = 48;
/** Ignore kinks smaller than this across DETECT_ARC. */
const MIN_TURN_DEG = 12;
const SCAN_STEP = 6;
const TURN_LEAD = 12;
const JUMP_LEAD = 8;
const CLASSIFY_BACK = 8;
const CLASSIFY_FWD = 40;
const EASY_MAX = 42;
const MEDIUM_MAX = 95;
const HAIRPIN_DEG = 125;

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
 * @param {number} at metres along the stage
 * @param {number} dh signed heading change (radians)
 * @param {number} deg absolute degrees
 * @param {boolean} landmark authored hairpin flag
 */
export function makeTurnNote(at, dh, deg, landmark) {
  const dir = dh > 0 ? "LEFT" : "RIGHT";
  const side = dir.toLowerCase();
  const hairpin = landmark || deg > HAIRPIN_DEG;
  let severity = 1;
  let grade = "easy";
  let text = `EASY ${dir}`;
  if (hairpin) {
    severity = 3;
    grade = "hairpin";
    text = `HAIRPIN ${dir}`;
  } else if (deg > MEDIUM_MAX) {
    severity = 3;
    grade = "hard";
    text = `HARD ${dir}`;
  } else if (deg > EASY_MAX) {
    severity = 2;
    grade = "medium";
    text = `MEDIUM ${dir}`;
  }
  const spoken =
    grade === "hairpin"
      ? `Hairpin ${side}`
      : `${grade.charAt(0).toUpperCase()}${grade.slice(1)} ${side}`;
  return {
    id: `${dir}-${severity}-${Math.round(at / 36)}`,
    kind: "turn",
    dir,
    severity,
    text,
    speech: spoken,
    clip: `${grade}-${side}`,
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
 * Soonest turn or jump inside the look-ahead window.
 * Jumps lose to a nearer turn. A far hairpin never beats the next easy bend.
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
    const p0 = sample(Math.max(0, d));
    if (!p0 || p0.jump) continue;
    const p1 = sample(Math.min(length - 1, d + DETECT_ARC));
    if (!p1) continue;
    const dh = wrapHeading((p1.heading || 0) - (p0.heading || 0));
    const deg = Math.abs(dh) * (180 / Math.PI);
    if (deg < MIN_TURN_DEG) continue;
    const q0 = sample(Math.max(0, d - CLASSIFY_BACK));
    const q1 = sample(Math.min(length - 1, d + CLASSIFY_FWD));
    const dh2 = wrapHeading((q1.heading || 0) - (q0.heading || 0));
    const deg2 = Math.abs(dh2) * (180 / Math.PI);
    const mid = sample(Math.min(length - 1, d + 16));
    const landmark = !!(p0.landmark || (mid && mid.landmark) || (q1 && q1.landmark));
    turnNote = makeTurnNote(d, dh2, deg2, landmark);
    turnAt = d;
    break;
  }

  if (jumpAt === Infinity && !turnNote) return null;
  if (jumpAt <= turnAt) {
    return {
      id: `jump-${Math.round(jumpStart)}`,
      kind: "jump",
      dir: "AHEAD",
      severity: 3,
      text: "JUMP",
      speech: "Jump",
      clip: "jump",
    };
  }
  return turnNote;
}
