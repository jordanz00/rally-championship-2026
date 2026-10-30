#!/usr/bin/env node
/**
 * vehicle-dynamics-report.mjs — run the maneuver matrix and dump JSON.
 *
 * RUN: node tools/vehicle-dynamics-report.mjs [out.json]
 * (re-execs itself with the ?v= stripping loader, like the other headless tools)
 */
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "qa-strip-query-loader.mjs")), pathToFileURL(here + "/"));
process.on("unhandledRejection", () => {});
const { collect } = await import("./lib/vehicle-metrics.mjs");
const M = collect({ log: (m) => process.stderr.write(`  ${m}\n`) });
const out = process.argv[2];
const json = JSON.stringify(M, null, 1);
if (out) fs.writeFileSync(out, json);
else console.log(json);
process.exit(0);
