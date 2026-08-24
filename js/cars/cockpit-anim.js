/**
 * Cockpit motion — procedural mocap-style driver animation (Sprint 36).
 *
 * WHO THIS IS FOR: POV camera + cockpit immersion without external mocap files.
 * WHAT IT DOES: spring-damped steering wheel, gear-shift punch, impact head-nod,
 *   hand countersteer offset — reads like captured motion at chase/POV distance.
 * HOW IT CONNECTS: game.js calls updateCockpitMotion() from the race loop after
 *   updateCockpit() gauge needles.
 */

/**
 * @param {THREE.Object3D} root car root with userData.steerWheel
 * @param {{steer:number, gear:number, dt:number, yawRate?:number, hitWall?:number, slidePct?:number}} state
 */
export function updateCockpitMotion(root, state) {
  if (!root) return;
  const dt = Math.max(0.001, Math.min(0.05, state.dt || 1 / 60));
  const ud = root.userData;
  if (ud._cockpitAnim == null) {
    ud._cockpitAnim = {
      wheelZ: 0,
      wheelVel: 0,
      shiftT: 0,
      headPitch: 0,
      headVel: 0,
      lastGear: state.gear || 1,
    };
  }
  const anim = ud._cockpitAnim;

  const targetWheel = -(state.steer || 0) * 2.85;
  const yawKick = (state.yawRate || 0) * 0.14;
  const slideKick = (state.slidePct || 0) * 0.22 * Math.sign(state.steer || 0);
  const wheelTarget = targetWheel + yawKick + slideKick;
  const wheelK = 28;
  const wheelD = 0.82;
  anim.wheelVel += (wheelTarget - anim.wheelZ) * wheelK * dt;
  anim.wheelVel *= wheelD;
  anim.wheelZ += anim.wheelVel * dt;

  if (state.gear != null && state.gear !== anim.lastGear) {
    anim.shiftT = 1;
    anim.lastGear = state.gear;
  }
  if (anim.shiftT > 0) anim.shiftT = Math.max(0, anim.shiftT - dt * 5.5);

  const hit = state.hitWall || 0;
  if (hit > 0.4) {
    anim.headVel += hit * 2.8 * dt;
  }
  anim.headVel += -anim.headPitch * 42 * dt;
  anim.headVel *= 0.88;
  anim.headPitch += anim.headVel * dt;

  const wheel = ud.steerSpin || ud.steerWheel;
  if (wheel) {
    // Spin group +Z is the steering column (GLB pivot or procedural torus).
    // Never rotateOnAxis with a world-AABB axis — that tumbled the modeled rim.
    wheel.rotation.z = anim.wheelZ;
    if (!ud.glbSteerWheel) {
      wheel.position.y = (ud._wheelBaseY ?? wheel.position.y) + anim.shiftT * 0.018;
      if (ud._wheelBaseY == null) ud._wheelBaseY = wheel.position.y;
    }
  }

  const pov = ud.povRig;
  if (pov && pov.head) {
    pov.head.rotation.x = anim.headPitch * 0.35;
    pov.head.position.z = pov.eyeZ - anim.shiftT * 0.04;
  }
}
