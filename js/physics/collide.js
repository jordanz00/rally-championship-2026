/**
 * Vehicle collisions — arcade bump, no damage, no crash-out.
 *
 * WHO THIS IS FOR: the race loop.
 * WHAT IT DOES: oriented-box overlap between cars, then a soft scrape so you
 *   can rub, block, or get a light nudge without bouncing off. Off-road is a
 *   free runoff with a gentle pull back toward the ribbon. Extreme runoff
 *   hauls toward the lane without teleporting — a snap to mid-track clustered
 *   the pack after jump 3.
 * HOW IT CONNECTS: game.js runs the car-car pass after every physics step;
 *   Vehicle.step calls bounceOffRoad and glanceObstacles itself.
 *
 * DESIGN RULE (docs/AM3-RESEARCH.md §2): championship mode has no crash-out and
 * no off-course penalty. Everything in this file is therefore a redirect or a
 * cost, never a stop and never an elimination. A rival must not shove the
 * player off their line — they bump, then slide around you.
 */

const HALF_LENGTH = 2.05;
const HALF_WIDTH = 0.95;
const BROAD_RADIUS = Math.hypot(HALF_LENGTH, HALF_WIDTH);
const RESTITUTION = 0.04;
const FRICTION = 0.05;
const CAR_RADIUS = 1.15;
/**
 * Ceiling on one depenetration push (m). Getting shoved out of a rock is a
 * sub-metre correction; anything larger is a bad overlap, and acting on it is
 * indistinguishable from a teleport.
 */
const MAX_PUSH = 3;
/**
 * Player env depenetration cap (m). A contact nudge — never a metres-long
 * shove that fights `_guardXZ` and freezes the car against a rock.
 */
const PLAYER_ENV_PUSH = 0.24;
const AI_ENV_PUSH = 0.85;
/** Tunnel / underpass faces need a firmer shove than soft rocks. */
const PLAYER_WALL_PUSH = 1.2;
const AI_WALL_PUSH = 1.45;
/** Extra separation so we do not leave the OBB kissing the solid. */
const CONTACT_SLOP = 0.02;
/**
 * Fallback lining thickness (m) for a wall collider built without an explicit
 * `depth`. A wall face is a slab with a back, not an infinite half-space — see
 * the wall branch of glanceObstacles.
 */
const WALL_BACK = 2;
const SEPARATE = 0.72;
const YAW_NUDGE = 0.01;
/**
 * AI-AI: soft scrape, almost no bounce. Restitution + hard separate made the
 * pack pinball when several rivals shared a groove.
 */
const AI_RESTITUTION = 0;
/** Fraction of closing speed absorbed (not bounced) on AI-AI contact. */
const AI_CLOSE_DAMP = 0.62;
const AI_SEPARATE = 0.28;
/** Cap one-frame depenetration so overlaps do not teleport the pack. */
const AI_PUSH_CAP = 0.14;
/** Extra sideways shove (m) so the trailing rival slides past instead of stacking. */
const AI_PASS_LATERAL = 0.28;
/** Mild lateral velocity (m/s) on the pass step — 1.8 used to sling them into the next car. */
const AI_PASS_SIDE_VEL = 0.85;
/** Minimum along-track speed (m/s) restored on the trailing AI after a rub. */
const AI_PASS_MIN_SPD = 10;
/** Cooldown before another pass impulse (s). */
const AI_PASS_HOLD = 1.15;
/**
 * Player-vs-rival: the player keeps the line. Inverse-mass share used to be
 * 0.42, which still handed ~30% of every shove (and FRICTION*4 dragged you
 * sideways). Rivals now eat the overlap and step around.
 */
const PLAYER_ANCHOR = 0.12;
/** Metres of player depenetration per resolve — a bump, not a shove. */
const PLAYER_PUSH_CAP = 0.028;
const PLAYER_SEPARATE = 0.18;
/** Rival eats almost all remaining overlap so they leave the player's box. */
const PLAYER_RIVAL_SEPARATE = 0.9;
/** Max player Δv from the normal impulse (m/s). */
const PLAYER_BUMP_VEL = 2.2;
/** Fraction of tangent drag that may reach the player. */
const PLAYER_SLIDE_SHARE = 0.12;
const PLAYER_TANGENT_GRIP = 0.04;
/** Rival steps this far (m) around the player instead of staying glued. */
const PLAYER_RIVAL_SIDESTEP = 0.4;
const PLAYER_RESTITUTION = 0.02;
/** Ceiling on the yaw disturbance a rival may hand the player, rad/s. */
const PLAYER_YAW_CAP = 0.09;

/**
 * Off-road bands past the painted edge (metres).
 * Shoulder: light bank. Runoff: free driving with a soft pull. Recover: stronger
 * Recover: stronger guide. Extreme: haul toward the lane — never teleport.
 */
const OFF_SHOULDER = 1.6;
const OFF_RUNOFF = 10;
const OFF_RECOVER = 17;
const OFF_RESET = 24;
/** Player shoulder: soft berm — bleed outward speed into along-track scrape. */
const PLAYER_SHOULDER_OUT = 0.14;
/** Fraction of killed outward speed fed back along the ribbon (scrape, not inward bounce). */
const PLAYER_SHOULDER_SCRAPE = 0.88;
/**
 * Player runoff along-track drag, per 60 Hz step.
 * 1.2–4.8%/frame was ~50–95% speed loss per second and parked the car.
 * These stay a readable verge cost (~8–22%/s) without a near-stop.
 */
const PLAYER_SCRUB_MIN = 0.0014;
const PLAYER_SCRUB_MAX = 0.0042;
const PLAYER_OUT_KILL_MAX = 0.12;
/** Keep rally pace on throttle in the verge (~65 km/h). 5.5 m/s felt like a stop. */
const PLAYER_RUNOFF_FLOOR = 18;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Short props (cones, tape) do not block a car whose undercarriage is already
 * above them. Tunnel walls always reach.
 * @param {{kind?:string, top?:number}} c
 * @param {{position?:{y?:number}}} v
 */
function colliderHitsCarY(c, v) {
  if (!c || c.kind === "wall") return true;
  const y = v && v.position && Number.isFinite(v.position.y) ? v.position.y : 0;
  const top = Number.isFinite(c.top) ? c.top : 3.1;
  return y < top + 0.45;
}

/**
 * Lateral of every OBB corner on the road sample (centre + 4 corners).
 * A yawed nose can hit lining while the origin is still on paint.
 * @returns {{maxAbs:number, worstLat:number}}
 */
function chassisLatExtents(v, q) {
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  const rx = fz;
  const rz = -fx;
  const nx = q.nx;
  const nz = q.nz;
  let maxAbs = Math.abs(q.lateral);
  let worstLat = q.lateral;
  for (const sl of [-1, 1]) {
    for (const sw of [-1, 1]) {
      const dLat =
        (fx * sl * HALF_LENGTH + rx * sw * HALF_WIDTH) * nx +
        (fz * sl * HALF_LENGTH + rz * sw * HALF_WIDTH) * nz;
      const lat = q.lateral + dLat;
      if (Math.abs(lat) > maxAbs) {
        maxAbs = Math.abs(lat);
        worstLat = lat;
      }
    }
  }
  return { maxAbs, worstLat };
}

/**
 * Resolve all pairs. `vehicles` is an array of Vehicle instances.
 * @param {Array<{position:{x:number,z:number}, velocity:{x:number,z:number}, yaw:number, spec:{mass?:number}}>} vehicles
 */
export function resolveVehicleCollisions(vehicles) {
  const n = vehicles.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      resolvePair(vehicles[i], vehicles[j]);
    }
  }
}

function resolvePair(a, b) {
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > BROAD_RADIUS * 2 || dist < 1e-5) return;

  const hit = satOverlap(a, b);
  if (!hit) return;

  const aiPack = !!(a.ai && b.ai);
  if (!aiPack && (a.ai || b.ai)) {
    resolvePlayerRival(a, b, hit, dx, dz);
    return;
  }

  let invA = 1 / (a.spec.mass || 1200);
  let invB = 1 / (b.spec.mass || 1200);
  const tot = invA + invB;
  const nx = hit.nx;
  const nz = hit.nz;
  const push = aiPack
    ? Math.min(hit.overlap * AI_SEPARATE, AI_PUSH_CAP)
    : hit.overlap * SEPARATE;

  a.position.x -= nx * push * (invA / tot);
  a.position.z -= nz * push * (invA / tot);
  b.position.x += nx * push * (invB / tot);
  b.position.z += nz * push * (invB / tot);

  const rvx = b.velocity.x - a.velocity.x;
  const rvz = b.velocity.z - a.velocity.z;
  const relN = rvx * nx + rvz * nz;
  if (relN < 0) {
    // AI pack: damp closing speed only — restitution bounce made them pinball.
    const bounce = aiPack ? AI_RESTITUTION : RESTITUTION;
    const damp = aiPack ? AI_CLOSE_DAMP : 1 + bounce;
    const jn = (-damp * relN) / tot;
    a.velocity.x -= jn * nx * invA;
    a.velocity.z -= jn * nz * invA;
    b.velocity.x += jn * nx * invB;
    b.velocity.z += jn * nz * invB;
    const mag = Math.abs(relN) + hit.overlap;
    if (!a.ai) {
      a.hitCar = Math.max(a.hitCar || 0, mag);
      a.hitNx = nx;
      a.hitNz = nz;
    }
    if (!b.ai) {
      b.hitCar = Math.max(b.hitCar || 0, mag);
      b.hitNx = -nx;
      b.hitNz = -nz;
    }
  }

  const tx = -nz;
  const tz = nx;
  const relT = rvx * tx + rvz * tz;
  // AI pack: light tangent scrub so they glance past; heavy friction glued them.
  const grip = aiPack ? FRICTION * 0.5 : FRICTION * 4;
  const jt = clamp(-relT / tot, -grip, grip);
  a.velocity.x -= jt * tx * invA;
  a.velocity.z -= jt * tz * invA;
  b.velocity.x += jt * tx * invB;
  b.velocity.z += jt * tz * invB;

  if (aiPack) {
    // Trailing car gets ONE lateral pass impulse, then soft-separate only.
    // Re-firing AI_PASS_LATERAL every step while OBBs still kiss thrashed the
    // mesh ±0.5 m each frame (rival “glitching back and forth”).
    const aAhead = (a.progress || 0) >= (b.progress || 0);
    const rear = aAhead ? b : a;
    const front = aAhead ? a : b;
    const ffx = Math.sin(front.yaw);
    const ffz = Math.cos(front.yaw);
    const frx = Math.cos(front.yaw);
    const frz = -Math.sin(front.yaw);
    const rdx = rear.position.x - front.position.x;
    const rdz = rear.position.z - front.position.z;
    let side = Math.sign(rdx * frx + rdz * frz);
    if (!side) side = rear === a ? 1 : -1;
    if ((rear._aiPassT || 0) <= 0.04) {
      rear.position.x += frx * side * AI_PASS_LATERAL;
      rear.position.z += frz * side * AI_PASS_LATERAL;
      const along = Math.max(
        AI_PASS_MIN_SPD,
        rear.velocity.x * ffx + rear.velocity.z * ffz,
        (front.velocity.x * ffx + front.velocity.z * ffz) * 0.92
      );
      rear.velocity.x = ffx * along + frx * side * AI_PASS_SIDE_VEL;
      rear.velocity.z = ffz * along + frz * side * AI_PASS_SIDE_VEL;
      rear._aiPassSide = side;
      rear._aiPassT = AI_PASS_HOLD;
    }
    a.yawRate = (a.yawRate || 0) * 0.9;
    b.yawRate = (b.yawRate || 0) * 0.9;
    return;
  }

  // A glancing rub should twitch the car, not spin it. The player's share is
  // capped outright — losing the back end because a rival leaned on you is
  // exactly the hard failure championship mode is not allowed to have.
  const glancing = (dx * -Math.cos(a.yaw) + dz * Math.sin(a.yaw)) * YAW_NUDGE;
  a.yawRate = (a.yawRate || 0) - (a.ai ? glancing : clampYaw(glancing));
  b.yawRate = (b.yawRate || 0) + (b.ai ? glancing : clampYaw(glancing));
}

/**
 * Player vs AI: the player keeps almost all of their pose and speed. The rival
 * takes the overlap, a closing-speed bounce, and a sidestep so they do not
 * stay glued and shove again next frame.
 *
 * @param {*} a
 * @param {*} b
 * @param {{overlap:number,nx:number,nz:number}} hit
 * @param {number} dx
 * @param {number} dz
 */
function resolvePlayerRival(a, b, hit, dx, dz) {
  const player = a.ai ? b : a;
  const rival = a.ai ? a : b;
  let nx = hit.nx;
  let nz = hit.nz;
  const toRx = rival.position.x - player.position.x;
  const toRz = rival.position.z - player.position.z;
  if (toRx * nx + toRz * nz < 0) {
    nx = -nx;
    nz = -nz;
  }

  const overlap = hit.overlap;
  const playerPush = Math.min(overlap * PLAYER_SEPARATE, PLAYER_PUSH_CAP);
  const rivalPush = Math.max(overlap * PLAYER_RIVAL_SEPARATE, overlap - playerPush);
  player.position.x -= nx * playerPush;
  player.position.z -= nz * playerPush;
  rival.position.x += nx * rivalPush;
  rival.position.z += nz * rivalPush;

  const invP = (1 / (player.spec.mass || 1200)) * PLAYER_ANCHOR;
  const invR = 1 / (rival.spec.mass || 1200);
  const tot = invP + invR;
  const rvx = rival.velocity.x - player.velocity.x;
  const rvz = rival.velocity.z - player.velocity.z;
  const relN = rvx * nx + rvz * nz;
  if (relN < 0) {
    const jn = (-(1 + PLAYER_RESTITUTION) * relN) / tot;
    let pdvx = jn * nx * invP;
    let pdvz = jn * nz * invP;
    const pdv = Math.hypot(pdvx, pdvz);
    if (pdv > PLAYER_BUMP_VEL) {
      const s = PLAYER_BUMP_VEL / pdv;
      pdvx *= s;
      pdvz *= s;
    }
    player.velocity.x -= pdvx;
    player.velocity.z -= pdvz;
    rival.velocity.x += jn * nx * invR;
    rival.velocity.z += jn * nz * invR;
    player.hitCar = Math.max(player.hitCar || 0, Math.abs(relN) * 0.45 + overlap);
    player.hitNx = nx;
    player.hitNz = nz;
  }

  const tx = -nz;
  const tz = nx;
  const relT = rvx * tx + rvz * tz;
  const jt = clamp(-relT / tot, -PLAYER_TANGENT_GRIP, PLAYER_TANGENT_GRIP);
  player.velocity.x -= jt * tx * invP * PLAYER_SLIDE_SHARE;
  player.velocity.z -= jt * tz * invP * PLAYER_SLIDE_SHARE;
  rival.velocity.x += jt * tx * invR;
  rival.velocity.z += jt * tz * invR;

  const prx = Math.cos(player.yaw);
  const prz = -Math.sin(player.yaw);
  let side = Math.sign(toRx * prx + toRz * prz);
  if (!side) side = 1;
  // One sidestep per rub — repeating it every tick while still overlapping
  // made the rival body stutter left/right in the chase cam.
  if ((rival._aiPassT || 0) <= 0.04) {
    rival.position.x += prx * side * PLAYER_RIVAL_SIDESTEP;
    rival.position.z += prz * side * PLAYER_RIVAL_SIDESTEP;
    const rfx = Math.sin(rival.yaw);
    const rfz = Math.cos(rival.yaw);
    const rAlong = Math.max(8, rival.velocity.x * rfx + rival.velocity.z * rfz);
    rival.velocity.x = rfx * rAlong + prx * side * 1.4;
    rival.velocity.z = rfz * rAlong + prz * side * 1.4;
    rival._aiPassSide = side;
    rival._aiPassT = 0.7;
  }

  const glancing = (dx * -Math.cos(player.yaw) + dz * Math.sin(player.yaw)) * YAW_NUDGE;
  player.yawRate = (player.yawRate || 0) - clampYaw(glancing * 0.45);
  rival.yawRate = (rival.yawRate || 0) * 0.88;
}

/** Limit a yaw disturbance handed to the player. */
function clampYaw(v) {
  return clamp(v, -PLAYER_YAW_CAP, PLAYER_YAW_CAP);
}

/**
 * 2D SAT for two oriented boxes in XZ.
 * Forward is (sin yaw, cos yaw) to match Vehicle.
 */
function satOverlap(a, b) {
  const axes = [
    { x: Math.sin(a.yaw), z: Math.cos(a.yaw) },
    { x: Math.cos(a.yaw), z: -Math.sin(a.yaw) },
    { x: Math.sin(b.yaw), z: Math.cos(b.yaw) },
    { x: Math.cos(b.yaw), z: -Math.sin(b.yaw) },
  ];

  let minOverlap = Infinity;
  let nx = 1;
  let nz = 0;

  for (const axis of axes) {
    const pa = projectBox(a, axis);
    const pb = projectBox(b, axis);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      nx = axis.x;
      nz = axis.z;
    }
  }

  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  if (dx * nx + dz * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { overlap: minOverlap, nx, nz };
}

function projectBox(v, axis) {
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  const rx = Math.cos(v.yaw);
  const rz = -Math.sin(v.yaw);
  const cx = v.position.x;
  const cz = v.position.z;
  let min = Infinity;
  let max = -Infinity;
  for (const sl of [-1, 1]) {
    for (const sw of [-1, 1]) {
      const px = cx + fx * sl * HALF_LENGTH + rx * sw * HALF_WIDTH;
      const pz = cz + fz * sl * HALF_LENGTH + rz * sw * HALF_WIDTH;
      const d = px * axis.x + pz * axis.z;
      if (d < min) min = d;
      if (d > max) max = d;
    }
  }
  return { min, max };
}

/**
 * Closest-point depenetration of a circle (rock/tree) against the car OBB.
 * Uses the full chassis footprint — not a centre sphere — so a nose clip
 * registers before the rock sits inside the body.
 * @returns {{overlap:number, nx:number, nz:number}|null}
 */
function circleVsCarObb(cx, cz, cr, px, pz, fx, fz, rx, rz) {
  const dx = cx - px;
  const dz = cz - pz;
  const localLat = dx * rx + dz * rz;
  const localLong = dx * fx + dz * fz;
  const qLat = Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, localLat));
  const qLong = Math.max(-HALF_LENGTH, Math.min(HALF_LENGTH, localLong));
  const inside = qLat === localLat && qLong === localLong;
  if (inside) {
    let nx = px - cx;
    let nz = pz - cz;
    let d = Math.hypot(nx, nz);
    if (d < 1e-4) {
      const roomLat = HALF_WIDTH - Math.abs(localLat);
      const roomLong = HALF_LENGTH - Math.abs(localLong);
      if (roomLat < roomLong) {
        nx = localLat >= 0 ? rx : -rx;
        nz = localLat >= 0 ? rz : -rz;
      } else {
        nx = localLong >= 0 ? fx : -fx;
        nz = localLong >= 0 ? fz : -fz;
      }
      d = 1;
    } else {
      nx /= d;
      nz /= d;
    }
    const penLat = HALF_WIDTH - Math.abs(localLat) + cr;
    const penLong = HALF_LENGTH - Math.abs(localLong) + cr;
    // Cap — an unbounded "inside" overlap was a multi-metre shove that stopped the car.
    return { overlap: Math.min(0.78, Math.min(penLat, penLong)), nx, nz };
  }
  const closestX = px + rx * qLat + fx * qLong;
  const closestZ = pz + rz * qLat + fz * qLong;
  const ox = closestX - cx;
  const oz = closestZ - cz;
  const d = Math.hypot(ox, oz) || 0.0001;
  const overlap = cr - d;
  if (overlap <= 0) return null;
  return { overlap, nx: ox / d, nz: oz / d };
}

/**
 * Contact resolve: separate along the hit normal, then strip only the velocity
 * component going into the surface. Never zero the whole velocity — a wall at
 * 40 m/s must remain ~40 m/s along the wall.
 *
 * @param {{position:{x:number,z:number}, velocity:{x:number,z:number}, yawRate?:number, hitWall?:number, ai?:boolean}} v
 * @param {number} nx
 * @param {number} nz
 * @param {number} overlap
 * @param {number} pass
 * @param {number} fx
 * @param {number} fz
 * @param {number} fast
 * @param {{wall?:boolean, vel?:boolean}} [opts]
 */
function applyGlance(v, nx, nz, overlap, pass, fx, fz, fast, opts = {}) {
  if (!(overlap > 0) || !Number.isFinite(nx) || !Number.isFinite(nz)) return;
  const nLen = Math.hypot(nx, nz) || 1;
  nx /= nLen;
  nz /= nLen;
  const wall = !!opts.wall;
  const applyVel = opts.vel !== false;
  const cap = wall
    ? v.ai
      ? AI_WALL_PUSH
      : PLAYER_WALL_PUSH
    : v.ai
      ? AI_ENV_PUSH
      : PLAYER_ENV_PUSH;
  const push = Math.min(overlap + CONTACT_SLOP, cap) * (pass === 0 ? 1 : 0.9);
  v.position.x += nx * push;
  v.position.z += nz * push;

  if (!applyVel) {
    v.hitWall = Math.max(v.hitWall || 0, push * 0.35);
    v.hitNx = nx;
    v.hitNz = nz;
    return;
  }

  // Scrape: kill only a share of closing speed and feed it along-nose.
  // Zeroing the whole normal (old) plus 0.58 m × 6 correction passes pinballed drifts.
  const vn = v.velocity.x * nx + v.velocity.z * nz;
  if (vn < 0) {
    const closed = -vn;
    const tx = -nz;
    const tz = nx;
    const vt = v.velocity.x * tx + v.velocity.z * tz;
    const along = v.velocity.x * fx + v.velocity.z * fz;
    const glancing = closed < Math.max(1.8, Math.abs(vt) * 0.5 + Math.max(0, along) * 0.22);
    if (v.ai) {
      v.velocity.x -= vn * nx;
      v.velocity.z -= vn * nz;
      const alongNow = v.velocity.x * fx + v.velocity.z * fz;
      if (alongNow < 6) {
        v.velocity.x += fx * (6 - alongNow) * 0.35;
        v.velocity.z += fz * (6 - alongNow) * 0.35;
      }
    } else {
      const killFrac = wall ? (glancing ? 0.32 : 0.78) : glancing ? 0.14 : 0.48;
      v.velocity.x -= vn * nx * killFrac;
      v.velocity.z -= vn * nz * killFrac;
      const keep = closed * killFrac * (wall ? 0.7 : 0.88);
      if (along >= -2) {
        v.velocity.x += fx * keep;
        v.velocity.z += fz * keep;
      } else {
        const tSign = Math.sign(vt) || 1;
        v.velocity.x += tx * tSign * keep * 0.55;
        v.velocity.z += tz * tSign * keep * 0.55;
      }
      const vt2 = v.velocity.x * tx + v.velocity.z * tz;
      const scrub = glancing ? (wall ? 0.008 : 0.014) : wall ? 0.016 : 0.028;
      v.velocity.x -= tx * vt2 * scrub;
      v.velocity.z -= tz * vt2 * scrub;
    }
    v.hitWall = Math.max(v.hitWall || 0, Math.abs(vn) * 0.55 + push * 0.35);
    v.hitNx = nx;
    v.hitNz = nz;
  }
  if (v.yawRate != null) {
    const past = nx * fz - nz * fx;
    const yawK = v.ai ? 0.028 : wall ? 0.018 : 0.01;
    v.yawRate += past * yawK * fast;
  }
  void MAX_PUSH;
}

/**
 * Wall slab overlap at a world XZ (same rules as glance wall branch).
 * @returns {{overlap:number, nx:number, nz:number}|null}
 */
function wallHitAt(c, px, pz, fx, fz, rx, rz) {
  const nx = c.nx;
  const nz = c.nz;
  const dx = px - c.x;
  const dz = pz - c.z;
  const along = dx * c.tx + dz * c.tz;
  if (along > c.halfLen + HALF_LENGTH || along < -c.halfLen - HALF_LENGTH) return null;
  const ext =
    HALF_LENGTH * Math.abs(fx * nx + fz * nz) + HALF_WIDTH * Math.abs(rx * nx + rz * nz);
  const dist = dx * nx + dz * nz;
  const overlap = ext - dist;
  if (overlap <= 0) return null;
  // Deep behind a thick lining still counts — ignoring it let cars tunnel
  // through rock once they passed the modelled slab depth.
  const back = Math.max(c.depth || WALL_BACK, 2.4) + ext + 4;
  if (dist < -back) return null;
  return { overlap: Math.min(overlap, ext + (c.depth || WALL_BACK)), nx, nz };
}

/** Spatial hash cell size (m). Rebuilds when collider count changes. */
const COL_CELL = 14;
let _colStamp = 1;
const _colScratch = [];

/**
 * Bucket env solids so glanceObstacles does not walk the whole Forest list.
 * @param {{colliders: Array<object>, _colGrid?: {n:number, map:Map<string, object[]>}}} track
 */
function ensureColliderGrid(track) {
  const list = track.colliders;
  const n = list.length;
  if (track._colGrid && track._colGrid.n === n) return track._colGrid;
  const map = new Map();
  const put = (gx, gz, c) => {
    const k = gx + ":" + gz;
    let b = map.get(k);
    if (!b) {
      b = [];
      map.set(k, b);
    }
    b.push(c);
  };
  for (let i = 0; i < n; i++) {
    const c = list[i];
    let minX;
    let maxX;
    let minZ;
    let maxZ;
    if (c.kind === "wall") {
      const hl = (c.halfLen || 4) + 3;
      const tx = c.tx || 0;
      const tz = c.tz || 1;
      const pad = (c.depth || WALL_BACK) + 3;
      const ax = c.x - tx * hl;
      const az = c.z - tz * hl;
      const bx = c.x + tx * hl;
      const bz = c.z + tz * hl;
      minX = Math.min(ax, bx) - pad;
      maxX = Math.max(ax, bx) + pad;
      minZ = Math.min(az, bz) - pad;
      maxZ = Math.max(az, bz) + pad;
    } else {
      const r = (c.r || 0.5) + 3.2;
      minX = c.x - r;
      maxX = c.x + r;
      minZ = c.z - r;
      maxZ = c.z + r;
    }
    const gx0 = Math.floor(minX / COL_CELL);
    const gx1 = Math.floor(maxX / COL_CELL);
    const gz0 = Math.floor(minZ / COL_CELL);
    const gz1 = Math.floor(maxZ / COL_CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) put(gx, gz, c);
    }
  }
  track._colGrid = { n, map };
  return track._colGrid;
}

/**
 * Colliders whose cells overlap the XZ AABB. Reuses a scratch array.
 * @param {{colliders: Array<object>}} track
 * @param {number} minX
 * @param {number} maxX
 * @param {number} minZ
 * @param {number} maxZ
 * @returns {object[]}
 */
function nearbyColliders(track, minX, maxX, minZ, maxZ) {
  const g = ensureColliderGrid(track);
  _colStamp += 1;
  if (_colStamp > 1e9) {
    _colStamp = 1;
    const all = track.colliders;
    for (let i = 0; i < all.length; i++) all[i]._gs = 0;
  }
  _colScratch.length = 0;
  const gx0 = Math.floor(minX / COL_CELL);
  const gx1 = Math.floor(maxX / COL_CELL);
  const gz0 = Math.floor(minZ / COL_CELL);
  const gz1 = Math.floor(maxZ / COL_CELL);
  const map = g.map;
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      const b = map.get(gx + ":" + gz);
      if (!b) continue;
      for (let i = 0; i < b.length; i++) {
        const c = b[i];
        if (c._gs === _colStamp) continue;
        c._gs = _colStamp;
        _colScratch.push(c);
      }
    }
  }
  return _colScratch;
}

/**
 * Env solids authority:
 *   proposed XZ → TOI sweep (path, not endpoint) → contact resolve
 *   → penetration correction → validity flag for caller.
 *
 * @param {{position:{x:number,z:number}, velocity:{x:number,z:number}, yaw:number, speed:number, yawRate?:number, hitWall?:number, _prevX?:number, _prevZ?:number, _envIntersect?:boolean, _envDeep?:boolean, lowDetail?:boolean, envCheap?:boolean}} v
 * @param {{colliders: Array<{x:number,z:number,r?:number,kind?:string,nx?:number,nz?:number,tx?:number,tz?:number,halfLen?:number,depth?:number}>}} track
 */
export function glanceObstacles(v, track) {
  const all = track.colliders;
  if (!all || !all.length) {
    v._envIntersect = false;
    v._envDeep = false;
    return;
  }
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  const rx = fz;
  const rz = -fx;
  const fast = 1 / (1 + Math.max(0, v.speed || 0) * 0.045);
  const x0 = Number.isFinite(v._prevX) ? v._prevX : v.position.x;
  const z0 = Number.isFinite(v._prevZ) ? v._prevZ : v.position.z;
  const x1 = v.position.x;
  const z1 = v.position.z;
  const move = Math.hypot(x1 - x0, z1 - z0);
  const pad = 4.4;
  const list = nearbyColliders(
    track,
    Math.min(x0, x1) - pad,
    Math.max(x0, x1) + pad,
    Math.min(z0, z1) - pad,
    Math.max(z0, z1) + pad
  );
  const farAi = !!(v.lowDetail && v.envCheap);
  // Sub-metre samples — at 40 m/s a 1/60 step is ~0.67 m; 0.4 left a gap.
  const sweepCap = farAi ? 1 : v.lowDetail ? 8 : 18;
  const sweepSteps = Math.min(sweepCap, Math.max(1, Math.ceil(move / 0.28)));
  v._envIntersect = false;
  v._envDeep = false;

  // --- Pass A: earliest time-of-impact along the path (not deepest at the end).
  let toi = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (farAi && c.kind !== "wall") continue;
    if (!colliderHitsCarY(c, v)) continue;
    for (let s = 0; s <= sweepSteps; s++) {
      const t = s / sweepSteps;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      let hit = null;
      let wall = false;
      if (c.kind === "wall") {
        hit = wallHitAt(c, px, pz, fx, fz, rx, rz);
        wall = true;
      } else {
        hit = circleVsCarObb(c.x, c.z, c.r || 0.5, px, pz, fx, fz, rx, rz);
      }
      if (!hit || hit.overlap <= 0) continue;
      if (!toi || t < toi.t - 1e-6 || (Math.abs(t - toi.t) < 1e-6 && hit.overlap > toi.overlap)) {
        toi = { t, overlap: hit.overlap, nx: hit.nx, nz: hit.nz, wall };
      }
      break; // first contact along this collider's samples
    }
  }
  if (toi) {
    // Rewind to the contact — do not leave the car past the solid.
    const placeT = Math.max(0, toi.t - 0.02);
    v.position.x = x0 + (x1 - x0) * placeT;
    v.position.z = z0 + (z1 - z0) * placeT;
    applyGlance(v, toi.nx, toi.nz, toi.overlap, 0, fx, fz, fast, { wall: toi.wall });
  }

  // --- Pass B: residual contacts at the resolved pose (walls + nearby rocks).
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (farAi && c.kind !== "wall") continue;
    if (!colliderHitsCarY(c, v)) continue;
    if (c.kind === "wall") {
      const hit = wallHitAt(c, v.position.x, v.position.z, fx, fz, rx, rz);
      if (hit) applyGlance(v, hit.nx, hit.nz, hit.overlap, 1, fx, fz, fast, { wall: true });
      continue;
    }
    const hit = circleVsCarObb(
      c.x,
      c.z,
      c.r || 0.5,
      v.position.x,
      v.position.z,
      fx,
      fz,
      rx,
      rz
    );
    if (hit && hit.overlap > 0.02) {
      applyGlance(v, hit.nx, hit.nz, hit.overlap, 1, fx, fz, fast, { wall: false });
    }
  }

  correctEnvPenetration(v, track);
}

/**
 * Final hard boundary: if the car is still inside a solid after the sweep
 * resolve, nudge out once. Does not zero velocity.
 *
 * @param {{position:{x:number,z:number}, velocity:{x:number,z:number}, yaw:number, yawRate?:number, hitWall?:number, ai?:boolean, _envIntersect?:boolean, _envDeep?:boolean}} v
 * @param {{colliders: Array<object>}} track
 */
export function correctEnvPenetration(v, track) {
  const all = track.colliders;
  if (!all || !all.length) {
    v._envIntersect = false;
    v._envDeep = false;
    return;
  }
  const pad = 4.4;
  const list = nearbyColliders(
    track,
    v.position.x - pad,
    v.position.x + pad,
    v.position.z - pad,
    v.position.z + pad
  );
  const farAi = !!(v.lowDetail && v.envCheap);
  const passes = farAi ? 1 : v.ai ? 3 : 6;
  let worst = 0;
  for (let pass = 0; pass < passes; pass++) {
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const rx = fz;
    const rz = -fx;
    const fast = 1;
    worst = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (farAi && c.kind !== "wall") continue;
      if (!colliderHitsCarY(c, v)) continue;
      let hit = null;
      let wall = false;
      if (c.kind === "wall") {
        hit = wallHitAt(c, v.position.x, v.position.z, fx, fz, rx, rz);
        wall = true;
      } else {
        hit = circleVsCarObb(c.x, c.z, c.r || 0.5, v.position.x, v.position.z, fx, fz, rx, rz);
      }
      if (!hit || hit.overlap <= 0.02) continue;
      if (hit.overlap > worst) worst = hit.overlap;
      applyGlance(v, hit.nx, hit.nz, hit.overlap, 1, fx, fz, fast, { wall, vel: pass === 0 });
    }
    if (worst <= 0.12) break;
  }
  v._envIntersect = worst > 0.12;
  v._envDeep = worst > 0.32;
}

/**
 * Off-road runoff — free to leave the ribbon; extreme distance resets you.
 *
 * Sprint 26: the PLAYER must steer. Soft pull and scrub are a COST for leaving
 * the ribbon — never an autopilot that yaws you around the stage on throttle
 * alone. AI keep stronger guide so the pack does not vanish into the trees.
 *
 * Never builds a sliding wall at the edge. Shoulder is a soft bank; deeper
 * runoff costs speed; extreme distance hauls toward the lane without a snap.
 *
 * @param {{position:{x:number,z:number}, velocity:{x:number,z:number}, yaw:number, yawRate?:number, ai?:boolean, hitWall?:number, _rearSlide?:boolean}} v
 * @param {{lateral:number, width:number, nx:number, nz:number, heading:number, tunnel?:boolean, dist?:number}} q
 * @param {{sample:(dist:number, out?:object)=>object}|null} [track]
 * @returns {boolean} true when the car is off the painted ribbon
 */
export function bounceOffRoad(v, q, track = null) {
  const half = q.width * 0.5;
  const lat = q.lateral;
  const over = Math.abs(lat) - half;
  const isPlayer = !v.ai;
  const tunnel = !!q.tunnel;
  const inward = lat > 0 ? -1 : 1;
  const nx = q.nx;
  const nz = q.nz;
  const hx = Math.sin(q.heading);
  const hz = Math.cos(q.heading);

  // Tunnel first — must run while the centre is still on paint. The lining sits
  // ~0.42 m past the ribbon; car OBB (~HALF_WIDTH) hits rock before `over > 0`.
  // The old early `over <= 0` return let chassis punch through the walls.
  if (tunnel) {
    const LINING_INSET = 0.42;
    const extents = chassisLatExtents(v, q);
    const maxLat = half + LINING_INSET - HALF_WIDTH;
    const absLat = extents.maxAbs;
    const inwardObb = extents.worstLat > 0 ? -1 : 1;
    if (absLat > maxLat) {
      const embed = absLat - maxLat;
      v.position.x += nx * inwardObb * embed;
      v.position.z += nz * inwardObb * embed;
      const vn = v.velocity.x * nx + v.velocity.z * nz;
      if (vn * Math.sign(extents.worstLat || 1) > 0) {
        v.velocity.x -= nx * vn;
        v.velocity.z -= nz * vn;
        const keep = Math.abs(vn) * 0.62;
        v.velocity.x += hx * keep;
        v.velocity.z += hz * keep;
      }
      v.hitWall = Math.max(v.hitWall || 0, embed * 1.05 + Math.abs(vn) * 0.5);
      v.hitNx = nx * inwardObb;
      v.hitNz = nz * inwardObb;
      if (v.yawRate != null) {
        const past = nx * inwardObb * hz - nz * inwardObb * hx;
        v.yawRate += past * 0.022;
      }
      return true;
    }
    // Near paint edge inside the bore — light berm, no soft 7 m runoff.
    const edge = Math.max(0, absLat - (half - 0.35));
    if (edge > 0) {
      const t = Math.min(1, edge / 0.35);
      const vn = v.velocity.x * nx + v.velocity.z * nz;
      if (vn * Math.sign(lat || 1) > 0) {
        const kill = vn * (isPlayer ? 0.3 : 0.42) * t;
        v.velocity.x -= nx * kill;
        v.velocity.z -= nz * kill;
        v.velocity.x += nx * inward * Math.abs(vn) * 0.24 * t;
        v.velocity.z += nz * inward * Math.abs(vn) * 0.24 * t;
      }
    }
    return over > 0;
  }

  if (over <= 0) return false;

  const shoulder = OFF_SHOULDER;
  const runoff = OFF_RUNOFF;
  const recover = OFF_RECOVER;
  const resetAt = OFF_RESET;

  // Extreme runoff: haul toward the ribbon. Never snap XZ onto the centre
  // line — that teleported the pack into the tunnel after Desert jump 3.
  if (over > resetAt) {
    v.position.x += nx * inward * Math.min(over - recover, 6) * 0.35;
    v.position.z += nz * inward * Math.min(over - recover, 6) * 0.35;
  }

  // Soft lateral guidance — never zero the along-track component.
  let pull = 0;
  let yawAuth = 0;
  if (over <= shoulder) {
    const t = over / shoulder;
    pull = 1.4 * t;
    yawAuth = 0.18 * t;
    // Soft berm: trim outward speed into along-track scrape — never bounce inward.
    const vn = v.velocity.x * nx + v.velocity.z * nz;
    if (vn * Math.sign(lat || 1) > 0) {
      const kill = vn * (isPlayer ? PLAYER_SHOULDER_OUT : 0.22) * t;
      v.velocity.x -= nx * kill;
      v.velocity.z -= nz * kill;
      const alongNow = v.velocity.x * hx + v.velocity.z * hz;
      if (alongNow > 1) {
        const feed = isPlayer ? PLAYER_SHOULDER_SCRAPE : 0.7;
        v.velocity.x += hx * Math.abs(kill) * feed;
        v.velocity.z += hz * Math.abs(kill) * feed;
      }
    }
  } else if (over <= runoff) {
    const t = (over - shoulder) / Math.max(0.1, runoff - shoulder);
    pull = 2.5 + t * 6;
    yawAuth = 0.45 + t * 1.1;
  } else {
    const t = Math.min(1, (over - runoff) / Math.max(0.1, recover - runoff));
    pull = 8 + t * 16;
    yawAuth = 1.1 + t * 2.2;
    // Creep back — small, continuous, not a single-frame snap wall.
    const creep = Math.min(over - runoff, 5) * (0.04 + t * 0.1);
    v.position.x += nx * inward * creep;
    v.position.z += nz * inward * creep;
  }

  // Bleed a share of outward speed in runoff — keep enough to drive through the verge.
  const vn = v.velocity.x * nx + v.velocity.z * nz;
  if (vn * Math.sign(lat || 1) > 0 && over > shoulder) {
    const killFrac = clamp(
      0.05 + (over - shoulder) * 0.01,
      0.05,
      isPlayer ? PLAYER_OUT_KILL_MAX : 0.48
    );
    v.velocity.x -= nx * vn * killFrac;
    v.velocity.z -= nz * vn * killFrac;
  }

  // Off-road pace cost for the player — light extra drag, never a parking brake.
  if (isPlayer && over > shoulder) {
    const alongSpd = v.velocity.x * hx + v.velocity.z * hz;
    if (alongSpd > 3) {
      const scrub = clamp(
        PLAYER_SCRUB_MIN + (over - shoulder) * 0.00028,
        PLAYER_SCRUB_MIN,
        PLAYER_SCRUB_MAX
      );
      v.velocity.x -= hx * alongSpd * scrub;
      v.velocity.z -= hz * alongSpd * scrub;
    }
    // Still on throttle: hold a usable rally pace through the verge.
    const th = typeof v.throttle === "number" ? v.throttle : 0;
    if (th > 0.08 && alongSpd > 0 && alongSpd < PLAYER_RUNOFF_FLOOR) {
      const lift = (PLAYER_RUNOFF_FLOOR - alongSpd) * (0.05 + th * 0.08);
      v.velocity.x += hx * lift;
      v.velocity.z += hz * lift;
    }
  }

  // Inward nudge. AI also get a free along-track push; the player does not —
  // they must aim the car themselves.
  const guide = pull * (isPlayer ? 0.032 : 0.09);
  v.velocity.x += nx * inward * guide;
  v.velocity.z += nz * inward * guide;
  if (!isPlayer) {
    const along = v.velocity.x * hx + v.velocity.z * hz;
    if (along > 1 && over > shoulder * 0.5) {
      v.velocity.x += hx * guide * 0.25;
      v.velocity.z += hz * guide * 0.25;
    }
    // Parked in the trees: shove back toward the ribbon and along the stage.
    const spd = Math.hypot(v.velocity.x, v.velocity.z);
    if (spd < 4.5 && over > shoulder * 0.35) {
      v.velocity.x += nx * inward * 5.5 + hx * 7;
      v.velocity.z += nz * inward * 5.5 + hz * 7;
    }
  }

  let dh = q.heading - v.yaw;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  if (isPlayer) {
    // Tiny bank feel only when deep in recover — never stage autopilot.
    if (over > runoff) {
      v.yaw += dh * yawAuth * 0.004;
      if (v.yawRate != null) v.yawRate += dh * yawAuth * 0.02;
    }
  } else {
    v.yaw += dh * yawAuth * 0.018;
    if (v.yawRate != null) v.yawRate += dh * yawAuth * 0.1;
    if (Math.hypot(v.velocity.x, v.velocity.z) < 5 && over > shoulder * 0.35) {
      v.yaw += dh * 0.1;
    }
  }

  return true;
}
