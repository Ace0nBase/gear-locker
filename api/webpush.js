// Web Push (RFC 8291 aes128gcm + VAPID ES256) using WebCrypto.
// The private key stays in the Cloudflare dashboard. Nothing here is a secret.

const enc = s => new TextEncoder().encode(s);

export function b64urlToBytes(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let s = "";
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

export function pushEndpointOk(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const h = u.hostname;
  if (h === "fcm.googleapis.com") return true;
  if (h === "updates.push.services.mozilla.com" || h.endsWith(".push.services.mozilla.com")) return true;
  if (h === "web.push.apple.com") return true;
  if (h.endsWith(".notify.windows.com")) return true;
  return false;
}

async function derive(sub, asPublic, shared, salt) {
  const uaPublic = b64urlToBytes(sub.keys.p256dh);
  const auth = b64urlToBytes(sub.keys.auth);
  const ikmInfo = concat(enc("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const prkKey = await hmac(auth, shared);
  const ikm = (await hmac(prkKey, concat(ikmInfo, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc("Content-Encoding: aes128gcm"), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc("Content-Encoding: nonce"), new Uint8Array([0, 1])))).slice(0, 12);
  return { cek, nonce };
}

export async function encryptWebPush(sub, payload, salt, asKeys) {
  const uaPublic = b64urlToBytes(sub.keys.p256dh);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const { cek, nonce } = await derive(sub, asPublic, shared, salt);
  const plain = typeof payload === "string" ? enc(payload) : payload;
  const record = concat(plain, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, record));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export async function decryptWebPush(body, sub, receiverKeys) {
  const u = body instanceof Uint8Array ? body : new Uint8Array(body);
  const salt = u.slice(0, 16);
  const idlen = u[20];
  const asPublic = u.slice(21, 21 + idlen);
  const cipher = u.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, receiverKeys.privateKey, 256));
  const { cek, nonce } = await derive(sub, asPublic, shared, salt);
  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, cipher));
  let end = record.length;
  while (end > 0 && record[end - 1] === 0) end--;
  if (record[end - 1] !== 2) throw new Error("bad padding");
  return new TextDecoder().decode(record.slice(0, end - 1));
}

async function vapidJwt(endpoint, env) {
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY);
  const d = b64urlToBytes(env.VAPID_PRIVATE_KEY);
  const jwk = {
    kty: "EC", crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(d),
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const subject = env.VAPID_SUBJECT || "https://ace0nbase.github.io/gear-locker/";
  const payload = bytesToB64url(enc(JSON.stringify({ aud, exp, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc(header + "." + payload)));
  return header + "." + payload + "." + bytesToB64url(sig);
}

export async function sendWebPush(sub, payload, env) {
  if (!env || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { ok: false, skipped: true };
  if (!sub || !pushEndpointOk(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return { ok: false, error: "bad endpoint" };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const body = await encryptWebPush(sub, payload, salt, asKeys);
  const jwt = await vapidJwt(sub.endpoint, env);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
    redirect: "error",
  });
  if (r.status === 404 || r.status === 410) return { ok: false, gone: true, status: r.status };
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, status: r.status };
}
