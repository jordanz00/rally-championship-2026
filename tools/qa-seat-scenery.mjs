#!/usr/bin/env node
/**
 * QA — land-tile sample + ground-prop filter (no browser).
 */
import * as THREE from "../vendor/three.module.js";
import {
  sampleTileY,
  sampleLandMeshY,
  isGroundProp,
  worldFootY,
} from "../js/tracks/seat-scenery.js";

let failed = 0;
function check(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

const geo = new THREE.PlaneGeometry(10, 10, 2, 2);
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes.position;
for (let i = 0; i < pos.count; i++) pos.setY(i, 4 + pos.getX(i) * 0.2);
const mesh = new THREE.Mesh(geo);
mesh.position.set(20, 0, -8);
mesh.userData.envLand = true;

const mid = sampleTileY(mesh, 20, -8);
check("tile centre is finite", Number.isFinite(mid));
check("tile centre near 4", Math.abs(mid - 4) < 0.05);

const right = sampleTileY(mesh, 24, -8);
check("tile slopes +X", right > mid + 0.5);

check("outside tile is null", sampleTileY(mesh, 80, 0) == null);
check("fallback when miss", sampleLandMeshY([mesh], 80, 0, 1.5) === 1.5);

const tree = {
  userData: { envProp: true },
  geometry: { userData: { propKind: "forest_tree_a" } },
};
check("tree is ground prop", isGroundProp(tree));

const seat = {
  userData: { envProp: true },
  name: "grandstand-seat",
  geometry: { userData: {} },
};
check("seat is not ground-snapped", !isGroundProp(seat));

const skipSeat = {
  userData: { envProp: true, skipSeat: true },
  name: "bleacher-deck",
  geometry: { userData: { propKind: "bleacher-deck" } },
};
check("skipSeat furniture is not ground-snapped", !isGroundProp(skipSeat));

const keepY = {
  userData: { envProp: true, keepY: true },
  name: "stage-gantry-pole-START-L",
  geometry: { userData: { propKind: "gantry-pole" } },
};
check("keepY gantry poles are not ground-snapped", !isGroundProp(keepY));

const midLod = {
  userData: { envProp: true, midDetail: true },
  geometry: { userData: { propKind: "forest_tree_a" } },
};
check("mid lod skipped", !isGroundProp(midLod));
check(
  "unnamed env is not auto nature",
  !isGroundProp({ userData: { envProp: true }, geometry: { userData: {} } })
);

const box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
const mat = new THREE.Matrix4().makeTranslation(0, 3, 0);
check("foot follows translate", Math.abs(worldFootY(box, mat) - 3) < 1e-6);

if (failed) {
  console.error(`Seat scenery QA failed: ${failed}`);
  process.exit(1);
}
console.log("Seat scenery QA passed.");
