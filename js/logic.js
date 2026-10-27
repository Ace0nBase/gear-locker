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

// Letters that look like Latin in a name. Cyrillic у is mapped to u so a lookalike "suppressor" still matches.
const CONFUSABLES = {
  "\u0405": "s", "\u0455": "s", "\u0443": "u", "\u0423": "u",
  "\u0430": "a", "\u0410": "a", "\u0435": "e", "\u0415": "e", "\u043e": "o", "\u041e": "o",
  "\u0440": "p", "\u0420": "p", "\u0441": "c", "\u0421": "c", "\u0445": "x", "\u0425": "x",
  "\u0456": "i", "\u0406": "i", "\u0458": "j", "\u04bb": "h", "\u04ba": "h", "\u0501": "d",
};

function foldText(value) {
  let t = String(value || "");
  t = t.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
  t = t.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  t = t.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
  t = t.normalize("NFD").replace(/\p{M}/gu, "");
  t = t.normalize("NFKC");
  t = [...t].map(ch => CONFUSABLES[ch] || ch).join("").toLowerCase();
  t = t.replace(/m\s*&\s*p/g, "mp");
  t = t.replace(/s\s*&\s*w/g, "sw");
  t = t.replace(/(\d),(?=\d)/g, "$1.");
  t = t.replace(/[_/\\|]+/g, " ");
  t = t.replace(/-+/g, " ");
  return t;
}

// Digit-for-letter swaps only inside a token that is mostly letters.
// A caliber or a model number stays as written. 1 can be i or l, so both stay.
function leetVariants(token) {
  if (!token || token.includes(".")) return [token];
  const letters = (token.match(/[a-z]/g) || []).length;
  const swaps = (token.match(/[013457]/g) || []).length;
  if (!swaps || letters <= swaps) return [token];
  const mapped = token.replace(/0/g, "o").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  return [...new Set([token, mapped.replace(/1/g, "i"), mapped.replace(/1/g, "l")])];
}

function leetExpand(spaced) {
  const extra = [];
  for (const token of spaced.split(" ")) {
    for (const variant of leetVariants(token)) if (variant !== token) extra.push(variant);
  }
  return extra.length ? `${spaced} ${extra.join(" ")}` : spaced;
}

// Fold lookalikes, digit swaps, and spacing before the sale check and the model prompt.
export function normalizeGearLabel(value) {
  const folded = foldText(value);
  const spaced = folded.replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
  return leetExpand(spaced);
}

function saleText(item) {
  const raw = [item.name, item.brand, item.load, item.caliber, item.armType].map(v => String(v || "")).join(" ");
  const expanded = normalizeGearLabel(raw);
  const parts = foldText(raw).split(/[^a-z0-9]+/).filter(Boolean);
  const glued = parts.length >= 6 && parts.every(p => p.length === 1) ? parts.join("") : "";
  return glued ? `${expanded} ${glued}` : expanded;
}

// Where the item is filed. Those categories are weight-only for every name.
// Magazine storage is not one of them. A blank category is not a free pass.
function placeRestricted(item) {
  const arm = String(item.arm || "").trim().toUpperCase();
  if (arm === "FA" || arm === "SU") return true;
  const c = foldText(item.category).replace(/[^a-z0-9]+/g, " ").trim();
  if (!c) return false;
  if (/\bmags?\b|\bmagazines?\b|\bstorage\b/.test(c)) return false;
  if (/\b(firearms?|handguns?|rifles?|shotguns?|suppressors?|silencers?|nfa)\b/.test(c)) return true;
  if (/\b(ammunitions?|ammo|cartridges?|reloading)\b/.test(c)) return true;
  if (/\b(lowers?|frames?|receivers?)\b/.test(c)) return true;
  return false;
}

function isMagazine(t) {
  if (/\b(pouch(?:es)?|holsters?|slings?|cases?|bags?|carriers?|wells?|holders?|kywi)\b/.test(t)) return false;
  if (/\b(win|rem|remington)\s+mags?\b/.test(t)) return false;
  if (/\b(pmags?|magazines?|mags)\b/.test(t)) return true;
  if (/\bmag\b/.test(t) && /\b(round|rounds|rd|rds|rifle|pistol|glock|carbine)\b/.test(t)) return true;
  if (/\bmag\b/.test(t) && !/\b(\d+(?:\.\d+)?\s*mm|\.\d{2,3}|magnum)\b/.test(t)) return true;
  return false;
}

function isAmmoContainer(t) {
  return /\bammo\s+(cans?|box(?:es)?|bags?|crates?|pouch(?:es)?)\b/.test(t);
}

// Unserialized parts stay priced. The receiver, frame, and sear do not.
function isPricedPart(t) {
  if (/\bbolt\s+actions?\b/.test(t)) return false;
  if (/\b(uppers?|slides?|barrels?|bcgs?|bolt\s+carriers?)\b/.test(t)) return true;
  if (/\bbolts?\b/.test(t)) return true;
  return false;
}

function isAccessory(t) {
  if (/\b\d+\s+\d+x\d+/.test(t) || /\blpvos?\b/.test(t)) return true;
  const bare = t.replace(/\b(?:brass|ammo|shell|cartridge|shotgun|once\s*fired)\s+cases?\b/g, " ");
  return /\b(holsters?|pouch(?:es)?|kywi|slings?|scabbards?|cases?|bags?|carriers?|grips?|bipods?|buttstocks?|handguards?|gas\s+tubes?|parts\s+kits?|wrench(?:es)?|sockets?|hex\s+keys?|paracords?|knives|knife|mats?|brush(?:es)?|chest\s+rigs?|rigs?|shell\s+holders?|lights?|lamps?|scopes?|sights?|optics?|binoculars?|headlamps?|multitools?|hats?|cameras?|tarps?|blankets?|flags?|snacks?|jugs?|batter(?:y|ies)|rangefinders?|ear\s+pro|glasses|sunglasses|tourniquets?|splints?|stocks?|cords?|jackets?|coats?|shirts?|pants|gaiters?|gloves?|boots?|mics?|microphones?|filters?|masks?|respirators?|belts?|covers?|mice|mouse|headsets?|ropes?|wires?|gauzes?|pads?|tents?|stickers?|koozies?|cards?|calipers?|hitches?|speakers?|socks?|hoodies?|vests?|radios?|jigs?|presses?|dies?|brakes?|vises?)\b/.test(bare);
}

function isCleaning(t) {
  return /\b(cleaning\s+(kits?|rods?|mats?)|bore\s+(snakes?|brush(?:es)?)|gun\s+oils?)\b/.test(t) && !/\bsolvent\s*traps?\b/.test(t);
}

function isAirgun(t) {
  return /\b(airsoft|air\s*guns?|air\s*pistols?|air\s*rifles?|pellet\s+guns?|bb\s*guns?|co2\s*pistols?)\b/.test(t);
}

function isBareCan(t) {
  if (/\b(ammo|fuel|gas|jerry|water|trash|garbage|oil|food|coffee|paint|tin|milk|soda|beer|watering|soup|spray|bear)\s+cans?\b/.test(t)) return false;
  if (/\bcans?\s+(openers?|lights?|holders?|stoves?|koozies?)\b/.test(t)) return false;
  if (/\bcan\s+am\b|\batvs?\b|\bkoozies?\b/.test(t)) return false;
  return /\bcans?\b/.test(t);
}

function isSuppressor(t) {
  if (/\b(suppress\w*|supress\w*|suppres\w*|surpress\w*|syppress\w*|silenc\w*|sillenc\w*|moderators?|solvent\s*traps?)\b/.test(t)) return true;
  if (/\b(sico|silencerco|dead\s+air)\b/.test(t)) return true;
  if (/suppress|silenc|syppress/.test(t.replace(/[^a-z0-9]/g, ""))) return true;
  return isBareCan(t);
}

function isNfa(t) {
  if (/\b(sbrs?|sbs|sears?|baffles?|monocores?)\b/.test(t)) return true;
  if (/\b(machine\s*guns?|lightning\s+links?|full\s*auto|select\s*fire)\b/.test(t)) return true;
  return false;
}

function isFrameOrLower(t) {
  if (/\b(window|internal|door|bed|picture|photo|pack|tent|bike|backpack)\s+frames?\b/.test(t) || /\bframes?\s+(packs?|sheets?)\b/.test(t)) return false;
  if (/\ba\s+frames?\b/.test(t)) return false;
  if (/\b(hitch|av|audio|stereo|gps|handheld|upper|radio|satellite|weather|noaa|sdr|gmrs|baofeng|bike)\b/.test(t) && /\breceivers?\b/.test(t)) return false;
  if (/\blower\s+(back|leg|body)\b/.test(t)) return false;
  if (/polymer\s*80|pf\s*940/.test(t)) return true;
  if (/\b(stripped|serialized|80)\b/.test(t) && /\b(lowers?|receivers?|frames?)\b/.test(t)) return true;
  if (/\blowers?\s+receivers?\b/.test(t)) return true;
  if (/\b80\s+(lowers?|frames?|receivers?)\b/.test(t)) return true;
  if (/\bfcus?\b|\bfire\s+control\s+units?\b/.test(t)) return true;
  if (/\b(pistol|rifle|handgun|firearm)\s+frames?\b/.test(t)) return true;
  if (/\blowers?\b/.test(t)) return true;
  if (/\bframes?\b/.test(t)) return true;
  if (/\breceivers?\b/.test(t)) return true;
  return false;
}

function isAmmo(t) {
  if (/\b(fmj|jhp|buckshot|birdshot|primers?|gunpowder|smokeless|green\s+tips?|hollow\s+points?|ammunition|cartridges?|ammo|hst|bmg)\b/.test(t)) return true;
  if (/\b(blazer\s+brass|brass\s+(?:cases?|casings?)|once\s*fired\s+brass|reloading\s+powder)\b/.test(t)) return true;
  if (/\b(m855|m193|creedmoor|valkyrie|grendel|blackout|ackley)\b/.test(t)) return true;
  if (/\b00\s*buck\b/.test(t)) return true;
  if (/\b\d+(?:\.\d+)?\s*mm\b/.test(t)) return true;
  if (!/\d\s+\d+x\d+/.test(t) && /\b(?:4\.6|5\.45|5\.56|5\.7|6\.5|6\.8|7\.62|7\.92|8\.6|9|10)\s*x\s*\d{2}\b/.test(t)) return true;
  if (/\b(5\.56|7\.62|6\.5|9\.3|4\.6|5\.7|6\.8)\b/.test(t)) return true;
  if (/(^|[^a-z0-9])\.(17|22|223|224|243|25|270|277|30|300|308|338|350|357|375|38|40|44|45|410|450|458|50)\b/.test(t)) return true;
  if (/\b\d{2,3}\s+(win|rem|remington|blk|blackout|special|magnum|sw|acp|auto|lr|legend|bushmaster|valkyrie|creedmoor|wsm|prc|hmr|western|nosler|grendel)\b/.test(t)) return true;
  if (/\b(?:30\s+06|30\s+30|45\s+70|25\s+06|22\s+250)\b/.test(t)) return true;
  if (/\b(?:10|12|16|20|28)\s*ga(?:uge)?\b/.test(t) || /\b410\s*bore\b/.test(t) || /\b\.410\b/.test(t)) return true;
  if (/\b22\s*lr\b/.test(t) || /22lr/.test(t.replace(/[^a-z0-9]/g, ""))) return true;
  if (/\b\d+\s*gr(?:ain)?s?\b/.test(t)) return true;
  if (/\b(?:shotgun|rifle|pistol)\s+shells?\b/.test(t) || /\bbox\s+of\s+shells?\b/.test(t)) return true;
  return false;
}

const MODEL_STOP = new Set(["the", "and", "for", "with", "size", "inch", "inches", "gen", "new", "used", "pack", "box", "set", "pair", "count", "qty", "oz", "lb", "mm", "cm", "day", "days", "year", "from", "this", "that", "one", "per", "all", "not", "its", "via", "page", "length", "style", "type", "model", "an", "of", "to", "on", "or", "at", "by", "my", "is", "it", "be", "as", "up", "if", "so", "we", "do", "no", "in"]);

// A brand-like word plus a model number. Not a catalog of brand and model pairs.
function hasBrandModel(t) {
  const compact = t.replace(/[^a-z0-9]/g, "");
  if (/\bar\s*\d{2}\b/.test(t) || /(?:^|[^a-z])ar\d{2}/.test(compact) || /\bak\s*\d{2}\b/.test(t) || /(?:^|[^a-z])ak\d{2}/.test(compact)) return true;
  if (/\b1911\b/.test(t)) return true;
  if (/\bmp\s*\d{1,2}\b/.test(t)) return true;
  if (/\bp\s*[2-9]\d{2}[a-z]?\b/.test(t)) return true;
  if (/\bg\s*\d{1,2}[a-z]?\b/.test(t)) return true;
  if (/\bm\s*\d{1,2}[a-z]?\d*\b/.test(t)) return true;
  const measured = t.replace(/\b\d+(?:\.\d+)?\s*(?:mm|cm|in|inch|inches|oz|lb|lbs|g|kg|gr|grain|grains|ga|gauge|rd|rds|pk|pack)\b/g, " ");
  const words = measured.split(" ").filter(w => /^[a-z]{2,}$/.test(w) && !MODEL_STOP.has(w) && !/^[a-z]{1,2}\d{1,2}$/.test(w));
  const nums = measured.match(/\b\d{2,3}[a-z]?\b/g) || [];
  if (words.length > 0 && nums.length > 0) return true;
  if (/\b[a-z]{1,2}\d{1,2}\b/.test(measured) && words.length > 0) return true;
  return false;
}

function isFirearmWord(t) {
  return /\b(pistols?|rifles?|shotguns?|handguns?|revolvers?|carbines?|lever\s+actions?)\b/.test(t);
}

// The category decides. The name is only a backup for a clear misfile.
// A model classification sticks until the name, brand, or category changes.
export function saleRestricted(item) {
  if (!item || typeof item !== "object") return false;
  if (item.modelRestricted === true) return true;
  if (placeRestricted(item)) return true;
  const category = foldText(item.category).replace(/[^a-z0-9]+/g, " ").trim();
  if (!category && item.caliber && (item.load || item.cpr != null || item.rounds != null)) return true;
  const t = saleText(item);
  if (!t) return false;
  if (isMagazine(t)) return false;
  if (isAmmoContainer(t)) return false;
  if (isPricedPart(t)) return false;
  if (isAccessory(t) || /\bfits\b/.test(t)) return false;
  if (isCleaning(t)) return false;
  if (isAirgun(t)) return false;
  if (isSuppressor(t)) return true;
  if (isNfa(t)) return true;
  if (isFrameOrLower(t)) return true;
  if (isAmmo(t)) return true;
  if (hasBrandModel(t)) return true;
  return isFirearmWord(t);
}

const GUN_MARKET = /(^|\.)((gunbroker|armslist|ammoseek|wikiarms|guns)\.com|gun\.deals)$/i;

function sourceHost(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./i, ""); } catch { return ""; }
}

// A gun-market link or source label drops the price. A note, a size, or cents do not.
export function lookupAnswerRestricted(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.restricted === true) return true;
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const urls = [...sources.map(s => s && s.url), parsed.url].filter(Boolean);
  if (urls.some(u => GUN_MARKET.test(sourceHost(u)))) return true;
  const labels = sources.map(s => s && s.label).filter(Boolean).join(" ");
  return /\b(gunbroker|armslist|ammoseek|wikiarms|guns\.com|gun\.deals)\b/i.test(labels);
}

function priceNumber(v) {
  return (v === null || v === undefined || v === "" || !isFinite(+v)) ? null : +v;
}

// The model answer is part of the same lookup. A missing flag does not unlock a price.
// An item the category already blocks stays weight-only either way.
export function settleLookup(item, parsed) {
  const clean = parsed && typeof parsed === "object" ? parsed : null;
  const flagOk = !!(clean && typeof clean.restricted === "boolean");
  const deterministic = !!(item && (item.weightOnly || saleRestricted(item)));
  if (!clean || (!flagOk && !deterministic)) return { apply: false };
  const block = deterministic || clean.restricted === true || lookupAnswerRestricted(clean);
  if (block) {
    return {
      apply: true, restricted: true,
      retailNew: null, usedLow: null, usedHigh: null, value: null,
      weightOz: priceNumber(clean.weightOz), priceNote: "",
      weightNote: publicWeightNote(clean.weightNote), sources: [],
    };
  }
  const sources = Array.isArray(clean.sources) ? clean.sources.filter(s => s && /^https:\/\//.test(s.url || "")).slice(0, 4).map(s => ({ label: String(s.label || "source").slice(0, 40), url: String(s.url) })) : [];
  return {
    apply: true, restricted: false,
    retailNew: priceNumber(clean.retailNew), usedLow: priceNumber(clean.usedLow), usedHigh: priceNumber(clean.usedHigh),
    value: priceNumber(clean.value), weightOz: priceNumber(clean.weightOz),
    priceNote: String(clean.priceNote || "").slice(0, 240), weightNote: String(clean.weightNote || "").slice(0, 80),
    sources,
  };
}

// A deal from the same model call. Restricted drops the price, the link, and the note.
export function settleDeal(item, parsed) {
  const empty = restricted => ({ price: null, where: "", url: "", condition: "", note: "", restricted: !!restricted });
  const clean = parsed && typeof parsed === "object" ? parsed : null;
  if (!clean || typeof clean.restricted !== "boolean") return empty(false);
  const url = /^https:\/\//.test(clean.url || "") ? String(clean.url).slice(0, 400) : "";
  const where = String(clean.where || "").slice(0, 40);
  const blocked = clean.restricted === true || saleRestricted(item) || lookupAnswerRestricted({
    restricted: clean.restricted, url, sources: url ? [{ label: where, url }] : [],
  });
  if (blocked) return empty(true);
  const price = isFinite(+clean.price) && +clean.price > 0 ? Math.round(+clean.price * 100) / 100 : null;
  return {
    price, where, url, condition: String(clean.condition || "").slice(0, 20),
    note: String(clean.note || "").slice(0, 160), restricted: false,
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
  if (saleRestricted(item) && (key === "retailNew" || key === "priceSource" || key === "priceDate")) return "";
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

// A restricted weight note keeps a maker spec. It drops store names and price figures.
export function publicWeightNote(note) {
  let s = String(note || "");
  if (/\$\s*\d|\bUSD\b|\bMSRP\b|\bdollars?\b|\bbucks\b/i.test(s)) return "";
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

const GearLogic = {
  SHARE_ITEM_KEYS, MAX_SHARE_ITEMS, USER_LOCAL_KEYS, DEVICE_LOCAL_KEYS,
  clearUserLocal, shareItemFields, newWriteId, serverStampIso, mergeByServerTime, mergeKitsByServerTime,
  parseAllowlist, decideAccess, chargeDecision, quotaKey, alertQuotaKey, selectDueWatches, pinLengthOk, newPasswordOk,
  refreshAuthClaims, loanSharePlan, orphanLoansFromLends, serverRow, loanNeedsItem, storagePrivacyVerdict, cloudWriteDelay, serviceWorkerAllowed, saleRestricted,
  countedValue, csvExportField, publicWeightNote, lookupAnswerRestricted, localDay,
  normalizeGearLabel, settleLookup, settleDeal,
  keepSignedIn, firestoreMemoryOnly, SIGN_OUT_WAIT_MS, settleOrTimeout, signOutConfirmNeeded, armorySubject, armoryLookupBlocked, photoIdBlocked,
};
globalThis.GearLogic = GearLogic;
