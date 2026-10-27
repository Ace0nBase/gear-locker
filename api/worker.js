// Gear Locker lookup API (Cloudflare Worker).
// POST /lookup  { items: [{ id, name, brand, category, condition, color, notes, kind? }] }
// Header: Authorization: Bearer <Firebase ID token from the signed-in app user>
// Returns { results: [{ id, ok, retailNew, usedLow, usedHigh, value, weightOz, priceNote, weightNote, sources }] }
// Secrets (set in the Cloudflare dashboard, never in code): ANTHROPIC_API_KEY
// Vars (dashboard, kept across deploys): FIREBASE_PROJECT, ALLOWED_ORIGINS, MODEL, FALLBACK_MODEL, ALLOWED_EMAILS (required), DAILY_AI_LIMIT, ALERT_DAILY_CAP, WATCH_BATCH, MIN_ALERT_GAP_HOURS
// An empty ALLOWED_EMAILS list turns lookups off for everyone, including the owner.

import { decideAccess, chargeDecision, quotaKey, alertQuotaKey, selectDueWatches, parseAllowlist, saleRestricted, publicWeightNote, lookupAnswerRestricted } from "../js/logic.js";
import { sendWebPush, pushEndpointOk } from "./webpush.js";

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
  const restricted = saleRestricted(it) || it.weightOnly;
  const wish = it.kind === "wish" && !restricted;
  if (restricted) {
    return `You look up the published weight of one piece of gear for a personal inventory app. Do not look up a price. Do not name a store, a seller, or a place to buy it.

Item: ${it.name}
Brand / model: ${it.brand || "unknown"}
Category: ${it.category || "unknown"}

Use web search only for the maker's listed weight (at most 2 searches). Do not price firearms, suppressors, frames, lower receivers, or ammunition.
Set retailNew, usedLow, usedHigh, and value to null. Set priceNote to "" and sources to []. Set "restricted" to true.
weightOz = the weight of ONE unit in ounces (1 lb = 16 oz, 1 g = 0.035274 oz), rounded to 0.1. If sizes differ and none is given, use size Medium and say so in weightNote. The weight note must not include a price or a store name.

When done, reply with ONLY this JSON object:
{"restricted": true, "retailNew": null, "usedLow": null, "usedHigh": null, "value": null, "weightOz": number|null, "priceNote": "", "weightNote": "short source, e.g. maker spec", "sources": []}`;
  }
  return `You look up real, current US market data for one piece of tactical / outdoor gear for a personal inventory app. Do not price firearms, suppressors, frames, lower receivers, or ammunition. If this item is one of those, set "restricted" to true, retailNew, usedLow, usedHigh, and value to null, priceNote to "", and sources to []. You may still return weightOz.

Item: ${it.name}
Brand / model: ${it.brand || "unknown"}
Category: ${it.category || "unknown"}
Color: ${it.color || "n/a"}
Condition: ${it.condition || "Good"}

Use web search (at most 3 searches). Good searches:
- "<brand> <name> price" for the manufacturer, Amazon or a major retailer: the current NEW price and the published WEIGHT
- "<brand> <name> amazon" for the Amazon price
- "<brand> <name> ebay sold" and "<brand> <name> tacswap" for USED prices${wish ? "\nThis is a wishlist item the user wants to buy. If the brand is blank the name may be a generic need (e.g. \"Eye protection\"): pick a well-regarded mid-range product, price it, and name it in priceNote." : ""}

If the brand is blank or "unknown", the user doesn't know the maker: work out the most likely kind of item from the name, category and color, and give typical prices and weight for a common mid-range version of it. Start priceNote with "Estimate:" and name what you based it on (e.g. "Estimate: typical MOLLE IFAK pouch, $25-45 new").
Always give a price even if used comps are thin: if you only find new prices, set retailNew from them and estimate usedLow/usedHigh as about 50-75% of new.
value = the per-unit value for THIS item's condition (${CONDITION[it.condition] || CONDITION.Good}).
weightOz = the weight of ONE unit in ounces (1 lb = 16 oz, 1 g = 0.035274 oz), rounded to 0.1. If sizes differ and none is given, use size Medium and say so in weightNote.
Use null only for things you truly could not find. Never invent numbers.

When done searching, your final message must be ONLY this JSON object, no other words before or after it:
{"restricted": false, "retailNew": number|null, "usedLow": number|null, "usedHigh": number|null, "value": number|null, "weightOz": number|null, "priceNote": "one short sentence with the comps you found, e.g. 'Amazon $129, eBay sold $85-120, TacSwap ~$110'", "weightNote": "short source, e.g. 'Crye spec, size M'", "sources": [{"label": "Amazon", "url": "https://..."}]}`;
}

const textOf = blocks => (blocks || []).filter(b => b.type === "text").map(b => b.text).join("");
function findJson(text, keys) {
  keys = keys || ["value", "weightOz", "retailNew"];
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
          try { const o = JSON.parse(cand); if (o && typeof o === "object" && keys.some(k => k in o)) return o; } catch {}
        }
        break;
      }
    }
  }
  return null;
}

async function callClaude(env, model, it) {
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
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
    restricted: j.restricted === true,
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
The buyer's target price is $${w.target}.

Use web search (at most 2 searches). Check TacSwap listings, eBay Buy It Now listings, Amazon, the maker's site and big retailers or sales. New or used in good condition both count; skip parts-only, wrong item or out-of-stock listings. Include shipping if it's clearly listed.

If this item is a firearm, suppressor, frame, lower receiver, or ammunition, set "restricted" to true and price to null, and leave where, url, and note empty.

When done, reply with ONLY this JSON object:
{"restricted": false, "price": number|null, "where": "site or seller, e.g. 'TacSwap' or 'Amazon'", "url": "https link to the listing", "condition": "new|used|like new", "note": "one short sentence, e.g. 'Used, good condition, ships free'"}`;
}
async function dealCheck(env, w) {
  if (saleRestricted(w)) return { price: null, where: "", url: "", condition: "", note: "", date: new Date().toISOString().slice(0, 10), hit: false };
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }];
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
  const deal = { price, where: String(j?.where || "").slice(0, 40), url: /^https:\/\//.test(j?.url || "") ? String(j.url).slice(0, 400) : "",
    condition: String(j?.condition || "").slice(0, 20), note: String(j?.note || "").slice(0, 160), date: new Date().toISOString().slice(0, 10),
    hit: price != null && price <= +w.target };
  if (lookupAnswerRestricted({ restricted: !!(j && j.restricted), priceNote: [deal.where, deal.note, deal.url].join(" "), sources: deal.url ? [{ label: deal.where, url: deal.url }] : [] })) {
    return { price: null, where: "", url: "", condition: "", note: "", date: deal.date, hit: false };
  }
  return deal;
}
const WKEY = uid => "w:" + uid;
async function readCount(env, key) { return +(await env.WATCH.get(key)) || 0; }
async function chargeAi(env, uid, add) {
  if (!env.WATCH) return { ok: false, status: 503, error: "Lookups are paused until price-alert storage is connected." };
  const limit = +(env.DAILY_AI_LIMIT || 40);
  const key = quotaKey(uid, new Date());
  const used = await readCount(env, key);
  const d = chargeDecision(used, add, limit);
  if (!d.ok) return { ok: false, status: 429, error: `Daily lookup limit reached (${d.limit} per day). Try again tomorrow.`, remaining: d.remaining, limit: d.limit };
  await env.WATCH.put(key, String(d.next), { expirationTtl: 48 * 3600 });
  return { ok: true, remaining: d.remaining, limit: d.limit };
}
async function chargeScheduledAlert(env, uid) {
  if (!env.WATCH) return { ok: false };
  const aiLimit = +(env.DAILY_AI_LIMIT || 40);
  const alertLimit = +(env.ALERT_DAILY_CAP || 6);
  const day = new Date();
  const qk = quotaKey(uid, day);
  const ak = alertQuotaKey(uid, day);
  const ai = chargeDecision(await readCount(env, qk), 1, aiLimit);
  const al = chargeDecision(await readCount(env, ak), 1, alertLimit);
  if (!ai.ok || !al.ok) return { ok: false };
  await env.WATCH.put(qk, String(ai.next), { expirationTtl: 48 * 3600 });
  await env.WATCH.put(ak, String(al.next), { expirationTtl: 48 * 3600 });
  return { ok: true };
}
async function listWatchUsers(env) {
  const users = [];
  let cursor;
  do {
    const page = await env.WATCH.list({ prefix: "w:", cursor });
    cursor = page.list_complete ? null : page.cursor;
    for (const k of page.keys) {
      const rec = await env.WATCH.get(k.name, "json");
      if (!rec || !Array.isArray(rec.list)) continue;
      users.push({ uid: k.name.slice(2), key: k.name, rec, list: rec.list });
    }
  } while (cursor);
  return users;
}
async function runDueWatches(env, budget) {
  if (!env.WATCH) return 0;
  const allow = parseAllowlist(env.ALLOWED_EMAILS);
  const gapMs = Math.max(1, +(env.MIN_ALERT_GAP_HOURS || 20)) * 3600e3;
  const aiLimit = +(env.DAILY_AI_LIMIT || 40);
  const alertLimit = +(env.ALERT_DAILY_CAP || 6);
  const now = new Date();
  const eligible = [];
  for (const u of await listWatchUsers(env)) {
    const email = String(u.rec.email || "").toLowerCase();
    if (!allow.includes(email) || u.rec.emailVerified === false) continue;
    if (await readCount(env, quotaKey(u.uid, now)) >= aiLimit) continue;
    if (await readCount(env, alertQuotaKey(u.uid, now)) >= alertLimit) continue;
    eligible.push(u);
  }
  eligible.forEach(u => { u.list = (u.list || []).filter(w => w && !saleRestricted(w)); });
  const picked = selectDueWatches(eligible.filter(u => u.list.length), { now, budget, minGapMs: gapMs });
  const dirty = new Map();
  let done = 0;
  for (const p of picked) {
    const u = eligible.find(x => x.uid === p.uid);
    const w = u && u.rec.list.find(x => x.id === p.watch.id);
    if (!w || saleRestricted(w)) continue;
    if (!(await chargeScheduledAlert(env, u.uid)).ok) continue;
    const wasHit = !!(w.best && w.best.hit);
    try {
      const b = await dealCheck(env, w);
      w.best = b; w.lastErr = "";
      if (!wasHit && b.hit && u.rec.push) {
        const sent = await sendWebPush(u.rec.push, JSON.stringify({ title: "Price alert", body: `${w.name} is at or under your target`, url: "./?tab=wish" }), env);
        if (sent && sent.gone) delete u.rec.push;
      }
    } catch (e) { w.lastErr = String(e.message || e).slice(0, 120); }
    w.lastCheck = new Date().toISOString();
    dirty.set(u.key, u.rec);
    done++;
  }
  for (const [key, rec] of dirty) await env.WATCH.put(key, JSON.stringify(rec));
  return done;
}

/* ---------- battery facts for a device ---------- */
async function batteryLookup(env, d) {
  const ask = `What battery does this device use, and how long does it normally last?
Device: ${d.brand} ${d.name} (${d.category}${d.type ? ", " + d.type : ""})
Use web search (at most 2 searches) on the maker's spec page or manual. If it uses no battery at all (iron sights, tritium/fiber optic, non-illuminated magnifier), say so.
swapMonths = a sensible replacement interval for someone who relies on it (e.g. EOTech CR123 ~3 months, Aimpoint T2 CR2032 ~12 months, weapon-light CR123s ~6 months, rechargeables = how often to top up, in months, can be 0.5).
Reply with ONLY this JSON:
{"none": false, "battery": "e.g. CR123A, CR2032, AA, built-in rechargeable", "count": number, "life": "short note, e.g. '50,000 hrs at setting 8' or '1.5 hrs on high'", "swapMonths": number}`;
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }];
  const messages = [{ role: "user", content: ask }];
  let data;
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 2000, tools, messages }) });
    data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || ("Claude API error " + r.status));
    if (data.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: data.content });
  }
  const t = textOf(data.content).replace(/```(?:json)?/gi, "");
  let j = null; for (const c of (t.match(/\{[\s\S]*?\}/g) || []).reverse()) { try { const o = JSON.parse(c); if ("battery" in o || "none" in o) { j = o; break } } catch {} }
  if (!j) throw new Error("couldn't read the battery answer");
  return { none: !!j.none, battery: String(j.battery || "").slice(0, 40), count: Math.max(0, Math.min(8, +j.count || 1)), life: String(j.life || "").slice(0, 80), swapMonths: Math.max(0.25, Math.min(60, +j.swapMonths || 6)) };
}

/* ---------- PACE plan builder ---------- */
async function paceBuild(env, b) {
  const fl = b.freqs.map(f => `${f.i}: ${f.name} | ${f.rx} MHz${f.duplex === "+" || f.duplex === "-" ? ` ${f.duplex}${f.offset}` : f.duplex === "split" ? ` tx ${f.tx}` : f.duplex === "off" ? " rx-only" : " simplex"}${f.tone ? " " + f.tone : ""} | ${f.mode} | ${f.service}${f.group ? " | " + f.group : ""}${f.notes ? " | " + f.notes : ""}${f.onRadio ? " | programmed" : " | not on a radio"}`).join("\n");
  const ask = `Build a practical communications PACE plan (Primary, Alternate, Contingency, Emergency).

Situation
- Area: ${b.location || "not given"}
- Scenario: ${b.scenario}
- How far apart people will be: ${b.distance}
- Terrain: ${b.terrain}
- Cell coverage expected: ${b.cell}
- Power / grid: ${b.grid}
- Who: ${b.people || "a small group"}
- Licenses: ${b.licensed}
- Devices they have: ${b.devices.join(", ") || "phones"}
- How long: ${b.duration || "a day"}
- Other notes: ${b.notes || "none"}

Their saved frequencies (index: details). PREFER these; refer to them by index:
${fl || "(none saved)"}

Rules
- Each step must be a different method or path, each more robust than the last (e.g. cell → text/app → radio simplex/repeater → satellite messenger or pre-agreed meet point).
- Only use radio methods the group actually has devices for. A Baofeng may transmit ONLY on amateur (ham) frequencies and only by licensed operators. GMRS needs a GMRS license and a GMRS-certified radio; FRS and MURS are license-free but need certified FRS/MURS radios. If nobody is licensed, don't plan to transmit on ham.
- Simplex handheld range is ~1–3 mi on flat ground, less in woods/urban; a repeater covers ~20–50 mi. Pick accordingly for the distance and terrain.
${b.location ? `- Use web search (at most 2 searches, e.g. RepeaterBook, the local ARES/RACES group, NOAA Weather Radio station list) to find REAL open 2 m / 70 cm repeaters and the NOAA weather station that cover "${b.location}". If one of the saved frequencies already matches, use the saved one. Only suggest a new frequency if you found it in a source; include the source.` : "- No area given: don't look anything up; use saved frequencies and general simplex/calling channels."}
- Keep text short and usable on a pocket card.

Reply with ONLY this JSON:
{"name":"short plan name","summary":"one sentence",
 "steps":{"p":{"method":"Cell call|Text / Signal|Radio|Ham repeater|Satellite messenger|Meet in person|Visual / signal panel|Email|Other","f":index or null,"n":index into newFreqs or null,"detail":"what exactly to do","when":"when to move to the next step"},"a":{...},"c":{...},"e":{...}},
 "checkin":"schedule, e.g. 'Top of each hour, 5-min listen window'","rally":"advice for picking a rally point (don't invent an address)","codes":"2-3 simple code words",
 "newFreqs":[{"name":"short name","rx":"146.940","duplex":"+|-|","offset":"0.600","tone":"103.5 or empty","mode":"FM","service":"Ham|GMRS|NOAA weather|MURS|FRS","notes":"where/what, e.g. 'W4XX repeater, Jacksonville'","source":"site name"}],
 "gaps":["short things they're missing, e.g. 'No one else is licensed: get them GMRS radios or ham licenses'"]}`;
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }];
  const messages = [{ role: "user", content: ask }];
  let data;
  for (let i = 0; i < 4; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 4000, ...(b.location ? { tools } : {}), messages }) });
    data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || ("Claude API error " + r.status));
    if (data.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: data.content });
  }
  let j = findJson(textOf(data.content), ["steps"]);
  if (!j) {
    messages.push({ role: "assistant", content: data.content.filter(x => x.type !== "text" || (x.text || "").trim()) });
    messages.push({ role: "user", content: "Now reply with ONLY the JSON object described above. No other text." });
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 3000, messages }) });
    data = await r.json().catch(() => ({})); j = findJson(textOf(data.content || []), ["steps"]);
  }
  if (!j || typeof j.steps !== "object") throw new Error("couldn't read the plan, try again");
  const S = (v, n) => String(v ?? "").slice(0, n);
  const nf = (Array.isArray(j.newFreqs) ? j.newFreqs : []).slice(0, 8).map(f => ({ name: S(f.name, 30), rx: S(f.rx, 12), duplex: ["+", "-"].includes(f.duplex) ? f.duplex : "", offset: S(f.offset, 8), tone: S(f.tone, 8), mode: ["FM", "NFM", "AM"].includes(f.mode) ? f.mode : "FM", service: S(f.service, 20), notes: S(f.notes, 120), source: S(f.source, 60) })).filter(f => +f.rx > 0);
  const steps = {};
  for (const k of ["p", "a", "c", "e"]) { const s = j.steps[k] || {}; steps[k] = { method: S(s.method, 30), f: Number.isInteger(s.f) && s.f >= 0 && s.f < b.freqs.length ? s.f : null, n: Number.isInteger(s.n) && s.n >= 0 && s.n < nf.length ? s.n : null, detail: S(s.detail, 200), when: S(s.when, 120) }; }
  return { name: S(j.name, 40), summary: S(j.summary, 200), steps, checkin: S(j.checkin, 120), rally: S(j.rally, 160), codes: S(j.codes, 160), newFreqs: nf, gaps: (Array.isArray(j.gaps) ? j.gaps : []).slice(0, 6).map(g => S(g, 160)) };
}
async function lookupOne(env, it) {
  const clean = {
    id: String(it.id || "").slice(0, 80), name: String(it.name || "").slice(0, 120), brand: String(it.brand || "").slice(0, 120),
    category: String(it.category || "").slice(0, 60), condition: String(it.condition || "Good").slice(0, 20), color: String(it.color || "").slice(0, 40),
    notes: "", kind: it.kind === "wish" ? "wish" : "item",
    arm: String(it.arm || "").slice(0, 8), caliber: String(it.caliber || "").slice(0, 40), load: String(it.load || "").slice(0, 80),
    weightOnly: it.weightOnly === true || it.weightOnly === "true",
  };
  if (!clean.name) return { id: clean.id, ok: false, error: "missing name" };
  if (clean.kind === "wish" && saleRestricted(clean)) return { id: clean.id, ok: false, error: "Price search skips this item." };
  let data;
  try { data = await callClaude(env, env.MODEL || "claude-haiku-5-5", clean); }
  catch (e) {
    if (env.FALLBACK_MODEL && (e.status === 400 || e.status === 404)) data = await callClaude(env, env.FALLBACK_MODEL, clean);
    else throw e;
  }
  const parsed = parseResult(data);
  if (saleRestricted(clean) || clean.weightOnly || lookupAnswerRestricted(parsed)) {
    return { id: clean.id, ok: true, retailNew: null, usedLow: null, usedHigh: null, value: null, weightOz: parsed.weightOz, priceNote: "", weightNote: publicWeightNote(parsed.weightNote), sources: [] };
  }
  return { id: clean.id, ok: true, ...parsed };
}

const DEFAULTS = { FIREBASE_PROJECT: "gear-locker-c248c", ALLOWED_ORIGINS: "https://ace0nbase.github.io", MODEL: "claude-haiku-5-5", FALLBACK_MODEL: "claude-sonnet-5-5", MAX_ITEMS: "4", ALLOWED_EMAILS: "", MAX_WATCHES: "10", WATCH_BATCH: "6", DAILY_AI_LIMIT: "40", ALERT_DAILY_CAP: "6", MIN_ALERT_GAP_HOURS: "20" };
const ROUTES = ["/lookup", "/identify", "/watch/sync", "/watch/status", "/watch/check", "/watch/push", "/battery", "/ammo", "/pace"];

export default {
  async fetch(req, rawEnv) {
    const env = { ...DEFAULTS };
    for (const k in rawEnv) if (rawEnv[k] !== undefined && rawEnv[k] !== "") env[k] = rawEnv[k];
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "gear-locker-api", access: "allowlist" }, 200, h);
    if (!ROUTES.includes(url.pathname) || req.method !== "POST") return json({ error: "Not found" }, 404, h);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "Lookup service isn't set up yet (missing API key)." }, 503, h);

    let user;
    try { user = await verifyFirebaseToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), env.FIREBASE_PROJECT); }
    catch { return json({ error: "Please sign in again." }, 401, h); }
    const access = decideAccess(user, env);
    if (!access.ok) return json({ error: access.error }, access.status, h);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400, h); }
    if (url.pathname.startsWith("/watch/")) {
      if (!env.WATCH) return json({ error: "Price alerts aren't switched on yet" }, 503, h);
      const key = WKEY(user.sub);
      const rec = (await env.WATCH.get(key, "json")) || { list: [] };
      const pub = () => ({ watches: rec.list.map(w => ({ id: w.id, target: w.target, best: w.best || null, lastCheck: w.lastCheck || "", lastErr: w.lastErr || "" })), vapidPublicKey: env.VAPID_PUBLIC_KEY || "", push: !!rec.push });
      const saveRec = async () => {
        rec.email = String(user.email || "");
        rec.emailVerified = !!user.email_verified;
        rec.updatedAt = new Date().toISOString();
        if ((rec.list && rec.list.length) || rec.push) await env.WATCH.put(key, JSON.stringify(rec));
        else await env.WATCH.delete(key);
      };
      if (url.pathname === "/watch/push") {
        const sub = body.subscription;
        if (!sub) { delete rec.push; await saveRec(); return json({ ok: true, push: false }, 200, h); }
        if (!sub.endpoint || !pushEndpointOk(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ error: "That notification setup isn't valid." }, 400, h);
        rec.push = { endpoint: String(sub.endpoint).slice(0, 500), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) } };
        await saveRec();
        return json({ ok: true, push: true }, 200, h);
      }
      if (url.pathname === "/watch/sync") {
        const max = +(env.MAX_WATCHES || 10);
        const inList = Array.isArray(body.watches) ? body.watches : [];
        const old = new Map(rec.list.map(w => [w.id, w]));
        const next = inList.slice(0, max).filter(w => w && w.id && w.name && +w.target > 0 && !saleRestricted(w)).map(w => {
          const o = old.get(String(w.id)) || {};
          const same = o.name === String(w.name) && o.brand === String(w.brand || "");
          return { id: String(w.id).slice(0, 80), name: String(w.name).slice(0, 120), brand: String(w.brand || "").slice(0, 120), category: String(w.category || "").slice(0, 60),
            target: Math.round(+w.target), best: same ? (o.best ? { ...o.best, hit: o.best.price != null && o.best.price <= Math.round(+w.target) } : null) : null,
            lastCheck: same ? (o.lastCheck || "") : "", lastErr: "" };
        });
        rec.list = next;
        await saveRec();
        return json({ ok: true, ...pub(), max, dropped: Math.max(0, inList.length - max) }, 200, h);
      }
      if (url.pathname === "/watch/check") {
        const w = rec.list.find(x => x.id === String(body.id || ""));
        if (!w) return json({ error: "Set an alert price on this item first" }, 400, h);
        if (saleRestricted(w)) {
          w.best = { price: null, where: "", url: "", condition: "", note: "", date: new Date().toISOString().slice(0, 10), hit: false };
          w.lastErr = "";
          await saveRec();
          return json(pub(), 200, h);
        }
        if (w.lastCheck && Date.now() - Date.parse(w.lastCheck) < 10 * 60e3) return json(pub(), 200, h);
        const bill = await chargeScheduledAlert(env, user.sub);
        if (!bill.ok) return json({ error: `Daily lookup limit reached (${+(env.DAILY_AI_LIMIT || 40)} per day). Try again tomorrow.` }, 429, h);
        try { w.best = await dealCheck(env, w); w.lastErr = ""; } catch (e) { w.lastErr = String(e.message || e).slice(0, 120); }
        w.lastCheck = new Date().toISOString();
        await saveRec();
        return json(pub(), 200, h);
      }
      return json(pub(), 200, h);
    }
    if (url.pathname === "/pace") {
      const S = (v, n) => String(v ?? "").slice(0, n);
      const b = { location: S(body.location, 80), scenario: S(body.scenario, 60), distance: S(body.distance, 60), terrain: S(body.terrain, 60), cell: S(body.cell, 40), grid: S(body.grid, 40), people: S(body.people, 80), licensed: S(body.licensed, 80), duration: S(body.duration, 40), notes: S(body.notes, 300),
        devices: (Array.isArray(body.devices) ? body.devices : []).slice(0, 12).map(d => S(d, 40)),
        freqs: (Array.isArray(body.freqs) ? body.freqs : []).slice(0, 150).map((f, i) => ({ i, name: S(f.name, 30), rx: S(f.rx, 12), duplex: S(f.duplex, 6), offset: S(f.offset, 8), tx: S(f.tx, 12), tone: S(f.tone, 16), mode: S(f.mode, 4), service: S(f.service, 24), group: S(f.group, 30), notes: S(f.notes, 80), onRadio: !!f.onRadio })) };
      const paceBill = await chargeAi(env, user.sub, 1);
      if (!paceBill.ok) return json({ error: paceBill.error }, paceBill.status, h);
      try { return json({ result: await paceBuild(env, b) }, 200, h); }
      catch (e) { return json({ error: String(e.message || e).slice(0, 160) }, 502, h); }
    }
    if (url.pathname === "/ammo") return json({ error: "Ammo price search is turned off." }, 410, h);
    if (url.pathname === "/battery") {
      const battBill = await chargeAi(env, user.sub, 1);
      if (!battBill.ok) return json({ error: battBill.error }, battBill.status, h);
      try { return json({ result: await batteryLookup(env, { name: String(body.name || "").slice(0, 120), brand: String(body.brand || "").slice(0, 80), category: String(body.category || "").slice(0, 60), type: String(body.type || "").slice(0, 40) }) }, 200, h); }
      catch (e) { return json({ error: String(e.message || e).slice(0, 160) }, 502, h); }
    }
    if (url.pathname === "/identify") {
      const img = String(body.image || "");
      if (!img || img.length > 2_800_000 || !/^[A-Za-z0-9+/=]+$/.test(img.slice(0, 200))) return json({ error: "Send a photo (JPEG, under 2 MB)" }, 400, h);
      const idBill = await chargeAi(env, user.sub, 1);
      if (!idBill.ok) return json({ error: idBill.error }, idBill.status, h);
      try { return json({ result: await identify(env, img, String(body.hint || "").slice(0, 80)) }, 200, h); }
      catch (e) { return json({ error: String(e.message || e).slice(0, 160) }, 502, h); }
    }
    const max = +(env.MAX_ITEMS || 4);
    const items = Array.isArray(body.items) ? body.items.slice(0, max) : [];
    if (!items.length) return json({ error: "No items" }, 400, h);
    const lookBill = await chargeAi(env, user.sub, items.length);
    if (!lookBill.ok) return json({ error: lookBill.error }, lookBill.status, h);

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
