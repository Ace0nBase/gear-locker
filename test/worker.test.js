import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../api/worker.js";

const src = fs.readFileSync(new URL("../api/worker.js", import.meta.url), "utf8");

test("health says lookups use an allowlist", async () => {
  const res = await worker.fetch(new Request("https://gear-locker-api.example/health"), {});
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.access, "allowlist");
});

test("lookup without a sign-in token is rejected", async () => {
  const res = await worker.fetch(new Request("https://gear-locker-api.example/lookup", { method: "POST", body: "{}" }), { ANTHROPIC_API_KEY: "test-key" });
  assert.equal(res.status, 401);
});

test("the worker keeps the hourly budget and does not allow a bundled origin", () => {
  assert.match(src, /WATCH_BATCH:\s*"6"/);
  assert.doesNotMatch(src, /WATCH_BATCH:\s*"12"/);
  assert.match(src, /ALLOWED_ORIGINS:\s*"https:\/\/ace0nbase\.github\.io"/);
  assert.doesNotMatch(src, /capacitor:\/\//);
  assert.match(src, /DAILY_AI_LIMIT:\s*"40"/);
  assert.match(src, /ALERT_DAILY_CAP:\s*"6"/);
  assert.match(src, /MIN_ALERT_GAP_HOURS:\s*"20"/);
  assert.match(src, /notes:\s*""/);
  assert.equal((src.match(/max_uses:\s*3/g) || []).length, 1);
  assert.equal((src.match(/max_uses:\s*2/g) || []).length, 3);
  assert.match(src, /Ammo price search is turned off/);
  assert.match(src, /Do not look up a price/);
  assert.doesNotMatch(src, /function ammoLookup|AmmoSeek/);
  const dealAt = src.indexOf("async function dealCheck");
  const guardAt = src.indexOf("if (saleRestricted(w))", dealAt);
  const fetchAt = src.indexOf("https://api.anthropic.com", dealAt);
  assert.ok(dealAt > 0 && guardAt > dealAt && guardAt < fetchAt);
  assert.match(src, /!saleRestricted\(w\)/);
  assert.match(src, /publicWeightNote\(parsed\.weightNote\)/);
  assert.match(src, /pickModelAnswer\(/);
  assert.match(src, /settleLookup\(clean, parsed\)/);
  assert.match(src, /settleDeal\(w, j\)/);
  assert.match(src, /Item: \$\{name\}/);
  assert.match(src, /const name = it\.name \|\| ""/);
  assert.match(src, /const name = w\.name \|\| ""/);
  assert.doesNotMatch(src, /"restricted"/);
  assert.doesNotMatch(src, /normalizeGearLabel/);
  assert.match(src, /stripGunMarketSources/);
  assert.match(src, /\$\{PRICE_BACKSTOP\}/);
  assert.match(src, /photoIdHardBlocked\(subject\)/);
  assert.match(src, /pricedPhotoCategories\(CATS\)/);
  assert.ok(src.indexOf("Do not look up a price") < src.indexOf("${PRICE_BACKSTOP}"));
});
