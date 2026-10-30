/**
 * FloorGuard — arbiter of the 30 fps floor (degrade ladder + recovery).
 *
 * WHO THIS IS FOR: game.js present path, tools/qa-perf-floor.mjs.
 * WHAT IT DOES: watches PRESENTED-frame intervals. When a stage cannot hold
 *   30 fps (late frames sustained ~1 s) it walks a fixed shed ladder —
 *   resolution → post → shadows → particles → rival detail — and climbs back
 *   one rung at a time only after a long calm window, with a probation + ban
 *   so a rung that fails once is never retried this stage (no oscillation).
 * HOW IT CONNECTS: perf-tier.js still owns cadence (60 vs even-30 lock) and the
 *   `lockRaceQuality` look; this module owns the *floor* — it is the only
 *   system allowed to shed look when the floor is missed. game.js applies the
 *   level via `_applyFloorLevel`. Pure policy: no THREE, no DOM, unit-testable.
 *
 * POWER BI MAPPING: none
 */

/** Ordered shed ladder. Cumulative: level N applies rungs 1..N. */
export const FLOOR_LADDER = Object.freeze([
  { id: "tsr-performance", group: "resolution" },
  { id: "scale-85", group: "resolution", scale: 0.85 },
  { id: "scale-72", group: "resolution", scale: 0.72 },
  { id: "scale-60", group: "resolution", scale: 0.6 },
  { id: "post-low", group: "post" },
  { id: "post-off", group: "post" },
  { id: "shadow-lite", group: "shadows" },
  { id: "shadow-off", group: "shadows" },
  { id: "particles", group: "particles" },
  { id: "rivals", group: "rivals" },
]);

export const FLOOR_MAX_LEVEL = FLOOR_LADDER.length;

/** Interval above which an UNLOCKED present counts as late (< ~36 fps). */
export const LATE_MS_FREE = 28;
/** Interval above which a LOCKED-30 present counts as late (a missed vsync is 50 ms). */
export const LATE_MS_LOCKED30 = 42;
/** EMA weight of one frame in the late-rate (≈ 20-frame window). */
export const LATE_ALPHA = 0.05;
/** Late-rate that counts as "missing the floor". */
export const LATE_TRIGGER = 0.22;
/** Wall ms the late-rate must stay over the trigger before a step down (~1 s). */
export const TRIGGER_HOLD_MS = 900;
/** Ignore verdicts this long after any step (framebuffer realloc hitch passes). */
export const STEP_COOLDOWN_MS = 1200;
/** Calm wall time before one rung is recovered (hysteresis — slow up, fast down). */
export const RECOVER_MS = 20000;
/** After a recovery, a fail inside this window bans that rung for the stage. */
export const PROBATION_MS = 6000;
/** Interval-vs-cadence ratios that make a step skip rungs under severe misses. */
export const SEVERE_RATIO_2 = 1.5;
export const SEVERE_RATIO_3 = 2.0;
/** Single-sample clamp so one 1 s shader compile counts as one late frame only. */
export const SAMPLE_CLAMP_MS = 120;

/**
 * @param {{maxLevel?:number}} [opts]
 */
export function createFloorGuard(opts = {}) {
  const maxLevel = Math.max(1, Math.min(FLOOR_MAX_LEVEL, opts.maxLevel || FLOOR_MAX_LEVEL));
  let level = 0;
  let lateRate = 0;
  let overMs = 0;
  let calmMs = 0;
  let coolMs = 0;
  let probationMs = 0;
  let probationFrom = -1;
  let emaMs = 33.3;
  let steps = 0;
  let recoveries = 0;
  /** @type {Set<number>} rungs that failed their probation this stage */
  const banned = new Set();

  return {
    get level() {
      return level;
    },
    get lateRate() {
      return lateRate;
    },
    get emaMs() {
      return emaMs;
    },
    get steps() {
      return steps;
    },
    get recoveries() {
      return recoveries;
    },
    get banned() {
      return Array.from(banned);
    },
    get maxLevel() {
      return maxLevel;
    },

    /** New stage / settle: forget everything. */
    reset() {
      level = 0;
      lateRate = 0;
      overMs = 0;
      calmMs = 0;
      coolMs = 0;
      probationMs = 0;
      probationFrom = -1;
      emaMs = 33.3;
      steps = 0;
      recoveries = 0;
      banned.clear();
    },

    /**
     * Fold one presented frame.
     * @param {number} frameMs interval since the previous presented frame
     * @param {boolean} locked30 present cadence is the deliberate even 30
     * @returns {{changed:boolean, level:number, prev:number, dir:number}}
     */
    tick(frameMs, locked30) {
      const raw = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : 16.7;
      const ms = Math.min(raw, SAMPLE_CLAMP_MS);
      emaMs = emaMs * 0.9 + ms * 0.1;
      const prev = level;
      const cadence = locked30 ? 33.3 : 16.7;
      const lateMs = locked30 ? LATE_MS_LOCKED30 : LATE_MS_FREE;
      const late = ms > lateMs ? 1 : 0;
      lateRate += (late - lateRate) * LATE_ALPHA;

      if (coolMs > 0) coolMs -= ms;
      if (probationMs > 0) probationMs -= ms;

      if (coolMs <= 0 && lateRate >= LATE_TRIGGER) {
        overMs += ms;
        calmMs = 0;
        if (overMs >= TRIGGER_HOLD_MS && level < maxLevel) {
          const ratio = emaMs / cadence;
          const skip = ratio >= SEVERE_RATIO_3 ? 3 : ratio >= SEVERE_RATIO_2 ? 2 : 1;
          if (probationMs > 0 && probationFrom === level) banned.add(level + 1);
          level = Math.min(maxLevel, level + skip);
          steps += 1;
          overMs = 0;
          coolMs = STEP_COOLDOWN_MS;
          lateRate = 0;
          probationMs = 0;
          probationFrom = -1;
        }
      } else if (lateRate < LATE_TRIGGER * 0.5) {
        overMs = 0;
        if (late === 0 && ms <= cadence * 1.2) calmMs += ms;
        else calmMs = 0;
        if (calmMs >= RECOVER_MS && level > 0 && coolMs <= 0 && !banned.has(level)) {
          probationFrom = level - 1;
          level -= 1;
          recoveries += 1;
          calmMs = 0;
          probationMs = PROBATION_MS;
          coolMs = STEP_COOLDOWN_MS;
        }
      }
      return { changed: level !== prev, level, prev, dir: Math.sign(level - prev) };
    },

    metrics() {
      return {
        level,
        rung: level > 0 ? FLOOR_LADDER[level - 1].id : "full",
        lateRate: +lateRate.toFixed(3),
        emaMs: +emaMs.toFixed(1),
        steps,
        recoveries,
        banned: Array.from(banned),
      };
    },
  };
}
