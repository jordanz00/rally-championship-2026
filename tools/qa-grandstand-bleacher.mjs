#!/usr/bin/env node
/**
 * QA — start/finish bleacher banks (static).
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

const track = fs.readFileSync(path.join(root, "js/tracks/track.js"), "utf8");
const seat = fs.readFileSync(path.join(root, "js/tracks/seat-scenery.js"), "utf8");

check("bleacher decks authored", /propName: "bleacher-deck"/.test(track) && /ROW_RISE = 0\.5/.test(track));
check("bleacher seats + risers", /bleacher-seat/.test(track) && /bleacher-riser/.test(track));
check("aisle stairs", /AISLE = 1\.15/.test(track) && /Center aisle stairs/.test(track));
check("canopy over rear rows", /bleacher-roof/.test(track) && /canopyPostH/.test(track));
check("people sit on row lift", /sit: true/.test(track) && /seatLift: seatY - 0\.12/.test(track));
check("Kenney VIP stays native-scale box", /s: 0\.85/.test(track) && /backLat/.test(track));
check("no Kenney stretch-to-span", !/STAND_FOOT_M/.test(track) && !/moduleSpan \/ STAND_FOOT/.test(track));
check("raised furniture keeps Y", /keepY: true/.test(track) && /if \(p\.keepY/.test(track));
check("seat pass skips bleachers", /if \(obj\.userData\.skipSeat\) return/.test(seat));
check("bays keep strip radius small", /const BAY = 4\.2/.test(track));

if (failed) {
  console.error(`Grandstand bleacher QA failed: ${failed}`);
  process.exit(1);
}
console.log("Grandstand bleacher QA passed.");
