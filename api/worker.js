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

Use web search (at most 4 searches). Good searches:
- "<brand> <name> price" for the manufacturer, Amazon or a major retailer: the current NEW price and the published WEIGHT
- "<brand> <name> amazon" for the Amazon price
- "<brand> <name> ebay sold" and "<brand> <name> tacswap" for USED prices${firearm ? "\nThis is a firearm: do NOT price it (set retailNew, usedLow, usedHigh, value to null). Only find the listed unloaded weight." : ""}${wish ? "\nThis is a wishlist item the user wants to buy. If the brand is blank the name may be a generic need (e.g. \"Eye protection\"): pick a well-regarded mid-range product, price it, and name it in priceNote." : ""}

If the brand is blank or "unknown", the user doesn't know the maker: work out the most likely kind of item from the name, category, color and notes, and give typical prices and weight for a common mid-range version of it. Start priceNote with "Estimate:" and name what you based it on (e.g. "Estimate: typical MOLLE IFAK pouch, $25-45 new").
Always give a price even if used comps are thin: if you only find new prices, set retailNew from them and estimate usedLow/usedHigh as about 50-75% of new.
value = the per-unit value for THIS item's condition (${CONDITION[it.condition] || CONDITION.Good}).
weightOz = the weight of ONE unit in ounces (1 lb = 16 oz, 1 g = 0.035274 oz), rounded to 0.1. If sizes differ and none is given, use size Medium and say so in weightNote.
Use null only for things you truly could not find. Never invent numbers.

When done searching, your final message must be ONLY this JSON object, no other words before or after it:
{"retailNew": number|null, "usedLow": number|null, "usedHigh": number|null, "value": number|null, "weightOz": number|null, "priceNote": "one short sentence with the comps you found, e.g. 'Amazon $129, eBay sold $85-120, TacSwap ~$110'", "weightNote": "short source, e.g. 'Crye spec, size M'", "sources": [{"label": "Amazon", "url": "https://..."}]}`;
}

const textOf = blocks => (blocks || []).filter(b => b.type === "text").map(b => b.text).join("");
function findJson(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const starts = [];
  for (let i = 0; i < t.length; i++) if (t[i] === "{") starts.push(i);
  for (let k = starts.length - 1; k >= 0; k--) {
    let depth = 0, inStr = false, esc = false;
    for (let j = starts[k]; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        const raw = t.slice(starts[k], j + 1);
        for (const cand of [raw, raw.replace(/[\r\n]+/g, " ")]) {
          try { const o = JSON.parse(cand); if (o && typeof o === "object" && ("value" in o || "weightOz" in o || "retailNew" in o)) return o; } catch {}
        }
        break;
      }
    }
  }
  return null;
}

async function callClaude(env, model, it) {
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
  const messages = [{ role: "user", content: prompt(it) }];
  const send = async () => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4000, tools, messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data?.error?.message || ("Claude API error " + r.status)); e.status = r.status; throw e; }
    return data;
  };
  const all = [];
  let data;
  // A long web-search turn can pause; continue it until Claude finishes.
  for (let i = 0; i < 4; i++) {
    data = await send();
    all.push(...(data.content || []));
    if (data.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: data.content });
  }
  if (findJson(textOf(data.content))) return { content: all, final: data.content };
  // No JSON yet: ask once more for just the JSON, from what it already found.
  const prev = (data.content || []).filter(b => b.type !== "text" || (b.text || "").trim());
  if (prev.length) messages.push({ role: "assistant", content: prev });
  messages.push({ role: "user", content: "Now reply with ONLY the JSON object described above, filled in from what you found. No other text." });
  data = await send();
  all.push(...(data.content || []));
  return { content: all, final: data.content };
}
function parseResult(data) {
  const blocks = data.content || [];
  const cited = [];
  blocks.forEach(b => (b.citations || []).forEach(c => { if (c.url && !cited.some(x => x.url === c.url)) cited.push({ label: (c.title || "source").slice(0, 40), url: c.url }); }));
  const j = findJson(textOf(data.final)) || findJson(textOf(blocks));
  if (!j) throw new Error("couldn't read the lookup answer, try again");
  const num = v => (v === null || v === undefined || v === "" || !isFinite(+v)) ? null : +v;
  let sources = Array.isArray(j.sources) ? j.sources.filter(s => s && /^https:\/\//.test(s.url || "")) : [];
  if (!sources.length) sources = cited;
  return {
    retailNew: num(j.retailNew), usedLow: num(j.usedLow), usedHigh: num(j.usedHigh), value: num(j.value), weightOz: num(j.weightOz),
    priceNote: String(j.priceNote || "").slice(0, 240), weightNote: String(j.weightNote || "").slice(0, 80),
    sources: sources.slice(0, 4).map(s => ({ label: String(s.label || "source").slice(0, 40), url: String(s.url) })),
  };
}

const CATS = ["Firearms","Suppressors","Armor & Carriers","Belts & Rigs","Pouches","Holsters & Slings","Helmet & Head","NVG & Optics","Lights & Lasers","Comms & Radios","Medical","Packs & Bags","Cases & Bags","Clothing & Boots","Knives & Tools","Mags & Ammo Storage","Cleaning & Maintenance","Misc"];
async function identify(env, img, hint) {
  const ask = `This photo shows one piece of tactical, outdoor, shooting or medical gear that the owner wants to add to their inventory app.${hint ? ` They called it: "${hint}".` : ""}
Identify it. Look for logos, labels, tags, stitching patterns and distinctive design to name the maker and model if you can; if you can't tell the maker, say what kind of item it is.
Reply with ONLY this JSON object:
{"name": "short item name, e.g. 'Double M4 mag pouch' or 'IFAK pouch'", "brand": "maker and model if identifiable with reasonable confidence, else empty string", "category": one of ${JSON.stringify(CATS)}, "color": "color or camo pattern", "confidence": "high|medium|low", "summary": "one short sentence on what it looks like and what gave it away"}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 600, messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } },
      { type: "text", text: ask } ] }] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || ("Claude API error " + r.status));
  const t = textOf(data.content);
  const m = t.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Couldn't read the photo answer");
  const j = JSON.parse(m[0]);
  const s = (v, n) => String(v || "").slice(0, n);
  return { name: s(j.name, 80), brand: s(j.brand, 80), category: CATS.includes(j.category) ? j.category : "", color: s(j.color, 40), confidence: ["high","medium","low"].includes(j.confidence) ? j.confidence : "low", summary: s(j.summary, 200) };
}

/* ---------- wishlist price watch ---------- */
function dealPrompt(w) {
  return `Find the LOWEST price someone in the US can buy this item for RIGHT NOW (an active listing or in-stock store price, not a sold listing).

Item: ${w.name}
Brand / model: ${w.brand || "any well-regarded brand"}
Category: ${w.category || "unknown"}
Notes: ${w.notes || "none"}
The buyer's target price is $${w.target}.

Use web search (at most 4 searches). Check TacSwap listings, eBay Buy It Now listings, Amazon, the maker's site and big retailers or sales. New or used in good condition both count; skip parts-only, wrong item or out-of-stock listings. Include shipping if it's clearly listed.

When done, reply with ONLY this JSON object:
{"price": number|null, "where": "site or seller, e.g. 'TacSwap' or 'Amazon'", "url": "https link to the listing", "condition": "new|used|like new", "note": "one short sentence, e.g. 'Used, good condition, ships free'"}`;
}
async function dealCheck(env, w) {
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
  const messages = [{ role: "user", content: dealPrompt(w) }];
  let data, all = [];
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 3000, tools, messages }) });
    data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || ("Claude API error " + r.status));
    all.push(...(data.content || []));
    if (data.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: data.content });
  }
  const t = textOf(data.content).replace(/```(?:json)?/gi, "");
  let j = null; const ms = t.match(/\{[\s\S]*\}/g) || [];
  for (const c of ms.reverse()) { try { const o = JSON.parse(c); if ("price" in o) { j = o; break } } catch {} }
  const price = j && isFinite(+j.price) && +j.price > 0 ? Math.round(+j.price * 100) / 100 : null;
  return { price, where: String(j?.where || "").slice(0, 40), url: /^https:\/\//.test(j?.url || "") ? String(j.url).slice(0, 400) : "",
    condition: String(j?.condition || "").slice(0, 20), note: String(j?.note || "").slice(0, 160), date: new Date().toISOString().slice(0, 10),
    hit: price != null && price <= +w.target };
}
const WKEY = uid => "w:" + uid;
async function runDueWatches(env, budget) {
  if (!env.WATCH) return 0;
  let done = 0, cursor;
  const dayMs = 20 * 3600e3;
  do {
    const page = await env.WATCH.list({ prefix: "w:", cursor });
    cursor = page.list_complete ? null : page.cursor;
    for (const k of page.keys) {
      if (done >= budget) return done;
      const rec = await env.WATCH.get(k.name, "json"); if (!rec || !Array.isArray(rec.list)) continue;
      let changed = false;
      for (const w of rec.list) {
        if (done >= budget) break;
        if (w.lastCheck && Date.now() - Date.parse(w.lastCheck) < dayMs) continue;
        try { const b = await dealCheck(env, w); w.best = b; w.lastErr = ""; } catch (e) { w.lastErr = String(e.message || e).slice(0, 120); }
        w.lastCheck = new Date().toISOString(); changed = true; done++;
      }
      if (changed) await env.WATCH.put(k.name, JSON.stringify(rec));
    }
  } while (cursor);
  return done;
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

const DEFAULTS = { FIREBASE_PROJECT: "gear-locker-c248c", ALLOWED_ORIGINS: "https://ace0nbase.github.io", MODEL: "claude-haiku-5-5", FALLBACK_MODEL: "claude-sonnet-5-5", MAX_ITEMS: "4", ALLOWED_EMAILS: "", MAX_WATCHES: "10", WATCH_BATCH: "6" };

export default {
  async fetch(req, rawEnv) {
    const env = { ...DEFAULTS };
    for (const k in rawEnv) if (rawEnv[k] !== undefined && rawEnv[k] !== "") env[k] = rawEnv[k];
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "gear-locker-api" }, 200, h);
    if (!["/lookup", "/identify", "/watch/sync", "/watch/status", "/watch/check"].includes(url.pathname) || req.method !== "POST") return json({ error: "Not found" }, 404, h);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "Lookup service isn't set up yet (missing API key)." }, 503, h);

    let user;
    try { user = await verifyFirebaseToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), env.FIREBASE_PROJECT); }
    catch { return json({ error: "Please sign in again." }, 401, h); }
    const allow = (env.ALLOWED_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || "").toLowerCase())) return json({ error: "Lookups are turned off for this account." }, 403, h);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400, h); }
    if (url.pathname.startsWith("/watch/")) {
      if (!env.WATCH) return json({ error: "Price alerts aren't switched on yet" }, 503, h);
      const key = WKEY(user.sub);
      const rec = (await env.WATCH.get(key, "json")) || { list: [] };
      const pub = () => rec.list.map(w => ({ id: w.id, target: w.target, best: w.best || null, lastCheck: w.lastCheck || "", lastErr: w.lastErr || "" }));
      if (url.pathname === "/watch/sync") {
        const max = +(env.MAX_WATCHES || 10);
        const inList = Array.isArray(body.watches) ? body.watches : [];
        const old = new Map(rec.list.map(w => [w.id, w]));
        const next = inList.slice(0, max).filter(w => w && w.id && w.name && +w.target > 0).map(w => {
          const o = old.get(String(w.id)) || {};
          const same = o.name === String(w.name) && o.brand === String(w.brand || "");
          return { id: String(w.id).slice(0, 80), name: String(w.name).slice(0, 120), brand: String(w.brand || "").slice(0, 120), category: String(w.category || "").slice(0, 60),
            notes: String(w.notes || "").slice(0, 160), target: Math.round(+w.target), best: same ? (o.best ? { ...o.best, hit: o.best.price != null && o.best.price <= Math.round(+w.target) } : null) : null,
            lastCheck: same ? (o.lastCheck || "") : "", lastErr: "" };
        });
        rec.list = next; rec.email = String(user.email || ""); rec.updatedAt = new Date().toISOString();
        if (next.length) await env.WATCH.put(key, JSON.stringify(rec)); else await env.WATCH.delete(key);
        return json({ ok: true, watches: pub(), max, dropped: Math.max(0, inList.length - max) }, 200, h);
      }
      if (url.pathname === "/watch/check") {
        const w = rec.list.find(x => x.id === String(body.id || ""));
        if (!w) return json({ error: "Set an alert price on this item first" }, 400, h);
        if (w.lastCheck && Date.now() - Date.parse(w.lastCheck) < 10 * 60e3) return json({ watches: pub() }, 200, h);
        try { w.best = await dealCheck(env, w); w.lastErr = ""; } catch (e) { w.lastErr = String(e.message || e).slice(0, 120); }
        w.lastCheck = new Date().toISOString();
        await env.WATCH.put(key, JSON.stringify(rec));
        return json({ watches: pub() }, 200, h);
      }
      return json({ watches: pub() }, 200, h);
    }
    if (url.pathname === "/identify") {
      const img = String(body.image || "");
      if (!img || img.length > 2_800_000 || !/^[A-Za-z0-9+/=]+$/.test(img.slice(0, 200))) return json({ error: "Send a photo (JPEG, under 2 MB)" }, 400, h);
      try { return json({ result: await identify(env, img, String(body.hint || "").slice(0, 80)) }, 200, h); }
      catch (e) { return json({ error: String(e.message || e).slice(0, 160) }, 502, h); }
    }
    const max = +(env.MAX_ITEMS || 4);
    const items = Array.isArray(body.items) ? body.items.slice(0, max) : [];
    if (!items.length) return json({ error: "No items" }, 400, h);

    const results = await Promise.all(items.map(it => lookupOne(env, it).catch(e => ({ id: String(it.id || ""), ok: false, error: String(e.message || e).slice(0, 160) }))));
    const firstErr = results.find(r => !r.ok)?.error;
    if (results.every(r => !r.ok)) return json({ error: firstErr || "Lookup failed", results }, 502, h);
    return json({ results }, 200, h);
  },
  async scheduled(event, rawEnv, ctx) {
    const env = { ...DEFAULTS };
    for (const k in rawEnv) if (rawEnv[k] !== undefined && rawEnv[k] !== "") env[k] = rawEnv[k];
    if (!env.ANTHROPIC_API_KEY) return;
    ctx.waitUntil(runDueWatches(env, +(env.WATCH_BATCH || 6)));
  },
};
