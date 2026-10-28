// Server-side email redaction. The delete request only enqueues this work.
// FIREBASE_SA_JSON is optional: without it the job stays queued and nothing is thrown.

import {
  REDACT_PAGE_SIZE, REDACT_OPS_BUDGET, REDACT_RECORD_MAX_BYTES,
  redactionJobBody, redactionRetryPlan, redactionProgressBody, redactionFailureBody, orderRedactions,
} from "../js/logic.js";
import { firestoreAccessToken } from "./firestore-admin.js";

export const REDACT_PREFIX = "redact:";

function rootUrl(project) {
  return "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(project) + "/databases/(default)/documents";
}

function docUrl(name) {
  return "https://firestore.googleapis.com/v1/" + String(name || "").replace(/^\/+/, "");
}

async function callFs(fetchImpl, token, url, opts) {
  const res = await fetchImpl(url, {
    method: opts.method,
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: opts.body,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function docsOf(data) {
  if (Array.isArray(data)) return data.map(row => row && row.document).filter(doc => doc && doc.name);
  if (data && Array.isArray(data.documents)) return data.documents.filter(doc => doc && doc.name);
  return [];
}

function fieldString(doc, field) {
  const value = doc && doc.fields && doc.fields[field];
  return value && typeof value.stringValue === "string" ? value.stringValue : "";
}

function hasField(doc, field) {
  return !!(doc && doc.fields && Object.prototype.hasOwnProperty.call(doc.fields, field));
}

function docId(name) {
  const parts = String(name || "").split("/");
  return parts[parts.length - 1] || "";
}

function safeId(value) {
  const id = String(value || "").trim();
  if (!id || /[/\s]/.test(id)) return "";
  return id;
}

export async function emailHoldKey(secret, email) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(email || "").trim().toLowerCase()));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  return "emailhold:" + hex;
}

export async function enqueueRedaction(env, uid, email, nowIso) {
  if (!env || !env.WATCH || !uid) throw new Error("redact");
  const addr = String(email || "").trim().toLowerCase();
  if (!addr) return;
  const raw = redactionJobBody(uid, addr, nowIso || new Date().toISOString());
  if (!raw) throw new Error("redact");
  await env.WATCH.put(REDACT_PREFIX + uid, raw);
  if (!env.EMAIL_HMAC_KEY) return;
  const key = await emailHoldKey(env.EMAIL_HMAC_KEY, addr);
  const hold = JSON.stringify({ uid: String(uid).trim(), at: String(nowIso || new Date().toISOString()) });
  if (hold.length > 256) throw new Error("redact");
  await env.WATCH.put(key, hold);
}

export async function releaseEmailHold(env, user) {
  try {
    if (!env || !env.WATCH || !env.EMAIL_HMAC_KEY || !user || user.email_verified === false || !user.email) return;
    const key = await emailHoldKey(env.EMAIL_HMAC_KEY, user.email);
    const raw = await env.WATCH.get(key);
    if (!raw) return;
    let uid = "";
    try { uid = String((JSON.parse(raw) || {}).uid || ""); }
    catch { uid = ""; }
    await env.WATCH.delete(key);
    if (uid && !/[\s/]/.test(uid)) await env.WATCH.delete(REDACT_PREFIX + uid);
  } catch { /* a lookup still runs when the hold cannot be cleared */ }
}

function loanName(project, lender, loanId) {
  return "projects/" + project + "/databases/(default)/documents/users/" + lender + "/loans/" + loanId;
}

function emailMatches(doc, email) {
  const want = String(email || "").trim().toLowerCase();
  const friend = fieldString(doc, "friendEmail").trim().toLowerCase();
  const lower = fieldString(doc, "friendEmailLower").trim().toLowerCase();
  if (!hasField(doc, "friendEmail") && !hasField(doc, "friendEmailLower")) return true;
  return friend === want || lower === want;
}

async function commitClear(fetchImpl, token, project, name) {
  const write = {
    update: {
      name,
      fields: {
        friendEmail: { stringValue: "" },
        friendEmailLower: { stringValue: "" },
      },
    },
    updateMask: { fieldPaths: ["friendEmail", "friendEmailLower", "updatedAt", "serverUpdatedAt"] },
    updateTransforms: ["updatedAt", "serverUpdatedAt"].map(fieldPath => ({ fieldPath, setToServerValue: "REQUEST_TIME" })),
    currentDocument: { exists: true },
  };
  return callFs(fetchImpl, token, rootUrl(project) + ":commit", {
    method: "POST",
    body: JSON.stringify({ writes: [write] }),
  });
}

function clearStatus(res) {
  if (!res) return "failed";
  if (res.status === 200) return "ok";
  const status = res.data && res.data.error && res.data.error.status;
  if (res.status === 404 || status === "NOT_FOUND" || status === "FAILED_PRECONDITION") return "missing";
  return "failed";
}

// One bounded pass. Real loans are cleared before forged lends. A short page advances the phase.
export async function redactStoredEmail(opts) {
  const project = opts && opts.project;
  const token = opts && opts.token;
  const email = String((opts && opts.email) || "").trim().toLowerCase();
  const incoming = (opts && opts.state) || {};
  const state = {
    phase: incoming.phase || "loans",
    cursor: String(incoming.cursor || ""),
    lendCursor: String(incoming.lendCursor || ""),
  };
  const budget = Math.max(1, Math.floor(+(opts && opts.budget) || REDACT_OPS_BUDGET));
  const pageSize = Math.max(1, Math.floor(+(opts && opts.pageSize) || REDACT_PAGE_SIZE));
  const fetchImpl = (opts && opts.fetchImpl) || fetch;
  const result = { state, ops: 0, loanClears: [], lendDeletes: [], skipped: false };
  if (!project || !email) return result;
  if (!token) return { ...result, skipped: true };

  async function call(url, options) {
    if (result.ops >= budget) return { budget: true, status: 0, data: {} };
    result.ops += 1;
    return callFs(fetchImpl, token, url, options);
  }

  async function queryPage(from, field, cursor) {
    const structuredQuery = {
      from,
      where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: email } } },
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: pageSize,
    };
    if (cursor) structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
    const res = await call(rootUrl(project) + ":runQuery", { method: "POST", body: JSON.stringify({ structuredQuery }) });
    if (res.budget) return { budget: true, docs: [] };
    if (res.status !== 200) throw new Error("query");
    const docs = docsOf(res.data);
    return { docs, full: docs.length >= pageSize };
  }

  async function clearLoanDoc(name) {
    if (result.ops >= budget) return "budget";
    result.ops += 1;
    const committed = await commitClear(fetchImpl, token, project, name);
    const status = clearStatus(committed);
    if (status === "failed") throw new Error("loan");
    if (status === "ok") result.loanClears.push(name);
    return status;
  }

  async function deleteLend(name) {
    if (result.ops >= budget) return "budget";
    result.ops += 1;
    const res = await callFs(fetchImpl, token, docUrl(name), { method: "DELETE" });
    if (res.status === 200 || res.status === 204 || res.status === 404) {
      result.lendDeletes.push(name);
      return "ok";
    }
    throw new Error("lend");
  }

  async function loansPage(cursor) {
    const page = await queryPage([{ collectionId: "loans", allDescendants: true }], "friendEmailLower", cursor);
    if (page.budget) return { budget: true };
    let processed = 0;
    for (const doc of page.docs) {
      if (!emailMatches(doc, email)) { processed += 1; continue; }
      const status = await clearLoanDoc(doc.name);
      if (status === "budget") return { budget: true, cursor };
      processed += 1;
    }
    if (processed < page.docs.length) return { budget: true, cursor };
    if (!page.full) return { done: true, cursor: "" };
    return { cursor: page.docs[page.docs.length - 1].name };
  }

  async function lendsPage(cursor) {
    const page = await queryPage([{ collectionId: "lends" }], "borrowerEmailLower", cursor);
    if (page.budget) return { budget: true };
    const ranked = [];
    for (const doc of page.docs) {
      const loanId = safeId(docId(doc.name));
      const lender = safeId(fieldString(doc, "lender"));
      if (!loanId || !lender) {
        ranked.push({ doc, match: false, clearLoan: false, name: "" });
        continue;
      }
      if (result.ops >= budget) return { budget: true, cursor };
      result.ops += 1;
      const got = await callFs(fetchImpl, token, docUrl(loanName(project, lender, loanId)), { method: "GET" });
      let match = false;
      let clearLoan = false;
      if (got.status === 200) {
        const lenderOnLoan = fieldString(got.data, "lender");
        match = !lenderOnLoan || lenderOnLoan === lender;
        clearLoan = match && emailMatches(got.data, email);
      } else if (got.status !== 404) {
        throw new Error("loan-get");
      }
      ranked.push({ doc, match, clearLoan, name: loanName(project, lender, loanId) });
    }
    const ordered = orderRedactions(ranked);
    let processed = 0;
    for (const row of ordered.now) {
      if (row.clearLoan && row.name) {
        const status = await clearLoanDoc(row.name);
        if (status === "budget") return { budget: true, cursor };
      }
      const removed = await deleteLend(row.doc.name);
      if (removed === "budget") return { budget: true, cursor };
      processed += 1;
    }
    if (processed < page.docs.length) return { budget: true, cursor };
    if (!page.full) return { done: true, cursor: "" };
    return { cursor: page.docs[page.docs.length - 1].name };
  }

  if (state.phase === "loans") {
    const step = await loansPage(state.cursor);
    if (step.budget) return result;
    if (step.done) {
      state.phase = "lends";
      state.cursor = "";
    } else {
      state.cursor = step.cursor || state.cursor;
      return result;
    }
  }
  if (state.phase === "lends") {
    const step = await lendsPage(state.lendCursor);
    if (step.budget) return result;
    if (step.done) {
      state.phase = "watch";
      state.cursor = "";
      state.lendCursor = "";
    } else {
      state.lendCursor = step.cursor || state.lendCursor;
    }
    return result;
  }
  const loans = await loansPage(state.cursor);
  if (loans.budget) return result;
  if (loans.done) state.cursor = "";
  else state.cursor = loans.cursor || state.cursor;
  const lends = await lendsPage(state.lendCursor);
  if (lends.budget) return result;
  if (lends.done) state.lendCursor = "";
  else state.lendCursor = lends.cursor || state.lendCursor;
  return result;
}

export async function runQueuedRedactions(env, fetchImpl) {
  if (!env || !env.WATCH) return 0;
  const fetchFn = fetchImpl || fetch;
  const now = Date.now();
  let token = null;
  try { token = await firestoreAccessToken(env, fetchFn); }
  catch { token = null; }
  let cursor;
  let done = 0;
  do {
    const page = await env.WATCH.list({ prefix: REDACT_PREFIX, cursor });
    for (const k of page.keys || []) {
      let raw = "";
      try { raw = await env.WATCH.get(k.name); }
      catch { continue; }
      let record = {};
      try { record = raw ? JSON.parse(raw) : {}; }
      catch { record = {}; }
      const plan = redactionRetryPlan(record, now);
      if (plan.action === "delete") {
        try { await env.WATCH.delete(k.name); done++; }
        catch { /* the next hourly run tries again */ }
        continue;
      }
      if (plan.action === "wait" || !token || !env.FIREBASE_PROJECT) continue;
      try {
        const pass = await redactStoredEmail({
          project: env.FIREBASE_PROJECT,
          token,
          email: record.email,
          state: record,
          fetchImpl: fetchFn,
        });
        if (pass.skipped) continue;
        const next = redactionProgressBody(record, pass.state, now);
        if (!next) await env.WATCH.delete(k.name);
        else await env.WATCH.put(k.name, next);
        done++;
      } catch {
        const failed = redactionFailureBody(record, now);
        try {
          if (failed) await env.WATCH.put(k.name, failed);
          else await env.WATCH.delete(k.name);
        } catch { /* the next hourly run tries again */ }
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return done;
}

export { REDACT_RECORD_MAX_BYTES };
