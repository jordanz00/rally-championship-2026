#!/usr/bin/env node
/**
 * qa-static-audit.mjs — zero-dependency static audit for the rally build.
 *
 * WHO THIS IS FOR: anyone about to hand this build to a player, and CI.
 * WHAT IT DOES: checks the classes of defect that have actually broken this
 *   project before — syntax errors, import paths that point at nothing,
 *   `?v=` cache-bust versions that drift out of sync, remote CDN assets,
 *   unsafe DOM sinks, hardcoded secrets, `getElementById` typos that
 *   silently kill a menu, and localStorage reads that coerce a missing key
 *   into 0 (which is how the game once shipped permanently muted).
 * HOW IT CONNECTS: reads the repo from disk only. Never edits, never
 *   launches a browser, never needs `npm install`.
 *
 * RUN: node tools/qa-static-audit.mjs
 * EXIT: 0 = no FAILs. 1 = at least one FAIL. Warnings never fail the build.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(ROOT, "index.html");

/** Directories that hold our own source. `vendor/` is third-party and exempt from style checks. */
const SOURCE_DIRS = ["js"];
const ALL_JS_DIRS = ["js", "vendor"];

const findings = { fail: [], warn: [], pass: [] };
const rel = (p) => path.relative(ROOT, p) || path.basename(p);

function fail(check, message, where) {
  findings.fail.push({ check, message, where });
}
function warn(check, message, where) {
  findings.warn.push({ check, message, where });
}
function pass(check, message) {
  findings.pass.push({ check, message });
}

/* ------------------------------------------------------------------ */
/* File collection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Recursively list files under a directory.
 * @param {string} dir absolute path
 * @param {(f:string)=>boolean} [filter]
 * @returns {string[]} absolute paths
 */
function walk(dir, filter = () => true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const isJs = (f) => f.endsWith(".js") || f.endsWith(".mjs");
const sourceJs = SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d), isJs)).sort();
const allJs = ALL_JS_DIRS.flatMap((d) => walk(path.join(ROOT, d), isJs)).sort();

/** Cache of file text so we read each file once. */
const textCache = new Map();
function read(file) {
  if (!textCache.has(file)) {
    try {
      textCache.set(file, fs.readFileSync(file, "utf8"));
    } catch {
      textCache.set(file, "");
    }
  }
  return textCache.get(file);
}

/**
 * Turn a character offset into a 1-based line number for readable reports.
 * @param {string} text
 * @param {number} index
 */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** Strip // and /* *\/ comments so we do not report on commented-out code. */
function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | line | block | single | double | tick
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "tick";
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; } else out += " ";
      i++; continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") { mode = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " ";
      i++; continue;
    }
    // inside a string literal: copy verbatim, honour escapes
    if (c === "\\") { out += c + (n ?? ""); i += 2; continue; }
    if ((mode === "single" && c === "'") || (mode === "double" && c === '"') || (mode === "tick" && c === "`")) {
      mode = "code";
    }
    out += c; i++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. Syntax check every .js                                           */
/* ------------------------------------------------------------------ */

/**
 * Syntax-check every JS file *as an ES module*.
 *
 * `node --check some.js` does NOT do this. Node treats a bare `.js` file as a
 * script for the purposes of --check, and it will happily exit 0 on a file with
 * an unbalanced brace inside an arrow-function callback — verified against
 * js/gfx/pbr.js, which Chrome rejects outright. Copying each file to a temp
 * `.mjs` forces the module parse goal and makes the check honest.
 */
function checkSyntax() {
  let bad = 0;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rally-syntax-"));
  try {
    for (const file of allJs) {
      const probe = path.join(tmpDir, "probe.mjs");
      try {
        fs.writeFileSync(probe, read(file));
        execFileSync(process.execPath, ["--check", probe], { stdio: "pipe" });
      } catch (err) {
        bad++;
        const raw = String(err.stderr || err.message);
        // Node reports the temp path and the offending line; keep both, retarget the path.
        const lineNo = /probe\.mjs:(\d+)/.exec(raw)?.[1];
        const reason = /(SyntaxError:.*)/.exec(raw)?.[1] || raw.split("\n")[0];
        fail("syntax", `${reason} — this file cannot be parsed as an ES module, so every module that imports it fails to load`, `${rel(file)}${lineNo ? `:${lineNo}` : ""}`);
      }
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (!bad) pass("syntax", `${allJs.length} JS files parse cleanly as ES modules`);
}

/* ------------------------------------------------------------------ */
/* 2 + 3. Import resolution and ?v= version consistency                */
/* ------------------------------------------------------------------ */

/**
 * Import specifiers. These are anchored to the start of a line on purpose:
 * an unanchored /from ["']/ also matches prose inside vendor string literals
 * (three.module.js contains the text `from "srgb-linear"` in an error message),
 * which produced false failures.
 */
const IMPORT_RES = [
  /^[ \t]*(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']/gm, // named / default / re-export
  /^[ \t]*import\s+["']([^"']+)["']/gm, // side-effect import
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import
];

/**
 * Collected edges: importer -> { spec, version, resolved }
 * @type {{importer:string, spec:string, version:string|null, resolved:string|null, line:number}[]}
 */
const edges = [];

function collectImports() {
  for (const file of allJs) {
    const src = stripComments(read(file));
    const seenAt = new Set();
    const matches = IMPORT_RES.flatMap((re) => [...src.matchAll(re)]);
    for (const m of matches) {
      if (seenAt.has(m.index)) continue;
      seenAt.add(m.index);
      const spec = m[1];
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        // bare specifier — no bundler here, so this cannot resolve in a browser
        if (/^https?:/.test(spec)) continue; // handled by the remote-asset check
        // Phase R: importmap maps "three" → vendor/three.module.js | three.webgpu.js
        if (spec === "three") {
          const mapped = path.join(ROOT, "vendor", "three.module.js");
          const mappedGpu = path.join(ROOT, "vendor", "three.webgpu.js");
          if (fs.existsSync(mapped) && fs.existsSync(mappedGpu)) {
            edges.push({
              importer: file,
              spec,
              version: null,
              resolved: mapped,
              line: lineAt(src, m.index),
              importmapped: true,
            });
            continue;
          }
        }
        edges.push({ importer: file, spec, version: null, resolved: null, line: lineAt(src, m.index) });
        continue;
      }
      const [bare, query = ""] = spec.split("?");
      const version = /(?:^|&)v=([^&]*)/.exec(query)?.[1] ?? null;
      const resolved = path.resolve(path.dirname(file), bare);
      edges.push({ importer: file, spec, version, resolved, line: lineAt(src, m.index) });
    }
  }
}

function checkImportsResolve() {
  let bad = 0;
  for (const e of edges) {
    if (!e.resolved) {
      bad++;
      fail("imports", `bare specifier "${e.spec}" cannot resolve in a browser (no build step)`, `${rel(e.importer)}:${e.line}`);
      continue;
    }
    if (!fs.existsSync(e.resolved)) {
      bad++;
      fail("imports", `import "${e.spec}" resolves to a missing file (${rel(e.resolved)})`, `${rel(e.importer)}:${e.line}`);
    }
  }
  if (!bad) pass("imports", `${edges.length} import specifiers all resolve on disk`);
}

/** Also verify what index.html loads. */
function checkHtmlAssets() {
  const html = read(INDEX);
  if (!html) {
    fail("html", "index.html is missing or unreadable", "index.html");
    return [];
  }
  const refs = [];
  const attrRe = /<(script|link)\b[^>]*?(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(attrRe)) {
    const tag = m[1].toLowerCase();
    const url = m[2];
    if (/^(https?:)?\/\//.test(url) || url.startsWith("data:")) continue; // remote check handles these
    if (tag === "link" && !/stylesheet/i.test(m[0])) continue;
    const [bare, query = ""] = url.split("?");
    const version = /(?:^|&)v=([^&]*)/.exec(query)?.[1] ?? null;
    const resolved = path.resolve(ROOT, bare.replace(/^\//, ""));
    refs.push({ url, resolved, version, line: lineAt(html, m.index) });
    if (!fs.existsSync(resolved)) {
      fail("html", `index.html references a missing file: ${url}`, `index.html:${lineAt(html, m.index)}`);
    }
  }
  return refs;
}

/**
 * A file may be imported from several places. If two importers disagree about
 * `?v=`, the browser fetches and caches the module twice — which in an ES-module
 * graph means two separate module instances with two separate module-level states.
 * That has bitten this project, so it is a FAIL, not a warning.
 */
function checkVersionConsistency(htmlRefs) {
  /** @type {Map<string, Map<string, string[]>>} resolved -> version -> where[] */
  const byFile = new Map();
  const note = (resolved, version, where) => {
    if (!resolved || version == null) return;
    if (!byFile.has(resolved)) byFile.set(resolved, new Map());
    const vs = byFile.get(resolved);
    if (!vs.has(version)) vs.set(version, []);
    vs.get(version).push(where);
  };

  for (const e of edges) note(e.resolved, e.version, `${rel(e.importer)}:${e.line}`);
  for (const r of htmlRefs) note(r.resolved, r.version, `index.html:${r.line}`);

  // Every first-party JS import in this project carries a ?v= cache-buster, and
  // index.html pins main.js and the stylesheet the same way. An import that
  // omits it is a hole in that scheme: the browser will happily serve that one
  // module from cache forever while its siblings update around it.
  // vendor/ is excluded — it is pinned third-party code that never changes, and
  // it consistently uses no version, so flagging it would be pure noise.
  const inVendor = (p) => path.relative(ROOT, p).split(path.sep)[0] === "vendor";
  const unversioned = edges.filter(
    (e) =>
      e.resolved &&
      e.version == null &&
      /\.(js|mjs)$/.test(e.resolved) &&
      !inVendor(e.resolved) &&
      !inVendor(e.importer)
  );
  if (unversioned.length) {
    for (const e of unversioned) {
      warn(
        "versions",
        `import "${e.spec}" has no ?v= cache-buster while every other module import here does — this module can be served stale from cache indefinitely`,
        `${rel(e.importer)}:${e.line}`
      );
    }
  } else {
    pass("versions", "every relative module import carries a ?v= cache-buster");
  }

  let conflicts = 0;
  for (const [file, versions] of byFile) {
    if (versions.size <= 1) continue;
    conflicts++;
    const detail = [...versions.entries()]
      .map(([v, wheres]) => `v=${v} (${wheres.join(", ")})`)
      .join("  vs  ");
    fail("versions", `${rel(file)} is imported under ${versions.size} different versions — the browser will load it twice: ${detail}`, rel(file));
  }
  if (!conflicts) pass("versions", `${byFile.size} versioned files each use one consistent ?v=`);

  // Staleness heuristic: bumping a `?v=` requires editing the importer. So if a
  // module was modified more recently than every file that imports it, nobody
  // bumped its version for the latest edit and returning players get stale JS.
  let stale = 0;
  for (const [file, versions] of byFile) {
    let mtime;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    const wheres = [...versions.values()].flat();
    let newestImporter = 0;
    let newestName = "";
    for (const w of wheres) {
      const importerFile = path.join(ROOT, w.split(":")[0]);
      try {
        const t = fs.statSync(importerFile).mtimeMs;
        if (t > newestImporter) { newestImporter = t; newestName = w.split(":")[0]; }
      } catch { /* ignore */ }
    }
    // 2s slack: editors touch importer and importee in the same save burst.
    if (newestImporter && mtime > newestImporter + 2000) {
      stale++;
      const ageMin = ((mtime - newestImporter) / 60000).toFixed(1);
      warn(
        "versions",
        `${rel(file)} was modified ${ageMin} min after its newest importer (${newestName}) — its ?v= was probably not bumped, so cached browsers keep old code`,
        rel(file)
      );
    }
  }
  if (!stale) pass("versions", "no module looks newer than the file that versions it");
}

/* ------------------------------------------------------------------ */
/* 4. No remote / CDN assets                                           */
/* ------------------------------------------------------------------ */

function checkNoRemoteAssets() {
  let bad = 0;
  const html = read(INDEX);

  // Executable or render-blocking remote refs in HTML.
  const tagRe = /<(script|link|img|audio|video|source|iframe)\b[^>]*?(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(tagRe)) {
    bad++;
    fail("remote", `<${m[1].toLowerCase()}> loads a remote URL: ${m[2]}`, `index.html:${lineAt(html, m.index)}`);
  }

  // Remote imports / fetches / asset URLs in JS.
  for (const file of allJs) {
    const src = stripComments(read(file));
    const re = /["'`](https?:\/\/[^"'`\s]+)["'`]/g;
    for (const m of src.matchAll(re)) {
      const url = m[1];
      const before = src.slice(Math.max(0, m.index - 90), m.index);
      const isLoad = /\b(?:import|fetch|load|src|href|url|open|new\s+Audio|new\s+Image|XMLHttpRequest)\b[^\n]*$/i.test(before);
      if (!isLoad) continue;
      bad++;
      fail("remote", `remote URL used as an asset/endpoint: ${url}`, `${rel(file)}:${lineAt(src, m.index)}`);
    }
  }

  // Remote url() in CSS.
  for (const file of walk(path.join(ROOT, "css"), (f) => f.endsWith(".css"))) {
    const src = read(file);
    for (const m of src.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^"')]+)/gi)) {
      bad++;
      fail("remote", `CSS loads a remote asset: ${m[1]}`, `${rel(file)}:${lineAt(src, m.index)}`);
    }
  }

  if (!bad) pass("remote", "no remote script/style/asset URLs — build is fully local");
}

/* ------------------------------------------------------------------ */
/* 5. Unsafe DOM sinks                                                 */
/* ------------------------------------------------------------------ */

function checkUnsafeDom() {
  let bad = 0;
  for (const file of sourceJs) {
    const src = stripComments(read(file));
    for (const m of src.matchAll(/\.(inner|outer)HTML\s*=\s*([^;\n]+)/g)) {
      const rhs = m[2].trim();
      // A bare empty-string clear is a lint smell but not an injection vector.
      const isStaticLiteral = /^(?:""|''|``)\s*$/.test(rhs);
      if (isStaticLiteral) {
        warn("dom", `${m[1]}HTML = "" — prefer removeChild loop (project rule)`, `${rel(file)}:${lineAt(src, m.index)}`);
        continue;
      }
      bad++;
      fail("dom", `${m[1]}HTML assigned a dynamic value: ${rhs.slice(0, 60)}`, `${rel(file)}:${lineAt(src, m.index)}`);
    }
    for (const m of src.matchAll(/\b(?:eval|new\s+Function)\s*\(/g)) {
      bad++;
      fail("dom", `dynamic code execution via ${m[0].replace(/\s*\($/, "")}`, `${rel(file)}:${lineAt(src, m.index)}`);
    }
    for (const m of src.matchAll(/\binsertAdjacentHTML\s*\(/g)) {
      bad++;
      fail("dom", "insertAdjacentHTML parses markup — use createElement/textContent", `${rel(file)}:${lineAt(src, m.index)}`);
    }
  }
  // Inline event handler attributes in HTML.
  const html = read(INDEX);
  for (const m of html.matchAll(/<[a-z][^>]*\son(?:click|load|error|input|change|mouse\w+|key\w+)\s*=/gi)) {
    warn("dom", "inline on* handler attribute in HTML — calls into a possibly unconstructed game object", `index.html:${lineAt(html, m.index)}`);
  }
  if (!bad) pass("dom", "no dynamic innerHTML/outerHTML, eval, or insertAdjacentHTML in js/");
}

/* ------------------------------------------------------------------ */
/* 6. Hardcoded secrets                                               */
/* ------------------------------------------------------------------ */

function checkSecrets() {
  let bad = 0;
  const secretRe =
    /\b(api[_-]?key|apikey|secret|password|passwd|access[_-]?token|auth[_-]?token|bearer|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["'`]([^"'`\n]{6,})["'`]/gi;
  const files = [...allJs, INDEX, ...walk(path.join(ROOT, "css"), (f) => f.endsWith(".css"))];
  for (const file of files) {
    const src = read(file);
    for (const m of src.matchAll(secretRe)) {
      const value = m[2];
      // Obvious non-secrets: placeholders and env lookups.
      if (/^(?:\$\{|process\.env|<|your[_-]|xxx|todo|none|null)/i.test(value)) continue;
      bad++;
      fail("secrets", `possible hardcoded credential (${m[1]})`, `${rel(file)}:${lineAt(src, m.index)}`);
    }
  }
  if (!bad) pass("secrets", "no hardcoded credentials found");
}

/* ------------------------------------------------------------------ */
/* 7. Every DOM id referenced from JS exists in index.html             */
/* ------------------------------------------------------------------ */

function collectHtmlIds() {
  const html = read(INDEX);
  const ids = new Set();
  for (const m of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) ids.add(m[1]);
  return ids;
}

function checkDomIds() {
  const ids = collectHtmlIds();
  let bad = 0;
  let seen = 0;
  for (const file of sourceJs) {
    const src = stripComments(read(file));
    const hits = [
      ...src.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g),
      ...src.matchAll(/querySelector(?:All)?\(\s*["']#([A-Za-z0-9_-]+)["']\s*\)/g),
    ];
    for (const m of hits) {
      seen++;
      const id = m[1];
      if (ids.has(id)) continue;
      bad++;
      fail("dom-ids", `JS looks up #${id} but no element with that id exists in index.html — this silently no-ops`, `${rel(file)}:${lineAt(src, m.index)}`);
    }
    // Attribute-selector lookups, e.g. [data-car='stratos'] — verify the value exists.
    for (const m of src.matchAll(/querySelector(?:All)?\(\s*["']\[(data-[a-z-]+)\s*=\s*['"]?([^'"\]]+)['"]?\]["']\s*\)/g)) {
      const [, attr, val] = m;
      const attrRe = new RegExp(`${attr}\\s*=\\s*["']${val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
      if (attrRe.test(read(INDEX))) continue;
      fail("dom-ids", `JS looks up [${attr}='${val}'] but index.html has no such element`, `${rel(file)}:${lineAt(src, m.index)}`);
      bad++;
    }
  }
  if (!bad) pass("dom-ids", `${seen} element lookups all match ids present in index.html`);
}

/* ------------------------------------------------------------------ */
/* 8. localStorage reads that can coerce a missing key into 0          */
/* ------------------------------------------------------------------ */

/**
 * `localStorage.getItem(k)` returns null for a missing key.
 * `Number(null)` is 0 and `parseFloat(null)` is NaN — either silently zeroes a
 * volume, a difficulty, or a saved setup. This project shipped muted that way.
 * A read is considered SAFE only if the same function body explicitly guards
 * for null / "" before coercing, or compares as a string.
 */
function checkLocalStorageCoercion() {
  let bad = 0;
  let reads = 0;
  for (const file of sourceJs) {
    const src = stripComments(read(file));
    for (const m of src.matchAll(/localStorage\.getItem\s*\(/g)) {
      reads++;
      const start = m.index;
      const line = lineAt(src, start);
      // Look at a window around the read: the coercion and the guard are local.
      const ctx = src.slice(Math.max(0, start - 400), Math.min(src.length, start + 400));
      const stmt = src.slice(start, src.indexOf("\n", start) === -1 ? src.length : src.indexOf("\n", start));

      const directCoercion =
        /Number\s*\(\s*localStorage\.getItem/.test(ctx) ||
        /parse(?:Int|Float)\s*\(\s*localStorage\.getItem/.test(ctx) ||
        /localStorage\.getItem\s*\([^)]*\)\s*(?:\|\||\?\?)\s*0\b/.test(ctx) ||
        /\+\s*localStorage\.getItem/.test(ctx);

      const stringCompareOnly = /localStorage\.getItem\s*\([^)]*\)\s*===?\s*["']/.test(stmt);
      const guarded =
        /(?:==|===)\s*null|!=\s*null|!==\s*null|\braw\s*==\s*null\b|Number\.isFinite|isNaN|\?\?\s*(?:fallback|def|["'])/.test(ctx);

      if (stringCompareOnly) continue;

      if (directCoercion && !guarded) {
        bad++;
        fail(
          "storage",
          "localStorage.getItem() result is coerced to a number with no null guard — a missing key becomes 0/NaN and silently zeroes this value",
          `${rel(file)}:${line}`
        );
      } else if (!guarded && !stringCompareOnly && /getItem/.test(stmt) && /=\s*localStorage\.getItem/.test(stmt)) {
        // Assigned raw, coercion may happen later. Worth a human glance, not a failure.
        warn("storage", "raw localStorage value assigned without a null guard nearby — confirm a missing key cannot zero anything", `${rel(file)}:${line}`);
      }
    }
  }
  if (!bad) pass("storage", `${reads} localStorage reads all guard a missing key`);
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

function report() {
  const line = "─".repeat(72);
  console.log(line);
  console.log("RALLY STATIC AUDIT  ·  " + new Date().toISOString());
  console.log(`repo: ${ROOT}`);
  console.log(line);

  for (const p of findings.pass) console.log(`  PASS  [${p.check}] ${p.message}`);
  if (findings.warn.length) {
    console.log("");
    for (const w of findings.warn) console.log(`  WARN  [${w.check}] ${w.where}\n          ${w.message}`);
  }
  if (findings.fail.length) {
    console.log("");
    for (const f of findings.fail) console.log(`  FAIL  [${f.check}] ${f.where}\n          ${f.message}`);
  }

  if (findings.warn.some((w) => /modified .* after its newest importer/.test(w.message))) {
    console.log("");
    console.log("  note  staleness warnings compare file mtimes. If someone is editing the repo");
    console.log("        right now, expect these to appear and disappear — check them against a");
    console.log("        quiet tree before treating one as a defect.");
  }
  console.log(line);
  const verdict = findings.fail.length ? "FAIL" : "PASS";
  console.log(
    `${verdict}  ·  ${findings.pass.length} checks passed  ·  ${findings.warn.length} warnings  ·  ${findings.fail.length} failures`
  );
  console.log(line);
  return findings.fail.length ? 1 : 0;
}

checkSyntax();
collectImports();
checkImportsResolve();
const htmlRefs = checkHtmlAssets();
checkVersionConsistency(htmlRefs);
checkNoRemoteAssets();
checkUnsafeDom();
checkSecrets();
checkDomIds();
checkLocalStorageCoercion();
process.exit(report());
