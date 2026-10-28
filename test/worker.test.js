import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import worker, { UsageLedger } from "../api/worker.js";
import { attemptQuotaKey, dailySpendKey, estimateSpendMicro, lookupItemHoldMicro, lookupTypicalMicro, monthQuotaKey, monthRefundKey, ratesForModel } from "../js/logic.js";

const src = fs.readFileSync(new URL("../api/worker.js", import.meta.url), "utf8");

test("health says a confirmed email can use lookups unless beta mode is on", async () => {
  const open = await worker.fetch(new Request("https://gear-locker-api.example/health"), {});
  assert.equal(open.status, 200);
  assert.equal((await open.json()).access, "verified");
  const beta = await worker.fetch(new Request("https://gear-locker-api.example/health"), { BETA_ONLY: "true" });
  assert.equal((await beta.json()).access, "allowlist");
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
  assert.equal((src.match(/max_uses:\s*spec\.searches/g) || []).length, 4);
  assert.doesNotMatch(src, /max_uses:\s*\d/);
  assert.match(src, /i < spec\.rounds/);
  assert.match(src, /roundFits/);
  assert.match(src, /SEARCH_RESULT_TOKENS/);
  assert.match(src, /Ammo price search is turned off/);
  assert.match(src, /Do not look up a price/);
  assert.doesNotMatch(src, /function ammoLookup|AmmoSeek/);
  const dealAt = src.indexOf("async function dealCheck");
  const guardAt = src.indexOf("if (priceRouteBlocked(w))", dealAt);
  const fetchAt = src.indexOf("https://api.anthropic.com", dealAt);
  assert.ok(dealAt > 0 && guardAt > dealAt && guardAt < fetchAt);
  assert.match(src, /!priceRouteBlocked\(w\)/);
  assert.match(src, /category === "Magazines"/);
  assert.match(src, /category === "Magazines & Belts"/);
  const lookupAt = src.indexOf("async function lookupOne");
  const blockAt = src.indexOf("priceRouteBlocked(clean)", lookupAt);
  const claudeAt = src.indexOf("callClaude", lookupAt);
  assert.ok(lookupAt > 0 && blockAt > lookupAt && blockAt < claudeAt);
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
  const delAt = src.indexOf('url.pathname === "/account/delete"');
  const keyAt = src.indexOf("if (!env.ANTHROPIC_API_KEY)");
  assert.ok(delAt > 0 && keyAt > delAt);
  const delEnd = src.indexOf("if (!ROUTES.includes", delAt);
  const delBody = src.slice(delAt, delEnd);
  assert.ok(delBody.indexOf("signInIsRecent(accountUser.auth_time") > -1);
  assert.ok(delBody.indexOf("signInIsRecent(accountUser.auth_time") < delBody.indexOf("deleteWatchRecord"));
  assert.ok(delBody.indexOf("deleteUserFirestore") < delBody.indexOf("deleteWatchRecord"));
  assert.ok(delBody.indexOf("deleteWatchRecord") < delBody.indexOf("deleteAuthUser"));
  assert.ok(delBody.indexOf("deleteWatchRecord") < delBody.indexOf("queueUsageCleanup"));
  assert.ok(delBody.indexOf("queueUsageCleanup") < delBody.indexOf("enqueueRedaction"));
  assert.ok(delBody.indexOf("enqueueRedaction") < delBody.indexOf("clearUsageCounters"));
  assert.ok(delBody.indexOf("clearUsageCounters") < delBody.indexOf("deleteCleanupResult"));
  assert.ok(delBody.indexOf("deleteCleanupResult") < delBody.indexOf("deleteAuthUser"));
  assert.match(delBody, /sign-in is still here/);
  assert.match(delBody, /Couldn't finish deleting the account/);
  assert.match(delBody, /deleteCleanupResult/);
  const queueFn = src.slice(src.indexOf("async function queueUsageCleanup"), src.indexOf("async function retryQueuedCleanups"));
  assert.match(queueFn, /CLEANUP_PREFIX \+ uid/);
  assert.doesNotMatch(queueFn, /redactPending/);
  const retryFn = src.slice(src.indexOf("async function retryQueuedCleanups"), src.indexOf("async function retryOnce"));
  assert.match(retryFn, /plan\.action === "wait"/);
  assert.ok(retryFn.indexOf('plan.action === "wait"') < retryFn.indexOf("env.WATCH.put"));
  const sessionAt = src.indexOf('url.pathname === "/account/session"');
  const apiKeyAt = src.indexOf("if (!env.ANTHROPIC_API_KEY)");
  assert.ok(sessionAt > 0 && sessionAt < apiKeyAt);
  assert.ok(src.indexOf("releaseEmailHold(env, sessionUser)") > sessionAt);
  const scheduled = src.slice(src.indexOf("async scheduled"));
  assert.match(scheduled, /sweepTombstones/);
  assert.ok(scheduled.indexOf("sweepTombstones") < scheduled.indexOf("pruneUsageCounters"));
  assert.match(scheduled, /pruneUsageCounters/);
  assert.ok(scheduled.indexOf("pruneUsageCounters") < scheduled.indexOf("retryQueuedCleanups"));
  assert.ok(scheduled.indexOf("retryQueuedCleanups") < scheduled.indexOf("runQueuedRedactions"));
  assert.ok(scheduled.indexOf("runQueuedRedactions") < scheduled.indexOf("ANTHROPIC_API_KEY"));
  assert.match(src, /roundInputTokens/);
  assert.match(src, /retryQueuedCleanups/);
  const authFn = src.slice(src.indexOf("async function deleteAuthUser"), src.indexOf("async function listWatchUsers"));
  assert.match(authFn, /env\.FIREBASE_SERVER_API_KEY/);
  assert.ok(authFn.indexOf("if (!key)") < authFn.indexOf("accounts:delete"));
  assert.match(authFn, /sign-in is still here/);
  assert.doesNotMatch(authFn, /referer/i);
  assert.match(src, /lookupBatchAllowance/);
  assert.ok(src.indexOf("lookupBatchAllowance") < src.indexOf("const lookBill = await reserveCall"));
  const bill = src.indexOf("const lookBill = await reserveCall");
  const call = src.indexOf("lookupOne(env, it,", bill);
  assert.ok(bill > 0 && call > bill);
  assert.match(src, /finishCall/);
  assert.match(src, /export \{ UsageLedger \}/);
  assert.doesNotMatch(src, /noteFreeSpend/);
  assert.doesNotMatch(src, /holdFreeSpend/);
  const ledger = fs.readFileSync(new URL("../api/usage-ledger.js", import.meta.url), "utf8");
  const reserveFn = ledger.slice(ledger.indexOf("reserve(req)"), ledger.indexOf("reconcile(req)"));
  assert.doesNotMatch(reserveFn, /\bawait\b/);
  assert.match(ledger, /import \{ DurableObject \} from ["']cloudflare:workers["']/);
  assert.match(ledger, /class UsageLedger extends DurableObject/);
  assert.match(ledger, /super\(ctx, env\)/);
  const counters = src.slice(src.indexOf("async function clearUsageCounters"), src.indexOf("async function retryOnce"));
  assert.match(counters, /clearUsageForUser/);
  assert.match(counters, /deleteUserKv/);
  assert.ok(src.indexOf("async function deleteWatchRecord") < src.indexOf("async function deleteAuthUser"));
  assert.match(src, /countRefund/);
  assert.match(src, /lookupPriced/);
  assert.match(src, /partial: true/);
});

function fakeSql() {
  const rows = new Map();
  return {
    rows,
    exec(sql, ...args) {
      const q = String(sql);
      const done = list => ({ toArray() { return list; } });
      if (q.startsWith("CREATE")) return done([]);
      if (q.startsWith("SELECT v")) return done(rows.has(args[0]) ? [{ v: rows.get(args[0]) }] : []);
      if (q.startsWith("SELECT 1")) return done(rows.has(args[0]) ? [{ n: 1 }] : []);
      if (q.startsWith("SELECT k")) return done([...rows.keys()].map(k => ({ k })));
      if (q.startsWith("INSERT")) { rows.set(args[0], args[1]); return done([]); }
      if (q.startsWith("DELETE")) { rows.delete(args[0]); return done([]); }
      throw new Error(q);
    },
  };
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

test("one failed lookup is refunded, and a second batch in the same moment keeps the leftover slot", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pub = publicKey.export({ format: "jwk" });
  const kid = "refund-test";
  const jwks = { keys: [{ kty: pub.kty, n: pub.n, e: pub.e, kid, alg: "RS256", use: "sig" }] };
  const nowS = Math.floor(Date.now() / 1000);
  const sub = "userrefund";
  const head = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const pay = b64url(JSON.stringify({
    aud: "gear-locker-c248c",
    iss: "https://securetoken.google.com/gear-locker-c248c",
    sub,
    email: "user@example.com",
    email_verified: true,
    iat: nowS,
    exp: nowS + 3600,
  }));
  const data = head + "." + pay;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(data), privateKey);
  const token = data + "." + b64url(sig);
  const orig = globalThis.fetch;
  let anthropic = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("googleapis.com")) return new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("api.anthropic.com")) {
      anthropic += 1;
      const body = JSON.parse(opts.body);
      const blob = JSON.stringify(body.messages || []);
      if (blob.includes("Heavy")) {
        const answer = JSON.stringify({ retailNew: 20, usedLow: 10, usedHigh: 15, value: 12, weightOz: 8, priceNote: "Amazon $20", weightNote: "maker spec", sources: [] });
        return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: answer }], usage: { input_tokens: 2000, output_tokens: 80000 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (blob.includes("Junk")) return new Response(JSON.stringify({ error: { message: "model blew up" }, usage: { input_tokens: 1000, output_tokens: 1000 } }), { status: 500, headers: { "content-type": "application/json" } });
      if (blob.includes("Fallback Item")) {
        const usage = String(body.model).includes("sonnet") ? { input_tokens: 2000, output_tokens: 2000 } : { input_tokens: 1000, output_tokens: 1000 };
        if (!String(body.model).includes("sonnet")) return new Response(JSON.stringify({ error: { message: "bad model" }, usage }), { status: 400, headers: { "content-type": "application/json" } });
        const answer = JSON.stringify({ retailNew: 20, usedLow: 10, usedHigh: 15, value: 12, weightOz: 8, priceNote: "Amazon $20", weightNote: "maker spec", sources: [] });
        return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: answer }], usage }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (blob.includes("Fail Item")) return new Response(JSON.stringify({ error: { message: "model blew up" } }), { status: 500, headers: { "content-type": "application/json" } });
      const answer = JSON.stringify({ retailNew: 20, usedLow: 10, usedHigh: 15, value: 12, weightOz: 8, priceNote: "Amazon $20", weightNote: "maker spec", sources: [] });
      return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: answer }], usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return orig(url, opts);
  };
  const envFor = ledger => ({
    ANTHROPIC_API_KEY: "test-key",
    FREE_SPEND_CAP_USD: "100000",
    FREE_DAILY_SPEND_CAP_USD: "100",
    PLAN_LIMIT_FREE: "10",
    DAILY_AI_LIMIT: "40",
    USAGE: { getByName: () => ledger },
  });
  const post = (ledger, items) => worker.fetch(new Request("https://gear-locker-api.example/lookup", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ items }),
  }), envFor(ledger));
  try {
    const now = new Date();
    const dayKey = attemptQuotaKey(sub, now);
    const monthKey = monthQuotaKey(sub, now);
    const sql = fakeSql();
    const ledger = new UsageLedger({ storage: { sql } }, {});
    sql.rows.set(monthKey, 7);
    sql.rows.set(dayKey, 0);
    sql.rows.set("seeded:spend", 1);
    sql.rows.set("spend:free", 0);
    const res = await post(ledger, [
      { id: "a", name: "Pouch A", category: "Pouches" },
      { id: "b", name: "Pouch B", category: "Pouches" },
      { id: "c", name: "Fail Item", category: "Pouches" },
      { id: "d", name: "Pouch D", category: "Pouches" },
    ]);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.results.filter(r => r.ok).length, 2);
    assert.equal(body.results.find(r => r.id === "c").ok, false);
    assert.equal(body.results.find(r => r.id === "d").ok, false);
    assert.match(body.results.find(r => r.id === "d").error, /this month's lookups/);
    assert.equal(sql.rows.get(monthKey), 9);
    assert.equal(sql.rows.get(dayKey), 3);
    assert.equal(anthropic, 3);

    const raceSql = fakeSql();
    const race = new UsageLedger({ storage: { sql: raceSql } }, {});
    raceSql.rows.set(monthKey, 5);
    raceSql.rows.set(dayKey, 0);
    raceSql.rows.set("seeded:spend", 1);
    raceSql.rows.set("spend:free", 0);
    const item = n => ({ id: "r" + n, name: "Race " + n, category: "Pouches" });
    const pair = await Promise.all([
      post(race, [1, 2, 3, 4].map(item)),
      post(race, [5, 6, 7, 8].map(item)),
    ]);
    const parsed = [];
    for (const one of pair) {
      const out = await one.json();
      assert.equal(one.status, 200, JSON.stringify(out));
      parsed.push(out.results.filter(r => r.ok).length);
    }
    assert.deepEqual(parsed.sort(), [1, 4]);
    assert.equal(raceSql.rows.get(monthKey), 10);
    assert.equal(raceSql.rows.get(dayKey), 5);

    const junkSql = fakeSql();
    const junk = new UsageLedger({ storage: { sql: junkSql } }, {});
    junkSql.rows.set("seeded:spend", 1);
    junkSql.rows.set("spend:free", 0);
    const junkEnv = { ...envFor(junk), PLAN_LIMIT_FREE: "1000", FREE_SPEND_CAP_USD: "100000" };
    const beforeCalls = anthropic;
    let ran = 0;
    let blocked = 0;
    for (let n = 0; n < 25; n++) {
      const items = [0, 1, 2, 3].map(i => ({ id: "j" + n + "-" + i, name: "Junk " + n + "-" + i, category: "Pouches" }));
      const one = await worker.fetch(new Request("https://gear-locker-api.example/lookup", {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ items }),
      }), junkEnv);
      const out = await one.json();
      if (one.status === 429) {
        blocked++;
        assert.match(out.error, /Daily lookup limit/);
      } else {
        assert.equal(one.status, 502, JSON.stringify(out));
        ran++;
      }
    }
    const unit = estimateSpendMicro({ input_tokens: 1000, output_tokens: 1000 });
    assert.equal(ran, 10);
    assert.equal(blocked, 15);
    assert.equal(anthropic - beforeCalls, 40);
    assert.equal(junkSql.rows.get(dayKey), 40);
    assert.equal(junkSql.rows.get(monthKey), 35);
    assert.equal(junkSql.rows.get(monthRefundKey(sub, now)), 5);
    assert.equal(junkSql.rows.get("spend:free"), 40 * unit);
    assert.ok(junkSql.rows.get("spend:free") < 25e6);
    assert.equal(junkSql.rows.get(dailySpendKey(sub, now)), 40 * unit);

    const fbSql = fakeSql();
    const fbLedger = new UsageLedger({ storage: { sql: fbSql } }, {});
    fbSql.rows.set("seeded:spend", 1);
    fbSql.rows.set("spend:free", 0);
    const fbBefore = anthropic;
    const fbRes = await post(fbLedger, [{ id: "fb", name: "Fallback Item", category: "Pouches" }]);
    const fbBody = await fbRes.json();
    assert.equal(fbRes.status, 200, JSON.stringify(fbBody));
    assert.equal(fbBody.results.filter(r => r.ok).length, 1);
    assert.equal(anthropic - fbBefore, 2);
    const rateEnv = { FALLBACK_MODEL: "claude-sonnet-5-5", FALLBACK_INPUT_PER_MILLION: "3", FALLBACK_OUTPUT_PER_MILLION: "15", FALLBACK_SEARCH_EACH: "0.01" };
    const both = estimateSpendMicro({ input_tokens: 1000, output_tokens: 1000 }) + estimateSpendMicro({ input_tokens: 2000, output_tokens: 2000 }, ratesForModel(rateEnv, "claude-sonnet-5-5"));
    assert.equal(fbSql.rows.get(dailySpendKey(sub, now)), both);
    assert.equal(fbSql.rows.get("spend:free"), both);
    assert.equal(fbSql.rows.get(dayKey), 1);

    const cappedSql = fakeSql();
    const capped = new UsageLedger({ storage: { sql: cappedSql } }, {});
    cappedSql.rows.set("seeded:spend", 1);
    cappedSql.rows.set("spend:free", 0);
    cappedSql.rows.set(dailySpendKey(sub, now), 750000);
    const capBefore = anthropic;
    const capRes = await worker.fetch(new Request("https://gear-locker-api.example/lookup", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "cap", name: "Pouch Cap", category: "Pouches" }] }),
    }), { ...envFor(capped), FREE_DAILY_SPEND_CAP_USD: "0.75" });
    const capBody = await capRes.json();
    assert.equal(capRes.status, 429, JSON.stringify(capBody));
    assert.match(capBody.error, /spending limit/);
    assert.equal(anthropic, capBefore);
    assert.equal(cappedSql.rows.get("spend:free"), 0);

    const freshSql = fakeSql();
    const fresh = new UsageLedger({ storage: { sql: freshSql } }, {});
    freshSql.rows.set("seeded:spend", 1);
    freshSql.rows.set("spend:free", 0);
    const freshEnv = { ...envFor(fresh), PLAN_LIMIT_FREE: "10", FREE_DAILY_SPEND_CAP_USD: "0.75", FREE_SPEND_CAP_USD: "25" };
    const postFresh = items => worker.fetch(new Request("https://gear-locker-api.example/lookup", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ items }),
    }), freshEnv);
    const first = await postFresh([1, 2, 3, 4].map(n => ({ id: "t" + n, name: "Typical " + n, category: "Pouches" })));
    const firstBody = await first.json();
    assert.equal(first.status, 200, JSON.stringify(firstBody));
    assert.equal(firstBody.results.filter(r => r.ok).length, 4);
    assert.equal(firstBody.results.some(r => /spending limit/i.test(r.error || "")), false);
    let priced = 4;
    for (let n = 5; priced < 10; n++) {
      const one = await postFresh([{ id: "t" + n, name: "Typical " + n, category: "Pouches" }]);
      const body = await one.json();
      assert.equal(one.status, 200, JSON.stringify(body));
      assert.equal(body.results.filter(r => r.ok).length, 1);
      assert.equal(/spending limit/i.test(body.error || ""), false);
      priced++;
    }
    assert.equal(priced, 10);
    assert.ok(freshSql.rows.get(dailySpendKey(sub, now)) < 750000);
    const monthFull = await postFresh([{ id: "t11", name: "Typical 11", category: "Pouches" }]);
    const monthBody = await monthFull.json();
    assert.equal(monthFull.status, 429);
    assert.match(monthBody.error, /this month's lookups/);
    assert.doesNotMatch(monthBody.error, /spending limit/);

    const heavySql = fakeSql();
    const heavy = new UsageLedger({ storage: { sql: heavySql } }, {});
    heavySql.rows.set("seeded:spend", 1);
    heavySql.rows.set("spend:free", 0);
    const heavyEnv = { ...envFor(heavy), PLAN_LIMIT_FREE: "10", FREE_DAILY_SPEND_CAP_USD: "0.75", FREE_SPEND_CAP_USD: "25" };
    const heavyBefore = anthropic;
    const heavyRes = await worker.fetch(new Request("https://gear-locker-api.example/lookup", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ items: [1, 2, 3, 4].map(n => ({ id: "h" + n, name: "Heavy " + n, category: "Pouches" })) }),
    }), heavyEnv);
    const heavyBody = await heavyRes.json();
    assert.equal(heavyRes.status, 200, JSON.stringify(heavyBody));
    assert.equal(heavyBody.results.filter(r => r.ok).length, 4);
    assert.equal(anthropic - heavyBefore, 4);
    const heavyUnit = estimateSpendMicro({ input_tokens: 2000, output_tokens: 80000 });
    assert.equal(heavySql.rows.get(dailySpendKey(sub, now)), 4 * heavyUnit);
    assert.ok(4 * heavyUnit > 750000);
    assert.ok(4 * lookupTypicalMicro(heavyEnv) < 750000);
    const again = await worker.fetch(new Request("https://gear-locker-api.example/lookup", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: "h5", name: "Heavy 5", category: "Pouches" }] }),
    }), heavyEnv);
    const againBody = await again.json();
    assert.equal(again.status, 429, JSON.stringify(againBody));
    assert.match(againBody.error, /Today's lookup spending limit is reached/);
    assert.equal(heavySql.rows.get(dailySpendKey(sub, now)), 4 * heavyUnit);
    assert.equal(anthropic - heavyBefore, 4);
    assert.equal(Math.floor(25e6 / lookupItemHoldMicro({})), 36);
  } finally {
    globalThis.fetch = orig;
  }
});
