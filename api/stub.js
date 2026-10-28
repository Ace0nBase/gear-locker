// Local lookup stub for npm run qa. It never calls Claude and it refuses
// the live Firebase project. Run it only on 127.0.0.1. It is not the production worker.
import { decideAccess, chargeDecision, quotaKey, saleRestricted, publicWeightNote, accountDeletePlan, signInIsRecent } from "../js/logic.js";

const memory = new Map();
const memKv = {
  async get(key) { return memory.has(key) ? memory.get(key) : null; },
  async put(key, val) { memory.set(key, String(val)); },
  async delete(key) { memory.delete(key); },
};

function b64u(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function readToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) throw new Error("bad token");
  const pay = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
  if (pay.aud !== "demo-gear-locker" || pay.iss !== "https://securetoken.google.com/demo-gear-locker" || !pay.sub) throw new Error("not the local emulator");
  return pay;
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function cors(req) {
  const origin = req.headers.get("origin") || "";
  const ok = origin === "http://127.0.0.1:5500" || origin === "http://localhost:5500";
  return {
    "access-control-allow-origin": ok ? origin : "http://127.0.0.1:5500",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    vary: "origin",
  };
}

function fakeItem(it) {
  const id = String(it.id || "");
  if (it.kind === "wish" && saleRestricted(it)) return { id, ok: false, error: "Price search skips this item." };
  if (saleRestricted(it) || it.weightOnly) {
    return { id, ok: true, retailNew: null, usedLow: null, usedHigh: null, value: null, weightOz: 12, priceNote: "", weightNote: publicWeightNote("Local test weight"), sources: [] };
  }
  return { id, ok: true, retailNew: 40, usedLow: 20, usedHigh: 30, value: 28, weightOz: 12, priceNote: "Local test price. No live lookup was made.", weightNote: "Local test weight", sources: [{ label: "Local test shop", url: "https://example.com/gear" }] };
}

export default {
  async fetch(req, env) {
    if (env && (env.ANTHROPIC_API_KEY || env.FIREBASE_PROJECT === "gear-locker-c248c")) {
      return new Response("This stub refuses live settings.", { status: 500 });
    }
    const h = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "gear-locker-api-stub", access: "local-emulator" }, 200, h);
    let user;
    try { user = readToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")); }
    catch { return json({ error: "Please sign in again." }, 401, h); }
    if (url.pathname === "/account/delete") {
      if (req.method !== "POST") return json({ error: "Not found" }, 404, h);
      if (user.auth_time && !signInIsRecent(user.auth_time)) {
        return json({ error: "Enter your password again, then delete the account." }, 401, h);
      }
      const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      try {
        const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=local", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok && !/USER_NOT_FOUND/i.test(String(data?.error?.message || ""))) {
          return json({ error: "Your gear was removed, but the sign-in is still here. Try again." }, 502, h);
        }
      } catch {
        return json({ error: "Your gear was removed, but the sign-in is still here. Try again." }, 502, h);
      }
      const plan = accountDeletePlan(user.sub);
      for (const key of plan.kvExact) await memKv.delete(key);
      for (const prefix of plan.kvPrefixes) {
        for (const key of [...memory.keys()]) if (String(key).startsWith(prefix)) memory.delete(key);
      }
      return json({ ok: true }, 200, h);
    }
    const access = decideAccess(user, { ALLOWED_EMAILS: user.email || "" });
    if (!access.ok) return json({ error: access.error }, access.status, h);
    const key = quotaKey(user.sub, new Date());
    const used = +(await memKv.get(key)) || 0;
    const bill = chargeDecision(used, 1, 40);
    if (!bill.ok) return json({ error: `Daily lookup limit reached (${bill.limit} per day). Try again tomorrow.` }, 429, h);
    await memKv.put(key, String(bill.next));
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    if (url.pathname === "/lookup") {
      const items = Array.isArray(body.items) ? body.items.slice(0, 4) : [];
      return json({ results: items.map(fakeItem) }, 200, h);
    }
    if (url.pathname === "/identify") return json({ result: { name: "Sample pouch", brand: "", category: "Pouches", color: "Coyote", confidence: "low", summary: "Local test only. No photo was sent anywhere." } }, 200, h);
    if (url.pathname === "/battery") return json({ result: { none: false, battery: "CR123A", count: 1, life: "Local test", swapMonths: 6 } }, 200, h);
    if (url.pathname === "/ammo") return json({ error: "Ammo price search is turned off." }, 410, h);
    if (url.pathname === "/pace") return json({ result: { name: "Local test plan", summary: "Stub plan. No live lookup was made.", steps: { p: { method: "Cell call", detail: "Call", when: "First" }, a: {}, c: {}, e: {} }, checkin: "", rally: "", codes: "", newFreqs: [], gaps: [] } }, 200, h);
    if (url.pathname.startsWith("/watch/")) return json({ ok: true, watches: [], max: 10, vapidPublicKey: "", push: false }, 200, h);
    return json({ error: "Not found" }, 404, h);
  },
};
