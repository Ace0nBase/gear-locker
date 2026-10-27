// Finish a tombstoned account with the person's own ID token.
// Rules allow that owner to list and delete their shares, locker, and lends, and to clear their email.
// 404 means the row is already gone. The auth user is deleted only after this returns ok.

import { USER_COLLECTIONS } from "../js/logic.js";

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
  if (res.status === 403) return [];
  if (res.status !== 200) throw new Error("query");
  return docsOf(res.data);
}

async function deleteNamed(fetchImpl, idToken, name) {
  const res = await callFs(fetchImpl, idToken, docUrl(name), { method: "DELETE" });
  if (res.status === 200 || res.status === 204 || res.status === 404) return;
  throw new Error("delete");
}

async function deleteQuery(fetchImpl, idToken, root, structuredQuery) {
  const docs = await runQuery(fetchImpl, idToken, root, structuredQuery);
  for (const doc of docs) await deleteNamed(fetchImpl, idToken, doc.name);
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

async function clearFields(fetchImpl, idToken, name, fields) {
  const mask = fields.map(field => "updateMask.fieldPaths=" + encodeURIComponent(field)).join("&");
  const body = { fields: {} };
  const stamp = new Date().toISOString();
  for (const field of fields) body.fields[field] = { stringValue: field === "updatedAt" ? stamp : "" };
  const res = await callFs(fetchImpl, idToken, docUrl(name) + "?" + mask, { method: "PATCH", body: JSON.stringify(body) });
  if (res.status === 200 || res.status === 404 || res.status === 403) return;
  throw new Error("patch");
}

async function redactQuery(fetchImpl, idToken, root, collectionId, field, value, fields) {
  if (!value) return;
  const docs = await runQuery(fetchImpl, idToken, root, {
    from: [{ collectionId, allDescendants: collectionId === "loans" }],
    where: equalFilter(field, value),
    limit: 300,
  });
  for (const doc of docs) await clearFields(fetchImpl, idToken, doc.name, fields);
}

export async function deleteUserFirestore(env, idToken, user, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const project = env && env.FIREBASE_PROJECT;
  const uid = user && user.sub;
  if (!project || !uid || !idToken) return { ok: false, error: GEAR_STILL_HERE };
  const email = String((user && user.email) || "");
  const root = rootUrl(project);
  try {
    await deleteQuery(fetchFn, idToken, root, {
      from: [{ collectionId: "shares" }],
      where: equalFilter("owner", uid),
      limit: 300,
    });
    for (const col of USER_COLLECTIONS) {
      await deleteCollection(fetchFn, idToken, root + "/users/" + encodeURIComponent(uid) + "/" + encodeURIComponent(col));
    }
    await deleteQuery(fetchFn, idToken, root, {
      from: [{ collectionId: "lends" }],
      where: equalFilter("lender", uid),
      limit: 300,
    });
    const lower = email.toLowerCase();
    await redactQuery(fetchFn, idToken, root, "loans", "friendEmail", email, ["friendEmail", "updatedAt"]);
    if (lower && lower !== email) await redactQuery(fetchFn, idToken, root, "loans", "friendEmail", lower, ["friendEmail", "updatedAt"]);
    await redactQuery(fetchFn, idToken, root, "lends", "borrowerEmail", email, ["borrowerEmail", "borrowerEmailLower", "updatedAt"]);
    await redactQuery(fetchFn, idToken, root, "lends", "borrowerEmailLower", lower, ["borrowerEmail", "borrowerEmailLower", "updatedAt"]);
    return { ok: true };
  } catch {
    return { ok: false, error: GEAR_STILL_HERE };
  }
}
