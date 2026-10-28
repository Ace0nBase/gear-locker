import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker, { UsageLedger } from "../api/worker.js";
import {
  MODEL_CALLS, REQUEST_DEADLINE_MS, ROUND_FLOOR_MS, ROUND_FLOOR_MIN_MS, USAGE_HOLD_STALE_MS,
  clampedDeadlineBudget, clampedRoundFloor, dailySpendKey, estimateInputTokens, estimateSpendMicro,
  inflightKey, poolSpendKey, ratesForModel,
} from "../js/logic.js";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pub = publicKey.export({ format: "jwk" });
const kid = "deadline-test";
const jwks = { keys: [{ kty: pub.kty, n: pub.n, e: pub.e, kid, alg: "RS256", use: "sig" }] };
const nowS = Math.floor(Date.now() / 1000);
const sub = "userdead";
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
const signed = head + "." + pay;
const token = signed + "." + b64url(crypto.sign("RSA-SHA256", Buffer.from(signed), privateKey));

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
        if (args[0] == null) return done([...rows.keys()].map(k => ({ k })));
        const prefix = String(args[0]).replace(/\*$/, "");
        return done([...rows.keys()].filter(k => k.startsWith(prefix)).map(k => ({ k })));
      }
      if (q.startsWith("INSERT")) { rows.set(args[0], args[1]); return done([]); }
      if (q.startsWith("DELETE")) { rows.delete(args[0]); return done([]); }
      throw new Error(q);
    },
  };
}

function ledgerEnv(extra) {
  const sql = fakeSql();
  const ledger = new UsageLedger({ storage: { sql } }, {});
  sql.rows.set("seeded:spend", 1);
  sql.rows.set("seeded:pool", 1);
  return {
    sql,
    env: {
      ANTHROPIC_API_KEY: "test-key",
      FREE_SPEND_CAP_USD: "25",
      FREE_DAILY_SPEND_CAP_USD: "10",
      PLAN_LIMIT_FREE: "40",
      DAILY_AI_LIMIT: "40",
      USAGE: { getByName: () => ledger },
      ...extra,
    },
  };
}

function post(path, body, env) {
  return worker.fetch(new Request("https://gear-locker-api.example" + path, {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify(body),
  }), env);
}

function hang(opts) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("model call was not aborted")), 4000);
    const fail = () => { clearTimeout(timer); reject(new DOMException("The operation was aborted", "AbortError")); };
    const signal = opts && opts.signal;
    if (!signal) return;
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

function installFetch(handler) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("googleapis.com") && !u.includes("identitytoolkit")) return new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } });
    return handler(u, opts);
  };
  return () => { globalThis.fetch = orig; };
}

function spendNow(sql) {
  const now = new Date();
  return {
    daily: sql.rows.get(dailySpendKey(sub, now)) || 0,
    pool: sql.rows.get(poolSpendKey(now)) || 0,
  };
}

function bodyStall(opts) {
  return { ok: true, status: 200, json: async () => { await hang(opts); }, text: async () => "" };
}

function inputEstimate(body, rates) {
  return estimateSpendMicro({
    input_tokens: estimateInputTokens(JSON.stringify((body && body.messages) || [])),
    output_tokens: 0,
    web_search_requests: 0,
  }, rates);
}

function pauseTurn(usage) {
  return new Response(JSON.stringify({
    stop_reason: "pause_turn",
    content: [{ type: "text", text: "searching" }],
    usage,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function watchFor(list) {
  const rec = { email: "user@example.com", emailVerified: true, list };
  return {
    get: async (key, type) => {
      if (key !== "w:" + sub) return null;
      return type === "json" ? rec : JSON.stringify(rec);
    },
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true }),
  };
}

describe("request deadline and abort billing", { concurrency: false }, () => {
  test("overridden deadline settings stay inside the stale window", () => {
    const cap = Math.min(REQUEST_DEADLINE_MS, USAGE_HOLD_STALE_MS - 15000);
    assert.equal(clampedDeadlineBudget("500000"), cap);
    assert.equal(clampedDeadlineBudget("999999999"), 100_000);
    assert.ok(clampedDeadlineBudget("999999999") < USAGE_HOLD_STALE_MS);
    assert.equal(clampedDeadlineBudget("1500"), 1500);
    assert.equal(clampedRoundFloor("90000", 100_000), ROUND_FLOOR_MS);
    assert.equal(clampedRoundFloor("500", 1200), 500);
    assert.ok(clampedRoundFloor("90000", 100_000) < clampedDeadlineBudget("500000"));
  });

  test("a fallback that starts is aborted on the shared deadline and keeps the primary usage", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "250", ROUND_FLOOR_MS: "40" });
    let fallbacks = 0;
    let fallbackInput = 0;
    const restore = installFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (String(body.model).includes("sonnet")) {
        fallbacks += 1;
        fallbackInput = estimateSpendMicro({ input_tokens: estimateInputTokens(JSON.stringify(body.messages || [])), output_tokens: 0, web_search_requests: 0 }, ratesForModel({ FALLBACK_MODEL: "claude-sonnet-5-5" }, "claude-sonnet-5-5"));
        await hang(opts);
      }
      return new Response(JSON.stringify({ error: { message: "bad model" }, usage: { input_tokens: 500, output_tokens: 40, web_search_requests: 2 } }), { status: 400, headers: { "content-type": "application/json" } });
    });
    try {
      const res = await post("/lookup", { items: [{ id: "fb", name: "Fallback Hang", category: "Pouches" }] }, env);
      const out = await res.json();
      assert.equal(res.status, 502, JSON.stringify(out));
      assert.equal(fallbacks, 1);
      const primary = estimateSpendMicro({ input_tokens: 500, output_tokens: 40, web_search_requests: 2 });
      const got = spendNow(sql);
      assert.equal(got.daily, primary + fallbackInput);
      assert.equal(got.pool, primary + fallbackInput);
      assert.ok(fallbackInput > 0);
    } finally { restore(); }
  });

  test("photo ID abort billing includes the image", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    const restore = installFetch(async (url, opts) => { await hang(opts); return new Response("{}", { status: 200 }); });
    try {
      const res = await post("/identify", { image: "aaaa", category: "Pouches" }, env);
      assert.equal(res.status, 502);
      const got = spendNow(sql);
      const imageFloor = estimateSpendMicro({ input_tokens: MODEL_CALLS.identify.promptTokens, output_tokens: 0, web_search_requests: 0 });
      assert.ok(got.daily >= imageFloor);
      assert.ok(got.daily > 600);
      assert.equal(got.pool, got.daily);
    } finally { restore(); }
  });

  test("a battery abort bills the input that was sent", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      expected = estimateSpendMicro({ input_tokens: estimateInputTokens(JSON.stringify(body.messages || [])), output_tokens: 0, web_search_requests: 0 });
      await hang(opts);
      return new Response("{}", { status: 200 });
    });
    try {
      const res = await post("/battery", { name: "Light", category: "Pouches" }, env);
      assert.equal(res.status, 502);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > 0);
    } finally { restore(); }
  });

  test("a pace abort bills the input that was sent", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      expected = estimateSpendMicro({ input_tokens: estimateInputTokens(JSON.stringify(body.messages || [])), output_tokens: 0, web_search_requests: 0 });
      await hang(opts);
      return new Response("{}", { status: 200 });
    });
    try {
      const res = await post("/pace", { location: "Camp" }, env);
      assert.equal(res.status, 502);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > 0);
    } finally { restore(); }
  });

  test("a deal check abort bills the input that was sent", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    env.WATCH = {
      get: async (key, type) => {
        if (key !== "w:" + sub) return null;
        const rec = { list: [{ id: "w1", name: "Pouch", category: "Pouches", target: 20 }] };
        return type === "json" ? rec : JSON.stringify(rec);
      },
      put: async () => {},
      delete: async () => {},
      list: async () => ({ keys: [], list_complete: true }),
    };
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      expected = estimateSpendMicro({ input_tokens: estimateInputTokens(JSON.stringify(body.messages || [])), output_tokens: 0, web_search_requests: 0 });
      await hang(opts);
      return new Response("{}", { status: 200 });
    });
    try {
      const res = await post("/watch/check", { id: "w1" }, env);
      const out = await res.json();
      assert.equal(res.status, 200, JSON.stringify(out));
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > 0);
    } finally { restore(); }
  });

  test("the hourly deal check abort bills the input that was sent", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    const uid = "cronuser";
    env.WATCH = {
      list: async () => ({ keys: [{ name: "w:" + uid }], list_complete: true }),
      get: async (key, type) => {
        if (key !== "w:" + uid) return null;
        const rec = { email: "user@example.com", emailVerified: true, list: [{ id: "w1", name: "Pouch", category: "Pouches", target: 20 }] };
        return type === "json" ? rec : JSON.stringify(rec);
      },
      put: async () => {},
      delete: async () => {},
    };
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      if (!String(url).includes("anthropic")) return new Response("{}", { status: 200 });
      const body = JSON.parse(opts.body);
      expected = estimateSpendMicro({ input_tokens: estimateInputTokens(JSON.stringify(body.messages || [])), output_tokens: 0, web_search_requests: 0 });
      await hang(opts);
      return new Response("{}", { status: 200 });
    });
    try {
      let job;
      await worker.scheduled({}, env, { waitUntil(p) { job = p; } });
      await job;
      const got = {
        daily: sql.rows.get(dailySpendKey(uid, new Date())) || 0,
        pool: sql.rows.get(poolSpendKey(new Date())) || 0,
      };
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > 0);
    } finally { restore(); }
  });

  test("the pace follow-up is skipped when little time is left", async () => {
    const { env } = ledgerEnv({ REQUEST_DEADLINE_MS: "220", ROUND_FLOOR_MS: "180" });
    let calls = 0;
    const restore = installFetch(async () => {
      calls += 1;
      await new Promise(r => setTimeout(r, 70));
      return new Response(JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "not the plan" }],
        usage: { input_tokens: 100, output_tokens: 40, web_search_requests: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const res = await post("/pace", { location: "Camp" }, env);
      assert.equal(res.status, 502);
      assert.equal(calls, 1);
    } finally { restore(); }
  });

  test("another search round is skipped when little time is left", async () => {
    const { env } = ledgerEnv({ REQUEST_DEADLINE_MS: "220", ROUND_FLOOR_MS: "180" });
    let calls = 0;
    const restore = installFetch(async () => {
      calls += 1;
      await new Promise(r => setTimeout(r, 70));
      return new Response(JSON.stringify({
        stop_reason: "pause_turn",
        content: [{ type: "text", text: "searching" }],
        usage: { input_tokens: 1000, output_tokens: 80, web_search_requests: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const res = await post("/lookup", { items: [{ id: "s", name: "Search Round", category: "Pouches" }] }, env);
      assert.equal(res.status, 502);
      assert.equal(calls, 1);
    } finally { restore(); }
  });

  test("an abort that settles after the hold was released still bills the estimate", () => {
    const sql = fakeSql();
    const ledger = new UsageLedger({ storage: { sql } }, {});
    const t0 = Date.parse("2026-10-28T12:00:00Z");
    const spendKey = "spend:free:2026-10";
    const daily = "ds:acct:2026-10-28";
    const flight = inflightKey("acct", t0);
    const estimate = 18_000;
    const held = ledger.reserve({
      id: "late-abort",
      reserve: 2_520_000,
      cap: 25e6,
      spendKey,
      seedSpend: 0,
      dailyAdd: 1,
      dailyLimit: 40,
      monthAdd: 1,
      monthLimit: 10,
      dailyKey: "t:acct:2026-10-28",
      monthKey: "m:acct:2026-10",
      dailySpendKey: daily,
      dailySpendCap: 750_000,
      dailyEach: 26_000,
      inflightKey: flight,
      inflightLimit: 4,
      now: t0,
    });
    assert.equal(held.ok, true);
    ledger.prune({ now: new Date(t0 + USAGE_HOLD_STALE_MS + 1000).toISOString(), spendKey });
    assert.equal(sql.rows.has("hold:late-abort"), false);
    assert.equal(sql.rows.get(spendKey) || 0, 0);
    const settled = ledger.reconcile({
      id: "late-abort",
      actual: estimate,
      spendKey,
      dailySpendKey: daily,
      dailyHold: 26_000,
      inflightKey: flight,
      now: t0 + USAGE_HOLD_STALE_MS + 5000,
    });
    assert.equal(settled.released, true);
    assert.equal(settled.duplicate, false);
    assert.equal(sql.rows.get(spendKey), estimate);
    assert.equal(sql.rows.get(daily), estimate);
    const again = ledger.reconcile({ id: "late-abort", actual: estimate, spendKey, dailySpendKey: daily, now: t0 + USAGE_HOLD_STALE_MS + 6000 });
    assert.equal(again.duplicate, true);
    assert.equal(sql.rows.get(spendKey), estimate);
  });

  test("an abort while reading the model body still bills the input", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      expected = estimateSpendMicro({ input_tokens: estimateInputTokens(JSON.stringify(body.messages || [])), output_tokens: 0, web_search_requests: 0 });
      return {
        ok: true,
        status: 200,
        json: async () => { await hang(opts); },
        text: async () => "",
      };
    });
    try {
      const res = await post("/lookup", { items: [{ id: "body", name: "Body Read", category: "Pouches" }] }, env);
      assert.equal(res.status, 502);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > 0);
    } finally { restore(); }
  });

  test("November's hourly job deletes the old pool key with no lookup, including KV", async () => {
    const sql = fakeSql();
    const ledger = new UsageLedger({ storage: { sql } }, {});
    sql.rows.set("spend:free", 20e6);
    const kv = new Map([["spend:free", "20000000"]]);
    const env = {
      NOW: "2026-11-02T00:00:00.000Z",
      USAGE: { getByName: () => ledger },
      WATCH: {
        get: async (key) => kv.has(key) ? kv.get(key) : null,
        put: async (key, value) => { kv.set(key, value); },
        delete: async (key) => { kv.delete(key); },
        list: async () => ({ keys: [], list_complete: true }),
      },
    };
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    try {
      let job;
      await worker.scheduled({}, env, { waitUntil(p) { job = p; } });
      await job;
      assert.equal(sql.rows.has("spend:free"), false);
      assert.equal(kv.has("spend:free"), false);
    } finally { globalThis.fetch = orig; }
  });

  test("one deadline is shared by every item and every round in the request", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "400", ROUND_FLOOR_MS: "40" });
    const signals = [];
    let calls = 0;
    const restore = installFetch(async (url, opts) => {
      signals.push(opts.signal);
      calls += 1;
      if (calls > 2) {
        await hang(opts);
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "not json yet" }],
        usage: { input_tokens: 80, output_tokens: 10, web_search_requests: 0 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const flight = inflightKey(sub, new Date());
      const first = post("/lookup", { items: [1, 2].map(n => ({ id: "sh" + n, name: "Shared " + n, category: "Pouches" })) }, env);
      const wait = Date.now() + 1000;
      while ((sql.rows.get(flight) || 0) < 2 && Date.now() < wait) await new Promise(r => setTimeout(r, 10));
      assert.equal(sql.rows.get(flight) || 0, 2);
      const done = await first;
      assert.equal(done.status, 502);
      assert.ok(signals.length >= 4);
      assert.equal(new Set(signals).size, 1);
      assert.equal(sql.rows.get(flight) || 0, 0);
      const secondSignals = [];
      globalThis.fetch = async (url, opts) => {
        if (String(url).includes("googleapis.com")) return new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } });
        secondSignals.push(opts.signal);
        await hang(opts);
        return new Response("{}", { status: 200 });
      };
      await post("/lookup", { items: [{ id: "other", name: "Other", category: "Pouches" }] }, env);
      assert.equal(secondSignals.length > 0, true);
      assert.equal(secondSignals[0] === signals[0], false);
    } finally { restore(); }
  });

  test("deadline overrides reject 0, negatives, blanks, and hex", () => {
    const cap = Math.min(REQUEST_DEADLINE_MS, USAGE_HOLD_STALE_MS - 15000);
    assert.equal(ROUND_FLOOR_MIN_MS, 15_000);
    for (const raw of ["0", "-5", "NaN", "", "0x10", "1.5", "16ms"]) {
      assert.equal(clampedDeadlineBudget(raw), cap, raw);
    }
    assert.notEqual(clampedDeadlineBudget("0x10"), 16);
    assert.equal(clampedRoundFloor("0", 100_000), ROUND_FLOOR_MIN_MS);
    assert.equal(clampedRoundFloor("10", 100_000), ROUND_FLOOR_MIN_MS);
    for (const raw of ["-1", "NaN", "", "0x10", "1.5"]) {
      assert.equal(clampedRoundFloor(raw, 100_000), ROUND_FLOOR_MS, raw);
    }
    assert.notEqual(clampedRoundFloor("0x10", 100_000), 16);
    assert.equal(clampedRoundFloor("500", 1200), 500);
  });

  test("a lookup body-read abort keeps the finished round", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "400", ROUND_FLOOR_MS: "30" });
    const round1 = { input_tokens: 8000, output_tokens: 400, web_search_requests: 3 };
    let calls = 0;
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      calls += 1;
      const body = JSON.parse(opts.body);
      if (calls === 1) return pauseTurn(round1);
      expected = estimateSpendMicro(round1) + inputEstimate(body);
      return bodyStall(opts);
    });
    try {
      const res = await post("/lookup", { items: [{ id: "round", name: "Finished Round", category: "Pouches" }] }, env);
      assert.equal(res.status, 502);
      assert.equal(calls, 2);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > estimateSpendMicro(round1));
    } finally { restore(); }
  });

  test("a fallback body-read abort keeps the primary and the finished fallback round", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "700", ROUND_FLOOR_MS: "40" });
    const rated = { FALLBACK_MODEL: "claude-sonnet-5-5", MODEL: "claude-haiku-5-5" };
    const primaryUsage = { input_tokens: 4000, output_tokens: 800, web_search_requests: 2 };
    const fallbackUsage = { input_tokens: 3000, output_tokens: 600, web_search_requests: 1 };
    const primaryCost = estimateSpendMicro(primaryUsage, ratesForModel(rated, "claude-haiku-5-5"));
    const fallbackCost = estimateSpendMicro(fallbackUsage, ratesForModel(rated, "claude-sonnet-5-5"));
    let fallbackCalls = 0;
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (!String(body.model).includes("sonnet")) {
        return new Response(JSON.stringify({ error: { message: "bad model" }, usage: primaryUsage }), { status: 400, headers: { "content-type": "application/json" } });
      }
      fallbackCalls += 1;
      if (fallbackCalls === 1) return pauseTurn(fallbackUsage);
      expected = primaryCost + fallbackCost + inputEstimate(body, ratesForModel(rated, "claude-sonnet-5-5"));
      return bodyStall(opts);
    });
    try {
      const res = await post("/lookup", { items: [{ id: "fb-body", name: "Fallback Body", category: "Pouches" }] }, env);
      assert.equal(res.status, 502);
      assert.equal(fallbackCalls, 2);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > primaryCost + fallbackCost);
    } finally { restore(); }
  });

  test("a hang abort after a finished lookup round keeps that round", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "400", ROUND_FLOOR_MS: "30" });
    const round1 = { input_tokens: 8000, output_tokens: 400, web_search_requests: 3 };
    let calls = 0;
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      calls += 1;
      const body = JSON.parse(opts.body);
      if (calls === 1) return pauseTurn(round1);
      expected = estimateSpendMicro(round1) + inputEstimate(body);
      await hang(opts);
      return new Response("{}", { status: 200 });
    });
    try {
      const res = await post("/lookup", { items: [{ id: "hang-round", name: "Hang Round", category: "Pouches" }] }, env);
      assert.equal(res.status, 502);
      assert.equal(calls, 2);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(got.daily > estimateSpendMicro(round1));
    } finally { restore(); }
  });

  test("photo ID body-read abort bills the exact text plus image estimate", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      const blocks = body.messages && body.messages[0] && body.messages[0].content;
      const text = Array.isArray(blocks) ? ((blocks.find(b => b && b.type === "text") || {}).text || "") : "";
      expected = estimateSpendMicro({
        input_tokens: estimateInputTokens(text) + MODEL_CALLS.identify.promptTokens,
        output_tokens: 0,
        web_search_requests: 0,
      });
      return bodyStall(opts);
    });
    try {
      const res = await post("/identify", { image: "aaaa", category: "Pouches" }, env);
      assert.equal(res.status, 502);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      const imageOnly = estimateSpendMicro({ input_tokens: MODEL_CALLS.identify.promptTokens, output_tokens: 0, web_search_requests: 0 });
      assert.ok(expected > imageOnly);
    } finally { restore(); }
  });

  test("a battery body-read abort bills the input that was sent", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      expected = inputEstimate(JSON.parse(opts.body));
      return bodyStall(opts);
    });
    try {
      const res = await post("/battery", { name: "Light", category: "Pouches" }, env);
      assert.equal(res.status, 502);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > 0);
    } finally { restore(); }
  });

  test("a pace body-read abort bills the input that was sent", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      expected = inputEstimate(JSON.parse(opts.body));
      return bodyStall(opts);
    });
    try {
      const res = await post("/pace", { location: "Camp" }, env);
      assert.equal(res.status, 502);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > 0);
    } finally { restore(); }
  });

  test("a deal body-read abort bills the input that was sent", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80" });
    env.WATCH = watchFor([{ id: "w1", name: "Pouch", category: "Pouches", target: 20 }]);
    let expected = 0;
    const restore = installFetch(async (url, opts) => {
      expected = inputEstimate(JSON.parse(opts.body));
      return bodyStall(opts);
    });
    try {
      const res = await post("/watch/check", { id: "w1" }, env);
      const out = await res.json();
      assert.equal(res.status, 200, JSON.stringify(out));
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > 0);
    } finally { restore(); }
  });

  test("a round that never starts does not add an input estimate", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "80", ROUND_FLOOR_MS: "20" });
    const round1 = { input_tokens: 2000, output_tokens: 400, web_search_requests: 2 };
    let calls = 0;
    const restore = installFetch(async () => {
      calls += 1;
      await new Promise(r => setTimeout(r, 120));
      return pauseTurn(round1);
    });
    try {
      const res = await post("/lookup", { items: [{ id: "unsent", name: "Unsent Round", category: "Pouches" }] }, env);
      assert.equal(res.status, 502);
      assert.equal(calls, 1);
      const got = spendNow(sql);
      const only = estimateSpendMicro(round1);
      assert.equal(got.daily, only);
      assert.equal(got.pool, only);
    } finally { restore(); }
  });

  test("time before the model call counts toward the deadline", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "200", HANDLER_DELAY_MS: "120" });
    let expected = 0;
    let calls = 0;
    const restore = installFetch(async (url, opts) => {
      calls += 1;
      expected = inputEstimate(JSON.parse(opts.body));
      await hang(opts);
      return new Response("{}", { status: 200 });
    });
    try {
      const started = Date.now();
      const res = await post("/lookup", { items: [{ id: "pre", name: "Pre Call", category: "Pouches" }] }, env);
      const elapsed = Date.now() - started;
      assert.equal(res.status, 502);
      assert.equal(calls, 1);
      assert.ok(elapsed < 280, "elapsed " + elapsed);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
    } finally { restore(); }
  });

  test("October's hourly job keeps the old pool keys before the seed", async () => {
    const sql = fakeSql();
    const ledger = new UsageLedger({ storage: { sql } }, {});
    sql.rows.set("spend:free", 20e6);
    const kv = new Map([["spend:free", "20000000"]]);
    const env = {
      NOW: "2026-10-28T12:00:00.000Z",
      USAGE: { getByName: () => ledger },
      WATCH: {
        get: async (key) => kv.has(key) ? kv.get(key) : null,
        put: async (key, value) => { kv.set(key, value); },
        delete: async (key) => { kv.delete(key); },
        list: async () => ({ keys: [], list_complete: true }),
      },
    };
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    try {
      let job;
      await worker.scheduled({}, env, { waitUntil(p) { job = p; } });
      await job;
      assert.equal(sql.rows.get("spend:free"), 20e6);
      assert.equal(kv.get("spend:free"), "20000000");
      assert.equal(sql.rows.has("seeded:pool"), false);
    } finally { globalThis.fetch = orig; }
  });

  test("an abort that finishes after the hold was released still bills the estimate", async () => {
    const { sql, env } = ledgerEnv({ REQUEST_DEADLINE_MS: "500" });
    let expected = 0;
    let release = () => {};
    const gate = new Promise(r => { release = r; });
    const restore = installFetch(async (url, opts) => {
      expected = inputEstimate(JSON.parse(opts.body));
      await gate;
      await hang(opts);
      return new Response("{}", { status: 200 });
    });
    try {
      const pending = post("/lookup", { items: [{ id: "stale-http", name: "Stale Abort", category: "Pouches" }] }, env);
      const ledger = env.USAGE.getByName();
      const wait = Date.now() + 1500;
      let flight = null;
      while (Date.now() < wait) {
        flight = [...sql.rows.keys()].find(k => k.startsWith("if:" + sub + ":"));
        if (flight) break;
        await new Promise(r => setTimeout(r, 10));
      }
      assert.ok(flight, [...sql.rows.keys()].join(","));
      const hold = [...sql.rows.keys()].find(k => k.startsWith("hold:"));
      assert.ok(hold);
      ledger.prune({ now: new Date(Date.now() + USAGE_HOLD_STALE_MS + 5000).toISOString(), spendKey: poolSpendKey(new Date()) });
      assert.equal(sql.rows.has(hold), false);
      assert.equal([...sql.rows.keys()].some(k => k.startsWith("rel:")), true);
      release();
      const res = await pending;
      assert.equal(res.status, 502);
      const got = spendNow(sql);
      assert.equal(got.daily, expected);
      assert.equal(got.pool, expected);
      assert.ok(expected > 0);
    } finally { release(); restore(); }
  });

  test("a request that finishes late logs how far past the deadline it ran", async () => {
    const { env } = ledgerEnv({ REQUEST_DEADLINE_MS: "40" });
    const logs = [];
    const orig = console.log;
    console.log = (...args) => { logs.push(args.map(String).join(" ")); };
    const restore = installFetch(async () => {
      await new Promise(r => setTimeout(r, 5200));
      return new Response(JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"retailNew":1,"usedLow":1,"usedHigh":2,"value":1,"weightOz":8,"priceNote":"","weightNote":"","sources":[]}' }],
        usage: { input_tokens: 10, output_tokens: 10, web_search_requests: 0 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      await post("/lookup", { items: [{ id: "late", name: "Late", category: "Pouches" }] }, env);
      const line = logs.find(l => l.startsWith("deadline: late "));
      assert.ok(line, logs.join("\n"));
      const match = /^deadline: late (\d+)ms \/lookup$/.exec(line);
      assert.ok(match, line);
      assert.ok(Number(match[1]) > 5000);
    } finally {
      console.log = orig;
      restore();
    }
  });
});
