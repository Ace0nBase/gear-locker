// Shared checks for the app, the lookup worker, and tests.
// No network, no secrets, no personal data.

export const SHARE_ITEM_KEYS = ["id", "name", "brand", "color", "category", "nick", "qty", "weight", "parent", "caliber", "value", "paid"];
export const MAX_SHARE_ITEMS = 80;

export const USER_LOCAL_KEYS = [
  "gearLocker.items",
  "gearLocker.kits",
  "gearLocker.db",
  "gearLocker.uid",
  "gearLocker.lock",
  "gearLocker.shareName",
  "gearLocker.curKit",
  "gearLocker.tab",
  "gearLocker.timer",
  "gearLocker.offline",
];
export const DEVICE_LOCAL_KEYS = ["gearLocker.keep", "gearLocker.noFolder"];

export function clearUserLocal(storage) {
  if (!storage) return;
  USER_LOCAL_KEYS.forEach(k => { try { storage.removeItem(k); } catch { /* private mode */ } });
  const extra = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith("gearLocker.") && !DEVICE_LOCAL_KEYS.includes(k)) extra.push(k);
    }
  } catch { /* ignore */ }
  extra.forEach(k => { try { storage.removeItem(k); } catch { /* ignore */ } });
}

export function shareItemFields(i, parent, prices) {
  const row = {
    id: String((i && i.id) || ""),
    name: String((i && i.name) || ""),
    brand: String((i && i.brand) || ""),
    color: String((i && i.color) || ""),
    category: String((i && i.category) || ""),
    nick: String((i && i.nick) || ""),
    qty: +((i && i.qty) || 1) || 1,
    weight: i && i.weight != null && i.weight !== "" && isFinite(+i.weight) ? +i.weight : null,
    parent: parent || "",
    caliber: i && i.category === "Firearms" ? String(i.caliber || "") : "",
  };
  if (prices) {
    row.value = countedValue(i);
    row.paid = +((i && i.paid) || 0) || 0;
  }
  return row;
}

export function newWriteId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function serverStampIso(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") {
    const t = Date.parse(v);
    return isFinite(t) ? new Date(t).toISOString() : "";
  }
  if (v instanceof Date) return isFinite(v.getTime()) ? v.toISOString() : "";
  if (typeof v.toDate === "function") {
    try {
      const d = v.toDate();
      if (d instanceof Date && isFinite(d.getTime())) return d.toISOString();
    } catch { /* not a Timestamp */ }
  }
  if (typeof v === "object") {
    const sec = v.seconds != null ? v.seconds : v._seconds;
    if (sec != null && isFinite(+sec)) {
      const ns = v.nanoseconds != null ? v.nanoseconds : (v._nanoseconds || 0);
      return new Date(+sec * 1000 + Math.floor(+ns / 1e6)).toISOString();
    }
  }
  return "";
}

export function mergeByServerTime(local, remote, inflight) {
  inflight = inflight || {};
  if (!remote) return local;
  if (!local) return remote;
  const lStamp = serverStampIso(local.serverUpdatedAt);
  const rStamp = serverStampIso(remote.serverUpdatedAt);
  const flight = inflight[local.id] || inflight[remote.id] || null;
  if (flight && flight.writeId && remote.writeId === flight.writeId) {
    if (local.updatedAt === flight.updatedAt) return { ...remote, serverUpdatedAt: rStamp || remote.serverUpdatedAt };
    return { ...local, serverUpdatedAt: rStamp || local.serverUpdatedAt };
  }
  if (rStamp && lStamp) {
    if (rStamp > lStamp) return { ...remote, serverUpdatedAt: rStamp };
    if (lStamp > rStamp) return local;
    if (local.updatedAt && remote.updatedAt && local.updatedAt > remote.updatedAt) return { ...local, serverUpdatedAt: lStamp };
    return { ...remote, serverUpdatedAt: rStamp };
  }
  if (rStamp && !lStamp) return { ...remote, serverUpdatedAt: rStamp };
  if (!rStamp && !lStamp) {
    const lu = local.updatedAt || "";
    const ru = remote.updatedAt || "";
    return ru > lu ? remote : local;
  }
  return local;
}

export function mergeKitsByServerTime(local, remote, meta) {
  meta = meta || {};
  const lStamp = serverStampIso(meta.localStamp);
  const rStamp = serverStampIso(meta.remoteStamp);
  const remoteKits = remote || {};
  if (meta.inflightWriteId && meta.remoteWriteId === meta.inflightWriteId) {
    if (meta.localPending) return { kits: local, serverUpdatedAt: rStamp || "", kept: "local" };
    return { kits: remoteKits, serverUpdatedAt: rStamp || "", kept: "remote" };
  }
  if (rStamp && (!lStamp || rStamp > lStamp)) return { kits: remoteKits, serverUpdatedAt: rStamp, kept: "remote" };
  if (lStamp && (!rStamp || lStamp > rStamp)) return { kits: local, serverUpdatedAt: lStamp, kept: "local" };
  if (!rStamp && !lStamp) {
    if (meta.localPending) return { kits: local, serverUpdatedAt: "", kept: "local" };
    if (remote) return { kits: remoteKits, serverUpdatedAt: "", kept: "remote" };
  }
  return { kits: local, serverUpdatedAt: lStamp, kept: "local" };
}

export function parseAllowlist(raw) {
  return String(raw || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function decideAccess(user, env) {
  const allow = parseAllowlist(env && env.ALLOWED_EMAILS);
  const email = String((user && user.email) || "").trim().toLowerCase();
  if (!allow.length) return { ok: false, status: 403, error: "Lookups are turned off until the owner adds approved emails.", email };
  if (!email || !allow.includes(email)) return { ok: false, status: 403, error: "Lookups are turned off for this account. Ask the owner to add your email.", email };
  if (!user.email_verified) return { ok: false, status: 403, error: "Confirm your email first (check your inbox), then try again.", email };
  return { ok: true, status: 200, error: "", email };
}

export function chargeDecision(used, add, limit) {
  used = Math.max(0, +used || 0);
  add = Math.max(0, +add || 0);
  limit = Math.max(0, +limit || 0);
  if (used + add > limit) return { ok: false, remaining: Math.max(0, limit - used), limit, next: used };
  return { ok: true, remaining: limit - used - add, limit, next: used + add };
}

function utcDay(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function quotaKey(uid, date) {
  return `q:${uid}:${utcDay(date)}`;
}

export function alertQuotaKey(uid, date) {
  return `a:${uid}:${utcDay(date)}`;
}

export function selectDueWatches(users, opts) {
  opts = opts || {};
  const now = opts.now != null ? +new Date(opts.now) : Date.now();
  const budget = opts.budget != null ? opts.budget : 6;
  const minGapMs = opts.minGapMs != null ? opts.minGapMs : 20 * 3600e3;
  const queues = [];
  for (const u of users || []) {
    const due = (u.list || []).filter(w => {
      if (!w || !w.lastCheck) return true;
      const t = Date.parse(w.lastCheck);
      return !isFinite(t) || now - t >= minGapMs;
    }).slice().sort((a, b) => {
      const ta = a.lastCheck ? Date.parse(a.lastCheck) : 0;
      const tb = b.lastCheck ? Date.parse(b.lastCheck) : 0;
      return (isFinite(ta) ? ta : 0) - (isFinite(tb) ? tb : 0);
    });
    if (due.length) queues.push({ uid: u.uid, due, i: 0 });
  }
  queues.sort((a, b) => {
    const ta = a.due[0].lastCheck ? Date.parse(a.due[0].lastCheck) : 0;
    const tb = b.due[0].lastCheck ? Date.parse(b.due[0].lastCheck) : 0;
    return (isFinite(ta) ? ta : 0) - (isFinite(tb) ? tb : 0);
  });
  const picked = [];
  while (picked.length < budget && queues.some(q => q.i < q.due.length)) {
    for (const q of queues) {
      if (picked.length >= budget) break;
      if (q.i < q.due.length) {
        picked.push({ uid: q.uid, watch: q.due[q.i] });
        q.i++;
      }
    }
  }
  return picked;
}

export function pinLengthOk(pin) {
  return /^\d{6,12}$/.test(String(pin || ""));
}

export function newPasswordOk(pw) {
  return String(pw || "").length >= 12;
}

// reload() updates the user object. Rules and lookups read the ID token, which stays stale until this.
export async function refreshAuthClaims(user) {
  if (!user || typeof user.reload !== "function" || typeof user.getIdToken !== "function") {
    throw new Error("no user");
  }
  await user.reload();
  await user.getIdToken(true);
  return user;
}

// The private loan and the shared lend are one save. A later debounced sync must not be the only copy.
export function loanSharePlan(loan, opts) {
  const removed = !!(opts && opts.removed);
  const verified = !!(opts && opts.verified);
  const email = String((loan && loan.friendEmail) || "").trim();
  const wasShared = !!(loan && loan.lendShared);
  const share = verified && !removed && !!email && !(loan && loan.deleted);
  return {
    writePrivate: true,
    writeLend: share,
    deleteLend: verified && !share && wasShared,
    needsVerify: !verified && !removed && !!email,
  };
}

// Drop client-only flags before a row is written to the server.
export function serverRow(row) {
  const copy = { ...(row || {}) };
  delete copy.offlinePending;
  return copy;
}

// A recovered loan keeps the item name when the inventory link is gone.
export function loanNeedsItem(loan) {
  const id = String((loan && loan.itemId) || "").trim();
  const name = String((loan && loan.itemName) || "").trim();
  return !id && !name;
}

// A lend with no matching private loan is recovered so the lender can mark it returned.
export function orphanLoansFromLends(privateLoans, lends, nowIso) {
  const have = new Set((privateLoans || []).filter(row => row && row.id).map(row => row.id));
  const stamp = nowIso || "";
  const out = [];
  for (const lend of lends || []) {
    if (!lend || !lend.id || have.has(lend.id)) continue;
    const item = lend.item || {};
    out.push({
      id: lend.id,
      itemId: "",
      itemName: String(item.name || ""),
      itemBrand: String(item.brand || ""),
      itemColor: String(item.color || ""),
      itemCategory: String(item.category || ""),
      borrower: String(lend.borrowerName || ""),
      friendEmail: String(lend.borrowerEmail || ""),
      out: lend.out || "",
      due: lend.due || "",
      returned: lend.returned || "",
      lendShared: true,
      notes: "",
      updatedAt: stamp || String(lend.updatedAt || ""),
      createdAt: stamp || String(lend.updatedAt || ""),
    });
  }
  return out;
}

// A missing file is not a blocked file. Only an explicit denial counts.
export function storagePrivacyVerdict(otherCode, signedOutCode) {
  const code = v => String(v || "");
  const denied = v => code(v) === "storage/unauthorized";
  const missing = v => code(v) === "storage/object-not-found";
  return {
    pass: denied(otherCode) && denied(signedOutCode),
    otherDenied: denied(otherCode),
    signedOutDenied: denied(signedOutCode),
    countedMissingAsBlocked: missing(otherCode) || missing(signedOutCode),
  };
}

// Offline edits have to reach the local queue before a reload. Online edits can wait.
export function cloudWriteDelay(onLine) {
  return onLine === false ? 0 : 400;
}

export function serviceWorkerAllowed(loc, qa) {
  if (!loc) return false;
  if (loc.protocol === "https:") return true;
  const host = loc.hostname === "127.0.0.1" || loc.hostname === "localhost";
  return !!qa && loc.protocol === "http:" && host;
}

// Category text only. Names are not folded, and digit swaps are not rewritten.
function categoryKey(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Automatic prices stop at the firearm, suppressor, ammunition, and lower-receiver
// shelves, and at a firearm or suppressor record on the Arms Room. A magazine
// shelf is not one of those. The item name is not checked.
export function saleRestricted(item) {
  if (!item || typeof item !== "object") return false;
  const kind = String(item.kind || item.tab || "").trim().toLowerCase();
  if (kind === "ammo") return true;
  const arm = String(item.arm || "").trim().toUpperCase();
  if (arm === "FA" || arm === "SU") return true;
  const c = categoryKey(item.category);
  if (!c) return false;
  if (/\bmags?\b|\bmagazines?\b|\bstorage\b/.test(c)) return false;
  if (/\b(firearms?|handguns?|rifles?|shotguns?|suppressors?|silencers?|nfa)\b/.test(c)) return true;
  if (/\b(ammunitions?|ammo|cartridges?|reloading)\b/.test(c)) return true;
  if (/\b(lowers?|frames?|receivers?)\b/.test(c)) return true;
  return false;
}

// Firearm marketplaces and firearm or ammunition retailers, matched by domain.
// Stores that also sell gear drop only a firearm, ammunition, or suppressor path segment.
const GUN_MARKET_HOSTS = new Set([
  "gunbroker.com", "armslist.com", "gunsamerica.com", "palmettostatearmory.com", "ammoseek.com",
  "luckygunner.com", "silencershop.com", "wikiarms.com", "cheaperthandirt.com", "grabagun.com",
  "budsgunshop.com", "aimsurplus.com", "kygunco.com", "classicfirearms.com", "impactguns.com",
  "gunsinternational.com", "galleryofguns.com", "slickguns.com", "truegunvalue.com", "targetsportsusa.com",
  "ammunitiondepot.com", "ammobuy.com", "silencercentral.com", "capitolarmory.com", "guns.com",
  "gun.deals", "ammo.com", "psa.com", "rainierarms.com", "ruger.com", "glock.com", "sgammo.com",
  "bulkammo.com", "dkfirearms.com", "gunbuyer.com", "gunprime.com", "ar15.com",
]);
const SHORTENER_HOSTS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "rebrand.ly", "cutt.ly", "is.gd",
  "shorturl.at", "rb.gy", "tiny.cc", "s.id", "buff.ly", "lnkd.in", "bl.ink", "t.ly",
  "v.gd", "x.co", "qr.ae", "shorte.st", "adf.ly",
]);
const GEAR_STORE_HOSTS = new Set([
  "brownells.com", "primaryarms.com", "natchezss.com", "natchez.com", "cabelas.com", "basspro.com",
  "sportsmans.com", "sportsmanswarehouse.com", "midwayusa.com", "opticsplanet.com", "academy.com",
  "scheels.com", "sportsmansguide.com", "eurooptic.com", "sigsauer.com", "budk.com",
]);
const FIREARM_SEGMENTS = new Set([
  "firearms", "guns", "handguns", "rifles", "pistols", "shotguns", "ammo", "ammunition",
  "suppressors", "suppressor", "silencer", "silencers", "lowers", "nfa", "reloading",
  "receivers", "lower-receivers", "stripped-lowers",
]);
const REDIRECT_KEYS = new Set(["u", "q", "url", "uddg", "target", "dest", "redirect", "redirect_url", "to", "next", "link", "r", "goto", "out"]);
const LINK_TOKEN = /https?:\/\/[^\s<>"']+|\b(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|deals|ly|gl|gd|co|at|cc|id|gy|in|ink|ae|st|ee)\b[^\s<>"']*/gi;

function parsedUrl(value) {
  try { return new URL(String(value)); } catch { return null; }
}

function normalizeHost(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
}

function toHttpUrl(value) {
  const text = String(value || "").trim().replace(/[),.;]+$/, "");
  if (!text) return null;
  const direct = parsedUrl(text);
  if (direct && /^https?:$/i.test(direct.protocol)) return direct;
  if (/^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(text)) {
    const withScheme = parsedUrl("https://" + text);
    if (withScheme && /^https?:$/i.test(withScheme.protocol)) return withScheme;
  }
  return null;
}

function pathText(url) {
  try { return decodeURIComponent(url.pathname || ""); } catch { return url.pathname || ""; }
}

function hostIn(host, names) {
  let h = host;
  while (h) {
    if (names.has(h)) return true;
    const dot = h.indexOf(".");
    if (dot < 0) return false;
    h = h.slice(dot + 1);
  }
  return false;
}

function firearmSegments(url) {
  return pathText(url).split("/").map(part => part.trim().toLowerCase().replace(/\.(html?|aspx|php)$/i, "")).filter(Boolean).some(part => FIREARM_SEGMENTS.has(part));
}

function hostBlocked(url) {
  if (!url) return false;
  const host = normalizeHost(url.hostname);
  if (!host) return false;
  if (hostIn(host, SHORTENER_HOSTS)) return true;
  if (host === "linktr.ee" && /^\/redirects(?:\/|$)/i.test(pathText(url))) return true;
  if (hostIn(host, GUN_MARKET_HOSTS)) return true;
  if (hostIn(host, GEAR_STORE_HOSTS) && firearmSegments(url)) return true;
  return false;
}

function httpTarget(value) {
  let text = String(value || "").trim();
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(text); i++) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch { break; }
  }
  const url = toHttpUrl(text);
  return url && /^https?:$/i.test(url.protocol) ? url : null;
}

function redirectTargets(url) {
  const out = [];
  for (const [key, value] of url.searchParams) {
    if (!REDIRECT_KEYS.has(String(key).toLowerCase())) continue;
    const next = httpTarget(value);
    if (next && next.href !== url.href) out.push(next);
  }
  return out;
}

function chainBlocked(url, unwraps) {
  if (!url) return false;
  if (hostBlocked(url)) return true;
  const nexts = redirectTargets(url);
  if (!nexts.length) return false;
  if (unwraps >= 3) return true;
  return nexts.some(next => chainBlocked(next, unwraps + 1));
}

export function gunMarketUrl(value) {
  return chainBlocked(toHttpUrl(value), 0);
}

export function stripGunMarketSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .filter(s => s && /^https:\/\//.test(s.url || "") && !gunMarketUrl(s.url))
    .slice(0, 4)
    .map(s => ({ label: String(s.label || "source").slice(0, 40), url: String(s.url).slice(0, 400) }));
}

export function stripGunMarketText(note) {
  return String(note || "").replace(LINK_TOKEN, token => gunMarketUrl(token.replace(/[),.;]+$/, "")) ? "" : token).replace(/\s{2,}/g, " ").trim();
}

// True when the answer still carries a firearm-retailer link. A price note, a size, or cents do not count.
export function lookupAnswerRestricted(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const urls = [...sources.map(s => s && s.url), parsed.url].filter(Boolean);
  return urls.some(gunMarketUrl);
}

function priceNumber(v) {
  return (v === null || v === undefined || v === "" || !isFinite(+v)) ? null : +v;
}

function extractTopJsonObjects(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const out = [];
  let i = 0;
  while (i < t.length) {
    if (t[i] !== "{") { i++; continue; }
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { end = j; break; }
    }
    if (end < 0) break;
    const raw = t.slice(i, end + 1);
    let parsed = null;
    for (const cand of [raw, raw.replace(/[\r\n]+/g, " ")]) {
      try { parsed = JSON.parse(cand); break; } catch { parsed = null; }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) out.push(parsed);
    i = end + 1;
  }
  return out;
}

// One lookup or deal object. A second JSON object drops every link, so the last
// object cannot smuggle a marketplace url through. A single object keeps its
// other links and loses firearm-retailer ones.
export function pickModelAnswer(text) {
  const objects = extractTopJsonObjects(text);
  const answers = objects.filter(o => ["retailNew", "usedLow", "usedHigh", "value", "weightOz", "price", "sources", "url"].some(k => k in o));
  if (!answers.length) return null;
  const picked = { ...answers[answers.length - 1] };
  if (objects.length > 1) {
    picked.sources = [];
    picked.url = "";
    picked.linksDropped = true;
  } else {
    picked.sources = stripGunMarketSources(picked.sources);
    if (gunMarketUrl(picked.url)) picked.url = "";
  }
  if (picked.priceNote) picked.priceNote = stripGunMarketText(picked.priceNote);
  return picked;
}

// A blocked category never receives a price. Other gear keeps its price, without firearm-retailer links.
export function settleLookup(item, parsed) {
  const clean = parsed && typeof parsed === "object" ? parsed : null;
  if (!clean) return { apply: false };
  const block = !!(item && (item.weightOnly || saleRestricted(item)));
  const sources = block || clean.linksDropped ? [] : stripGunMarketSources(clean.sources);
  if (block) {
    return {
      apply: true,
      retailNew: null, usedLow: null, usedHigh: null, value: null,
      weightOz: priceNumber(clean.weightOz), priceNote: "",
      weightNote: publicWeightNote(clean.weightNote), sources: [],
    };
  }
  return {
    apply: true,
    retailNew: priceNumber(clean.retailNew), usedLow: priceNumber(clean.usedLow), usedHigh: priceNumber(clean.usedHigh),
    value: priceNumber(clean.value), weightOz: priceNumber(clean.weightOz),
    priceNote: stripGunMarketText(clean.priceNote).slice(0, 240),
    weightNote: stripGunMarketText(clean.weightNote).slice(0, 80),
    sources,
  };
}

// Same condition factors the form uses when a typed retail price fills the insured value.
const CONDITION_FACTOR = { New: 0.9, Good: 0.7, Used: 0.55, Worn: 0.4, "Needs-repair": 0.2 };

// A number the user typed on a blocked item stays. A prefilled market price does not become a typed price.
export function keepManualPrice(item, touch) {
  if (!item || typeof item !== "object" || !saleRestricted(item)) return item;
  const flags = touch && typeof touch === "object" ? touch : {};
  const out = { ...item, marketSources: [] };
  delete out.priceNote;
  delete out.usedLow;
  delete out.usedHigh;
  delete out.deal;
  if ("link" in out) out.link = "";
  const retail = Math.max(0, Math.round(+out.retailNew || 0));
  const value = Math.max(0, Math.round(+out.value || 0));
  const retailDirty = !!flags.retail;
  const valueDirty = !!flags.value;
  const keepRetail = retail > 0 && (retailDirty || !!flags.retailWasManual);
  if (keepRetail) {
    out.retailNew = retail;
    out.priceSource = "manual";
  } else {
    out.retailNew = 0;
    delete out.priceSource;
    delete out.priceDate;
  }
  const factor = CONDITION_FACTOR[out.condition] ?? 0.6;
  const derived = keepRetail && retailDirty && !valueDirty && value > 0 && value === Math.round(retail * factor);
  if (value > 0 && (valueDirty || !!flags.valueWasManual || derived)) {
    out.value = value;
    out.valueSource = "manual";
  } else {
    out.value = 0;
    delete out.valueSource;
  }
  if (out.weightNote) out.weightNote = publicWeightNote(out.weightNote);
  return out;
}

// Price flags belong on the record before the one cloud write. A later snapshot
// echo then has the same flags, and a typed insured value survives a move onto a blocked shelf.
export function stampManualPrices(item, before, touch) {
  if (!item || typeof item !== "object") return item;
  const flags = touch && typeof touch === "object" ? touch : {};
  const out = { ...item };
  const retailTyped = !!flags.retail && +out.retailNew > 0;
  const valueTyped = !!flags.value && +out.value > 0;
  const retailWasManual = !!(before && before.priceSource === "manual");
  const valueWasManual = !!(before && before.valueSource === "manual");
  if (retailTyped) out.priceSource = "manual";
  else if (flags.retail && !(+out.retailNew > 0) && out.priceSource === "manual") {
    delete out.priceSource;
    delete out.priceDate;
  }
  if (valueTyped) out.valueSource = "manual";
  else if (!flags.value && !(+out.value > 0) && out.valueSource === "manual") delete out.valueSource;
  if (!saleRestricted(out)) return out;
  return keepManualPrice(out, {
    retail: !!flags.retail,
    value: !!flags.value,
    retailWasManual: retailWasManual || retailTyped,
    valueWasManual: valueWasManual || valueTyped,
  });
}

// A market lookup fills empty and auto-filled numbers. A retail or insured value the user typed stays.
export function applyMarketPrices(item, result, day) {
  const out = { ...(item && typeof item === "object" ? item : {}) };
  const res = result && typeof result === "object" ? result : {};
  const n = v => (v == null || v === "" || !isFinite(+v)) ? null : Math.round(+v);
  const retailManual = out.priceSource === "manual" && +out.retailNew > 0;
  const valueManual = out.valueSource === "manual" && +out.value > 0;
  const retail = n(res.retailNew);
  const value = n(res.value);
  if (!retailManual && retail != null) out.retailNew = retail;
  const usedLow = n(res.usedLow);
  const usedHigh = n(res.usedHigh);
  if (usedLow != null) out.usedLow = usedLow;
  if (usedHigh != null) out.usedHigh = usedHigh;
  if (!valueManual && value != null) out.value = value;
  else if (!valueManual && value == null && +out.retailNew > 0) out.value = Math.round(+out.retailNew * (CONDITION_FACTOR[out.condition] ?? 0.6));
  if (!retailManual) {
    out.priceSource = "market";
    if (day) out.priceDate = day;
  }
  out.priceNote = stripGunMarketText(res.priceNote || "").slice(0, 240);
  out.marketSources = stripGunMarketSources(res.sources);
  return out;
}

// A deal for a blocked category has no price and no link. Other gear keeps the price and loses a firearm-retailer link.
export function settleDeal(item, parsed) {
  const empty = blocked => ({ price: null, where: "", url: "", condition: "", note: "", restricted: !!blocked });
  if (saleRestricted(item)) return empty(true);
  const clean = parsed && typeof parsed === "object" ? parsed : null;
  if (!clean) return empty(false);
  let url = /^https:\/\//.test(clean.url || "") ? String(clean.url).slice(0, 400) : "";
  if (clean.linksDropped || gunMarketUrl(url)) url = "";
  let where = String(clean.where || "").slice(0, 40);
  if (/^https?:/i.test(where) && (clean.linksDropped || gunMarketUrl(where))) where = "";
  const price = isFinite(+clean.price) && +clean.price > 0 ? Math.round(+clean.price * 100) / 100 : null;
  return {
    price, where, url, condition: String(clean.condition || "").slice(0, 20),
    note: stripGunMarketText(clean.note).slice(0, 160), restricted: false,
  };
}

// The calendar day where the app is open, not the UTC date.
export function localDay(d) {
  const dt = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function countedValue(item) {
  if (!item || typeof item !== "object") return 0;
  const n = +item.value;
  if (!isFinite(n) || n <= 0) return 0;
  if (saleRestricted(item) && item.valueSource !== "manual") return 0;
  return n;
}

export function csvExportField(item, key) {
  if (!item || typeof item !== "object") return "";
  if (saleRestricted(item) && item.priceSource !== "manual" && (key === "retailNew" || key === "priceSource" || key === "priceDate")) return "";
  if (key === "value" && saleRestricted(item)) {
    const n = countedValue(item);
    return n || "";
  }
  const v = item[key];
  return v == null ? "" : v;
}

function hasPriceNumber(s) {
  const bare = String(s).replace(/\b\d+(?:\.\d+)?\s*(?:oz|ounces?|lb|lbs|pounds?|g|kg|grams?|mm|cm|in|inch|inches)\b/gi, " ");
  return /\b\d{2,5}\.\d{2}\b/.test(bare) || /\b\d{3,5}\b/.test(bare);
}

const NUMBER_WORD = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const SPELLED_AMOUNT = new RegExp(`\\b(?:${NUMBER_WORD})\\s+hundred\\b|\\b(?:${NUMBER_WORD})\\s+thousand\\b|\\b(?:${NUMBER_WORD})\\s+(?:${NUMBER_WORD})\\b`, "i");
const RETAILER = /\b(stores?|shops?|retailers?|outfitters?|dealers?|sellers?|vendors?|merchants?|distributors?|resellers?|gunsmiths?|emporiums?|bazaars?)\b/i;

// A restricted weight note keeps a maker spec. It drops store names and price figures.
export function publicWeightNote(note) {
  let s = String(note || "");
  if (/\$\s*\d|\bUSD\b|\bMSRP\b|\bdollars?\b|\bbucks\b/i.test(s)) return "";
  if (SPELLED_AMOUNT.test(s) || RETAILER.test(s)) return "";
  const store = /\b(amazon|ebay|tacswap|brownells|palmetto|\bpsa\b|midway|opticsplanet|primary\s*arms|gunbroker|cheaper\s*than\s*dirt|cabela'?s|bass\s*pro|sportsman'?s|grabagun|bud'?s?(?:\s*gun)?|aim\s*surplus|eurooptic|armslist|ammoseek|wikiarms|guns\.com|impact\s*guns|kygunco|classic\s*firearms|gun\.deals|scheels|rei|\bbig\s*5\b)\b/i;
  const priceWord = /\b(price|priced|avg|average|sale|sold|cost|retail)\b/i;
  if ((store.test(s) || priceWord.test(s) || /\bfor\s+\d{3,5}(?:\.\d{2})?\b/i.test(s)) && hasPriceNumber(s)) return "";
  s = s.replace(/https?:\/\/\S+/gi, " ");
  s = s.replace(/\bwww\.\S+/gi, " ");
  s = s.replace(store, " ");
  if (/\b(armory|academy|sports|sporting|outdoor|surplus|warehouse|retailer|dealer|gun\s*shop|firearms|scheels|midway|gunbroker)\b/i.test(s)) return "";
  if (hasPriceNumber(s)) return "";
  s = s.replace(/\s{2,}/g, " ").replace(/^[\s,;:.\-|]+|[\s,;:.\-|]+$/g, "");
  return s.slice(0, 80);
}


// Missing or "1" keeps the signed-in session. Only an explicit "0" turns it off.
export function keepSignedIn(storage) {
  try { return !storage || storage.getItem("gearLocker.keep") !== "0"; }
  catch { return true; }
}

// Keep-signed-in off uses a memory cache and drops any disk cache from an earlier session.
export function firestoreMemoryOnly(keep) {
  return keep === false;
}

export const SIGN_OUT_WAIT_MS = 1500;

// True when the save finished, false when it timed out or failed.
export function settleOrTimeout(promise, ms) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    Promise.resolve(promise).then(() => finish(true), () => finish(false));
    setTimeout(() => finish(false), ms);
  });
}

export function signOutConfirmNeeded(settled) {
  return settled === false;
}

// Spreadsheet apps run a cell that starts with these. A leading apostrophe forces text.
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

const ARMORY_ARMS = new Set(["FA", "SU", "OP", "WL", "LA", "KN"]);
const TOOLISH = /multi.?tool|leatherman|gerber|\bsaw\b|shovel|plier|wrench|screwdriver|sharpener|machete|e-?tool/i;

// Attach the item this one is mounted on, so a headlamp on a helmet stays a lookup and a light on a rifle does not.
export function armorySubject(item, host) {
  if (!item || typeof item !== "object") return item;
  if (!host) return item;
  return { ...item, hostCategory: host.category || "", hostArm: host.arm || "" };
}

function onWeapon(item) {
  if (!item || !item.mountedOn) return false;
  const hostCat = String(item.hostCategory || "").trim().toLowerCase();
  const hostArm = String(item.hostArm || "").trim().toUpperCase();
  return hostCat === "firearms" || hostCat === "suppressors" || hostArm === "FA" || hostArm === "SU";
}

// Arms Room records, and gear mounted on a weapon. A headlamp, flashlight, or binoculars on their own still look up.
export function armoryLookupBlocked(privateArms, item) {
  if (!privateArms || !item || typeof item !== "object") return false;
  const arm = String(item.arm || "").trim().toUpperCase();
  if (ARMORY_ARMS.has(arm)) return true;
  if (onWeapon(item)) return true;
  const category = String(item.category || "").trim().toLowerCase();
  if (category === "firearms" || category === "suppressors") return true;
  if (category === "knives & tools") {
    const blob = [item.name, item.brand].map(v => String(v || "")).join(" ");
    return !TOOLISH.test(blob);
  }
  return false;
}

// With the opt-out on, a new item has to have a category before Photo ID can run.
export function photoIdBlocked(privateArms, item) {
  if (!privateArms) return false;
  if (!item || !String(item.category || "").trim()) return true;
  return armoryLookupBlocked(true, item);
}

// Once a drill has its round count, later bangs are echoes, not another shot.
export function timerShotAccepted(count, rounds) {
  const need = +rounds || 0;
  return !(need && count >= need);
}

// FCC Part 95: channels 1–22 are shared FRS and GMRS. Repeater inputs sit 5 MHz up from 15–22.
const FRS_GMRS_MHZ = [
  462.5625, 462.5875, 462.6125, 462.6375, 462.6625, 462.6875, 462.7125,
  467.5625, 467.5875, 467.6125, 467.6375, 467.6625, 467.6875, 467.7125,
  462.55, 462.575, 462.6, 462.625, 462.65, 462.675, 462.7, 462.725,
];
function mhzNear(a, b) { return Math.abs(a - b) < 0.0002; }
function on25kHz(rx) {
  const steps = rx / 0.025;
  return Math.abs(steps - Math.round(steps)) < 0.02;
}
export function radioService(rx) {
  const n = parseFloat(String(rx ?? "").replace(/[^\d.]/g, ""));
  if (!isFinite(n) || n <= 0) return "Other";
  if (FRS_GMRS_MHZ.some(f => mhzNear(n, f))) return "FRS/GMRS";
  if (n >= 467.55 - 0.0004 && n <= 467.725 + 0.0004 && on25kHz(n)) return "GMRS";
  if ((n >= 144 && n <= 148) || (n >= 420 && n <= 450) || (n >= 222 && n <= 225) || (n >= 50 && n <= 54)) return "Ham";
  if (n >= 462.55 && n <= 467.725) return "GMRS";
  if (n >= 151.82 && n <= 154.6) return "MURS";
  if (n >= 156 && n <= 162.025) return "Marine";
  if (n >= 162.4 && n <= 162.55) return "NOAA weather";
  if (n >= 108 && n <= 137) return "Aviation";
  return "Other";
}

const GearLogic = {
  SHARE_ITEM_KEYS, MAX_SHARE_ITEMS, USER_LOCAL_KEYS, DEVICE_LOCAL_KEYS,
  clearUserLocal, shareItemFields, newWriteId, serverStampIso, mergeByServerTime, mergeKitsByServerTime,
  parseAllowlist, decideAccess, chargeDecision, quotaKey, alertQuotaKey, selectDueWatches, pinLengthOk, newPasswordOk,
  refreshAuthClaims, loanSharePlan, orphanLoansFromLends, serverRow, loanNeedsItem, storagePrivacyVerdict, cloudWriteDelay, serviceWorkerAllowed, saleRestricted,
  countedValue, csvExportField, csvCell, publicWeightNote, lookupAnswerRestricted, localDay,
  gunMarketUrl, stripGunMarketSources, stripGunMarketText, pickModelAnswer, settleLookup, settleDeal, keepManualPrice, stampManualPrices, applyMarketPrices,
  keepSignedIn, firestoreMemoryOnly, SIGN_OUT_WAIT_MS, settleOrTimeout, signOutConfirmNeeded, armorySubject, armoryLookupBlocked, photoIdBlocked,
  timerShotAccepted, radioService,
};
globalThis.GearLogic = GearLogic;
