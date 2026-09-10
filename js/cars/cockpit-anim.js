/**
 * Cockpit motion — procedural mocap-style driver animation (Sprint 36).
 *
 * WHO THIS IS FOR: POV camera + cockpit immersion without external mocap files.
 * WHAT IT DOES: spring-damped steering wheel, gear-shift punch, impact head-nod,
 *   hand countersteer offset, and POV driver sleeves that track the rim grips.
 * HOW IT CONNECTS: game.js calls updateCockpitMotion() from the race loop after
 *   updateCockpit() gauge needles.
 */

import * as THREE from "../../vendor/three.module.js";

const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * Stretch a sleeve mesh from shoulder to wrist (cylinder along +Y).
 * @param {THREE.Mesh} sleeve
 * @param {THREE.Object3D} shoulder
 * @param {THREE.Object3D} hand
 * @param {{_tmpA:THREE.Vector3,_tmpB:THREE.Vector3,_tmpC:THREE.Vector3}} scratch
 */
function poseSleeve(sleeve, shoulder, hand, scratch) {
  if (!sleeve || !shoulder || !hand || !sleeve.parent) return;
  shoulder.getWorldPosition(scratch._tmpA);
  hand.getWorldPosition(scratch._tmpB);
  sleeve.parent.worldToLocal(scratch._tmpA);
  sleeve.parent.worldToLocal(scratch._tmpB);
  scratch._tmpC.subVectors(scratch._tmpB, scratch._tmpA);
  const len = scratch._tmpC.length();
  if (len < 0.04) {
    sleeve.visible = false;
    return;
  }
  sleeve.visible = true;
  sleeve.position.copy(scratch._tmpA);
  scratch._tmpC.multiplyScalar(1 / len);
  sleeve.quaternion.setFromUnitVectors(_yAxis, scratch._tmpC);
  // Slight elbow bulge: keep reach short of the palm so the cuff meets the glove.
  const reach = Math.min(0.42, Math.max(0.14, len * 0.9));
  sleeve.scale.set(1, reach, 1);
}

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

  // POV driver arms — gloves ride the rim; sleeves stretch from fixed shoulders.
  const driver = ud.povDriver;
  if (driver && ud._cockpitOn && driver.sleeveL && driver.handL) {
    const gripLean = anim.wheelZ * 0.08;
    if (driver.handL) driver.handL.rotation.y = gripLean;
    if (driver.handR) driver.handR.rotation.y = -gripLean;
    poseSleeve(driver.sleeveL, driver.shoulderL, driver.handL, driver);
    poseSleeve(driver.sleeveR, driver.shoulderR, driver.handR, driver);
  }
}
