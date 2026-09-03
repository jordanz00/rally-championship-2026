/**
 * Authored pace-note library — historical WRC-style list per stage.
 *
 * WHO THIS IS FOR: Sprint 36 archive + optional tooling.
 * WHAT IT DOES: distance-triggered calls used to override curvature heuristics.
 * HOW IT CONNECTS: Sprint 67 stopped using this at runtime. Track.noteAt()
 *   reads geometry via pace-call.mjs (turns + jumps only). Distances here
 *   drifted from courses.js and must not drive the navigator.
 *
 * DISTANCES: calibrated to a prior courses.js piece sum. Re-run
 *   `node tools/dcc-pipeline.mjs --pace-audit` before ever wiring this back.
 */

/**
 * @typedef {Object} AuthoredPaceNote
 * @property {number} at distance along spline (m)
 * @property {string} id stable call id
 * @property {string} text HUD uppercase
 * @property {string} speech co-driver line
 * @property {number} severity 1 easy .. 3 hard
 * @property {string} [kind] turn|jump|caution|crest|narrows
 */

/** @type {Record<string, AuthoredPaceNote[]>} */
export const AUTHORED_PACE = {
  desert: [
    { at: 12, id: "des-open", text: "FLAT OUT", speech: "Flat out", severity: 1, kind: "crest" },
    { at: 280, id: "des-grav-in", text: "INTO GRAVEL", speech: "Into gravel", severity: 2, kind: "caution" },
    { at: 520, id: "des-jump1", text: "OVER JUMP", speech: "Jump", severity: 3, kind: "jump" },
    { at: 680, id: "des-tunnel", text: "INTO TUNNEL", speech: "Into the tunnel", severity: 2, kind: "narrows" },
    { at: 920, id: "des-mud", text: "INTO MUD", speech: "Into mud, easy", severity: 2, kind: "caution" },
    { at: 1180, id: "des-bowl", text: "HARD RIGHT", speech: "Hard right, open", severity: 3, kind: "turn" },
    { at: 1420, id: "des-sweep", text: "LONG RIGHT MAYBE", speech: "Long right maybe", severity: 2, kind: "turn", long: true, maybe: true },
    { at: 1680, id: "des-hairpin-r", text: "HARD RIGHT", speech: "Hard right", severity: 3, kind: "turn" },
    { at: 1760, id: "des-hairpin-l", text: "HARD LEFT", speech: "Hard left", severity: 3, kind: "turn" },
    { at: 1920, id: "des-finish", text: "TO FINISH", speech: "To the finish", severity: 1, kind: "crest" },
  ],
  forest: [
    { at: 40, id: "for-open", text: "MEDIUM LEFT", speech: "Medium left, keep in", severity: 2, kind: "turn" },
    { at: 220, id: "for-grav", text: "INTO GRAVEL", speech: "Into gravel", severity: 2, kind: "caution" },
    { at: 310, id: "for-jump", text: "OVER JUMP", speech: "Jump", severity: 3, kind: "jump" },
    { at: 520, id: "for-glade", text: "INTO GLADE", speech: "Into the glade", severity: 2, kind: "caution" },
    { at: 560, id: "for-bowl", text: "HARD RIGHT", speech: "Hard right, waterfall", severity: 3, kind: "turn" },
    { at: 760, id: "for-sweep", text: "LONG RIGHT MAYBE", speech: "Long right, gravel, maybe", severity: 2, kind: "turn", long: true, maybe: true },
    { at: 980, id: "for-linked", text: "HARD RIGHT", speech: "Hard right, mud", severity: 3, kind: "turn" },
    { at: 1100, id: "for-linked-l", text: "HARD LEFT", speech: "Hard left, mud", severity: 3, kind: "turn" },
    { at: 1280, id: "for-autumn", text: "MEDIUM LEFT", speech: "Medium left, autumn", severity: 2, kind: "turn" },
    { at: 1520, id: "for-finale", text: "HARD RIGHT", speech: "Hard right to finish", severity: 3, kind: "turn" },
    { at: 1720, id: "for-finish", text: "TO FINISH", speech: "To the finish", severity: 1, kind: "crest" },
  ],
  mountain: [
    { at: 60, id: "mnt-hairpin1", text: "HARD LEFT", speech: "Hard left", severity: 3, kind: "turn" },
    { at: 280, id: "mnt-cobble", text: "COBBLES", speech: "Cobbles, caution", severity: 2, kind: "caution" },
    { at: 520, id: "mnt-crest", text: "CREST", speech: "Crest", severity: 2, kind: "crest" },
    { at: 780, id: "mnt-hairpin2", text: "HARD RIGHT", speech: "Hard right", severity: 3, kind: "turn" },
    { at: 1020, id: "mnt-gravel", text: "INTO GRAVEL", speech: "Into gravel", severity: 2, kind: "caution" },
    { at: 1280, id: "mnt-bowl", text: "HARD LEFT", speech: "Hard left, bowl", severity: 3, kind: "turn" },
    { at: 1580, id: "mnt-sweep", text: "LONG LEFT MAYBE", speech: "Long left maybe", severity: 2, kind: "turn", long: true, maybe: true },
    { at: 1820, id: "mnt-final", text: "HARD RIGHT", speech: "Hard right to finish", severity: 3, kind: "turn" },
  ],
  lakeside: [
    { at: 80, id: "lake-shore", text: "MEDIUM RIGHT", speech: "Medium right", severity: 2, kind: "turn" },
    { at: 340, id: "lake-jump", text: "OVER JUMP", speech: "Jump", severity: 3, kind: "jump" },
    { at: 580, id: "lake-mist", text: "NARROW", speech: "Narrow, mist", severity: 2, kind: "narrows" },
    { at: 820, id: "lake-finish", text: "TO FINISH", speech: "To the finish", severity: 1, kind: "crest" },
  ],
};

/**
 * Find the next authored note inside the co-driver look-ahead window.
 * @param {string} courseId
 * @param {number} dist current progress (m)
 * @param {number} look look-ahead (m)
 * @returns {AuthoredPaceNote|null}
 */
export function findAuthoredNote(courseId, dist, look) {
  const list = AUTHORED_PACE[courseId];
  if (!list || !list.length) return null;
  const far = dist + look;
  let best = null;
  let bestAt = Infinity;
  for (const n of list) {
    if (n.at <= dist + 4) continue;
    if (n.at > far) continue;
    if (n.at < bestAt) {
      bestAt = n.at;
      best = n;
    }
  }
  return best;
}

/**
 * Convert authored note to Track.noteAt shape.
 * @param {AuthoredPaceNote} n
 * @returns {{id:string,kind:string,dir:string,severity:number,text:string,speech:string}}
 */
export function authoredToNote(n) {
  let dir = "AHEAD";
  if (/left/i.test(n.text)) dir = "LEFT";
  else if (/right/i.test(n.text)) dir = "RIGHT";
  return {
    id: n.id,
    kind: n.kind || "turn",
    dir,
    severity: n.severity || 2,
    text: n.text,
    speech: n.speech,
  };
}
