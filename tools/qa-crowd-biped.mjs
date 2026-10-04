#!/usr/bin/env node
/**
 * QA — biped fan plant + sit + T-pose hang (static).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
function check(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

const crowd = fs.readFileSync(path.join(root, "js/tracks/crowd.js"), "utf8");
const track = fs.readFileSync(path.join(root, "js/tracks/track.js"), "utf8");
const kit = fs.readFileSync(path.join(root, "js/tracks/prop-kit.js"), "utf8");

check("crowd replants after land seat", /replant\(landFn\)/.test(crowd));
check("crowd sit squat", /const sit = !!p\.sit/.test(crowd) && /0\.52 \+ cheer/.test(crowd));
check("track stores seatLift", /seatLift: opts\.seatLift/.test(track));
check("grandstand marks sit", /sit: true/.test(track) && /seatLift: seatY/.test(track));
check("verge uses visual land", /_visualLandY\(x, z\)/.test(track));
check("seat pass replants crowd", /_crowd\.replant/.test(track));
check("authored arms hang if T-pose", /armLooksTPose\(armLGeo/.test(kit) && /orientArmDownFromTPose\(armLGeo/.test(kit));
check("split still hangs T-pose", /orientArmDownFromTPose\(armL, -1\)/.test(kit));

const chars = fs.readdirSync(path.join(root, "assets/props")).filter((f) => /^character-.*\.glb$/i.test(f));
check("12 character GLBs on disk", chars.length >= 12);

if (failed) {
  console.error(`Crowd biped QA failed: ${failed}`);
  process.exit(1);
}
console.log("Crowd biped QA passed.");
