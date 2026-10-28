// Mints a Firestore access token from the Worker secret FIREBASE_SA_JSON.
// The JSON never goes to the client. A missing or unreadable secret returns null.

import { tombstoneDue } from "../js/logic.js";

const SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_SKEW_MS = 60 * 1000;

let cached = null;

export function resetFirestoreTokenCache() {
  cached = null;
}

export function parseServiceAccount(raw) {
  if (!raw || typeof raw !== "string") return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const clientEmail = String(parsed.client_email || "").trim();
  let privateKey = String(parsed.private_key || "");
  if (!clientEmail || !privateKey.includes("PRIVATE KEY")) return null;
  privateKey = privateKey.replace(/\\n/g, "\n");
  return { clientEmail, privateKey };
}

function bytesToB64url(bytes) {
  let bin = "";
  const list = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < list.length; i++) bin += String.fromCharCode(list[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToPkcs8(pem) {
  const b64 = String(pem || "").replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function signJwt(account) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    iss: account.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })));
  const input = new TextEncoder().encode(header + "." + payload);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, input);
  return header + "." + payload + "." + bytesToB64url(sig);
}

// Returns a cached Bearer token, or null when the secret is missing or the token endpoint fails.
export async function firestoreAccessToken(env, fetchImpl) {
  const account = parseServiceAccount(env && env.FIREBASE_SA_JSON);
  if (!account) return null;
  const now = Date.now();
  if (cached && cached.email === account.clientEmail && cached.token && cached.exp > now + TOKEN_SKEW_MS) return cached.token;
  let assertion;
  try { assertion = await signJwt(account); }
  catch { return null; }
  const fetchFn = fetchImpl || fetch;
  let res;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(assertion),
    });
  } catch { return null; }
  const data = await res.json().catch(() => ({}));
  const token = data && data.access_token;
  const expiresIn = Math.max(0, Math.floor(+data.expires_in || 0));
  if (!res.ok || !token) return null;
  cached = { email: account.clientEmail, token, exp: now + expiresIn * 1000 };
  return token;
}

function httpStatus(value) {
  const n = Math.floor(+value);
  if (!Number.isFinite(n) || n < 0 || n > 999) return 0;
  return n;
}

// One read-only Firestore list. The log line is only "sa_token: ok" or "sa_token: fail <status>".
export async function serviceAccountLogLine(env, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  let line = "sa_token: fail 0";
  try {
    let mintStatus = 0;
    const token = await firestoreAccessToken(env, async (url, opts) => {
      const res = await fetchFn(url, opts);
      if (String(url) === TOKEN_URL) mintStatus = httpStatus(res.status);
      return res;
    });
    if (!token) {
      line = "sa_token: fail " + mintStatus;
    } else {
      const project = String((env && env.FIREBASE_PROJECT) || "gear-locker-c248c");
      const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(project) + "/databases/(default)/documents/deletedUsers?pageSize=1";
      const res = await fetchFn(url, { method: "GET", headers: { authorization: "Bearer " + token } });
      await res.text().catch(() => "");
      line = res.ok ? "sa_token: ok" : "sa_token: fail " + httpStatus(res.status);
    }
  } catch {
    line = "sa_token: fail 0";
  }
  console.log(line);
  return line;
}

export const TOMBSTONE_PAGE_SIZE = 50;
export const TOMBSTONE_DELETE_BUDGET = 40;
export const TOMBSTONE_PAGE_BUDGET = 20;

// Hourly sweep. TTL policies need billing, so this job deletes expired markers instead.
// The log line is only "tombstones: N". Document names and uids are never logged.
export async function sweepTombstones(env, fetchImpl, nowMs, opts) {
  const fetchFn = fetchImpl || fetch;
  const pageSize = Math.max(1, Math.floor(+(opts && opts.pageSize) || TOMBSTONE_PAGE_SIZE));
  const deleteBudget = Math.max(1, Math.floor(+(opts && opts.deleteBudget) || TOMBSTONE_DELETE_BUDGET));
  const pageBudget = Math.max(1, Math.floor(+(opts && opts.pageBudget) || TOMBSTONE_PAGE_BUDGET));
  const now = nowMs == null ? Date.now() : nowMs;
  let deleted = 0;
  try {
    const token = await firestoreAccessToken(env, fetchFn);
    if (token) {
      const project = String((env && env.FIREBASE_PROJECT) || "gear-locker-c248c");
      const root = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(project) + "/databases/(default)/documents/deletedUsers";
      let pageToken = "";
      for (let page = 0; page < pageBudget && deleted < deleteBudget; page++) {
        const url = root + "?pageSize=" + pageSize + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
        const res = await fetchFn(url, { method: "GET", headers: { authorization: "Bearer " + token } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) break;
        const docs = Array.isArray(data.documents) ? data.documents : [];
        for (const doc of docs) {
          if (deleted >= deleteBudget) break;
          if (!tombstoneDue(doc, now)) continue;
          const name = String((doc && doc.name) || "");
          if (!name.startsWith("projects/")) continue;
          const del = await fetchFn("https://firestore.googleapis.com/v1/" + name, {
            method: "DELETE",
            headers: { authorization: "Bearer " + token },
          });
          await del.text().catch(() => "");
          if (del.ok || del.status === 404) deleted++;
        }
        pageToken = data.nextPageToken || "";
        if (!pageToken) break;
      }
    }
  } catch { /* the count below is still safe to log */ }
  console.log("tombstones: " + deleted);
  return { deleted };
}
