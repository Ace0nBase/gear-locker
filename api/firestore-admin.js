// Mints a Firestore access token from the Worker secret FIREBASE_SA_JSON.
// The JSON never goes to the client. A missing or unreadable secret returns null.

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
