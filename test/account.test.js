import test from "node:test";
import assert from "node:assert/strict";
import {
  decideAccess, isReviewEmail, monthQuotaKey, planMonthlyLimit, reviewDailyLimit, spendCapMicro,
  estimateSpendMicro, usageFromResponse, freeSpendBlocked, usageDecision, lookupPlan,
  deleteRevenueCatCustomer, accountDeletePlan, USER_COLLECTIONS,
  signInIsRecent, reserveFits, lookupReserveMicro, reconcileSpendMicro, loanEmailRedaction,
  clampMaxTokens, MODEL_CALLS, operationWorstUsage, worstCaseSpendMicro, callHoldMicro, priciestRates, spendRates, applyReserve, applyReconcile,
  deleteRetryRoute, runDeleteAttempt, SERVER_DELETE_STEPS, LOOKUPS_PAUSED,
} from "../js/logic.js";
import { UsageLedger } from "../api/usage-ledger.js";
import { deleteUserFirestore } from "../api/account-delete.js";

const day = new Date("2026-10-26T23:30:00Z");
const open = { dailyUsed: 0, dailyAdd: 1, dailyLimit: 40, monthUsed: 0, monthAdd: 1, monthLimit: 40, spentMicro: 0, capMicro: 25e6 };

test("decideAccess is open to a confirmed email and beta mode restores the allowlist", () => {
  const user = { email: "Owner@Example.com", email_verified: true };
  assert.equal(decideAccess(user, { ALLOWED_EMAILS: "" }).ok, true);
  assert.equal(decideAccess({ email: "stranger@example.com", email_verified: true }, {}).ok, true);
  const unverified = decideAccess({ email: "owner@example.com", email_verified: false }, {});
  assert.equal(unverified.ok, false);
  assert.match(unverified.error, /Confirm your email/);
  const beta = { BETA_ONLY: "true" };
  assert.equal(decideAccess(user, { ...beta, ALLOWED_EMAILS: "" }).ok, false);
  assert.match(decideAccess(user, { ...beta, ALLOWED_EMAILS: "" }).error, /approved emails/);
  assert.equal(decideAccess(user, { ...beta, ALLOWED_EMAILS: "friend@example.com" }).ok, false);
  assert.equal(decideAccess({ email: "owner@example.com", email_verified: false }, { ...beta, ALLOWED_EMAILS: "owner@example.com" }).ok, false);
  assert.equal(decideAccess(user, { ...beta, ALLOWED_EMAILS: " owner@example.com " }).ok, true);
});

test("review emails, month keys, and plan limits stay configurable", () => {
  assert.equal(isReviewEmail("Review@Example.com", { REVIEW_EMAILS: " review@example.com , other@example.com " }), true);
  assert.equal(isReviewEmail("nope@example.com", { REVIEW_EMAILS: "review@example.com" }), false);
  assert.equal(monthQuotaKey("uid", day), "m:uid:2026-10");
  assert.equal(planMonthlyLimit("free", {}), 40);
  assert.equal(planMonthlyLimit("pro", {}), 400);
  assert.equal(planMonthlyLimit("armory", { PLAN_LIMIT_ARMORY: "12" }), 12);
  assert.equal(planMonthlyLimit("nope", { PLAN_LIMIT_FREE: "7" }), 7);
  assert.equal(reviewDailyLimit({}), 8);
  assert.equal(reviewDailyLimit({ REVIEW_DAILY_LIMIT: "3" }), 3);
  assert.equal(spendCapMicro({}), 25e6);
  assert.equal(spendCapMicro({ FREE_SPEND_CAP_USD: "10" }), 10e6);
});

test("spend estimates come from tokens and searches", () => {
  assert.equal(estimateSpendMicro({ input_tokens: 1e6 }), 1e6);
  assert.equal(estimateSpendMicro({ output_tokens: 1e6 }), 5e6);
  assert.equal(estimateSpendMicro({ web_search_requests: 2 }), 20000);
  assert.deepEqual(usageFromResponse({ usage: { input_tokens: 3, output_tokens: 4, server_tool_use: { web_search_requests: 2 } } }), {
    input_tokens: 3, output_tokens: 4, web_search_requests: 2,
  });
});

test("the free spend cap blocks only the free plan", () => {
  assert.equal(freeSpendBlocked(25e6, 25e6, "free", false), true);
  assert.equal(freeSpendBlocked(25e6, 25e6, "pro", false), false);
  assert.equal(freeSpendBlocked(25e6, 25e6, "free", true), false);
  assert.equal(freeSpendBlocked(1, 25e6, "free", false), false);
});

test("usageDecision pauses free lookups, skips the month for review, and keeps the daily cap", () => {
  assert.equal(usageDecision({ ...open, plan: "free" }).ok, true);
  const paused = usageDecision({ ...open, plan: "free", spentMicro: 25e6 });
  assert.equal(paused.ok, false);
  assert.match(paused.error, /Lookups are paused/);
  assert.equal(usageDecision({ ...open, plan: "pro", spentMicro: 25e6 }).ok, true);
  assert.equal(usageDecision({ ...open, plan: "free", review: true, spentMicro: 25e6, dailyLimit: 8 }).ok, true);
  const reviewDay = usageDecision({ ...open, review: true, dailyUsed: 8, dailyLimit: 8, monthUsed: 500, spentMicro: 25e6 });
  assert.equal(reviewDay.ok, false);
  assert.match(reviewDay.error, /Daily lookup limit/);
  const reviewMonth = usageDecision({ ...open, review: true, dailyLimit: 8, monthUsed: 500, monthLimit: 40, spentMicro: 25e6 });
  assert.equal(reviewMonth.ok, true);
  const month = usageDecision({ ...open, monthUsed: 40 });
  assert.equal(month.ok, false);
  assert.match(month.error, /this month's lookups/);
  const daily = usageDecision({ ...open, plan: "armory", dailyUsed: 40 });
  assert.equal(daily.ok, false);
  assert.match(daily.error, /Daily lookup limit/);
});

test("plan lookup is a free stub and account deletion names the exact keys", () => {
  assert.equal(lookupPlan(), "free");
  const hook = deleteRevenueCatCustomer();
  assert.equal(hook.ok, true);
  assert.equal(hook.skipped, true);
  const plan = accountDeletePlan("abc");
  assert.deepEqual(plan.collections, USER_COLLECTIONS);
  assert.deepEqual(plan.kvExact, ["w:abc"]);
  assert.deepEqual(plan.kvPrefixes, ["q:abc:", "a:abc:", "m:abc:"]);
  assert.equal(plan.lendField, "lender");
  assert.ok(plan.kvPrefixes.every(p => p.endsWith(":")));
  assert.deepEqual(USER_COLLECTIONS, ["items", "ammo", "sessions", "dope", "maint", "wish", "loans", "freqs", "pace", "meta"]);
});

test("account deletion accepts a sign-in from the last five minutes", () => {
  const now = 1_700_000_000;
  assert.equal(signInIsRecent(now, now), true);
  assert.equal(signInIsRecent(now - 4 * 60, now), true);
  assert.equal(signInIsRecent(now - 6 * 60, now), false);
  assert.equal(signInIsRecent(undefined, now), false);
  assert.equal(signInIsRecent(0, now), false);
  assert.equal(signInIsRecent(now + 30, now), true);
  assert.equal(signInIsRecent(now + 2 * 60, now), false);
});

test("a free spend hold is the worst case from the output cap and the search count", () => {
  assert.equal(reserveFits(8e6, 2e6, 10e6), true);
  assert.equal(reserveFits(9e6, 2e6, 10e6), false);
  assert.equal(reconcileSpendMicro(10e6, 2e6, 1.5e6), 9.5e6);
  assert.equal(reconcileSpendMicro(10e6, 2e6, 0), 8e6);
  assert.equal(clampMaxTokens(9000), 4000);
  assert.equal(clampMaxTokens(4000), 4000);
  assert.equal(clampMaxTokens(0), 1);
  const usage = operationWorstUsage("lookup");
  assert.equal(usage.output_tokens, MODEL_CALLS.lookup.maxTokens * MODEL_CALLS.lookup.rounds * MODEL_CALLS.lookup.calls);
  assert.equal(usage.web_search_requests, MODEL_CALLS.lookup.searches * MODEL_CALLS.lookup.rounds * MODEL_CALLS.lookup.calls);
  assert.equal(usage.input_tokens, MODEL_CALLS.lookup.promptTokens * MODEL_CALLS.lookup.rounds * MODEL_CALLS.lookup.calls);
  assert.equal(lookupReserveMicro({}), estimateSpendMicro(usage, priciestRates({})));
  assert.ok(priciestRates({}).outputPerMillion > spendRates({}).outputPerMillion);
  assert.deepEqual(priciestRates({ FALLBACK_MODEL: "" }), spendRates({ FALLBACK_MODEL: "" }));
  assert.equal(operationWorstUsage("lookup", 100).input_tokens, 100 * MODEL_CALLS.lookup.rounds * MODEL_CALLS.lookup.calls);
  assert.ok(callHoldMicro({}, "lookup", 100) < callHoldMicro({}, "lookup"));
  assert.equal(worstCaseSpendMicro({}, "lookup"), lookupReserveMicro({}));
  assert.equal(lookupReserveMicro({ SPEND_RESERVE_USD: "3" }), 3e6);
  assert.equal(lookupReserveMicro({ SPEND_RESERVE_USD: "0.01" }), lookupReserveMicro({}));
  const over = applyReconcile({ spend: 10e6, daily: 1, month: 1, alert: 0 }, { reserved: 2e6, actual: 9e6 });
  assert.equal(over.billed, 9e6);
  assert.equal(over.state.spend, 17e6);
});

test("loan redaction clears only a matching email and ignores the item name", () => {
  const loan = {
    friendEmail: "Friend@Example.com",
    lenderEmail: "owner@example.com",
    borrowerEmail: "Friend@Example.com",
    borrowerEmailLower: "friend@example.com",
    item: { name: "gone@example.com pouch" },
    note: "keep",
  };
  const cleared = loanEmailRedaction(loan, "friend@example.com");
  assert.equal(cleared.friendEmail, "");
  assert.equal(cleared.borrowerEmail, "");
  assert.equal(cleared.borrowerEmailLower, "");
  assert.equal(cleared.lenderEmail, "owner@example.com");
  assert.equal(cleared.note, "keep");
  assert.equal(cleared.item.name, "gone@example.com pouch");
  assert.equal(loan.friendEmail, "Friend@Example.com");
  assert.equal(loanEmailRedaction({ friendEmail: "other@example.com", item: { name: "gone@example.com" } }, "gone@example.com"), null);
  assert.equal(loanEmailRedaction({ lenderEmail: "Owner@Example.com" }, "owner@example.com").lenderEmail, "");
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
      if (q.startsWith("SELECT k")) {
        const prefix = String(args[0]).replace(/\*$/, "");
        return done([...rows.keys()].filter(k => k.startsWith(prefix)).map(k => ({ k })));
      }
      if (q.startsWith("INSERT")) { rows.set(args[0], args[1]); return done([]); }
      if (q.startsWith("DELETE")) { rows.delete(args[0]); return done([]); }
      throw new Error(q);
    },
  };
}

function ledgerWith(sql) {
  return new UsageLedger({ storage: { sql } }, {});
}

test("20 parallel lookups near the cap let through only what fits", async () => {
  const spendSql = fakeSql();
  const spendLedger = ledgerWith(spendSql);
  const spendResults = await Promise.all(Array.from({ length: 20 }, (_, i) => Promise.resolve().then(() => spendLedger.reserve({
    id: "s" + i,
    reserve: 1,
    cap: 10,
    seedSpend: 8,
    dailyAdd: 1,
    dailyLimit: 40,
    monthAdd: 1,
    monthLimit: 40,
    dailyKey: "q:u:day",
    monthKey: "m:u:month",
  }))));
  const spendOk = spendResults.filter(r => r.ok);
  assert.equal(spendOk.length, 2);
  assert.equal(spendResults.filter(r => !r.ok).length, 18);
  assert.equal(spendSql.rows.get("spend:free"), 10);
  assert.match(spendResults.find(r => !r.ok).error, /Lookups are paused/);
  const capped = spendLedger.reconcile({ id: spendOk[0].id, actual: 50 });
  assert.equal(capped.billed, 50);
  assert.equal(capped.spend, 59);
  const released = spendLedger.reconcile({ id: spendOk[1].id, actual: 0 });
  assert.equal(released.spend, 58);
  const again = spendLedger.reconcile({ id: spendOk[0].id, actual: 50 });
  assert.equal(again.duplicate, true);
  assert.equal(again.spend, released.spend);

  const dailySql = fakeSql();
  const dailyLedger = ledgerWith(dailySql);
  const dailyResults = await Promise.all(Array.from({ length: 20 }, (_, i) => Promise.resolve().then(() => dailyLedger.reserve({
    id: "d" + i,
    reserve: 1,
    cap: 1e12,
    seedSpend: 0,
    dailyAdd: 1,
    dailyLimit: 3,
    monthAdd: 1,
    monthLimit: 100,
    dailyKey: "q:u:day",
    monthKey: "m:u:month",
  }))));
  assert.equal(dailyResults.filter(r => r.ok).length, 3);
  assert.match(dailyResults.find(r => !r.ok).error, /Daily lookup limit reached \(3 per day\)/);

  const monthSql = fakeSql();
  const monthLedger = ledgerWith(monthSql);
  const monthResults = await Promise.all(Array.from({ length: 20 }, (_, i) => Promise.resolve().then(() => monthLedger.reserve({
    id: "m" + i,
    reserve: 1,
    cap: 1e12,
    seedSpend: 0,
    dailyAdd: 1,
    dailyLimit: 40,
    monthAdd: 1,
    monthLimit: 2,
    dailyKey: "q:u:day",
    monthKey: "m:u:month",
  }))));
  assert.equal(monthResults.filter(r => r.ok).length, 2);
  assert.match(monthResults.find(r => !r.ok).error, /this month's lookups/);

  const review = applyReserve({ spend: 10, daily: 0, month: 9, alert: 1 }, {
    reserve: 5, cap: 10, skipSpend: true, skipMonth: true, dailyAdd: 1, dailyLimit: 8, monthAdd: 1, monthLimit: 1, alertAdd: 1, alertLimit: 1,
  });
  assert.equal(review.ok, false);
  assert.match(review.error, /price alerts/);
  const reviewOk = applyReserve({ spend: 10, daily: 0, month: 9, alert: 0 }, {
    reserve: 5, cap: 10, skipSpend: true, skipMonth: true, dailyAdd: 1, dailyLimit: 8, monthAdd: 1, monthLimit: 1,
  });
  assert.equal(reviewOk.ok, true);
  assert.equal(reviewOk.reserved, 0);
  assert.equal(reviewOk.state.spend, 10);
  assert.equal(reviewOk.state.month, 9);
  assert.equal(reviewOk.state.daily, 1);
  assert.equal(LOOKUPS_PAUSED, "Lookups are paused for now. You can keep using the rest of War Box.");
});

test("a failed delete survives reload and the retry does not list shares on the client", () => {
  const start = { tombstone: false, shares: 2, gear: 3, auth: true, kv: true };
  for (const fail of ["502", "timeout", "offline"]) {
    const first = runDeleteAttempt(start, fail);
    assert.equal(first.ok, false);
    assert.deepEqual(first.route, ["client-data", "tombstone", "server"]);
    assert.equal(first.queriedShares, true);
    assert.equal(first.state.tombstone, true);
    assert.equal(first.state.auth, true);
    assert.equal(first.state.kv, true);
    const retry = runDeleteAttempt(first.state, "ok");
    assert.deepEqual(retry.route, deleteRetryRoute(true));
    assert.deepEqual(retry.route, ["server"]);
    assert.equal(retry.queriedShares, false);
    assert.equal(retry.state.shares, 0);
    assert.equal(retry.state.gear, 0);
    assert.equal(retry.state.auth, false);
    assert.equal(retry.state.kv, false);
    assert.deepEqual(retry.steps, SERVER_DELETE_STEPS);
    const third = runDeleteAttempt(retry.state, "ok");
    assert.equal(third.state.auth, false);
    assert.equal(third.state.shares, 0);
    assert.equal(third.state.kv, false);
  }
  const leftover = runDeleteAttempt({ tombstone: true, shares: 4, gear: 1, auth: true, kv: true }, "ok");
  assert.equal(leftover.queriedShares, false);
  assert.equal(leftover.state.shares, 0);
  assert.equal(leftover.state.auth, false);
});

test("a mocked $3.05 lookup records $3.05", () => {
  const usage = usageFromResponse({
    usage: {
      input_tokens: 500_000,
      output_tokens: 400_000,
      server_tool_use: { web_search_requests: 5, web_search_tokens: 500_000 },
    },
  });
  const actual = estimateSpendMicro(usage);
  assert.equal(actual, 3_050_000);
  const ledger = ledgerWith(fakeSql());
  const held = ledger.reserve({
    id: "look-305",
    reserve: 1_000,
    cap: 50_000_000,
    dailyAdd: 1,
    dailyLimit: 40,
    monthAdd: 1,
    monthLimit: 40,
    dailyKey: "q:user1:2026-10-27",
    monthKey: "m:user1:2026-10",
  });
  assert.equal(held.ok, true);
  const rec = ledger.reconcile({ id: "look-305", actual });
  assert.equal(rec.billed, 3_050_000);
  assert.equal(rec.spend, 3_050_000);
  assert.equal(ledger.read({ keys: ["spend:free"] }).values["spend:free"], 3_050_000);
});

test("server cleanup pages 305 shares before it finishes", async () => {
  const names = Array.from({ length: 305 }, (_, i) => "projects/demo/databases/(default)/documents/shares/s" + String(i).padStart(4, "0"));
  const left = new Set(names);
  let shareQueries = 0;
  let lendQueries = 0;
  const deleted = [];
  const fetchImpl = async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const json = (status, data) => ({ status, json: async () => data });
    if (method === "DELETE") {
      const name = decodeURIComponent(String(url).split("/documents/")[1] || "");
      const full = "projects/demo/databases/(default)/documents/" + name;
      deleted.push(full);
      left.delete(full);
      return json(200, {});
    }
    if (method === "PATCH") return json(200, {});
    if (String(url).includes(":runQuery")) {
      const col = body.structuredQuery.from[0].collectionId;
      const limit = body.structuredQuery.limit;
      const after = body.structuredQuery.startAt && body.structuredQuery.startAt.values[0].referenceValue;
      assert.ok(limit > 0 && limit < 305);
      if (col === "shares") {
        shareQueries += 1;
        let rows = [...left].sort();
        if (after) rows = rows.filter(name => name > after);
        rows = rows.slice(0, limit);
        if (!rows.length) return json(200, [{}]);
        return json(200, rows.map(name => ({ document: { name } })));
      }
      if (col === "lends") lendQueries += 1;
      return json(200, [{}]);
    }
    return json(200, { documents: [] });
  };
  const out = await deleteUserFirestore({ FIREBASE_PROJECT: "demo" }, "token", { sub: "abc", email: "a@b.co" }, fetchImpl);
  assert.equal(out.ok, true);
  assert.equal(left.size, 0);
  assert.equal(deleted.length, 305);
  assert.ok(shareQueries >= 2);
  assert.ok(lendQueries >= 1);
});

test("server cleanup treats a missing document as already gone", async () => {
  let shares = 1;
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || "GET";
    assert.equal(u.includes("not-a-token"), false);
    assert.match(opts.headers.authorization, /^Bearer /);
    const body = opts.body ? JSON.parse(opts.body) : null;
    const json = (status, data) => ({ status, json: async () => data });
    if (method === "DELETE") { shares = 0; return json(404, {}); }
    if (method === "PATCH") return json(200, {});
    if (u.includes(":runQuery")) {
      const col = body.structuredQuery.from[0].collectionId;
      if (col === "shares" && shares) {
        return json(200, [{ document: { name: "projects/demo/databases/(default)/documents/shares/s1" } }]);
      }
      return json(200, [{}]);
    }
    return json(200, { documents: [] });
  };
  const env = { FIREBASE_PROJECT: "demo" };
  const user = { sub: "abc", email: "Friend@Example.com" };
  const first = await deleteUserFirestore(env, "not-a-token", user, fetchImpl);
  assert.equal(first.ok, true);
  assert.equal(shares, 0);
  const second = await deleteUserFirestore(env, "not-a-token", user, fetchImpl);
  assert.equal(second.ok, true);
  const broken = await deleteUserFirestore(env, "not-a-token", user, async () => ({ status: 500, json: async () => ({}) }));
  assert.equal(broken.ok, false);
  assert.match(broken.error, /sign-in is still here/);
});
