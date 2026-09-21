/**
 * Cockpit motion — procedural mocap-style driver animation (Sprint 36).
 *
 * WHO THIS IS FOR: POV camera + cockpit immersion without external mocap files.
 * WHAT IT DOES: spring-damped steering wheel, gear-shift punch, impact head-nod,
 *   hand countersteer offset, and two-bone POV arms tracking gloved wrists.
 * HOW IT CONNECTS: game.js calls updateCockpitMotion() from the race loop after
 *   updateCockpit() gauge needles.
 */

import * as THREE from "../../vendor/three.module.js";

const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * Two-bone IK: shoulder → elbow → wrist. Elbow bends slightly toward the lap.
 * @param {object} driver
 * @param {"L"|"R"} side
 */
function poseArm(driver, side) {
  const shoulder = side === "L" ? driver.shoulderL : driver.shoulderR;
  const elbow = side === "L" ? driver.elbowL : driver.elbowR;
  const upper = side === "L" ? driver.sleeveL : driver.sleeveR;
  const forearm = side === "L" ? driver.forearmL : driver.forearmR;
  const hand = side === "L" ? driver.handL : driver.handR;
  const wristNode = side === "L" ? driver.wristL : driver.wristR;
  if (!shoulder || !hand || !upper || !elbow || !forearm) return;

  const shW = driver._tmpA;
  const wrW = driver._tmpB;
  const elW = driver._tmpC;
  const dir = driver._tmpD;
  const yAxis = driver._yAxis || _yAxis;

  shoulder.getWorldPosition(shW);
  (wristNode || hand).getWorldPosition(wrW);

  // Elbow mid-reach, dropped toward the lap / cabin center.
  elW.lerpVectors(shW, wrW, 0.48);
  elW.y -= 0.075;
  elW.x += (side === "L" ? -0.045 : 0.045);
  elW.z -= 0.025;

  // Upper arm: child of shoulder — local aim shoulder→elbow.
  const elLocal = dir;
  elLocal.copy(elW);
  shoulder.worldToLocal(elLocal);
  const upLen = elLocal.length();
  if (upLen < 0.04) {
    upper.visible = false;
  } else {
    upper.visible = true;
    upper.position.set(0, 0, 0);
    elLocal.multiplyScalar(1 / upLen);
    upper.quaternion.setFromUnitVectors(yAxis, elLocal);
    upper.scale.set(1, Math.min(0.34, upLen), 1);
  }

  // Elbow marker in cabin (shoulders group).
  if (elbow.parent) {
    const p = dir;
    p.copy(elW);
    elbow.parent.worldToLocal(p);
    elbow.position.copy(p);
  }

  // Forearm: child of elbow — local aim elbow→wrist.
  const wrLocal = dir;
  wrLocal.copy(wrW);
  elbow.worldToLocal(wrLocal);
  const lowLen = wrLocal.length();
  if (lowLen < 0.03) {
    forearm.visible = false;
  } else {
    forearm.visible = true;
    forearm.position.set(0, 0, 0);
    wrLocal.multiplyScalar(1 / lowLen);
    forearm.quaternion.setFromUnitVectors(yAxis, wrLocal);
    forearm.scale.set(1, Math.min(0.4, lowLen * 0.96), 1);
  }
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

  // POV driver — gloves ride the rim; two-bone sleeves track wrists.
  const driver = ud.povDriver;
  if (driver && ud._cockpitOn && driver.handL) {
    const gripLean = anim.wheelZ * 0.08;
    if (driver.handL) driver.handL.rotation.y = gripLean;
    if (driver.handR) driver.handR.rotation.y = -gripLean;
    if (driver.elbowL && driver.forearmL) {
      poseArm(driver, "L");
      poseArm(driver, "R");
    } else if (driver.sleeveL) {
      // Legacy single-cylinder sleeves.
      poseLegacySleeve(driver.sleeveL, driver.shoulderL, driver.handL, driver);
      poseLegacySleeve(driver.sleeveR, driver.shoulderR, driver.handR, driver);
    }
  }
}

/**
 * @param {THREE.Mesh} sleeve
 * @param {THREE.Object3D} shoulder
 * @param {THREE.Object3D} hand
 * @param {object} scratch
 */
function poseLegacySleeve(sleeve, shoulder, hand, scratch) {
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
  const reach = Math.min(0.42, Math.max(0.14, len * 0.9));
  sleeve.scale.set(1, reach, 1);
}
