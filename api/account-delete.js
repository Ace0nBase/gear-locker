// Finish a tombstoned account with the person's own ID token.
// Rules allow that owner to list and delete their shares, locker, and lends, and to clear their email.
// 404 means the row is already gone. The auth user is deleted only after this returns ok.

import { USER_COLLECTIONS, loanRedactTargets } from "../js/logic.js";

const GEAR_STILL_HERE = "Couldn't finish removing your gear. Your sign-in is still here. Try again.";

function rootUrl(project) {
  return "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(project) + "/databases/(default)/documents";
}

function docUrl(name) {
  return "https://firestore.googleapis.com/v1/" + String(name || "").replace(/^\/+/, "");
}

async function callFs(fetchImpl, idToken, url, opts) {
  const res = await fetchImpl(url, {
    method: opts.method,
    headers: { authorization: "Bearer " + idToken, "content-type": "application/json" },
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

async function runQuery(fetchImpl, idToken, root, structuredQuery) {
  const res = await callFs(fetchImpl, idToken, root + ":runQuery", {
    method: "POST",
    body: JSON.stringify({ structuredQuery }),
  });
  if (res.status !== 200) throw new Error("query");
  return docsOf(res.data);
}

async function deleteNamed(fetchImpl, idToken, name) {
  const res = await callFs(fetchImpl, idToken, docUrl(name), { method: "DELETE" });
  if (res.status === 200 || res.status === 204 || res.status === 404) return;
  throw new Error("delete");
}

async function deleteQuery(fetchImpl, idToken, root, structuredQuery) {
  await forEachMatch(fetchImpl, idToken, root, structuredQuery, async docs => {
    for (const doc of docs) await deleteNamed(fetchImpl, idToken, doc.name);
  });
}

async function deleteCollection(fetchImpl, idToken, url) {
  let page = "";
  do {
    const join = url.includes("?") ? "&" : "?";
    const res = await callFs(fetchImpl, idToken, url + join + "pageSize=300" + (page ? "&pageToken=" + encodeURIComponent(page) : ""), { method: "GET" });
    if (res.status === 404) return;
    if (res.status !== 200) throw new Error("list");
    for (const doc of docsOf(res.data)) await deleteNamed(fetchImpl, idToken, doc.name);
    page = (res.data && res.data.nextPageToken) || "";
  } while (page);
}

function equalFilter(field, value) {
  return { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } };
}

// One Firestore page. The loop below continues until a page comes back empty.
const PAGE_SIZE = 300;

function withPage(structuredQuery, after) {
  const query = {
    ...structuredQuery,
    orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
    limit: PAGE_SIZE,
  };
  if (after) query.startAt = { values: [{ referenceValue: after }], before: false };
  return query;
}

async function forEachMatch(fetchImpl, idToken, root, structuredQuery, visit) {
  let after = "";
  for (;;) {
    const docs = await runQuery(fetchImpl, idToken, root, withPage(structuredQuery, after));
    if (!docs.length) return;
    await visit(docs);
    const last = String((docs[docs.length - 1] && docs[docs.length - 1].name) || "");
    if (!last || last === after) throw new Error("page");
    if (docs.length < PAGE_SIZE) return;
    after = last;
  }
}

async function patchFields(fetchImpl, idToken, name, fields, mustExist) {
  const mask = fields.map(field => "updateMask.fieldPaths=" + encodeURIComponent(field)).join("&");
  const exists = mustExist ? "&currentDocument.exists=true" : "";
  const body = { fields: {} };
  const stamp = new Date().toISOString();
  for (const field of fields) body.fields[field] = field === "updatedAt" ? { timestampValue: stamp } : { stringValue: "" };
  let res;
  try {
    res = await callFs(fetchImpl, idToken, docUrl(name) + "?" + mask + exists, { method: "PATCH", body: JSON.stringify(body) });
  } catch {
    return "failed";
  }
  if (res.status === 200) return "ok";
  if (res.status === 404) return "missing";
  return "failed";
}

function stringField(doc, field) {
  const value = doc && doc.fields && doc.fields[field];
  return value && typeof value.stringValue === "string" ? value.stringValue : "";
}

function docId(doc) {
  const parts = String((doc && doc.name) || "").split("/");
  return parts[parts.length - 1] || "";
}

async function collectQuery(fetchImpl, idToken, root, structuredQuery) {
  const found = [];
  await forEachMatch(fetchImpl, idToken, root, structuredQuery, async docs => {
    found.push(...docs);
  });
  return found;
}

function loanDocName(project, lender, loanId) {
  return "projects/" + project + "/databases/(default)/documents/users/" + lender + "/loans/" + loanId;
}

function explicitlyUnverified(user) {
  return !!(user && (user.email_verified === false || user.emailVerified === false));
}

function hasField(doc, field) {
  return !!(doc && doc.fields && Object.prototype.hasOwnProperty.call(doc.fields, field));
}

// Redaction is best effort. A missing loan, a lender mismatch, or a changed email is skipped.
// Anything else is queued. It never fails the caller's own delete.
async function redactBorrowed(fetchImpl, idToken, project, root, email, user) {
  const pending = [];
  const want = String(email || "").trim().toLowerCase();
  if (!want || explicitlyUnverified(user)) return pending;
  const raw = String(email || "");
  const queries = [equalFilter("borrowerEmail", raw)];
  if (raw.toLowerCase() === raw) queries.push(equalFilter("borrowerEmailLower", want));
  const docs = [];
  const seen = new Set();
  try {
    for (const where of queries) {
      const page = await collectQuery(fetchImpl, idToken, root, {
        from: [{ collectionId: "lends" }],
        where,
      });
      for (const doc of page) {
        if (!doc || !doc.name || seen.has(doc.name)) continue;
        seen.add(doc.name);
        docs.push(doc);
      }
    }
  } catch {
    pending.push({ reason: "lends-query" });
    return pending;
  }
  const plan = loanRedactTargets(docs.map(doc => ({ id: docId(doc), lender: stringField(doc, "lender") })));
  for (const path of plan.paths) {
    const name = loanDocName(project, path.lender, path.loanId);
    let got;
    try {
      got = await callFs(fetchImpl, idToken, docUrl(name), { method: "GET" });
    } catch {
      got = { status: 0, data: {} };
    }
    if (got.status === 404) continue;
    if (got.status === 200) {
      const lenderOnLoan = stringField(got.data, "lender");
      if (lenderOnLoan && lenderOnLoan !== path.lender) continue;
      if (hasField(got.data, "friendEmail") && stringField(got.data, "friendEmail").trim().toLowerCase() !== want) continue;
    }
    const patched = await patchFields(fetchImpl, idToken, name, ["friendEmail", "updatedAt"], true);
    if (patched === "missing") continue;
    if (patched !== "ok") pending.push({ lender: path.lender, loanId: path.loanId, reason: "loan" });
  }
  for (const doc of docs) {
    const cleared = await patchFields(fetchImpl, idToken, doc.name, ["borrowerEmail", "borrowerEmailLower", "updatedAt"], false);
    if (cleared === "failed") pending.push({ lend: doc.name, reason: "lend" });
  }
  return pending;
}

export async function deleteUserFirestore(env, idToken, user, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const project = env && env.FIREBASE_PROJECT;
  const uid = user && user.sub;
  if (!project || !uid || !idToken) return { ok: false, error: GEAR_STILL_HERE, redactPending: [] };
  const email = String((user && user.email) || "");
  const root = rootUrl(project);
  try {
    await deleteQuery(fetchFn, idToken, root, {
      from: [{ collectionId: "shares" }],
      where: equalFilter("owner", uid),
    });
    for (const col of USER_COLLECTIONS) {
      await deleteCollection(fetchFn, idToken, root + "/users/" + encodeURIComponent(uid) + "/" + encodeURIComponent(col));
    }
    await deleteQuery(fetchFn, idToken, root, {
      from: [{ collectionId: "lends" }],
      where: equalFilter("lender", uid),
    });
  } catch {
    return { ok: false, error: GEAR_STILL_HERE, redactPending: [] };
  }
  let redactPending = [];
  try {
    redactPending = await redactBorrowed(fetchFn, idToken, project, root, email, user);
  } catch {
    redactPending = [{ reason: "redact" }];
  }
  return { ok: true, redactPending };
}
