#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer, launchChrome, findChrome, preparePage, goto, waitFor, evaluate, screenshot } from "./lib/qa-harness.mjs";

if (!findChrome()) {
  console.error("no chrome");
  process.exit(1);
}
const server = await startServer(ROOT);
const browser = await launchChrome({ headless: true, width: 1280, height: 720 });
const { cdp } = browser;
await preparePage(cdp);
try {
  await goto(cdp, `${server.origin}/tools/hand-grip-lab.html`);
  const report = await waitFor(
    cdp,
    `const r = window.__gripReport && window.__gripReport(); return r && r.ready ? r : null;`,
    { timeout: 20000, label: "hands" }
  );
  console.log(JSON.stringify(report, null, 2));
  const jpg = await screenshot(cdp);
  const out = path.join(ROOT, "tools/qa-out/hand-grip-lab.jpg");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(jpg, "base64"));
  console.log("wrote", out);
} finally {
  await browser.close();
  await server.close();
}
