import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = p => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("index.html");
const config = read("config.js");
const sw = read("sw.js");
const manifest = read("manifest.webmanifest");
const firebaserc = read(".firebaserc");
const appJs = ["core", "records", "cloud", "arms", "social", "stacks", "kits", "field", "security", "comms"].map(n => read("js/" + n + ".js")).join("\n");

test("the page has a content security policy and no inline app script", () => {
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src-attr 'none'/);
  assert.doesNotMatch(html, /unsafe-eval/);
  assert.doesNotMatch(html, /upgrade-insecure-requests/);
  assert.doesNotMatch(html, /<script>\s*const CATS/);
  assert.doesNotMatch(html, /onsubmit=/);
  assert.doesNotMatch(html, /minlength="8"/);
  assert.match(html, /js\/logic\.js/);
  assert.match(html, /<script src="config\.js"><\/script>\s*<script src="js\/qa-sync\.js"><\/script>/);
  const syncAt = html.indexOf("js/qa-sync.js");
  const coreAt = html.indexOf("js/core.js");
  assert.ok(syncAt > 0 && syncAt < coreAt);
  assert.match(html, /css\/app\.css/);
});

test("published files do not contain a personal name, the future app name, or a live test override", () => {
  const blob = html + config + sw + manifest + appJs + read("README.md") + read("js/logic.js") + read("js/qa-guard.js") + read("api/worker.js");
  assert.doesNotMatch(blob, /Blake/);
  assert.doesNotMatch(blob, /Kit Cage|kitcage|War Box|getwarbox/i);
  const emails = blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const allowed = new Set(["friend@email.com", "securetoken@system.gserviceaccount.com"]);
  assert.deepEqual(emails.filter(e => !allowed.has(e.toLowerCase())), []);
});

test("sign-out clears this device and the service worker is version 29", () => {
  assert.match(appJs, /GearLogic\.clearUserLocal/);
  assert.match(appJs, /pinLengthOk/);
  assert.match(appJs, /shareItemFields/);
  assert.match(appJs, /notes:""/);
  assert.match(sw, /gear-locker-v29/);
  assert.match(sw, /addEventListener\("push"/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(manifest, /"purpose": "maskable"/);
  assert.doesNotMatch(manifest, /icon-512\.png".*"purpose": "maskable"/);
});

test("local test mode blocks the Google popup script and the page does not allow it", () => {
  assert.doesNotMatch(html, /apis\.google\.com/);
  assert.match(read("js/qa-sync.js"), /https:\/\/apis\.google\.com\/js\/api\.js/);
  assert.match(read("js/qa-sync.js"), /appendChild/);
  assert.match(read("js/cloud.js"), /getIdToken\(true\)|refreshAuthClaims/);
  assert.match(read("js/cloud.js"), /enablePersistence\(\{synchronizeTabs:true\}\)/);
  assert.doesNotMatch(read("js/cloud.js"), /if\(!window\.GEAR_QA\)\{try\{fsdb\.enablePersistence/);
  assert.match(read("js/social.js"), /loanSharePlan/);
  assert.match(read("js/social.js"), /batch\.set\(ref,lendDoc/);
  assert.match(read("js/security.js"), /item name, brand and color, dates, and your email/);
  assert.match(read("css/app.css"), /\.btn\{[^}]*min-height:44px/);
  assert.match(read("css/app.css"), /\.acct button\{[^}]*min-height:44px/);
  assert.match(read("css/app.css"), /\.detail \.lnk\{[^}]*min-height:44px/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.engines.node, ">=22");
  assert.match(read("README.md"), /Node\.js 22 or newer/);
  assert.match(read("README.md"), /Java 21 or newer/);
});

test("production config stays on the live project and the default alias does not", () => {
  assert.match(config, /projectId: "gear-locker-c248c"/);
  assert.match(config, /APP_CHECK_SITE_KEY = ""/);
  assert.match(firebaserc, /"default": "demo-gear-locker"/);
  assert.doesNotMatch(firebaserc, /gear-locker-c248c/);
  assert.equal(fs.existsSync(new URL("../icon-maskable-512.png", import.meta.url)), true);
});
