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

function itemBlob(item) {
  return [item.name, item.brand, item.load, item.caliber, item.armType].map(v => String(v || "").toLowerCase()).join(" ");
}

function ammoContainer(blob) {
  return /\bammo\s+(can|box|bag|crate|pouch)\b/.test(blob);
}

function namedCan(blob) {
  const t = String(blob || "").trim();
  if (/\b(ammo|fuel|gas|jerry|water|trash|garbage|oil|food|coffee|paint|tin|milk|soda|beer|watering)\s+cans?\b/.test(t)) return false;
  if (/\bcans?\s+(opener|light|holder|stove)\b/.test(t)) return false;
  return /^(the\s+|my\s+)?can$/.test(t) || /\bcan\b/.test(t);
}

function suppressorIdentity(blob) {
  if (ammoContainer(blob)) return false;
  if (/suppress|supress|suppres|silenc|solvent\s*trap|\bsico\b|dead\s*air/.test(blob)) return true;
  return namedCan(blob);
}

function accessoryNotFirearm(blob) {
  return /\b(holster|pouch|sling|scabbard|case|bag|carrier)\b/.test(blob)
    && !/\blower\b/.test(blob)
    && !/\bframe\b/.test(blob)
    && !suppressorIdentity(blob);
}

function lightOrScope(blob) {
  return /\b(lights?|lamps?|scopes?|sights?)\b/.test(blob) && !/\blower\b/.test(blob) && !suppressorIdentity(blob);
}

// Magazines are not priced like firearms or ammunition. A caliber in the name does not change that.
function isMagazine(blob) {
  if (/\b(pouch|holster|sling|case|bag|carrier|well)\b/.test(blob)) return false;
  return /\b(pmags?|magazines?|mags?)\b/.test(blob);
}

function cleaningNotAmmo(blob) {
  return /\bcleaning\s+kit\b|\bbore\s+snake\b/.test(blob) && !/solvent\s*trap/.test(blob);
}

function clearCartridge(blob) {
  if (ammoContainer(blob) || accessoryNotFirearm(blob) || isMagazine(blob) || cleaningNotAmmo(blob)) return false;
  return /\d+(?:\.\d+)?\s*mm\b/.test(blob)
    || /\.\d{2,3}\b/.test(blob)
    || /\d+\s*gauges?\b/.test(blob)
    || /\d+\s*ga\b/.test(blob)
    || /\b22\s*lr\b/.test(blob)
    || /\b5\.56\b/.test(blob)
    || /\b7\.62\b/.test(blob)
    || /\d+\s*gr(?:ain)?s?\b/.test(blob)
    || /\bcreedmoor\b/.test(blob)
    || /\b\d+\s*acp\b/.test(blob)
    || /\bblazer\s+brass\b/.test(blob)
    || /\b(ammunition|cartridges?)\b/.test(blob)
    || /\bammo\b/.test(blob);
}

const LOWER_PLATFORM = "(?:ar[\\s-]?15|ar15|ar[\\s-]?10|ar10|\\bar\\b|\\bm4|\\b308\\b)";
const LOWER_NEAR = new RegExp(LOWER_PLATFORM + ".{0,40}lower|lower.{0,40}" + LOWER_PLATFORM);

function namedFirearm(blob) {
  return /\bglock\s*\d{2}\w*\b/.test(blob)
    || /\bp365\w*\b/.test(blob)
    || /\bremington\s*870\b/.test(blob)
    || /\bm\s*&\s*p\s*15\b|\bm&p\s*15\b/.test(blob);
}

function firearmIdentity(blob) {
  if (ammoContainer(blob) || accessoryNotFirearm(blob) || lightOrScope(blob) || isMagazine(blob)) return false;
  if (suppressorIdentity(blob)) return true;
  if (/\bpolymer\s*80\b|\bpf-?\s*940/.test(blob)) return true;
  if (/\b(window|internal|door|bed|picture|photo|pack|tent|bike)\s+frame\b/.test(blob) || /\bframe\s+pack\b/.test(blob)) return false;
  if (/\b(pistol|rifle|handgun|firearm)\s+frame\b/.test(blob)) return true;
  if (/\b(?!pack\b|photo\b|tent\b|bike\b|picture\b|window\b|internal\b|door\b|bed\b)[a-z0-9][\w.+-]*\s+frame\b/.test(blob)) return true;
  if (/\b(stripped|serialized|complete)\s+(lower|receiver)\b/.test(blob)) return true;
  if (/\blower\s+receiver\b/.test(blob)) return true;
  if (/\b80\s*(%|percent)?\s*(frame|lower|receiver)\b/.test(blob)) return true;
  if (LOWER_NEAR.test(blob)) return true;
  if (/\bfcu\b|\bfire\s*control\s*unit\b/.test(blob)) return true;
  if (/\breceiver\b/.test(blob) && !/\b(handheld|upper|radio|satellite|weather|gps|noaa)\b/.test(blob)) return true;
  if (namedFirearm(blob)) return true;
  if (/\b(pistols?|rifles?|shotguns?|handguns?|revolvers?|carbines?)\b/.test(blob)) return true;
  return false;
}

// The app must not shop for firearms, firearm parts that are the firearm, or ammunition.
// The name is checked in every category. Magazines are not restricted.
export function saleRestricted(item) {
  if (!item || typeof item !== "object") return false;
  const arm = String(item.arm || "").trim().toUpperCase();
  if (arm === "FA" || arm === "SU") return true;
  const category = normCat(item.category);
  if (category === "firearms" || category === "suppressors" || category === "ammo" || category === "ammunition") return true;
  const blob = itemBlob(item);
  if (!category && item.caliber && (item.load || item.cpr != null || item.rounds != null)) return true;
  if (isMagazine(blob)) return false;
  if (suppressorIdentity(blob)) return true;
  if (cleaningNotAmmo(blob)) return false;
  if (clearCartridge(blob)) return true;
  return firearmIdentity(blob);
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
  const store = /\b(amazon|ebay|tacswap|brownells|palmetto|\bpsa\b|midway|opticsplanet|primary\s*arms|gunbroker|cheaper\s*than\s*dirt|cabela'?s|bass\s*pro|sportsman'?s|grabagun|bud'?s?\s*gun\s*shop|aim\s*surplus|eurooptic|armslist|ammoseek|wikiarms|guns\.com|impact\s*guns|kygunco|classic\s*firearms|gun\.deals)\b/gi;
  let s = String(note || "");
  s = s.replace(/https?:\/\/\S+/gi, "");
  s = s.replace(/\bwww\.\S+/gi, "");
  s = s.replace(store, "");
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
  countedValue, csvExportField, publicWeightNote,
  keepSignedIn, firestoreMemoryOnly, SIGN_OUT_WAIT_MS, settleOrTimeout, signOutConfirmNeeded, armorySubject, armoryLookupBlocked, photoIdBlocked,
};
globalThis.GearLogic = GearLogic;
