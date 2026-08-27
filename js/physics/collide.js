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
 * Fallback lining thickness (m) for a wall collider built without an explicit
 * `depth`. A wall face is a slab with a back, not an infinite half-space — see
 * the wall branch of glanceObstacles.
 */
const WALL_BACK = 2;
const SEPARATE = 0.72;
const YAW_NUDGE = 0.01;
/** AI-AI: soft separate — hard restitution + high friction was welding the pack. */
const AI_RESTITUTION = 0.02;
const AI_SEPARATE = 0.55;
/** Extra sideways shove (m) so the trailing rival slides past instead of stacking. */
const AI_PASS_LATERAL = 0.55;
/** Minimum along-track speed (m/s) restored on the trailing AI after a rub. */
const AI_PASS_MIN_SPD = 9;
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
/** Player shoulder: soft berm — bleed outward speed, do not kill forward momentum. */
const PLAYER_SHOULDER_OUT = 0.14;
const PLAYER_SHOULDER_BOUNCE = 0.2;
/** Player runoff: light pace cost only (was up to 28%/frame — felt like a wall). */
const PLAYER_SCRUB_MIN = 0.012;
const PLAYER_SCRUB_MAX = 0.048;
const PLAYER_OUT_KILL_MAX = 0.22;
/** Keep rolling through runoff when the player is still on throttle. */
const PLAYER_RUNOFF_FLOOR = 5.5;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
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
  const push = hit.overlap * (aiPack ? AI_SEPARATE : SEPARATE);

  a.position.x -= nx * push * (invA / tot);
  a.position.z -= nz * push * (invA / tot);
  b.position.x += nx * push * (invB / tot);
  b.position.z += nz * push * (invB / tot);

  const rvx = b.velocity.x - a.velocity.x;
  const rvz = b.velocity.z - a.velocity.z;
  const relN = rvx * nx + rvz * nz;
  if (relN < 0) {
    const bounce = aiPack ? AI_RESTITUTION : RESTITUTION;
    const jn = (-(1 + bounce) * relN) / tot;
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
  const grip = aiPack ? FRICTION * 1.6 : FRICTION * 4;
  const jt = clamp(-relT / tot, -grip, grip);
  a.velocity.x -= jt * tx * invA;
  a.velocity.z -= jt * tz * invA;
  b.velocity.x += jt * tx * invB;
  b.velocity.z += jt * tz * invB;

  if (aiPack) {
    // Trailing car gets a lateral shove + speed restore so packs do not log-jam.
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
    rear.position.x += frx * side * AI_PASS_LATERAL;
    rear.position.z += frz * side * AI_PASS_LATERAL;
    const keep = Math.max(
      AI_PASS_MIN_SPD,
      Math.hypot(rear.velocity.x, rear.velocity.z) * 0.92,
      Math.hypot(front.velocity.x, front.velocity.z) * 0.88
    );
    rear.velocity.x = ffx * keep + frx * side * 1.8;
    rear.velocity.z = ffz * keep + frz * side * 1.8;
    rear._aiPassSide = side;
    rear._aiPassT = 0.85;
    a.yawRate = (a.yawRate || 0) * 0.85;
    b.yawRate = (b.yawRate || 0) * 0.85;
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
  rival.position.x += prx * side * PLAYER_RIVAL_SIDESTEP;
  rival.position.z += prz * side * PLAYER_RIVAL_SIDESTEP;
  const rfx = Math.sin(rival.yaw);
  const rfz = Math.cos(rival.yaw);
  const rAlong = Math.max(8, rival.velocity.x * rfx + rival.velocity.z * rfz);
  rival.velocity.x = rfx * rAlong + prx * side * 1.4;
  rival.velocity.z = rfz * rAlong + prz * side * 1.4;
  rival._aiPassSide = side;
  rival._aiPassT = 0.7;

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
 * Kill speed into a hit normal, keep some along-track roll. Shared by sphere
 * rocks and planar tunnel walls.
 * @param {{position:{x:number,z:number}, velocity:{x:number,z:number}, yawRate?:number, hitWall?:number, ai?:boolean}} v
 * @param {number} nx
 * @param {number} nz
 * @param {number} overlap
 * @param {number} pass
 * @param {number} fx
 * @param {number} fz
 * @param {number} fast
 */
function applyGlance(v, nx, nz, overlap, pass, fx, fz, fast) {
  // Full separation — opaque environment must not be penetrable. Capped:
  // depenetration is a nudge out of a solid, so it can never exceed a car
  // length. Without this, any collider that reports a bad overlap becomes a
  // teleport (a tunnel wall face flung the car 573 m off Desert after jump 3).
  const push = Math.min(overlap, MAX_PUSH) * (pass === 0 ? 1.05 : 1.01);
  v.position.x += nx * push;
  v.position.z += nz * push;
  const vn = v.velocity.x * nx + v.velocity.z * nz;
  if (vn < 0) {
    v.velocity.x -= vn * nx;
    v.velocity.z -= vn * nz;
    const scrub = v.ai ? (pass === 0 ? 0.05 : 0.02) : pass === 0 ? 0.08 : 0.04;
    v.velocity.x *= 1 - scrub;
    v.velocity.z *= 1 - scrub;
    const along = v.velocity.x * fx + v.velocity.z * fz;
    const spd = Math.hypot(v.velocity.x, v.velocity.z);
    const keep = Math.max(along, spd * (v.ai ? 0.62 : 0.55), v.ai ? 6 : 4);
    const blend = v.ai ? 0.72 : 0.38;
    v.velocity.x = v.velocity.x * (1 - blend) + fx * keep * blend;
    v.velocity.z = v.velocity.z * (1 - blend) + fz * keep * blend;
    v.hitWall = Math.max(v.hitWall || 0, Math.abs(vn) * 0.65 + push * 0.45);
    v.hitNx = nx;
    v.hitNz = nz;
    if (v.ai && keep < 7) {
      v.velocity.x += fx * 4.5;
      v.velocity.z += fz * 4.5;
    }
  }
  if (v.yawRate != null) {
    const past = nx * fz - nz * fx;
    v.yawRate += past * 0.04 * fast;
  }
}

/**
 * Glance off trees, rocks, houses — never embed through opaque solids.
 * Tunnel / underpass sides are planar slabs (`kind: "wall"`) so the hit
 * matches the visible inner face instead of a sphere sitting in the rock.
 *
 * Sprint 26c: full depenetration (was 0.55× and let cars tunnel through rock /
 * berms at speed). Still AM3-friendly: kill inward speed, scrub a little, roll
 * past — no crash-out, no wall-skating lock.
 *
 * @param {{position:{x:number,z:number}, velocity:{x:number,z:number}, yaw:number, speed:number, yawRate?:number, hitWall?:number}} v
 * @param {{colliders: Array<{x:number,z:number,r?:number,kind?:string,nx?:number,nz?:number,tx?:number,tz?:number,halfLen?:number}>}} track
 */
export function glanceObstacles(v, track) {
  const list = track.colliders;
  if (!list || !list.length) return;
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  const rx = fz;
  const rz = -fx;
  const fast = 1 / (1 + Math.max(0, v.speed || 0) * 0.045);
  // Two passes so a fast frame that sinks deep still ends outside the solid.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.kind === "wall") {
        const nx = c.nx;
        const nz = c.nz;
        const dx = v.position.x - c.x;
        const dz = v.position.z - c.z;
        const along = dx * c.tx + dz * c.tz;
        if (along > c.halfLen + HALF_LENGTH || along < -c.halfLen - HALF_LENGTH) continue;
        // Car OBB extent along the wall normal — body side, not the enclosing
        // circle, so a parallel scrape meets the visible lining.
        const ext =
          HALF_LENGTH * Math.abs(fx * nx + fz * nz) + HALF_WIDTH * Math.abs(rx * nx + rz * nz);
        const dist = dx * nx + dz * nz;
        const overlap = ext - dist;
        if (overlap <= 0) continue;
        // `dist` is unbounded below, so this face is only a *slab* if we say
        // so. `along` limits the wall's length but nothing limited its depth:
        // a car merely behind the lining — off-course, or on the far side of a
        // tunnel whose arm curves back over its own approach — computed
        // overlap = ext + (hundreds of metres) and was flung exactly that far
        // along the normal in one step. On Desert that strip crosses the
        // jump-3 landing, which is the teleport-into-the-tunnel bug.
        //
        // The bound is the lining's real thickness plus the chassis extent, so
        // a car genuinely buried in the rock is still pushed out (a blanket
        // 2 m let it tunnel clean through a 5.2 m portal pier) while one that
        // is simply somewhere else in the world is ignored.
        if (dist < -((c.depth || WALL_BACK) + ext)) continue;
        applyGlance(v, nx, nz, overlap, pass, fx, fz, fast);
        continue;
      }
      const dx = v.position.x - c.x;
      const dz = v.position.z - c.z;
      const d = Math.hypot(dx, dz) || 0.0001;
      const min = CAR_RADIUS + c.r;
      const overlap = min - d;
      if (overlap <= 0) continue;
      const nx = dx / d;
      const nz = dz / d;
      applyGlance(v, nx, nz, overlap, pass, fx, fz, fast);
    }
  }
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
  if (over <= 0) return false;

  const isPlayer = !v.ai;
  const tunnel = !!q.tunnel;
  const shoulder = tunnel ? 0.45 : OFF_SHOULDER;
  const runoff = tunnel ? 2.2 : OFF_RUNOFF;
  const recover = tunnel ? 4.5 : OFF_RECOVER;
  const resetAt = tunnel ? 7 : OFF_RESET;

  const inward = lat > 0 ? -1 : 1;
  const nx = q.nx;
  const nz = q.nz;
  const hx = Math.sin(q.heading);
  const hz = Math.cos(q.heading);

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
    // Soft berm: trim outward speed and bounce lightly inward — never a full stop.
    const vn = v.velocity.x * nx + v.velocity.z * nz;
    if (vn * Math.sign(lat || 1) > 0) {
      const kill = vn * (isPlayer ? PLAYER_SHOULDER_OUT : 0.22) * t;
      v.velocity.x -= nx * kill;
      v.velocity.z -= nz * kill;
      if (isPlayer) {
        v.velocity.x += nx * inward * Math.abs(vn) * PLAYER_SHOULDER_BOUNCE * t;
        v.velocity.z += nz * inward * Math.abs(vn) * PLAYER_SHOULDER_BOUNCE * t;
      } else if (v.velocity.x * hx + v.velocity.z * hz > 0) {
        v.velocity.x += hx * Math.abs(kill) * 0.7;
        v.velocity.z += hz * Math.abs(kill) * 0.7;
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

  // Off-road pace cost for the player — slight scrub deep in runoff only.
  if (isPlayer && over > shoulder) {
    const alongSpd = v.velocity.x * hx + v.velocity.z * hz;
    if (alongSpd > 3) {
      const scrub = clamp(
        PLAYER_SCRUB_MIN + (over - shoulder) * 0.004,
        PLAYER_SCRUB_MIN,
        PLAYER_SCRUB_MAX
      );
      v.velocity.x -= hx * alongSpd * scrub;
      v.velocity.z -= hz * alongSpd * scrub;
    }
    // Still on throttle: do not bleed to a dead stop in the runoff.
    const th = typeof v.throttle === "number" ? v.throttle : 0;
    if (th > 0.08 && alongSpd > 0 && alongSpd < PLAYER_RUNOFF_FLOOR) {
      const lift = (PLAYER_RUNOFF_FLOOR - alongSpd) * (0.25 + th * 0.35);
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
