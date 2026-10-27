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

function normCat(category) {
  return String(category || "").trim().toLowerCase();
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

function saleText(item) {
  const raw = [item.name, item.brand, item.load, item.caliber, item.armType].map(v => String(v || "")).join(" ");
  const folded = foldText(raw);
  const spaced = folded.replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
  const compact = spaced.replace(/[^a-z0-9]/g, "");
  const parts = folded.split(/[^a-z0-9]+/).filter(Boolean);
  const glued = parts.length >= 6 && parts.every(p => p.length === 1) ? parts.join("") : "";
  return { t: glued ? `${spaced} ${glued}` : spaced, c: compact + glued };
}

// Magazines are not priced like firearms or ammunition. A caliber in the name does not change that.
function isMagazine(t) {
  if (/\b(pouch(?:es)?|holsters?|slings?|cases?|bags?|carriers?|wells?|holders?)\b/.test(t)) return false;
  return /\b(pmags?|magazines?|mags?)\b/.test(t);
}

function isAmmoContainer(t) {
  return /\bammo\s+(cans?|box(?:es)?|bags?|crates?|pouch(?:es)?)\b/.test(t);
}

// Gear that can name a gun or a caliber and still be ordinary equipment.
function isAccessory(t) {
  return /\b(holsters?|pouch(?:es)?|slings?|scabbards?|cases?|bags?|carriers?|grips?|bipods?|buttstocks?|handguards?|gas\s+tubes?|parts\s+kits?|wrench(?:es)?|sockets?|hex\s+keys?|paracords?|knives|knife|mats?|brush(?:es)?|chest\s+rigs?|rigs?|shell\s+holders?|lights?|lamps?|scopes?|sights?|optics?|binoculars?|headlamps?|multitools?|hats?|cameras?|tarps?|blankets?|flags?|snacks?|jugs?|batter(?:y|ies)|rangefinders?|ear\s+pro|glasses|tourniquets?|splints?|barrels?|stocks?|cords?)\b/.test(t);
}

function isCleaning(t) {
  return /\b(cleaning\s+(kits?|rods?|mats?)|bore\s+(snakes?|brush(?:es)?)|gun\s+oils?)\b/.test(t) && !/\bsolvent\s*traps?\b/.test(t);
}

function isBareCan(t) {
  if (/\b(ammo|fuel|gas|jerry|water|trash|garbage|oil|food|coffee|paint|tin|milk|soda|beer|watering|soup|spray|bear)\s+cans?\b/.test(t)) return false;
  if (/\bcans?\s+(openers?|lights?|holders?|stoves?)\b/.test(t)) return false;
  if (/\bcan\s+am\b|\batvs?\b/.test(t)) return false;
  return /\bcans?\b/.test(t);
}

function isSuppressor(t, c) {
  if (/\b(suppress\w*|supress\w*|suppres\w*|surpress\w*|syppress\w*|silenc\w*|sillenc\w*|solvent\s*traps?|moderators?)\b/.test(t)) return true;
  if (/suppress|silenc|syppress/.test(c)) return true;
  if (/\b(sico|silencerco|dead\s+air|thunder\s+beast|huxwrx|rugged\s+obsidian|silencer\s+central)\b/.test(t)) return true;
  if (/\boil\s+filter\s+adapters?\b|\bfuel\s+filter\s+kits?\b|\bmuzzle\s+cans?\b/.test(t)) return true;
  return isBareCan(t);
}

function isAmmo(t, c) {
  if (/\b(fmj|jhp|buckshot|birdshot|primers?|gunpowder|smokeless|green\s+tips?|m855|m193|hollow\s+points?|hst|brass\s+casings?|casings?|shells?|slugs?|ammunition|cartridges?|ammo|rds|rounds?)\b/.test(t)) return true;
  if (/\b(hodgdon|h4350|luger|creedmoor|blazer\s+brass)\b/.test(t)) return true;
  if (/\d+(?:\.\d+)?\s*mm\b/.test(t)) return true;
  if (/\d+(?:\.\d+)?\s*x\s*\d+/.test(t)) return true;
  if (/\b(5\.56|7\.62|6\.5|9\.3|4\.6|5\.7)\b/.test(t)) return true;
  if (/\.(22|223|300|308|45|40|357|38|277|243|270|30|25|17|204|338|375|458|50)\b/.test(t)) return true;
  if (/(^|[^\d])\.?22\s*lr\b/.test(t) || /22lr/.test(c)) return true;
  if (/\b\d{2,3}\s*(win|rem|remington|blk|blackout|special|magnum|sw|acp|auto|lr)\b/.test(t)) return true;
  if (/\b30\s+06\b/.test(t) || /\b300\s+(blackout|blk)\b/.test(t)) return true;
  if (/\b\d+\s*gauges?\b/.test(t) || /\b\d+\s*ga\b/.test(t)) return true;
  if (/\d+\s*gr(?:ain)?s?\b/.test(t)) return true;
  if (/556|762x39|9x19|300blk|300blackout|308win/.test(c)) return true;
  return false;
}

function isFrameOrLower(t) {
  if (/\b(window|internal|door|bed|picture|photo|pack|tent|bike)\s+frames?\b/.test(t) || /\bframes?\s+packs?\b/.test(t)) return false;
  if (/\buppers?\b/.test(t) && !/\blowers?\b/.test(t)) return false;
  if (/\b(pistol|rifle|handgun|firearm)\s+frames?\b/.test(t)) return true;
  if (/\bpolymer\s*80\b|\bpf\s*940/.test(t)) return true;
  if (/\b(stripped|serialized|complete)\s+(lowers?|receivers?)\b/.test(t)) return true;
  if (/\blowers?\s+receivers?\b/.test(t) || /\blowers?\b/.test(t)) return true;
  if (/\b80\s+(frames?|lowers?|receivers?)\b/.test(t)) return true;
  if (/\bfcus?\b|\bfire\s+control\s+units?\b/.test(t)) return true;
  if (/\bframes?\b/.test(t)) return true;
  if (/\breceivers?\b/.test(t) && !/\b(handheld|upper|radio|satellite|weather|gps|noaa|sdr|gmrs|baofeng)\b/.test(t)) return true;
  return false;
}

function knownModel(t, c) {
  if (/\bglocks?\s*\d{2}/.test(t) || (/\bglocks?\b/.test(t) && /\b\d{2}\b/.test(t))) return true;
  if (/\bg\s*\d{2}\w*\b/.test(t)) return true;
  if (/\bp\s*\d{3}\w*\b/.test(t) || /p365/.test(c)) return true;
  if (/\b(mcx|mpx|hellcat|g2c|ddm4|hk\s*416)\b/.test(t) || /hk416|ddm4/.test(c)) return true;
  if (/\bar\s*15\b/.test(t) || /\bak\s*47\b/.test(t) || /ar15|ak47/.test(c)) return true;
  if (/\b1911\b/.test(t)) return true;
  if (/\bmp\s*\d{2}\b/.test(t) || /\bmp\s+shield\b/.test(t)) return true;
  if (/\bruger\b/.test(t) && /\b10\s*22\b/.test(t)) return true;
  if (/\bmossberg\b/.test(t) && /\b590\b/.test(t)) return true;
  if (/\bremington\b/.test(t) && /\b870\b/.test(t)) return true;
  if (/\bcolt\b/.test(t) && /\b6920\b/.test(t)) return true;
  if (/\bcz\b/.test(t) && /\bscorpion\b/.test(t)) return true;
  if (/\bberetta\b/.test(t) && /\b92/.test(t)) return true;
  if (/\bspringfield\b/.test(t) && /\bhellcat\b/.test(t)) return true;
  if (/\btaurus\b/.test(t) && /\bg2c\b/.test(t)) return true;
  if (/\bkimber\b/.test(t) && /\bmicro\b/.test(t)) return true;
  if (/\bhenry\b/.test(t) && /\blever\b/.test(t)) return true;
  if (/\bsavage\b/.test(t) && /\b110\b/.test(t)) return true;
  if (/\btikka\b/.test(t) && /\bt3x?\b/.test(t)) return true;
  if (/\bsigs?\b/.test(t) && /\b(p\s*\d{3}|mcx|mpx)\b/.test(t)) return true;
  return false;
}

function isFirearmWord(t) {
  return /\b(pistols?|rifles?|shotguns?|handguns?|revolvers?|carbines?|lever\s+actions?)\b/.test(t);
}

// The app must not shop for firearms, firearm parts that are the firearm, or ammunition.
// The name, brand, caliber, and load are checked in every category. Magazines are not restricted.
export function saleRestricted(item) {
  if (!item || typeof item !== "object") return false;
  const arm = String(item.arm || "").trim().toUpperCase();
  if (arm === "FA" || arm === "SU") return true;
  const category = normCat(item.category);
  if (category === "firearms" || category === "suppressors" || category === "ammo" || category === "ammunition") return true;
  if (!category && item.caliber && (item.load || item.cpr != null || item.rounds != null)) return true;
  const { t, c } = saleText(item);
  if (!t) return false;
  if (isMagazine(t)) return false;
  if (isAmmoContainer(t)) return false;
  if (isAccessory(t)) return false;
  if (isCleaning(t)) return false;
  if (isSuppressor(t, c)) return true;
  if (isAmmo(t, c)) return true;
  if (isFrameOrLower(t)) return true;
  if (knownModel(t, c)) return true;
  return isFirearmWord(t);
}

// A price answer that itself describes a firearm, suppressor, or ammunition is not shown.
export function lookupAnswerRestricted(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.restricted === true) return true;
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const name = [parsed.priceNote, parsed.weightNote, parsed.where, parsed.note, ...sources.flatMap(s => [s && s.label, s && s.url])].filter(Boolean).join(" ");
  if (!String(name).trim()) return false;
  return saleRestricted({ category: "Misc", name });
}

// A looked-up price on a restricted item is not an insured value.
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

export function publicWeightNote(note) {
  let s = String(note || "");
  if (/\$\s*\d|\bUSD\b|\bMSRP\b/i.test(s)) return "";
  const known = /\b(amazon|ebay|tacswap|brownells|palmetto|\bpsa\b|midway|opticsplanet|primary\s*arms|gunbroker|cheaper\s*than\s*dirt|cabela'?s|bass\s*pro|sportsman'?s|grabagun|bud'?s?\s*gun\s*shop|aim\s*surplus|eurooptic|armslist|ammoseek|wikiarms|guns\.com|impact\s*guns|kygunco|classic\s*firearms|gun\.deals)\b/gi;
  s = s.replace(/https?:\/\/\S+/gi, " ");
  s = s.replace(/\bwww\.\S+/gi, " ");
  s = s.replace(known, " ");
  if (/\b(armory|academy|sports|sporting|outdoor|surplus|warehouse|retailer|dealer|gun\s*shop|firearms)\b/i.test(s)) return "";
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
  countedValue, csvExportField, publicWeightNote, lookupAnswerRestricted,
  keepSignedIn, firestoreMemoryOnly, SIGN_OUT_WAIT_MS, settleOrTimeout, signOutConfirmNeeded, armorySubject, armoryLookupBlocked, photoIdBlocked,
};
globalThis.GearLogic = GearLogic;
