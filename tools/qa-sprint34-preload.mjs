/**
 * Sprint 34 — background stage preload gates (instant race when hot).
 *
 * Run: node tools/qa-sprint34-preload.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = fs.readFileSync(path.join(root, "js/game.js"), "utf8");
const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("SPRINT 34 PRELOAD\n");

check(
  "splash defers heavy warm until PRESS START",
  /_startBackgroundWarm\(/.test(game) &&
    /PRESS START/.test(game) &&
    /_leaveTitle/.test(game) &&
    /prefetchPropKit\(\)|preparePropKit\(/.test(game)
);
check(
  "leave title queues championship cup (Desert first)",
  /for \(const id of COURSE_ORDER\)/.test(game) && /_scheduleTrackPreload\(id\)/.test(game)
);
check(
  "multi-course track cache",
  /_trackCache/.test(game) && /_preloadQueue/.test(game) && /_pumpPreloadQueue/.test(game)
);
check(
  "preload uses async Track.create (not sync new Track)",
  /Track\.create\(COURSES\[courseId\]/.test(game) &&
    !/_preloadedTrack = new Track\(COURSES/.test(game)
);
check(
  "race joins in-flight preload",
  /_awaitTrackPreload\(/.test(game) && /Finishing background stage/.test(game)
);
check(
  "hot cache still GPU-settles before countdown",
  /_settleRacePresent/.test(game) &&
    /Warming shaders/.test(game) &&
    /showLoadingScreen/.test(game) &&
    /Lighting stage/.test(game)
);
check(
  "HTTP music prefetch on title",
  /_prefetchStageBytes\(/.test(game) && /desert\.mp3\?v=4/.test(game)
);
check(
  "course buttons warm on hover (priority)",
  /pointerenter/.test(game) && /priority:\s*true/.test(game)
);
check(
  "leave title continues Desert warm",
  /_leaveTitle[\s\S]*_scheduleTrackPreload\(this\.courseId \|\| "desert"/.test(game)
);
check(
  "halfway checkpoint preloads next stage",
  /_maybePreloadNextStageAtHalfway/.test(game) && /_armNextStagePreload/.test(game)
);
check(
  "preload pumps during race",
  /this\.state === "race"/.test(game) && /_pumpPreloadQueue/.test(game)
);
check(
  "lakeside unlock schedules preload",
  /_pendingNextCourse = "lakeside"[\s\S]*_scheduleTrackPreload\("lakeside"/.test(game)
);
const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust chain", cacheOk, `v=${gameV}`);
check(
  "music prefetch present",
  /prefetch[^>]+desert\.mp3/.test(index)
);

console.log(failed ? `\nFAIL  ·  ${failed} check(s)` : "\nPASS  ·  all checks");
process.exit(failed ? 1 : 0);
