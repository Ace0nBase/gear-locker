import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deleteUserFirestore } from "../api/account-delete.js";
import { firestoreAccessToken, parseServiceAccount, resetFirestoreTokenCache, serviceAccountLogLine } from "../api/firestore-admin.js";
import { emailHoldKey, enqueueRedaction, HOLD_TTL_SECONDS, redactStoredEmail, releaseEmailHold, runQueuedRedactions } from "../api/redact.js";
import {
  LEND_EMAIL_CAP, REDACT_MAX_AGE_MS, lendMailDocId, orderRedactions, redactionFailureBody, redactionJobBody,
  redactionRetryPlan, serverRow,
} from "../js/logic.js";

function projectName(kind, id, lender) {
  if (kind === "loans") return "projects/demo/databases/(default)/documents/users/" + lender + "/loans/" + id;
  return "projects/demo/databases/(default)/documents/lends/" + id;
}

function toFs(plain) {
  const fields = {};
  for (const [key, value] of Object.entries(plain || {})) fields[key] = { stringValue: String(value) };
  return fields;
}

function memoryFirestore() {
  const docs = new Map();
  const events = [];
  const fetchImpl = async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const json = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
    const full = String(url).replace("https://firestore.googleapis.com/v1/", "");
    if (String(url).includes(":runQuery")) {
      const query = body.structuredQuery;
      const field = query.where.fieldFilter.field.fieldPath;
      const value = query.where.fieldFilter.value.stringValue;
      const kind = query.from[0].collectionId;
      const after = query.startAt && query.startAt.values[0].referenceValue;
      let rows = [...docs.keys()].filter(name => name.includes("/" + kind + "/") && (docs.get(name)[field] || "") === value).sort();
      if (after) rows = rows.filter(name => name > after);
      rows = rows.slice(0, query.limit);
      return json(200, rows.map(name => ({ document: { name, fields: toFs(docs.get(name)) } })));
    }
    if (String(url).includes(":commit")) {
      const write = body.writes[0];
      const name = write.update.name;
      events.push({ op: "commit", name, write });
      if (write.currentDocument && write.currentDocument.exists && !docs.has(name)) return json(404, { error: { status: "NOT_FOUND" } });
      const next = { ...(docs.get(name) || {}) };
      for (const [key, value] of Object.entries(write.update.fields || {})) next[key] = value.stringValue;
      docs.set(name, next);
      return json(200, {});
    }
    if (method === "DELETE") {
      events.push({ op: "delete", name: full });
      docs.delete(full);
      return json(200, {});
    }
    if (method === "GET") {
      if (!docs.has(full)) return json(404, {});
      return json(200, { name: full, fields: toFs(docs.get(full)) });
    }
    return json(200, {});
  };
  return {
    docs,
    events,
    fetchImpl,
    put(kind, id, fields, lender) { docs.set(projectName(kind, id, lender), { ...fields }); },
  };
}

function memKv(startMs) {
  let now = startMs == null ? Date.now() : startMs;
  const data = new Map();
  function live(key) {
    const row = data.get(key);
    if (!row) return null;
    if (row.exp != null && row.exp <= now) {
      data.delete(key);
      return null;
    }
    return row;
  }
  return {
    data,
    setNow(ms) { now = ms; },
    async get(key) {
      const row = live(key);
      return row ? row.value : null;
    },
    async put(key, value, opts) {
      const ttl = opts && opts.expirationTtl;
      const exp = ttl ? now + Math.floor(+ttl) * 1000 : null;
      data.set(key, { value, exp });
    },
    async delete(key) { data.delete(key); },
    async list({ prefix } = {}) {
      const keys = [...data.keys()].filter(key => live(key) && String(key).startsWith(prefix || "")).sort();
      return { keys: keys.map(name => ({ name })), list_complete: true };
    },
  };
}

test("a delete with 10100 forged lends finishes in a fixed number of operations", async () => {
  async function count() {
    let calls = 0;
    let borrowerQueries = 0;
    const fetchImpl = async (url, opts) => {
      calls += 1;
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      const json = (status, data) => ({ status, json: async () => data });
      if (String(url).includes(":runQuery")) {
        const field = body.structuredQuery.where.fieldFilter.field.fieldPath;
        if (field === "borrowerEmail" || field === "borrowerEmailLower") {
          borrowerQueries += 1;
          return json(200, Array.from({ length: 10100 }, (_, i) => ({
            document: { name: "projects/demo/databases/(default)/documents/lends/f" + i, fields: { borrowerEmailLower: { stringValue: "a@b.co" } } },
          })));
        }
        return json(200, [{}]);
      }
      return json(200, { documents: [] });
    };
    const out = await deleteUserFirestore({ FIREBASE_PROJECT: "demo" }, "token", { sub: "abc", email: "a@b.co" }, fetchImpl);
    return { calls, borrowerQueries, ok: out.ok };
  }
  const none = await count();
  const many = await count();
  assert.equal(many.ok, true);
  assert.equal(none.borrowerQueries, 0);
  assert.equal(many.borrowerQueries, 0);
  assert.equal(many.calls, none.calls);
  assert.ok(many.calls < 40);
});

test("server redaction clears real loans first and resumes the next page", async () => {
  const db = memoryFirestore();
  for (let i = 0; i < 10; i++) {
    db.put("loans", "loan" + String(i).padStart(2, "0"), {
      lender: "owner", friendEmail: "A@B.co", friendEmailLower: "a@b.co",
    }, "owner");
  }
  db.put("lends", "real", { lender: "owner", borrowerEmailLower: "a@b.co" });
  for (let i = 0; i < 6; i++) db.put("lends", "fake" + i, { lender: "attacker", borrowerEmailLower: "a@b.co" });
  let state = { phase: "loans", cursor: "", lendCursor: "" };
  const first = await redactStoredEmail({
    project: "demo", token: "tok", email: "a@b.co", state, fetchImpl: db.fetchImpl, budget: 8, pageSize: 4,
  });
  state = first.state;
  const second = await redactStoredEmail({
    project: "demo", token: "tok", email: "a@b.co", state, fetchImpl: db.fetchImpl, budget: 8, pageSize: 4,
  });
  state = second.state;
  assert.equal(first.loanClears.length, 4);
  assert.equal(second.loanClears.length, 4);
  assert.equal(state.phase, "loans");
  assert.equal(db.events.some(event => event.op === "delete"), false);
  const clear = db.events.find(event => event.op === "commit");
  assert.ok(clear.write.updateTransforms.some(item => item.fieldPath === "updatedAt" && item.setToServerValue === "REQUEST_TIME"));
  assert.ok(clear.write.updateTransforms.some(item => item.fieldPath === "serverUpdatedAt" && item.setToServerValue === "REQUEST_TIME"));
  let removed = 0;
  for (let pass = 0; pass < 6 && state.phase !== "watch"; pass++) {
    const out = await redactStoredEmail({
      project: "demo", token: "tok", email: "a@b.co", state, fetchImpl: db.fetchImpl, budget: 40, pageSize: 4,
    });
    state = out.state;
    removed += out.lendDeletes.length;
  }
  assert.equal(state.phase, "watch");
  assert.equal(removed, 7);
  for (let i = 0; i < 10; i++) {
    const row = db.docs.get(projectName("loans", "loan" + String(i).padStart(2, "0"), "owner"));
    assert.equal(row.friendEmail, "");
    assert.equal(row.friendEmailLower, "");
  }
  assert.equal([...db.docs.keys()].some(name => name.includes("/lends/")), false);
});

test("a lends page clears a real loan before it deletes forged lends", async () => {
  const db = memoryFirestore();
  db.put("loans", "real", { lender: "owner", friendEmail: "a@b.co", friendEmailLower: "a@b.co" }, "owner");
  db.put("lends", "aaa", { lender: "attacker", borrowerEmailLower: "a@b.co" });
  db.put("lends", "real", { lender: "owner", borrowerEmailLower: "a@b.co" });
  const state = { phase: "lends", cursor: "", lendCursor: "" };
  await redactStoredEmail({
    project: "demo", token: "tok", email: "a@b.co", state, fetchImpl: db.fetchImpl, budget: 20, pageSize: 4,
  });
  const writes = db.events.map(event => event.op + " " + event.name);
  const loanAt = writes.findIndex(line => line.startsWith("commit ") && line.includes("/loans/real"));
  const fakeAt = writes.findIndex(line => line.startsWith("delete ") && line.includes("/lends/aaa"));
  assert.ok(loanAt >= 0 && fakeAt > loanAt);
  assert.equal(db.docs.get(projectName("loans", "real", "owner")).friendEmail, "");
});

test("an edit-sheet write-back is cleared on the next pass", async () => {
  const db = memoryFirestore();
  const loan = projectName("loans", "real", "owner");
  db.put("loans", "real", { lender: "owner", friendEmail: "a@b.co", friendEmailLower: "a@b.co" }, "owner");
  db.put("lends", "real", { lender: "owner", borrowerEmailLower: "a@b.co" });
  let state = { phase: "loans", cursor: "", lendCursor: "" };
  const swept = await redactStoredEmail({ project: "demo", token: "tok", email: "a@b.co", state, fetchImpl: db.fetchImpl, budget: 30, pageSize: 4 });
  state = swept.state;
  assert.equal(state.phase, "watch");
  assert.equal(db.docs.get(loan).friendEmail, "");
  db.docs.set(loan, { lender: "owner", friendEmail: "a@b.co", friendEmailLower: "a@b.co" });
  db.put("lends", "real", { lender: "owner", borrowerEmailLower: "a@b.co" });
  const again = await redactStoredEmail({
    project: "demo", token: "tok", email: "a@b.co", state, fetchImpl: db.fetchImpl, budget: 30, pageSize: 4,
  });
  state = again.state;
  assert.equal(db.docs.get(loan).friendEmail, "");
  assert.equal(db.docs.get(loan).friendEmailLower, "");
  assert.ok(again.loanClears.includes(loan));
  assert.equal(db.docs.has(projectName("lends", "real")), false);
  assert.equal(state.phase, "watch");
});

test("a missing service account leaves the redaction job queued", async () => {
  resetFirestoreTokenCache();
  const kv = memKv();
  const env = { WATCH: kv, EMAIL_HMAC_KEY: "hold-key", FIREBASE_PROJECT: "demo" };
  await enqueueRedaction(env, "abc", "A@B.co", "2026-10-27T00:00:00.000Z", { email_verified: true });
  const job = await kv.get("redact:abc");
  assert.equal(JSON.parse(job).email, "a@b.co");
  assert.equal(JSON.parse(job).phase, "loans");
  const holdKey = [...kv.data.keys()].find(key => key.startsWith("emailhold:"));
  assert.ok(holdKey);
  assert.equal(holdKey.includes("@"), false);
  assert.equal(JSON.parse(await kv.get(holdKey)).uid, "abc");
  let tokenCalls = 0;
  await runQueuedRedactions(env, async () => { tokenCalls += 1; throw new Error("no network"); });
  assert.equal(tokenCalls, 0);
  assert.equal(await kv.get("redact:abc"), job);
  await releaseEmailHold(env, { email: "a@b.co", email_verified: true });
  assert.equal(await kv.get("redact:abc"), null);
  assert.equal(await kv.get(holdKey), null);
  await releaseEmailHold(env, { email: "a@b.co", email_verified: false });
});

test("an unverified delete does not queue email redaction or a hold", async () => {
  const kv = memKv();
  const env = { WATCH: kv, EMAIL_HMAC_KEY: "hold-key" };
  const when = "2026-10-27T00:00:00.000Z";
  await enqueueRedaction(env, "abc", "a@b.co", when, { email_verified: false });
  await enqueueRedaction(env, "abc", "a@b.co", when, { email: "a@b.co" });
  assert.equal(await kv.get("redact:abc"), null);
  assert.equal([...kv.data.keys()].some(key => String(key).startsWith("emailhold:")), false);
  await enqueueRedaction(env, "abc", "a@b.co", when, { emailVerified: true });
  assert.equal(JSON.parse(await kv.get("redact:abc")).email, "a@b.co");
  assert.equal([...kv.data.keys()].some(key => String(key).startsWith("emailhold:")), true);
});

test("the email hold expires 30 days after it is written", async () => {
  const start = Date.parse("2026-10-27T00:00:00.000Z");
  const kv = memKv(start);
  const env = { WATCH: kv, EMAIL_HMAC_KEY: "hold-key" };
  await enqueueRedaction(env, "abc", "a@b.co", "2026-10-27T00:00:00.000Z", { email_verified: true });
  const holdKey = [...kv.data.keys()].find(key => String(key).startsWith("emailhold:"));
  assert.equal(HOLD_TTL_SECONDS, 30 * 24 * 60 * 60);
  assert.ok(await kv.get(holdKey));
  kv.setNow(start + 29 * 24 * 60 * 60 * 1000);
  assert.ok(await kv.get(holdKey));
  kv.setNow(start + 31 * 24 * 60 * 60 * 1000);
  assert.equal(await kv.get(holdKey), null);
  assert.ok(await kv.get("redact:abc"));
});

test("the redaction job expires after 30 days and waits out its backoff", () => {
  const now = Date.parse("2026-10-27T00:00:00.000Z");
  const fresh = JSON.parse(redactionJobBody("abc", "a@b.co", "2026-10-27T00:00:00.000Z"));
  assert.equal(redactionRetryPlan(fresh, now).action, "retry");
  const failed = JSON.parse(redactionFailureBody(fresh, now));
  assert.equal(failed.attempts, 1);
  assert.equal(redactionRetryPlan(failed, now + 60 * 1000).action, "wait");
  const aged = { ...fresh, at: new Date(now - REDACT_MAX_AGE_MS - 1000).toISOString() };
  assert.equal(redactionRetryPlan(aged, now).action, "delete");
  assert.equal(redactionFailureBody(aged, now), null);
});

test("a saved loan stores the lowercased email, and the lend cap hash matches the rules", async () => {
  const row = serverRow({ id: "loan1", friendEmail: "Friend@Example.com", notes: "keep" });
  assert.equal(row.friendEmailLower, "friend@example.com");
  assert.equal(row.notes, "keep");
  assert.equal("friendEmailLower" in serverRow({ name: "Pouch" }), false);
  const hash = await lendMailDocId("Friend@Example.com");
  assert.equal(hash, createHash("sha256").update("friend@example.com").digest("hex").toUpperCase());
  assert.equal(LEND_EMAIL_CAP, 40);
  const ranked = orderRedactions([
    { id: "fake", match: false, clearLoan: false },
    { id: "real", match: true, clearLoan: true },
  ]);
  assert.equal(ranked.now[0].id, "real");
  assert.equal(ranked.later.length, 0);
});

test("the Firestore token is an RS256 JWT and is reused until it expires", async () => {
  resetFirestoreTokenCache();
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const bytes = new Uint8Array(pkcs8);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
  const raw = JSON.stringify({ client_email: "redact@gear-locker-c248c.iam.gserviceaccount.com", private_key: pem });
  assert.ok(parseServiceAccount(raw));
  assert.equal(parseServiceAccount(""), null);
  let hits = 0;
  let assertion = "";
  const fetchImpl = async (url, opts) => {
    hits += 1;
    const params = new URLSearchParams(opts.body);
    assertion = params.get("assertion");
    return { ok: true, status: 200, json: async () => ({ access_token: "ya29.test", expires_in: 3600 }) };
  };
  const env = { FIREBASE_SA_JSON: raw };
  assert.equal(await firestoreAccessToken(env, fetchImpl), "ya29.test");
  assert.equal(await firestoreAccessToken(env, fetchImpl), "ya29.test");
  assert.equal(hits, 1);
  const [header, payload, sig] = assertion.split(".");
  const headerJson = JSON.parse(Buffer.from(header, "base64url").toString());
  const body = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(headerJson.alg, "RS256");
  assert.equal(body.scope, "https://www.googleapis.com/auth/datastore");
  assert.equal(body.iss, "redact@gear-locker-c248c.iam.gserviceaccount.com");
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    pair.publicKey,
    Buffer.from(sig, "base64url"),
    new TextEncoder().encode(header + "." + payload),
  );
  assert.equal(verified, true);
  assert.equal(await firestoreAccessToken({}, fetchImpl), null);
  const key = await emailHoldKey("hold-key", "A@B.co");
  assert.equal(key, await emailHoldKey("hold-key", "a@b.co"));
  assert.notEqual(key, await emailHoldKey("other-key", "a@b.co"));
  resetFirestoreTokenCache();
});

test("the hourly service-account check logs only ok or a status code", async () => {
  resetFirestoreTokenCache();
  const missing = await serviceAccountLogLine({}, async () => { throw new Error("no network"); });
  assert.equal(missing, "sa_token: fail 0");

  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = "";
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
  const env = {
    FIREBASE_PROJECT: "gear-locker-c248c",
    FIREBASE_SA_JSON: JSON.stringify({ client_email: "probe@gear-locker-c248c.iam.gserviceaccount.com", private_key: pem }),
  };
  const secretBody = JSON.stringify({ error: "private_key leaked", access_token: "ya29.secret" });
  resetFirestoreTokenCache();
  const denied = await serviceAccountLogLine(env, async () => ({
    ok: false, status: 401, json: async () => JSON.parse(secretBody), text: async () => secretBody,
  }));
  assert.equal(denied, "sa_token: fail 401");
  assert.equal(denied.includes("ya29"), false);
  assert.equal(denied.includes("private_key"), false);

  resetFirestoreTokenCache();
  const reads = [];
  const ok = await serviceAccountLogLine(env, async (url) => {
    if (String(url).includes("oauth2.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "ya29.secret", expires_in: 3600 }), text: async () => secretBody };
    }
    reads.push(String(url));
    return { ok: true, status: 200, json: async () => ({ documents: [] }), text: async () => secretBody };
  });
  assert.equal(ok, "sa_token: ok");
  assert.equal(reads.length, 1);
  assert.match(reads[0], /\/documents\/deletedUsers\?pageSize=1$/);

  resetFirestoreTokenCache();
  const forbidden = await serviceAccountLogLine(env, async (url) => {
    if (String(url).includes("oauth2.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "ya29.secret", expires_in: 3600 }), text: async () => "" };
    }
    return { ok: false, status: 403, json: async () => ({ error: { message: secretBody } }), text: async () => secretBody };
  });
  assert.equal(forbidden, "sa_token: fail 403");
  assert.match(forbidden, /^sa_token: fail \d+$/);
  resetFirestoreTokenCache();
});
