// Gear Locker lookup API (Cloudflare Worker).
// POST /lookup  { items: [{ id, name, brand, category, condition, color, notes, kind? }] }
// Header: Authorization: Bearer <Firebase ID token from the signed-in app user>
// Returns { results: [{ id, ok, retailNew, usedLow, usedHigh, value, weightOz, priceNote, weightNote, sources }] }
// Secrets (set in the Cloudflare dashboard, never in code): ANTHROPIC_API_KEY
// Vars (wrangler.toml): FIREBASE_PROJECT, ALLOWED_ORIGINS, MODEL, FALLBACK_MODEL, ALLOWED_EMAILS (optional), MAX_ITEMS

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwksCache = null, jwksAt = 0;

function cors(env, req) {
  const origin = req.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin : allowed[0] || "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    "vary": "origin",
  };
}
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function b64u(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function keys() {
  if (jwksCache && Date.now() - jwksAt < 3600e3) return jwksCache;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error("Couldn't load Google sign-in keys");
  jwksCache = (await r.json()).keys || [];
  jwksAt = Date.now();
  return jwksCache;
}
async function verifyFirebaseToken(token, project) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const [h, p, sig] = parts;
  const head = JSON.parse(new TextDecoder().decode(b64u(h)));
  const pay = JSON.parse(new TextDecoder().decode(b64u(p)));
  if (head.alg !== "RS256") throw new Error("bad alg");
  const jwk = (await keys()).find(k => k.kid === head.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(sig), new TextEncoder().encode(h + "." + p));
  const nowS = Math.floor(Date.now() / 1000);
  if (!valid || pay.aud !== project || pay.iss !== "https://securetoken.google.com/" + project || !pay.sub || pay.exp < nowS || pay.iat > nowS + 300) throw new Error("invalid token");
  return pay;
}

const CONDITION = {
  "New": "new/unused: near the low end of current retail, or recent new-in-package sold prices",
  "Good": "lightly used: the upper part of the used range",
  "Used": "normal wear: the middle of the used range",
  "Worn": "well used: the low end of the used range",
  "Needs-repair": "damaged/needs repair: below the low end of the used range",
};
function prompt(it) {
  const firearm = it.category === "Firearms";
  const wish = it.kind === "wish";
  return `You look up real, current US market data for one piece of tactical / outdoor gear for a personal inventory app.

Item: ${it.name}
Brand / model: ${it.brand || "unknown"}
Category: ${it.category || "unknown"}
Color: ${it.color || "n/a"}
Condition: ${it.condition || "Good"}
Notes: ${it.notes || "none"}

Use web search. Do separate searches as needed:
- the manufacturer or a major retailer page for the current NEW price and the published WEIGHT (spec sheet)
- eBay sold/completed listings and TacSwap for USED prices${firearm ? "\nThis is a firearm: do NOT price it (set retailNew, usedLow, usedHigh, value to null). Only find the listed unloaded weight." : ""}${wish ? "\nThis is a wishlist item the user wants to buy. If the brand is blank the name may be a generic need (e.g. \"Eye protection\"): pick a well-regarded mid-range product, price it, and name it in priceNote." : ""}

value = the per-unit value for THIS item's condition (${CONDITION[it.condition] || CONDITION.Good}).
weightOz = the weight of ONE unit in ounces (1 lb = 16 oz, 1 g = 0.035274 oz), rounded to 0.1. If sizes differ and none is given, use size Medium and say so in weightNote.
Use null for anything you could not find with reasonable confidence. Never invent numbers.

Reply with ONLY this JSON object and nothing else:
{"retailNew": number|null, "usedLow": number|null, "usedHigh": number|null, "value": number|null, "weightOz": number|null, "priceNote": "one short sentence with the comps you found, e.g. '6 eBay sold $85–120, TacSwap ~$110, Crye retail $175'", "weightNote": "short source, e.g. 'Crye spec, size M'", "sources": [{"label": "eBay sold", "url": "https://..."}]}`;
}

async function callClaude(env, model, it) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: prompt(it) }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.error?.message || ("Claude API error " + r.status)); e.status = r.status; throw e; }
  return data;
}
function parseResult(data) {
  const blocks = data.content || [];
  const text = blocks.filter(b => b.type === "text").map(b => b.text).join("\n");
  const cited = [];
  blocks.forEach(b => (b.citations || []).forEach(c => { if (c.url && !cited.some(x => x.url === c.url)) cited.push({ label: (c.title || "source").slice(0, 40), url: c.url }); }));
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in answer");
  const j = JSON.parse(m[0]);
  const num = v => (v === null || v === undefined || v === "" || !isFinite(+v)) ? null : +v;
  let sources = Array.isArray(j.sources) ? j.sources.filter(s => s && /^https:\/\//.test(s.url || "")) : [];
  if (!sources.length) sources = cited;
  return {
    retailNew: num(j.retailNew), usedLow: num(j.usedLow), usedHigh: num(j.usedHigh), value: num(j.value), weightOz: num(j.weightOz),
    priceNote: String(j.priceNote || "").slice(0, 240), weightNote: String(j.weightNote || "").slice(0, 80),
    sources: sources.slice(0, 4).map(s => ({ label: String(s.label || "source").slice(0, 40), url: String(s.url) })),
  };
}
async function lookupOne(env, it) {
  const clean = {
    id: String(it.id || "").slice(0, 80), name: String(it.name || "").slice(0, 120), brand: String(it.brand || "").slice(0, 120),
    category: String(it.category || "").slice(0, 60), condition: String(it.condition || "Good").slice(0, 20), color: String(it.color || "").slice(0, 40),
    notes: String(it.notes || "").slice(0, 200), kind: it.kind === "wish" ? "wish" : "item",
  };
  if (!clean.name) return { id: clean.id, ok: false, error: "missing name" };
  let data;
  try { data = await callClaude(env, env.MODEL || "claude-haiku-5-5", clean); }
  catch (e) {
    if (env.FALLBACK_MODEL && (e.status === 400 || e.status === 404)) data = await callClaude(env, env.FALLBACK_MODEL, clean);
    else throw e;
  }
  return { id: clean.id, ok: true, ...parseResult(data) };
}

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "gear-locker-api" }, 200, h);
    if (url.pathname !== "/lookup" || req.method !== "POST") return json({ error: "Not found" }, 404, h);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "Lookup service isn't set up yet (missing API key)." }, 503, h);

    let user;
    try { user = await verifyFirebaseToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), env.FIREBASE_PROJECT); }
    catch { return json({ error: "Please sign in again." }, 401, h); }
    const allow = (env.ALLOWED_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || "").toLowerCase())) return json({ error: "Lookups are turned off for this account." }, 403, h);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400, h); }
    const max = +(env.MAX_ITEMS || 4);
    const items = Array.isArray(body.items) ? body.items.slice(0, max) : [];
    if (!items.length) return json({ error: "No items" }, 400, h);

    const results = await Promise.all(items.map(it => lookupOne(env, it).catch(e => ({ id: String(it.id || ""), ok: false, error: String(e.message || e).slice(0, 160) }))));
    const firstErr = results.find(r => !r.ok)?.error;
    if (results.every(r => !r.ok)) return json({ error: firstErr || "Lookup failed", results }, 502, h);
    return json({ results }, 200, h);
  },
};
