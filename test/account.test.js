import test from "node:test";
import assert from "node:assert/strict";
import {
  decideAccess, isReviewEmail, monthQuotaKey, planMonthlyLimit, reviewDailyLimit, spendCapMicro,
  estimateSpendMicro, usageFromResponse, freeSpendBlocked, usageDecision, lookupPlan,
  deleteRevenueCatCustomer, accountDeletePlan, USER_COLLECTIONS,
} from "../js/logic.js";

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
