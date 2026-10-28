// On-device spreadsheet import. No network, no disk, no price lookups.
// Column matching uses the header text only.

import { GEAR_CATEGORIES, importRestricted, migrateCategoryName, saleRestricted } from "./logic.js";

export const LIMITS = {
  fileBytes: 15 * 1024 * 1024,
  rows: 20000,
  cols: 64,
  cellChars: 4000,
  uncompressed: 40 * 1024 * 1024,
  ratio: 100,
};

export const UNDO_MS = 24 * 60 * 60 * 1000;
export const WRITE_BATCH = 400;
export const HIST_KEY = "gearLocker.importHistory";
export const MAP_KEY = "gearLocker.importMaps";

export const DEFAULT_CATEGORIES = GEAR_CATEGORIES.slice();

const PAID_KEYS = new Set([
  "purchase price", "price paid", "amount paid", "what i paid", "paid", "cost", "price", "unit price", "purchase cost",
]);

const FIELD_DEFS = [
  { id: "brand", aliases: ["brand", "make", "mfr", "mfg", "maker", "manufacturer", "brand model"] },
  { id: "name", aliases: ["item name", "name", "item", "description"] },
  { id: "model", aliases: ["model", "model name"] },
  { id: "armType", aliases: ["type", "kind", "category", "class", "firearm type", "type of firearm"] },
  { id: "action", aliases: ["action"] },
  { id: "caliber", aliases: ["caliber", "calibre", "cal", "gauge", "chambering", "cartridge"] },
  { id: "serial", aliases: ["serial", "serial no", "serial number", "s n", "sn"] },
  { id: "bbl", aliases: ["barrel", "barrel length", "bbl"] },
  { id: "finish", aliases: ["finish"] },
  { id: "color", aliases: ["color", "colour"] },
  { id: "qty", aliases: ["qty", "quantity", "count"] },
  { id: "condition", aliases: ["condition", "cond"] },
  { id: "acquired", aliases: ["date acquired", "acquired", "bought", "purchase date", "date purchased", "date"] },
  { id: "acquiredFrom", aliases: ["seller", "dealer", "ffl", "from", "vendor", "purchased from"] },
  { id: "location", aliases: ["location", "where", "stored", "storage", "safe", "storage location"] },
  { id: "roundCount", aliases: ["rounds fired", "round count", "shots", "total rounds fired"] },
  { id: "notes", aliases: ["notes", "comments", "remarks", "memo", "tags", "capacity", "model number"], multi: true },
  { id: "paid", aliases: ["purchase price", "price paid", "amount paid", "what i paid", "paid", "cost", "price"] },
  { id: "mountedOn", aliases: ["mounted on", "on firearm", "host", "parent", "attached to", "parent serial", "firearm serial"] },
  { id: "load", aliases: ["bullet", "grain", "gr", "load", "bullet type", "bullet weight"], multi: true },
  { id: "rounds", aliases: ["rounds", "number of rounds"] },
  { id: "lot", aliases: ["lot", "lot number", "lot no"] },
  { id: "lowAlert", aliases: ["low alert", "warn below"] },
  { id: "manufactureDate", aliases: ["manufacture date", "dom", "year made"] },
];

const SOURCE_ALIASES = {
  guntrack: {
    brand: ["manufacturer"], model: ["model name"], armType: ["type of firearm"],
    serial: ["serial number"], caliber: ["caliber"], acquired: ["date purchased"],
    paid: ["purchase price", "amount paid"], roundCount: ["total rounds fired"], rounds: ["number of rounds"],
  },
  armscache: {
    brand: ["manufacturer"], location: ["storage location"], armType: ["firearm type"],
    paid: ["price paid"], acquired: ["purchase date"],
  },
  myarmory: {
    brand: ["manufacturer"], acquiredFrom: ["purchased from"], paid: ["purchase price"],
    acquired: ["purchase date"], roundCount: ["rounds fired"], serial: ["serial number"],
  },
};

export const FIELD_LABELS = {
  name: "Name", brand: "Brand", model: "Model", armType: "Type", action: "Action", caliber: "Caliber",
  serial: "Serial", bbl: "Barrel length", finish: "Finish", color: "Color", qty: "Qty", condition: "Condition",
  acquired: "Date acquired", acquiredFrom: "Acquired from", location: "Stored at", roundCount: "Rounds fired",
  notes: "Notes", paid: "What I paid", mountedOn: "Mounted on", load: "Load", rounds: "Rounds", lot: "Lot",
  lowAlert: "Low alert", manufactureDate: "Manufacture date", ignore: "Ignore",
};

const DICT = new Set(FIELD_DEFS.flatMap(f => f.aliases));

const CP1252 = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰",
  0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•",
  0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

const MAC_ROMAN = [
  0x00C4, 0x00C5, 0x00C7, 0x00C9, 0x00D1, 0x00D6, 0x00DC, 0x00E1, 0x00E0, 0x00E2, 0x00E4, 0x00E3, 0x00E5, 0x00E7, 0x00E9, 0x00E8,
  0x00EA, 0x00EB, 0x00ED, 0x00EC, 0x00EE, 0x00EF, 0x00F1, 0x00F3, 0x00F2, 0x00F4, 0x00F6, 0x00F5, 0x00FA, 0x00F9, 0x00FB, 0x00FC,
  0x2020, 0x00B0, 0x00A2, 0x00A3, 0x00A7, 0x2022, 0x00B6, 0x00DF, 0x00AE, 0x00A9, 0x2122, 0x00B4, 0x00A8, 0x2260, 0x00C6, 0x00D8,
  0x221E, 0x00B1, 0x2264, 0x2265, 0x00A5, 0x00B5, 0x2202, 0x2211, 0x220F, 0x03C0, 0x222B, 0x00AA, 0x00BA, 0x03A9, 0x00E6, 0x00F8,
  0x00BF, 0x00A1, 0x00AC, 0x221A, 0x0192, 0x2248, 0x2206, 0x00AB, 0x00BB, 0x2026, 0x00A0, 0x00C0, 0x00C3, 0x00D5, 0x0152, 0x0153,
  0x2013, 0x2014, 0x201C, 0x201D, 0x2018, 0x2019, 0x00F7, 0x25CA, 0x00FF, 0x0178, 0x2044, 0x20AC, 0x2039, 0x203A, 0xFB01, 0xFB02,
  0x2021, 0x00B7, 0x201A, 0x201E, 0x2030, 0x00C2, 0x00CA, 0x00C1, 0x00CB, 0x00C8, 0x00CD, 0x00CE, 0x00CF, 0x00CC, 0x00D3, 0x00D4,
  0xF8FF, 0x00D2, 0x00DA, 0x00DB, 0x00D9, 0x0131, 0x02C6, 0x02DC, 0x00AF, 0x02D8, 0x02D9, 0x02DA, 0x00B8, 0x02DD, 0x02DB, 0x02C7,
];

const CALIBERS = [
  [/^(5\.56(?:\s*nato)?|5\.56\s*x\s*45|\.223\s*\/\s*5\.56|\.223\/5\.56)$/i, "5.56 NATO"],
  [/^(9\s*mm|9x19|9\s*mm\s*luger)$/i, "9mm Luger"],
  [/^(12\s*ga(?:uge)?|12ga)$/i, "12 ga"],
  [/^(5\.7|5\.7\s*x\s*28(?:\s*mm)?)$/i, "5.7x28mm"],
  [/^300\s*blk|300\s*blackout|\.300\s*aac$/i, "300 BLK"],
  [/^\.308(?:\s*win(?:chester)?)?$/i, ".308 Win"],
  [/^7\.62\s*x\s*51$/i, "7.62x51"],
  [/^7\.62\s*x\s*39$/i, "7.62x39"],
  [/^\.45\s*acp$/i, ".45 ACP"],
  [/^\.40\s*s\s*&?\s*w$/i, ".40 S&W"],
  [/^\.22\s*lr$/i, ".22 LR"],
  [/^\.380(?:\s*acp)?$/i, ".380 ACP"],
  [/^6\.5\s*creedmoor$/i, "6.5 Creedmoor"],
  [/^\.300\s*win(?:chester)?\s*mag$/i, ".300 Win Mag"],
  [/^10\s*mm$/i, "10mm"],
];

const CONDITIONS = [
  [/^new|unfired|nib|mint$/i, "New"],
  [/^good|excellent|very good|vg|lnib$/i, "Good"],
  [/^used|fair$/i, "Used"],
  [/^worn|poor|rough$/i, "Worn"],
  [/repair|broken|parts|inop/i, "Needs-repair"],
];

export function nrm(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function maskSerial(value) {
  const s = String(value ?? "");
  if (!s) return "";
  const tail = s.slice(-4);
  return "••••" + tail;
}

export function serialAriaLabel(serial, masked) {
  const s = String(serial ?? "");
  if (!s) return "";
  if (!masked) return s;
  return "ending " + s.slice(-4);
}

export function chunk(list, size = WRITE_BATCH) {
  const out = [];
  const n = Math.max(1, size | 0);
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function newUlid(time = Date.now(), rand = Math.random) {
  const EN = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let t = Math.max(0, time | 0);
  let timePart = "";
  for (let i = 0; i < 10; i++) { timePart = EN[t % 32] + timePart; t = Math.floor(t / 32); }
  let r = "";
  for (let i = 0; i < 16; i++) r += EN[Math.floor(rand() * 32) % 32];
  return timePart + r;
}

export function normalizeHeader(raw) {
  let s = String(raw ?? "").normalize("NFKC").replace(/^\uFEFF/, "");
  s = s.toLowerCase().trim().replace(/[_./#\-]+/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\(\s*s\s*\)\s*$/i, "").replace(/[:*]+\s*$/g, "").trim();
  let unit = "";
  const unitMatch = s.match(/^(.*?)[\s]*[\[(]([a-z0-9/%"]+)[\])]\s*$/);
  if (unitMatch && unitMatch[2] !== "s") {
    unit = unitMatch[2];
    s = unitMatch[1].trim();
  }
  return { key: s.replace(/\s+/g, " ").trim(), unit };
}

function jaro(s, t) {
  if (s === t) return 1;
  const n = s.length, m = t.length;
  if (!n || !m) return 0;
  const span = Math.max(0, Math.floor(Math.max(n, m) / 2) - 1);
  const sM = new Array(n).fill(false);
  const tM = new Array(m).fill(false);
  let matches = 0;
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - span);
    const end = Math.min(i + span + 1, m);
    for (let j = start; j < end; j++) {
      if (tM[j] || s[i] !== t[j]) continue;
      sM[i] = true;
      tM[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let trans = 0, k = 0;
  for (let i = 0; i < n; i++) {
    if (!sM[i]) continue;
    while (!tM[k]) k++;
    if (s[i] !== t[k]) trans++;
    k++;
  }
  return (matches / n + matches / m + (matches - trans / 2) / matches) / 3;
}

function jaroWinkler(a, b) {
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

function tokenOverlap(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const tok of A) if (B.has(tok)) inter++;
  return inter / Math.max(A.size, B.size);
}

export function priceKind(key) {
  const k = String(key || "");
  if (!k) return "";
  if (/cpr|cost per round|price per round|per round/.test(k)) return "drop";
  if (PAID_KEYS.has(k) || k === "paid each" || /purchase price|price paid|amount paid|what i paid/.test(k)) return "paid";
  if (/current value|msrp|retail|appraised|insured|market value|sale price/.test(k)) return "drop";
  if (k === "value" || k === "amount") return "drop";
  if (/price|paid|cost|amount|msrp|retail|appraised|[$€£]/.test(k)) return "drop";
  return "";
}

export function confidenceOf(score, locked) {
  if (locked) return "lock";
  if (score >= 90) return "hi";
  if (score >= 80) return "likely";
  if (score >= 50) return "mid";
  return "lo";
}

export function confidenceLabel(code) {
  return { hi: "Sure", likely: "Likely", mid: "Guess", lo: "No match", lock: "Locked" }[code] || "No match";
}

function scoreAlias(key, alias, exactScore) {
  if (key === alias) return exactScore;
  const overlap = tokenOverlap(key, alias);
  if (overlap >= 0.7) return 85;
  if (jaroWinkler(key, alias) >= 0.88) return 75;
  return 0;
}

function bestFieldScore(key, source) {
  let best = { field: "", score: 0 };
  for (const def of FIELD_DEFS) {
    let score = 0;
    for (const alias of def.aliases) score = Math.max(score, scoreAlias(key, alias, 99));
    const sourced = (SOURCE_ALIASES[source] && SOURCE_ALIASES[source][def.id]) || [];
    for (const alias of sourced) score = Math.max(score, scoreAlias(key, alias, 97));
    if (score > best.score) best = { field: def.id, score };
  }
  return best;
}

function headerQualifies(cell) {
  const { key } = normalizeHeader(cell);
  if (!key) return false;
  if (DICT.has(key)) return true;
  for (const alias of DICT) {
    if (scoreAlias(key, alias, 99) >= 75) return true;
  }
  return key.length <= 40 && !/\d/.test(key) && /[a-z]/i.test(key);
}

export function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    const cells = row.map(c => String(c ?? "").trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const ok = cells.filter(headerQualifies).length;
    if (ok / cells.length >= 0.5) return i;
  }
  return 0;
}

function uniqueHeaders(raw) {
  const seen = new Map();
  return raw.map(cell => {
    const norm = normalizeHeader(cell);
    const base = norm.key || "column";
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const header = n === 1 ? String(cell ?? "").trim() : `${String(cell ?? "").trim()} (${n})`;
    return { header, key: base, unit: norm.unit, dup: n };
  });
}

export function detectSource(keys) {
  const has = s => keys.includes(s);
  if ((has("serial number") && has("type of firearm")) || has("number of rounds")) return "guntrack";
  if ((has("storage location") && has("firearm type")) || has("price paid")) return "armscache";
  if ((has("purchased from") && has("rounds fired")) || (has("purchase price") && has("manufacturer") && has("serial number"))) return "myarmory";
  return "generic";
}

export function mapColumns(headerCells, opts = {}) {
  const sourceHint = opts.source || "";
  const prepared = uniqueHeaders(headerCells);
  const keys = prepared.map(h => h.key);
  const source = sourceHint || detectSource(keys);
  const scored = prepared.map((h, index) => {
    const kind = priceKind(h.key);
    if (kind === "drop") {
      return { index, header: h.header, key: h.key, unit: h.unit, field: "ignore", score: 0, confidence: "lock", locked: true, suggest: "" };
    }
    const best = bestFieldScore(h.key, source);
    const field = best.score >= 50 ? best.field : "ignore";
    return {
      index, header: h.header, key: h.key, unit: h.unit,
      field: kind === "paid" && best.field !== "paid" && best.score < 99 ? "paid" : field,
      score: kind === "paid" ? Math.max(best.score, 99) : best.score,
      confidence: confidenceOf(kind === "paid" ? Math.max(best.score, 99) : best.score, false),
      locked: false,
      suggest: "",
    };
  });
  const taken = new Set();
  const order = scored.map((col, i) => ({ i, score: col.locked ? -1 : col.score })).sort((a, b) => b.score - a.score);
  const assigned = scored.map(col => ({ ...col }));
  for (const slot of order) {
    const col = assigned[slot.i];
    if (col.locked || col.field === "ignore") continue;
    const def = FIELD_DEFS.find(f => f.id === col.field);
    if (def && def.multi) continue;
    if (taken.has(col.field)) {
      col.suggest = "notes";
      col.field = "ignore";
      col.confidence = "mid";
      col.score = Math.min(col.score, 75);
      continue;
    }
    taken.add(col.field);
  }
  const remembered = opts.remembered;
  if (Array.isArray(remembered)) {
    assigned.forEach((col, i) => {
      if (col.locked) return;
      const choice = remembered[i];
      if (!choice) return;
      col.field = choice;
      col.usedLastTime = true;
    });
  }
  return { source, columns: assigned };
}

function retargetQuantity(columns) {
  const fields = new Set(columns.filter(c => c.field !== "ignore").map(c => c.field));
  const ammoish = fields.has("caliber") && !fields.has("serial") && (fields.has("lot") || fields.has("load") || fields.has("rounds") || fields.has("qty"));
  if (!ammoish) return columns;
  let moved = false;
  return columns.map(col => {
    if (moved || col.locked) return col;
    if (col.field === "qty" || col.key === "quantity" || col.key === "count") {
      moved = true;
      return { ...col, field: "rounds" };
    }
    return col;
  });
}

export function headerHash(keys) {
  const s = keys.join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return "h" + h.toString(16);
}

function cleanText(value, notes) {
  let s = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  // The app's own CSV prefixes '=+-@ so a spreadsheet will not run the cell. Put the value back.
  if (s.startsWith("'") && /^[=+\-@\t\r]/.test(s.slice(1))) s = s.slice(1);
  if (!notes) s = s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  else s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > LIMITS.cellChars) return { text: s.slice(0, LIMITS.cellChars), truncated: true };
  return { text: s, truncated: false };
}

export function parsePaid(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^[=+@]/.test(s)) return null;
  const n = Number(s.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  if (!isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function parseQty(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { value: null, note: "" };
  if (/^[=+@]/.test(s)) return { value: null, note: s };
  const n = Number(s.replace(/[, ]/g, ""));
  if (!isFinite(n) || !Number.isInteger(n)) return { value: null, note: s };
  return { value: n, note: "" };
}

export function excelSerialToIso(serial, date1904) {
  const n = Number(serial);
  if (!isFinite(n)) return "";
  const days = date1904 ? n - 24107 : (n >= 61 ? n - 25569 : n - 25568);
  const ms = Math.round(days * 86400000);
  const d = new Date(ms);
  if (!isFinite(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function parseDate(raw, monthFirst) {
  const s = String(raw ?? "").trim();
  if (!s) return { iso: "", note: "", flag: "" };
  if (/^[=+@]/.test(s)) return { iso: "", note: s, flag: "bad-date" };
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return checkYmd(+m[1], +m[2], +m[3], s);
  m = s.match(/^(\d{4})$/);
  if (m) return { iso: `${m[1]}-01-01`, note: "year only", flag: "year" };
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase().slice(0, 4).replace(/^sept$/, "sept")]) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)] || MONTHS[m[1].toLowerCase()];
    if (mon) return { iso: `${m[2]}-${String(mon).padStart(2, "0")}-01`, note: "", flag: "" };
  }
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const a = +m[1], b = +m[2];
    let month, day;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else if (monthFirst === false) { day = a; month = b; }
    else { month = a; day = b; }
    return checkYmd(y, month, day, s);
  }
  return { iso: "", note: s, flag: "bad-date" };
}

function checkYmd(y, month, day, raw) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return { iso: "", note: raw, flag: "bad-date" };
  const dt = new Date(Date.UTC(y, month - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return { iso: "", note: raw, flag: "bad-date" };
  const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const ahead = Date.UTC(y, month - 1, day) > Date.now() + 366 * 86400000;
  return { iso, note: "", flag: ahead ? "future" : "" };
}

export function columnDateOrder(values, localeMonthFirst = true) {
  let dmy = 0, mdy = 0, any = 0;
  for (const raw of values) {
    const m = String(raw ?? "").trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
    else any++;
  }
  if (dmy > mdy) return "dmy";
  if (mdy > dmy) return "mdy";
  return localeMonthFirst ? "mdy" : "dmy";
}

export function normalizeCaliber(raw) {
  const s = cleanText(raw).text;
  if (!s) return { value: "", suggestion: "", unknown: false };
  for (const [re, name] of CALIBERS) if (re.test(s)) return { value: name, suggestion: "", unknown: false };
  return { value: s, suggestion: "", unknown: true };
}

function mapCondition(raw) {
  const s = cleanText(raw).text;
  if (!s) return { value: "", note: "" };
  for (const [re, name] of CONDITIONS) if (re.test(s)) return { value: name, note: "" };
  return { value: "", note: s };
}

function normType(value) {
  return normalizeType(value);
}

// Cyrillic and Greek letters that look like Latin. Applied after NFKC.
const LOOKALIKE = new Map(Object.entries({
  "\u0410": "A", "\u0430": "a", "\u0412": "B", "\u0432": "b", "\u0415": "E", "\u0435": "e",
  "\u041a": "K", "\u043a": "k", "\u041c": "M", "\u043c": "m", "\u041d": "H", "\u043d": "h",
  "\u041e": "O", "\u043e": "o", "\u0420": "P", "\u0440": "p", "\u0421": "C", "\u0441": "c",
  "\u0422": "T", "\u0442": "t", "\u0423": "Y", "\u0443": "y", "\u0425": "X", "\u0445": "x",
  "\u0405": "S", "\u0455": "s", "\u0406": "I", "\u0456": "i", "\u0408": "J", "\u0458": "j",
  "\u0404": "E", "\u0454": "e", "\u0407": "I", "\u0457": "i", "\u04c0": "l", "\u04cf": "l",
  "\u0474": "V", "\u0475": "v",
  "\u0391": "A", "\u03b1": "a", "\u0392": "B", "\u03b2": "b", "\u0395": "E", "\u03b5": "e",
  "\u0396": "Z", "\u03b6": "z", "\u0397": "H", "\u03b7": "h", "\u0399": "I", "\u03b9": "i",
  "\u039a": "K", "\u03ba": "k", "\u039c": "M", "\u03bc": "m", "\u039d": "N", "\u03bd": "v",
  "\u039f": "O", "\u03bf": "o", "\u03a1": "P", "\u03c1": "p", "\u03a4": "T", "\u03c4": "t",
  "\u03a5": "Y", "\u03c5": "y", "\u03a7": "X", "\u03c7": "x", "\u0398": "O", "\u03b8": "o",
}));

// NFKC, drop zero-width characters and combining marks, fold look-alikes, then lowercase.
function prepareType(value) {
  let s = String(value || "").normalize("NFKC");
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
  s = s.normalize("NFD").replace(/\p{M}/gu, "");
  s = [...s].map(ch => LOOKALIKE.get(ch) || ch).join("");
  return s.toLowerCase();
}

function normalizeType(value) {
  return prepareType(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// w/, with, +, &, and, slash, and comma join two descriptions. They are not one gear type.
function comboMarked(value) {
  const prepared = prepareType(value);
  if (/[+/&,;]|\/|\bw\/|\bwith\b|\band\b/.test(prepared)) return true;
  const tokens = prepared.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  return tokens.includes("w") || tokens.includes("with") || tokens.includes("and");
}

// Whole type-cell values. A word inside a longer accessory name is not a firearm.
const STORAGE_TYPES = new Set([
  "ammo can", "ammunition can", "ammo box", "ammo bag", "ammo crate", "ammo storage", "ammo storage loaders",
  "speed loader", "speedloader", "mag loader",
]);
const SUPPRESSOR_TYPES = new Set(["suppressor", "suppressors", "silencer", "silencers", "sound suppressor", "nfa suppressor"]);
const LOWER_TYPES = new Set([
  "lower", "lower receiver", "lower receivers", "stripped lower", "complete lower", "assembled lower",
  "ar lower", "ar15 lower", "ar 15 lower", "serialized lower", "frame", "receiver",
]);
const AMMO_TYPES = new Set(["ammunition", "ammo", "cartridge", "cartridges", "shotshell", "shotshells"]);
const FIREARM_EXACT = new Set([
  "pistol", "pistols", "rifle", "rifles", "shotgun", "shotguns", "revolver", "revolvers",
  "handgun", "handguns", "carbine", "carbines", "sbr", "sbrs", "firearm", "firearms", "gun", "guns",
  "long gun", "machine gun", "submachine gun", "sub machine gun", "machinegun", "smg",
  "bolt action rifle", "semi auto pistol", "semi automatic pistol", "pump action shotgun", "lever action rifle",
]);
const SOURCE_FIREARM_TYPES = {
  myarmory: ["pistol", "rifle", "shotgun", "revolver", "handgun", "carbine", "sbr", "firearm", "long gun", "bolt action rifle", "gun"],
  armscache: ["handgun", "rifle", "shotgun", "pistol", "revolver", "firearm", "long gun", "carbine"],
  guntrack: ["handgun", "handguns", "rifle", "rifles", "shotgun", "shotguns", "pistol", "revolver", "long gun"],
  generic: ["pistol", "rifle", "shotgun", "revolver", "handgun", "carbine", "sbr", "firearm", "long gun", "bolt action rifle", "gun"],
};

// Whole-value accessory and gear types. A word inside a longer cell is not a match.
const OPTIC = { target: "gear", arm: "OP", category: "NVG & Optics" };
const LASER = { target: "gear", arm: "LA", category: "Lights & Lasers" };
const LIGHT = { target: "gear", arm: "WL", category: "Lights & Lasers" };
const HOLSTER = { target: "gear", arm: "", category: "Holsters & Slings" };
const CASE = { target: "gear", arm: "", category: "Cases & Bags" };
const MISC = { target: "gear", arm: "", category: "Misc" };
const MAG = { target: "gear", arm: "", category: migrateCategoryName("Magazines & Belts") };
const BELT = { target: "gear", arm: "", category: migrateCategoryName("Belts & Rigs") };
const ARMOR = { target: "gear", arm: "", category: "Armor & Carriers" };
const PART = { target: "gear", arm: "", category: "Triggers & Parts" };
const CLEAN = { target: "gear", arm: "", category: "Cleaning & Maintenance" };
const AMMO_ROUTE = { target: "ammo", arm: "", category: "Ammunition" };
const KNIFE = { target: "gear", arm: "KN", category: "Knives & Tools" };
const ACCESSORY_TERMS = {
  scope: OPTIC, scopes: OPTIC, optic: OPTIC, optics: OPTIC, lpvo: OPTIC, sight: OPTIC, sights: OPTIC, holographic: OPTIC,
  laser: LASER, lasers: LASER, nvg: LASER, nvgs: LASER, thermal: LASER,
  light: LIGHT, lights: LIGHT, flashlight: LIGHT, flashlights: LIGHT, wml: LIGHT,
  sling: HOLSTER, slings: HOLSTER, holster: HOLSTER, holsters: HOLSTER,
  belt: BELT, belts: BELT,
  safe: CASE, safes: CASE, case: CASE, cases: CASE,
  bipod: MISC, bipods: MISC,
  magazine: MAG, magazines: MAG, mag: MAG, mags: MAG,
  grip: PART, grips: PART, trigger: PART, triggers: PART,
  cleaning: CLEAN,
  shell: AMMO_ROUTE, shells: AMMO_ROUTE, shotshell: AMMO_ROUTE, shotshells: AMMO_ROUTE,
  knife: KNIFE, knives: KNIFE, blade: KNIFE, blades: KNIFE, dagger: KNIFE, daggers: KNIFE,
};
const GEAR_PHRASES = {
  "red dot": OPTIC, "red dots": OPTIC, "red dot sight": OPTIC, "red dot sights": OPTIC,
  "holographic sight": OPTIC, "holographic sights": OPTIC,
  "night vision": LASER,
  "weapon light": LIGHT, "weapon lights": LIGHT,
  "cleaning kit": CLEAN, "cleaning kits": CLEAN,
  "battle belt": BELT, "duty belt": BELT, "rigger belt": BELT, "rigger s belt": BELT, "riggers belt": BELT,
  "chest rig": ARMOR, "plate carrier": ARMOR,
};
const SOURCE_GEAR_PHRASES = {
  myarmory: GEAR_PHRASES,
  armscache: GEAR_PHRASES,
  guntrack: GEAR_PHRASES,
  generic: GEAR_PHRASES,
};

function armoryFromTokens(tokens) {
  let armType = "";
  if (tokens.some(tok => tok === "shotgun" || tok === "shotguns")) armType = "Shotgun";
  else if (tokens.some(tok => /^(pistols?|handguns?|revolvers?)$/.test(tok))) armType = "Handgun";
  else if (tokens.some(tok => /^(rifles?|carbines?|sbrs?)$/.test(tok))) armType = "Rifle";
  return { target: "armory", arm: "FA", category: "Firearms", armType };
}

function pricedShelf(route) {
  if (!route || route.target !== "gear" || route.migratedFromMagShelf) return route;
  if (route.category && !saleRestricted({ category: route.category, arm: route.arm || "" })) {
    return { ...route, pricedAllowlist: true };
  }
  return route;
}

function exactFirearm(key, source) {
  const listed = SOURCE_FIREARM_TYPES[source] || SOURCE_FIREARM_TYPES.generic || [];
  const known = listed.some(name => normType(name) === key) || FIREARM_EXACT.has(key);
  if (!known) return null;
  if (key === "long gun" || key === "machine gun" || key === "submachine gun" || key === "sub machine gun") return armoryFromTokens(key.split(" "));
  return armoryFromTokens(key.split(" "));
}

function classifyType(typeText, categories, source) {
  const key = normType(typeText);
  if (!key) return null;
  const list = categories || [];
  if (key === "mags ammo storage" || key === "mags and ammo storage") {
    return { target: "gear", arm: "", category: migrateCategoryName("Mags & Ammo Storage"), storage: true, migratedFromMagShelf: true };
  }
  if (STORAGE_TYPES.has(key)) return pricedShelf({ target: "gear", arm: "", category: storageCategory(list), storage: true });
  const named = routeNamedCategory(key);
  if (named) return pricedShelf(named);
  if (SUPPRESSOR_TYPES.has(key)) return { target: "armory", arm: "SU", category: "Suppressors", armType: "Suppressor" };
  if (LOWER_TYPES.has(key)) return { target: "armory", arm: "FA", category: "Lower receiver", armType: "Lower receiver" };
  if (AMMO_TYPES.has(key)) return { target: "ammo", arm: "", category: "Ammunition" };
  const firearm = exactFirearm(key, source);
  if (firearm) return firearm;
  // A combo marker or any word that is not the whole allowlisted value stays uncategorized.
  if (comboMarked(typeText)) return null;
  const tokens = key.split(" ").filter(Boolean);
  if (tokens.length === 1 && ACCESSORY_TERMS[tokens[0]]) return pricedShelf({ ...ACCESSORY_TERMS[tokens[0]] });
  const phrases = SOURCE_GEAR_PHRASES[source] || SOURCE_GEAR_PHRASES.generic;
  if (phrases[key]) return pricedShelf({ ...phrases[key] });
  return null;
}

// The old combined shelves mixed magazines with belts and pouches, and belts with rigs.
// Import does not pick for the owner, and it does not read the item name.
const AMBIGUOUS_LEGACY = new Set([normType("Magazines & Belts"), normType("Belts & Rigs")]);

function routeNamedCategory(name) {
  const key = normType(name);
  if (!key) return null;
  if (AMBIGUOUS_LEGACY.has(key)) return null;
  if (key === "firearms") return { target: "armory", arm: "FA", category: "Firearms", armType: "" };
  if (key === "suppressors" || key === "suppressor") return { target: "armory", arm: "SU", category: "Suppressors", armType: "Suppressor" };
  if (key === "lower receiver") return { target: "armory", arm: "FA", category: "Lower receiver", armType: "Lower receiver" };
  if (key === "ammunition" || key === "ammo") return { target: "ammo", arm: "", category: "Ammunition" };
  if (key === "reloading") return { target: "gear", arm: "", category: "Reloading" };
  const migrated = migrateCategoryName(name);
  const want = normType(migrated);
  const exact = DEFAULT_CATEGORIES.find(c => normType(c) === key || (want && normType(c) === want));
  if (exact) return { target: "gear", arm: "", category: exact };
  return null;
}

function storageCategory(categories) {
  if (categories.includes("Ammo Storage & Loaders")) return "Ammo Storage & Loaders";
  return "Mags & Ammo Storage";
}

function fileDefaultTarget(columns) {
  const fields = new Set(columns.filter(c => c.field !== "ignore").map(c => c.field));
  if ((fields.has("rounds") || fields.has("lot") || fields.has("load")) && !fields.has("serial")) return "ammo";
  return "needs";
}

function applyColumns(columns, choices) {
  if (!choices) return columns;
  return columns.map(col => {
    if (col.locked) return col;
    const next = choices[col.index];
    if (!next) return col;
    return { ...col, field: next, usedLastTime: col.usedLastTime };
  });
}

function blankDropCells(grid, columns) {
  const drop = new Set(columns.filter(c => c.locked).map(c => c.index));
  if (!drop.size) return grid;
  return grid.map(row => row.map((cell, i) => drop.has(i) ? "" : cell));
}

export function buildTable(matrix, opts = {}) {
  const rows = matrix || [];
  if (!rows.length) return { ok: false, code: "empty" };
  const headerAt = findHeaderRow(rows);
  const headerCells = rows[headerAt] || [];
  if (headerCells.filter(c => String(c ?? "").trim()).length < 2 && rows.length < 2) return { ok: false, code: "empty" };
  let mapped = mapColumns(headerCells, { source: opts.source, remembered: opts.remembered });
  mapped = { ...mapped, columns: retargetQuantity(mapped.columns) };
  if (mapped.columns.length > LIMITS.cols) return { ok: false, code: "too-big", limit: "columns" };
  const data = [];
  let blanks = 0;
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!row.some(c => String(c ?? "").trim())) { blanks++; continue; }
    data.push(row);
  }
  if (!data.length) return { ok: false, code: "empty", blanks };
  if (data.length > (opts.maxRows || LIMITS.rows)) return { ok: false, code: "too-big", limit: "rows" };
  const grid = blankDropCells(data, mapped.columns);
  const acquiredCol = mapped.columns.find(c => c.field === "acquired");
  const dateOrder = opts.dateOrder || (acquiredCol ? columnDateOrder(grid.map(row => row[acquiredCol.index]), opts.monthFirst !== false) : "mdy");
  return {
    ok: true,
    name: String(opts.name || "Sheet"),
    source: mapped.source,
    encoding: opts.encoding || "",
    separator: opts.separator || "",
    headerRow: headerAt + 1,
    columns: mapped.columns,
    grid,
    blanks,
    dateOrder,
    defaultTarget: opts.defaultTarget || fileDefaultTarget(mapped.columns),
    warnings: opts.warnings || [],
    hidden: !!opts.hidden,
    included: opts.hidden ? false : true,
    formulaBlanks: opts.formulaBlanks || 0,
    partial: opts.partial || null,
  };
}

function finishRoute(typed, fields) {
  if (!typed) return { target: "needs", arm: "", category: "", needsCategory: true, gearArmory: false };
  if (typed.storage || typed.target === "ammo") return { ...typed, gearArmory: false };
  if (typed.arm === "OP" || typed.arm === "WL" || typed.arm === "LA" || typed.arm === "KN") {
    return { ...typed, target: "gear", arm: fields.serial ? typed.arm : "", gearArmory: !!fields.serial && typed.arm !== "KN" };
  }
  if (typed.target === "armory") return { ...typed, gearArmory: false };
  return { ...typed, arm: fields.serial ? (typed.arm || "") : "", gearArmory: !!fields.serial && !!typed.arm, target: "gear" };
}

function routeOne(fields, fileTarget, categories, source) {
  const raw = String(fields.armType || "").trim();
  const typed = raw ? classifyType(raw, categories, source) : null;
  if (typed) return finishRoute(typed, fields);
  if (raw) return { target: "needs", arm: "", category: "", needsCategory: true, gearArmory: false };
  // An empty type stays uncategorized. A bullet or grain note is not a type, and neither is the file default.
  // A lot number is the ammunition signal. fileTarget is not.
  void fileTarget;
  if (!fields.serial && fields.lot) return { target: "ammo", arm: "", category: "Ammunition", gearArmory: false };
  return { target: "needs", arm: "", category: "", needsCategory: true, gearArmory: false };
}

function ownExport(columns) {
  const keys = new Set((columns || []).map(col => col.key));
  return keys.has("brand model") && (keys.has("paid each") || keys.has("new retail") || keys.has("price source"));
}

function nameBrandKey(name, brand) {
  return `${String(name || "").trim().toLowerCase()}|${String(brand || "").trim().toLowerCase()}`;
}

function readFields(row, columns, opts) {
  const fields = {};
  const notes = [];
  const problems = [];
  let truncated = false;
  const monthFirst = (opts.dateOrder || "mdy") !== "dmy";
  columns.forEach(col => {
    if (col.locked || col.field === "ignore") return;
    const raw = row[col.index];
    if (raw == null || String(raw).trim() === "") return;
    const cleaned = cleanText(raw, col.field === "notes");
    if (cleaned.truncated) truncated = true;
    const text = cleaned.text;
    if (col.field === "notes" || col.field === "manufactureDate") {
      notes.push(col.field === "manufactureDate" ? `Manufacture date: ${text}` : (col.dup > 1 || col.header ? `${col.header}: ${text}` : text));
      return;
    }
    if (col.field === "load") {
      fields.loadParts = fields.loadParts || [];
      fields.loadParts.push(text);
      return;
    }
    if (col.field === "paid") {
      const paid = parsePaid(text);
      if (paid == null) notes.push(`${col.header}: ${text}`);
      else fields.paid = paid;
      return;
    }
    if (col.field === "qty" || col.field === "rounds" || col.field === "roundCount" || col.field === "lowAlert") {
      const q = parseQty(text);
      if (q.value == null) {
        notes.push(`${col.header}: ${text}`);
        problems.push({ kind: "qty", message: "Quantity is not a number" });
      } else fields[col.field] = q.value;
      return;
    }
    if (col.field === "acquired") {
      const d = parseDate(text, monthFirst);
      if (!d.iso) {
        notes.push(text);
        problems.push({ kind: "date", message: "Date needs a look" });
      } else {
        fields.acquired = d.iso;
        if (d.flag === "future") problems.push({ kind: "date", message: "Date is more than a year ahead" });
        if (d.flag === "year") notes.push("Year only");
      }
      return;
    }
    if (col.field === "caliber") {
      fields.caliberRaw = text;
      return;
    }
    if (col.field === "condition") {
      const c = mapCondition(text);
      if (c.value) fields.condition = c.value;
      else if (c.note) notes.push(`Condition: ${c.note}`);
      return;
    }
    fields[col.field] = text;
  });
  if (Array.isArray(fields.loadParts)) fields.load = fields.loadParts.join(" ").trim();
  delete fields.loadParts;
  if (fields.caliberRaw) {
    const cal = normalizeCaliber(fields.caliberRaw);
    fields.caliber = cal.value;
    if (cal.unknown) problems.push({ kind: "caliber", message: cal.suggestion ? `Could be ${cal.suggestion}` : "Caliber is not in the list", suggestion: cal.suggestion || "" });
    delete fields.caliberRaw;
  }
  if (truncated) problems.push({ kind: "long", message: "A cell was shortened" });
  const extra = row.slice(columns.length).map(c => cleanText(c).text).filter(Boolean);
  if (extra.length) {
    notes.push("Extra: " + extra.join(" | "));
    problems.push({ kind: "ragged", message: "Extra cells were added to notes" });
  }
  fields.notes = notes.filter(Boolean).join("\n");
  return { fields, problems };
}

function localNoteDay(now) {
  const d = new Date(now || Date.now());
  if (!isFinite(d.getTime())) return String(now || "").slice(0, 10);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function composeName(fields, index) {
  if (fields.name) return fields.name;
  const parts = [fields.brand, fields.model].map(s => String(s || "").trim()).filter(Boolean);
  if (fields.model && !fields.brand) return fields.model;
  if (parts.length) return parts.join(" ");
  return `Imported item ${index}`;
}

function ammoKey(row) {
  return [row.caliber, row.brand, row.load, row.lot].map(v => String(v || "").trim().toLowerCase()).join("|");
}

// A merge keeps the category and the price status already on the item.
// The category decides. Arm, type, and the file's gun type do not.
function mergeKeepsMarket(current) {
  if (!current || typeof current !== "object") return false;
  const category = String(current.category || "").trim();
  if (!category || /^needs a category$/i.test(category)) return false;
  if (saleRestricted({ category })) return false;
  const kept = { ...current, arm: "", armType: "", kind: "", tab: "" };
  if (kept.importId && importRestricted(kept)) return false;
  return true;
}

function filedAsFirearm(route) {
  return !!(route && (route.target === "armory" || route.arm === "FA" || route.arm === "SU"));
}

function comboPieces(typeText) {
  return String(typeText || "")
    .split(/\s*(?:\bw\/|\/|\+|&|,|;|\bwith\b|\band\b)\s*/i)
    .map(part => part.trim())
    .filter(Boolean);
}

// The file's type column only, using the same whole-type classifier as the import.
// A gear name that merely contains a gun word is not a gun. Item names are not read.
export function typeColumnIsGun(typeText) {
  const raw = String(typeText || "").trim();
  if (!raw) return false;
  if (filedAsFirearm(classifyType(raw, null, "generic"))) return true;
  if (!comboMarked(raw)) return false;
  return comboPieces(raw).some(part => filedAsFirearm(classifyType(part, null, "generic")));
}

export function planImport(tables, opts = {}) {
  const categories = opts.categories || DEFAULT_CATEGORIES;
  const now = opts.now || new Date().toISOString();
  const importId = opts.importId || newUlid(Date.parse(now) || Date.now());
  const existingItems = (opts.items || []).filter(r => r && !r.deleted);
  const existingAmmo = (opts.ammo || []).filter(r => r && !r.deleted);
  const serials = new Map();
  existingItems.forEach(it => { if (it.serial) serials.set(nrm(it.serial), { row: it, where: "saved" }); });
  const ammoKeys = new Map();
  existingAmmo.forEach(a => ammoKeys.set(ammoKey(a), { row: a, where: "saved" }));
  const gearKeys = new Map();
  const nameBrandKeys = new Map();
  existingItems.forEach(it => {
    const named = nameBrandKey(it.name, it.brand);
    if (named !== "|") nameBrandKeys.set(named, { row: it, where: "saved" });
    if (it.serial) return;
    if (named !== "|") gearKeys.set(named, { row: it, where: "saved" });
  });
  const takenIds = new Set();
  (opts.items || []).forEach(row => { if (row && row.id) takenIds.add(row.id); });
  (opts.ammo || []).forEach(row => { if (row && row.id) takenIds.add(row.id); });
  let seq = 0;
  const nextId = () => {
    let id = "";
    do {
      seq++;
      id = opts.ids && opts.ids[seq - 1] ? opts.ids[seq - 1] : ("imp" + importId.slice(-6) + seq.toString(36));
    } while (takenIds.has(id));
    takenIds.add(id);
    return id;
  };
  const review = [];
  const items = [];
  const ammo = [];
  const merges = [];
  tables.forEach((table, ti) => {
    if (table.included === false) return;
    const choices = opts.columnChoices && opts.columnChoices[ti];
    let columns = applyColumns(table.columns, choices);
    columns = retargetQuantity(columns);
    const fileTarget = (opts.targets && opts.targets[ti]) || table.defaultTarget || "needs";
    const own = ownExport(columns);
    const monthFirst = opts.monthFirst !== false && (opts.dateOrders ? opts.dateOrders[ti] : table.dateOrder) !== "dmy";
    table.grid.forEach((gridRow, ri) => {
      const read = readFields(gridRow, columns, { dateOrder: monthFirst ? "mdy" : "dmy" });
      const fields = read.fields;
      const problems = read.problems.slice();
      const fix = opts.rowFixes && opts.rowFixes[ti] && opts.rowFixes[ti][ri];
      if (fix && fix.serial) fields.serial = cleanText(fix.serial).text;
      if (fix && fix.acquired) fields.acquired = fix.acquired;
      if (fix && fix.caliber) fields.caliber = cleanText(fix.caliber).text;
      if (fix && fix.skip) {
        review.push({ table: ti, row: ri, target: "skip", name: composeName(fields, ri + 1), problems, decision: "skip", skipped: true });
        return;
      }
      let routed = routeOne({ ...fields, qty: fields.qty ?? fields.rounds ?? null }, fileTarget, categories, table.source);
      const picked = opts.rowCategories && opts.rowCategories[ti] && opts.rowCategories[ti][ri];
      if (picked) routed = finishRoute(classifyType(picked, categories, table.source) || routeNamedCategory(picked), fields);
      const rowTarget = opts.rowTargets && opts.rowTargets[ti] && opts.rowTargets[ti][ri];
      if (rowTarget && routed.target !== "needs") routed = { ...routed, target: rowTarget, moved: routed.target !== rowTarget || routed.moved };
      if ((routed.arm === "OP" || routed.arm === "WL" || routed.arm === "LA") && !fields.serial) routed.arm = "";
      const name = composeName(fields, review.length + 1);
      if (routed.target === "needs") {
        let duplicate = null;
        if (fields.serial) {
          const hit = serials.get(nrm(fields.serial));
          if (hit) duplicate = { kind: "serial", existingId: hit.row.id, existingLabel: hit.row.name || "Saved item", where: hit.where, serial: fields.serial };
        } else {
          const key = nameBrandKey(name, fields.brand);
          const hit = key !== "|" && (gearKeys.get(key) || nameBrandKeys.get(key));
          if (hit) duplicate = { kind: "possible", existingId: hit.row.id, existingLabel: hit.row.name || name, where: hit.where };
        }
        review.push({
          table: ti, row: ri, target: "needs", arm: "", gearArmory: false, name,
          brand: fields.brand || "", category: "", caliber: fields.caliber || "",
          serial: fields.serial || "", serialMasked: maskSerial(fields.serial),
          paid: fields.paid != null ? fields.paid : null, problems, duplicate,
          sourceType: String(fields.armType || "").trim(),
          decision: "add", needsCategory: true, fileTarget,
        });
        return;
      }
      let decision = "add";
      let duplicate = null;
      if (routed.target === "ammo") {
        const key = ammoKey({ caliber: fields.caliber, brand: fields.brand, load: fields.load, lot: fields.lot });
        const hit = key !== "|||" && ammoKeys.get(key);
        if (hit) {
          duplicate = { kind: "ammo", existingId: hit.row.id, existingLabel: [hit.row.caliber, hit.row.brand, hit.row.load].filter(Boolean).join(" "), where: hit.where };
          decision = "skip";
        }
      } else if (fields.serial) {
        const key = nrm(fields.serial);
        const hit = key && serials.get(key);
        if (hit) {
          duplicate = { kind: "serial", existingId: hit.row.id, existingLabel: hit.row.name || "Saved item", where: hit.where, serial: fields.serial };
          decision = "skip";
        }
      } else if (routed.target === "gear" || own) {
        const key = nameBrandKey(name, fields.brand);
        const hit = key !== "|" && (own ? nameBrandKeys.get(key) : gearKeys.get(key));
        if (hit) {
          duplicate = { kind: own ? "saved" : "possible", existingId: hit.row.id, existingLabel: hit.row.name || name, where: hit.where };
          decision = own ? "skip" : "add";
        }
      }
      const chosen = opts.rowDecisions && opts.rowDecisions[ti] && opts.rowDecisions[ti][ri];
      if (chosen && duplicate) decision = chosen;
      if (!fields.serial && routed.target === "armory") problems.push({ kind: "serial", message: "No serial" });
      const paid = fields.paid != null ? fields.paid : null;
      const recordBase = {
        name,
        brand: fields.brand || "",
        category: routed.category || (routed.target === "armory" ? "Firearms" : routed.target === "needs" ? "" : "Misc"),
        qty: fields.qty || 1,
        location: fields.location || "",
        notes: fields.notes || "",
        acquired: fields.acquired || "",
        condition: fields.condition || "Good",
        color: fields.color || fields.finish || "",
        caliber: fields.caliber || "",
        serial: fields.serial || "",
        mountedOnText: fields.mountedOn || "",
      };
      if (paid != null) {
        recordBase.paid = paid;
        recordBase.paidSource = "manual";
      }
      const view = {
        table: ti,
        row: ri,
        target: routed.target,
        arm: routed.arm || "",
        gearArmory: !!routed.gearArmory,
        name,
        brand: recordBase.brand,
        category: recordBase.category,
        caliber: recordBase.caliber,
        serial: recordBase.serial,
        serialMasked: maskSerial(recordBase.serial),
        paid: paid,
        problems,
        duplicate,
        decision: duplicate ? decision : "add",
        sourceType: String(fields.armType || "").trim(),
        moved: !!(routed.moved || (rowTarget && rowTarget !== fileTarget)),
        fileTarget,
        fields: recordBase,
      };
      if (decision === "skip" && duplicate) {
        review.push({ ...view, skipped: true });
        return;
      }
      if (routed.target === "needs") {
        review.push({ ...view, needsCategory: true, decision: "add" });
        return;
      }
      if (decision === "merge" && duplicate && duplicate.where === "saved") {
        const collection = routed.target === "ammo" ? "ammo" : "items";
        const current = (collection === "ammo" ? existingAmmo : existingItems).find(r => r.id === duplicate.existingId);
        const patch = {};
        const undo = {};
        const incoming = collection === "ammo"
          ? { brand: recordBase.brand, caliber: recordBase.caliber, load: fields.load || "", lot: fields.lot || "", rounds: fields.rounds || fields.qty || "", location: recordBase.location, paid: recordBase.paid, paidSource: recordBase.paidSource }
          : { ...recordBase, arm: routed.arm || "", armType: routed.armType || fields.armType || "", action: fields.action || "", bbl: fields.bbl || "", acquiredFrom: fields.acquiredFrom || "", baseRounds: fields.roundCount || "", finish: fields.finish || "" };
        if (current) {
          for (const [k, v] of Object.entries(incoming)) {
            if (v == null || v === "" || k === "name" && current.name) continue;
            if (k === "notes" || k === "arm" || k === "armType" || k === "kind" || k === "tab" || k === "category") continue;
            const prev = current[k];
            if (prev == null || prev === "") { patch[k] = v; undo[k] = ""; }
          }
          if (incoming.notes) {
            undo.notes = current.notes || "";
            const line = `Imported ${localNoteDay(now)}: ${incoming.notes}`;
            patch.notes = current.notes ? `${current.notes}\n${line}` : line;
          }
          if (mergeKeepsMarket(current)) {
            if (!current.importPricedAllowlist) undo.importPricedAllowlist = "";
            patch.importPricedAllowlist = true;
          }
          const prevIds = Array.isArray(current.importIds) ? current.importIds.slice() : (current.importId ? [current.importId] : []);
          const prevBy = current.importUndoBy && typeof current.importUndoBy === "object" ? current.importUndoBy : null;
          undo.importId = current.importId || "";
          undo.importedAt = current.importedAt || "";
          undo.importIds = prevIds.length ? prevIds : "";
          undo.importUndoBy = prevBy || "";
          patch.importId = current.importId || importId;
          patch.importIds = prevIds.concat(importId);
          patch.importUndoBy = { ...(prevBy || {}), [importId]: undo };
          undo.updatedAt = current.updatedAt || "";
          undo.importBookkeeping = current.importBookkeeping || "";
          patch.importedAt = current.importedAt || now;
          patch.importUndo = undo;
          patch.updatedAt = now;
          patch.importBookkeeping = now;
          merges.push({ id: current.id, collection, patch });
        }
        review.push({ ...view, decision: "merge", skipped: false });
        return;
      }
      const id = nextId();
      if (routed.target === "ammo") {
        if (!recordBase.caliber) problems.push({ kind: "caliber", message: "Ammo needs a caliber" });
        const doc = {
          id, createdAt: now, updatedAt: now, importedAt: now, importId, importIds: [importId],
          caliber: recordBase.caliber, brand: recordBase.brand, load: fields.load || "",
          rounds: fields.rounds || fields.qty || 0, lot: fields.lot || "", location: recordBase.location,
          lowAlert: fields.lowAlert || "", notes: recordBase.notes, kind: "ammo", tab: "ammo",
        };
        if (paid != null) { doc.paid = paid; doc.paidSource = "manual"; }
        if (picked) doc.importCategoryPicked = true;
        else if (routed.pricedAllowlist) doc.importPricedAllowlist = true;
        if (decision === "add" && duplicate) doc.tags = ["possible duplicate"];
        ammo.push(doc);
        ammoKeys.set(ammoKey(doc), { row: doc, where: "file" });
        review.push({ ...view, id, decision });
        return;
      }
      const doc = {
        id, createdAt: now, updatedAt: now, importedAt: now, importId, importIds: [importId],
        name: recordBase.name, brand: recordBase.brand, category: recordBase.category,
        qty: recordBase.qty || 1, location: recordBase.location, notes: recordBase.notes,
        acquired: recordBase.acquired, condition: recordBase.condition || "Good", color: recordBase.color,
        caliber: recordBase.caliber, serial: recordBase.serial, arm: routed.arm || "",
        armType: routed.armType || fields.armType || "", action: fields.action || "",
        bbl: fields.bbl || "", acquiredFrom: fields.acquiredFrom || "",
        baseRounds: fields.roundCount ?? "",
        mountedOnText: recordBase.mountedOnText,
      };
      if (paid != null) { doc.paid = paid; doc.paidSource = "manual"; }
      if (picked) doc.importCategoryPicked = true;
      else if (routed.pricedAllowlist) doc.importPricedAllowlist = true;
      if (routed.migratedFromMagShelf) doc.migratedFromMagShelf = true;
      const tags = [];
      if (!doc.serial && routed.target === "armory") tags.push("no serial");
      if (decision === "add" && duplicate) tags.push("possible duplicate");
      if (tags.length) doc.tags = tags;
      if (importRestricted(doc) || saleRestricted(doc)) {
        delete doc.value;
        delete doc.retailNew;
        delete doc.cpr;
        delete doc.priceSource;
        delete doc.marketSources;
      }
      items.push(doc);
      const named = nameBrandKey(doc.name, doc.brand);
      if (named !== "|") nameBrandKeys.set(named, { row: doc, where: "file" });
      if (doc.serial) serials.set(nrm(doc.serial), { row: doc, where: "file" });
      else if (named !== "|") gearKeys.set(named, { row: doc, where: "file" });
      review.push({ ...view, id, decision });
    });
  });
  linkMounted(items, existingItems);
  const counts = countPlan(review);
  return { importId, rows: review, items, ammo, merges, counts, at: now };
}

function linkMounted(items, existing) {
  const bySerial = new Map();
  const byName = new Map();
  [...existing, ...items].forEach(it => {
    if (!it || it.deleted) return;
    if (it.serial) bySerial.set(nrm(it.serial), it.id);
    if (it.name) byName.set(String(it.name).trim().toLowerCase(), it.id);
  });
  items.forEach(it => {
    const raw = String(it.mountedOnText || "").trim();
    delete it.mountedOnText;
    if (!raw || raw === it.id) return;
    const hit = bySerial.get(nrm(raw)) || byName.get(raw.toLowerCase());
    if (hit && hit !== it.id) it.mountedOn = hit;
    else it.notes = [it.notes, `Mounted on: ${raw}`].filter(Boolean).join("\n");
  });
}

export function countPlan(rows) {
  const live = (rows || []).filter(r => r && !r.skipped && r.target !== "needs");
  const skipped = (rows || []).filter(r => r && r.skipped).length;
  const needs = (rows || []).filter(r => r && !r.skipped && r.target === "needs").length;
  return {
    firearms: live.filter(r => r.target === "armory").length,
    gear: live.filter(r => r.target === "gear").length,
    ammo: live.filter(r => r.target === "ammo").length,
    skipped,
    needs,
    total: live.length,
  };
}

export function summaryLine(counts) {
  const bits = [];
  bits.push(`${counts.firearms} firearm${counts.firearms === 1 ? "" : "s"}`);
  bits.push(`${counts.gear} gear item${counts.gear === 1 ? "" : "s"}`);
  bits.push(`${counts.ammo} ammo lot${counts.ammo === 1 ? "" : "s"}`);
  let line = `Import ${bits.join(", ")}.`;
  if (counts.skipped) line += ` ${counts.skipped} duplicate${counts.skipped === 1 ? "" : "s"} skipped.`;
  return line;
}

function applyUndo(row, undo, nowIso) {
  const next = { ...row, updatedAt: nowIso };
  for (const [k, prev] of Object.entries(undo || {})) {
    if (k === "importUndo") continue;
    if (prev === "" || prev == null) delete next[k];
    else next[k] = prev;
  }
  delete next.importUndo;
  return next;
}

function undoOne(row, importId, nowIso) {
  if (!row || row.deleted) return row;
  const by = row.importUndoBy && typeof row.importUndoBy === "object" ? row.importUndoBy : null;
  if (by && Object.prototype.hasOwnProperty.call(by, importId)) return applyUndo(row, by[importId], nowIso);
  const ids = Array.isArray(row.importIds) ? row.importIds : [];
  const createdBy = ids.length ? ids[0] : "";
  if (by && createdBy === importId) return { id: row.id, deleted: true, updatedAt: nowIso };
  if (row.importUndo && typeof row.importUndo === "object" && (row.importId === importId || ids[ids.length - 1] === importId)) {
    return applyUndo(row, row.importUndo, nowIso);
  }
  if (createdBy === importId || (row.importId === importId && !row.importUndo)) {
    return { id: row.id, deleted: true, updatedAt: nowIso };
  }
  return row;
}

export function undoImportState(items, ammo, importId, nowIso) {
  const touch = rows => (rows || []).map(row => undoOne(row, importId, nowIso));
  return { items: touch(items), ammo: touch(ammo) };
}

export function missingImportIds(rows, importId, expectedIds) {
  const live = new Set();
  (rows || []).forEach(row => {
    if (!row || row.deleted || !row.id) return;
    const ids = Array.isArray(row.importIds) ? row.importIds : [];
    if (row.importId === importId || ids.includes(importId)) live.add(row.id);
  });
  return (expectedIds || []).filter(id => id && !live.has(id));
}

export function changedAfterImport(rows, importId) {
  return (rows || []).filter(r => {
    if (!r || r.deleted) return false;
    const ids = Array.isArray(r.importIds) ? r.importIds : [];
    if (r.importId !== importId && !ids.includes(importId)) return false;
    if (r.importEdited) return true;
    if (r.importBookkeeping && r.updatedAt === r.importBookkeeping) return false;
    return !!(r.updatedAt && r.importedAt && r.updatedAt !== r.importedAt);
  });
}

export function loadHistory(storage) {
  try {
    const list = JSON.parse(storage.getItem(HIST_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function saveHistory(storage, entry) {
  const list = loadHistory(storage).filter(row => row && row.id !== entry.id);
  const status = entry.status || "saved";
  const undone = !!entry.undone || status === "undone";
  list.unshift({
    id: entry.id,
    at: entry.at,
    counts: entry.counts || {},
    status,
    undone,
    rollback: !undone && (status === "rollback" || !!entry.rollback),
    progress: entry.progress || null,
  });
  storage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 20)));
}

export function undoOpen(entry, now) {
  if (!entry || entry.undone || entry.status === "undone") return false;
  const at = Date.parse(entry.at || "");
  if (!isFinite(at)) return false;
  return (now || Date.now()) - at < UNDO_MS;
}

// A rollback that has not been stored yet stays on this batch, even after 24 hours.
export function activeUndoEntry(list, now) {
  const rows = Array.isArray(list) ? list : [];
  const pending = rows.find(row => row && !row.undone && row.status !== "undone" && (row.status === "rollback" || row.rollback));
  if (pending) return pending;
  return rows.find(row => row && !row.undone && row.status !== "undone" && (row.status === "saving" || undoOpen(row, now))) || null;
}

export function importHistoryLabel(row) {
  if (!row || typeof row !== "object") return "File import";
  if (row.undone || row.status === "undone") return "Undone";
  if (row.rollback || row.status === "rollback" || row.status === "saving") return "Incomplete. Undo or finish";
  return "File import";
}

export function importHistoryCanUndo(row) {
  return !!(row && !row.undone && row.status !== "undone");
}

export function loadMaps(storage) {
  try {
    const data = JSON.parse(storage.getItem(MAP_KEY) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}

export function rememberMap(storage, keys, fields) {
  const all = loadMaps(storage);
  all[headerHash(keys)] = fields.map(f => (f && f !== "ignore" ? f : "ignore"));
  const raw = JSON.stringify(all);
  storage.setItem(MAP_KEY, raw);
  return raw;
}

function fail(code, extra) {
  const more = extra || {};
  let message = more.message || "";
  if (!message) {
    if (code === "binary") message = "This doesn't look like a spreadsheet.";
    else if (code === "not-workbook") message = "This isn't a spreadsheet workbook.";
    else if (code === "partial") message = more.partial ? `Couldn't read from row ${more.partial}. A quote was left open.` : "A quote was left open.";
    else if (code === "empty") message = "That file has no rows to import.";
    else if (code === "encrypted-backup") message = "This backup is encrypted. Export a CSV and try that file.";
    else if (code === "encrypted-workbook") message = "This workbook is password-protected. Save it as CSV or xlsx without a password, then try again.";
    else if (code === "encoding") message = "Couldn't read the text in this file.";
    else if (code === "too-big") message = "This file is too big.";
    else message = "War Box can't read this file. Save it as CSV or xlsx and try again.";
  }
  return { ok: false, code, ...more, message };
}

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function isSalted(bytes) {
  const sig = "Salted__";
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig.charCodeAt(i)) return false;
  return true;
}

function isOle(bytes) {
  return bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
}

function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function looksBinary(bytes) {
  const n = Math.min(bytes.length, 4096);
  if (!n) return false;
  const sigs = [[0x89, 0x50, 0x4E, 0x47], [0xFF, 0xD8, 0xFF], [0x25, 0x50, 0x44, 0x46], [0x47, 0x49, 0x46, 0x38], [0x7F, 0x45, 0x4C, 0x46], [0x4D, 0x5A], [0x1F, 0x8B]];
  for (const sig of sigs) {
    if (n >= sig.length && sig.every((b, i) => bytes[i] === b)) return true;
  }
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) bad++;
  }
  return bad / n > 0.1;
}

export function escapeSaveReport(saved, total) {
  const n = Math.max(0, Math.round(+saved) || 0);
  const m = Math.max(n, Math.round(+total) || 0);
  if (!n) return "Stopped. Nothing was saved.";
  return `Stopped. Rolled back ${n} of ${m}. Nothing was saved.`;
}

function decodeCp1252(bytes) {
  let s = "";
  for (const b of bytes) {
    if (b >= 0x80 && b <= 0x9F) s += CP1252[b] || "\uFFFD";
    else s += String.fromCharCode(b);
  }
  return s;
}

function decodeMac(bytes) {
  let s = "";
  for (const b of bytes) {
    if (b < 0x80) s += String.fromCharCode(b);
    else s += String.fromCodePoint(MAC_ROMAN[b - 0x80] || 0xFFFD);
  }
  return s;
}

export function decodeBytes(bytes, encoding) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
    return { ok: true, encoding: "utf-16le", text: new TextDecoder("utf-16le").decode(u8).replace(/^\uFEFF/, "") };
  }
  if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
    return { ok: true, encoding: "utf-16be", text: new TextDecoder("utf-16be").decode(u8).replace(/^\uFEFF/, "") };
  }
  const body = u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF ? u8.subarray(3) : u8;
  if (encoding === "windows-1252") return { ok: true, encoding: "windows-1252", text: decodeCp1252(body) };
  if (encoding === "mac") return { ok: true, encoding: "mac", text: decodeMac(body) };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { ok: true, encoding: "utf-8", text };
  } catch {
    return { ok: true, encoding: "windows-1252", text: decodeCp1252(body) };
  }
}

function sniffSep(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const first = (lines[0] || "").trim();
  const sepLine = first.match(/^sep=(.)$/i);
  if (sepLine) return { sep: sepLine[1], drop: 1 };
  const candidates = [",", ";", "\t", "|"];
  let best = ",", bestScore = -1;
  const sample = lines.slice(0, 50);
  for (const sep of candidates) {
    const counts = [];
    for (const line of sample) {
      if (!line.trim()) continue;
      counts.push(countSep(line, sep));
    }
    if (!counts.length) continue;
    const mode = counts.slice().sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    if (mode < 1) continue;
    const consistent = counts.filter(n => n === mode).length;
    const score = consistent * 10 + mode;
    if (score > bestScore) { bestScore = score; best = sep; }
  }
  return { sep: best, drop: 0 };
}

function countSep(line, sep) {
  let n = 0, q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { i++; continue; }
      q = !q;
      continue;
    }
    if (!q && ch === sep) n++;
  }
  return n;
}

export function parseDelimited(text, sep, opts = {}) {
  const out = [];
  let row = [];
  let cell = "";
  let q = false;
  let badAt = 0;
  const max = opts.maxRows || LIMITS.rows;
  const pushCell = () => { row.push(cell); cell = ""; };
  const pushRow = () => { out.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    if (opts.onProgress && i % (1024 * 1024) === 0) opts.onProgress(i, text.length);
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { q = true; continue; }
    if (ch === sep) { pushCell(); continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushCell();
      pushRow();
      if (out.length > max) return { rows: out.slice(0, max), tooBig: true, partial: null };
      continue;
    }
    cell += ch;
  }
  if (q) {
    badAt = out.length + 1;
    return { rows: out, tooBig: false, partial: badAt };
  }
  if (cell.length || row.length) { pushCell(); pushRow(); }
  return { rows: out, tooBig: false, partial: null };
}

function tableFromMatrix(matrix, meta) {
  const built = buildTable(matrix, meta);
  return built;
}

export function readCsvText(text, opts = {}) {
  const sniffed = opts.separator ? { sep: opts.separator, drop: 0 } : sniffSep(text);
  let body = text;
  if (sniffed.drop) {
    const nl = text.search(/\r\n|\n|\r/);
    body = nl < 0 ? "" : text.slice(nl).replace(/^\r\n|\n|\r/, "");
  }
  const parsed = parseDelimited(body, sniffed.sep, opts);
  if (parsed.tooBig) return fail("too-big", { limit: "rows" });
  const quoteMessage = parsed.partial ? `Couldn't read from row ${parsed.partial}. A quote was left open.` : "";
  const built = tableFromMatrix(parsed.rows, {
    ...opts,
    encoding: opts.encoding || "utf-8",
    separator: sniffed.sep,
    partial: parsed.partial,
    warnings: quoteMessage ? [quoteMessage] : [],
  });
  if (!built.ok) {
    if (parsed.partial) return fail("partial", { message: quoteMessage, partial: parsed.partial });
    return built;
  }
  if (parsed.partial) built.partial = parsed.partial;
  return { ok: true, tables: [built], message: quoteMessage };
}

function asObjects(value, parentSerial) {
  if (!value) return [];
  if (Array.isArray(value)) {
    const rows = [];
    value.forEach(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const nested = [];
      const flat = {};
      for (const [k, v] of Object.entries(item)) {
        if (Array.isArray(v) && v.length && v.every(x => x && typeof x === "object" && !Array.isArray(x))) nested.push(v);
        else if (v != null && typeof v !== "object") flat[k] = v;
      }
      const serial = flat["SERIAL NUMBER"] || flat["Serial Number"] || flat.serial || flat.Serial || parentSerial || "";
      rows.push(flat);
      nested.forEach(list => {
        list.forEach(child => {
          const copy = {};
          for (const [k, v] of Object.entries(child)) if (v != null && typeof v !== "object") copy[k] = v;
          if (!copy["MOUNTED ON"] && !copy["Mounted On"] && serial) copy["MOUNTED ON"] = serial;
          rows.push(copy);
        });
      });
    });
    return rows;
  }
  return [];
}

export function readJsonText(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return null; }
  if (!data || typeof data !== "object") return null;
  const groups = [];
  if (Array.isArray(data)) groups.push({ name: "Import", rows: asObjects(data) });
  else {
    for (const [key, value] of Object.entries(data)) {
      const rows = asObjects(value);
      if (rows.length) groups.push({ name: key, rows });
    }
  }
  if (!groups.length) return null;
  const tables = [];
  for (const group of groups) {
    const headers = [];
    group.rows.forEach(row => {
      Object.keys(row).forEach(k => { if (!headers.includes(k)) headers.push(k); });
    });
    const matrix = [headers, ...group.rows.map(row => headers.map(h => row[h] == null ? "" : String(row[h])))];
    const built = buildTable(matrix, { name: group.name, encoding: "utf-8", separator: "" });
    if (built.ok) tables.push(built);
  }
  if (!tables.length) return fail("empty");
  return { ok: true, tables };
}

function u16(view, o) { return view.getUint16(o, true); }
function u32(view, o) { return view.getUint32(o, true); }

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "function") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { inflateRawSync } = await import("node:zlib");
  return inflateRawSync(bytes);
}

export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  const min = Math.max(0, bytes.length - 22 - 0xFFFF);
  while (e >= min && view.getUint32(e, true) !== 0x06054b50) e--;
  if (e < min) return fail("unsupported");
  const count = u16(view, e + 10);
  const cdSize = u32(view, e + 12);
  const cdOff = u32(view, e + 16);
  if (cdOff + cdSize > bytes.length) return fail("unsupported");
  const files = [];
  let p = cdOff;
  let uncompressed = 0;
  let compressed = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return fail("unsupported");
    const flags = u16(view, p + 8);
    const method = u16(view, p + 10);
    const comp = u32(view, p + 20);
    const uncomp = u32(view, p + 24);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const local = u32(view, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    uncompressed += uncomp;
    compressed += comp;
    if (flags & 1) return fail("encrypted-workbook");
    if (/encryptioninfo|encryptedpackage/i.test(name)) return fail("encrypted-workbook");
    files.push({ name, method, comp, uncomp, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (uncompressed > LIMITS.uncompressed || (compressed > 0 && uncompressed / compressed > LIMITS.ratio)) return fail("too-big", { limit: "uncompressed" });
  const out = {};
  for (const file of files) {
    if (file.uncomp === 0) { out[file.name] = new Uint8Array(); continue; }
    const local = file.local;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return fail("unsupported");
    const nameLen = u16(view, local + 26);
    const extraLen = u16(view, local + 28);
    const start = local + 30 + nameLen + extraLen;
    const slice = bytes.subarray(start, start + file.comp);
    if (file.method === 0) out[file.name] = slice;
    else if (file.method === 8) out[file.name] = await inflateRaw(slice);
    else return fail("unsupported");
    if (out[file.name].length > file.uncomp + 8 && out[file.name].length > LIMITS.uncompressed) return fail("too-big", { limit: "uncompressed" });
  }
  return { ok: true, files: out };
}

function decodeXml(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlText(xml) {
  return new TextDecoder().decode(xml);
}

function sharedStrings(xml) {
  const text = xmlText(xml).replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  const parts = text.split(/<(?:\w+:)?si\b/);
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const body = parts[i].split(/<\/(?:\w+:)?si>/)[0];
    const bits = [...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => decodeXml(m[1]));
    out.push(bits.join(""));
  }
  return out;
}

function dateStyleSet(xml) {
  if (!xml) return new Set();
  const text = xmlText(xml);
  const custom = new Map();
  for (const m of text.matchAll(/<(?:\w+:)?numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]+)"/g)) {
    const code = m[2].toLowerCase();
    if (/[yd]/.test(code) && !/^[#0.,]+$/.test(code)) custom.set(+m[1], true);
  }
  const builtin = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const xfs = [];
  const block = text.split(/<(?:\w+:)?cellXfs\b/)[1] || "";
  for (const m of block.matchAll(/<(?:\w+:)?xf\b[^>]*numFmtId="(\d+)"/g)) {
    const id = +m[1];
    xfs.push(builtin.has(id) || custom.get(id) === true);
  }
  return xfs;
}

function colRow(ref) {
  const m = String(ref || "").match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: +m[2] - 1 };
}

function parseSheet(xml, strings, dateStyles, date1904) {
  const text = xmlText(xml);
  const formulaBlanks = (text.match(/<(?:\w+:)?f\b/g) || []).length;
  let cached = 0;
  const rows = [];
  const rowRe = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rm;
  let formulaNoValue = 0;
  while ((rm = rowRe.exec(text))) {
    const rAttr = /r="(\d+)"/.exec(rm[1]);
    const rowIndex = rAttr ? +rAttr[1] - 1 : rows.length;
    const line = [];
    const cellRe = /<(?:\w+:)?c\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[2] || ""))) {
      const attrs = cm[1] || "";
      const inner = cm[2] || "";
      const ref = /r="([A-Z]+\d+)"/i.exec(attrs);
      const pos = ref ? colRow(ref[1]) : { col: line.length, row: rowIndex };
      if (!pos || pos.col > LIMITS.cols) continue;
      const type = (/t="([^"]+)"/.exec(attrs) || [])[1] || "n";
      const style = +((/s="(\d+)"/.exec(attrs) || [])[1] || 0);
      const hasF = /<(?:\w+:)?f\b/.test(inner);
      const v = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
      if (hasF && v) cached++;
      let value = "";
      if (hasF && !v) { formulaNoValue++; value = ""; }
      else if (type === "inlineStr") {
        value = [...inner.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => decodeXml(m[1])).join("");
      } else if (v) {
        const raw = decodeXml(v[1]);
        if (type === "s") value = strings[+raw] || "";
        else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
        else if (type === "str") value = raw;
        else if (dateStyles[style] && raw !== "") value = excelSerialToIso(raw, date1904);
        else value = raw;
      }
      line[pos.col] = value;
    }
    rows[rowIndex] = line.map(c => c == null ? "" : c);
    if (rows.filter(Boolean).length > LIMITS.rows + 25) return { tooBig: true, rows: [], formulaNoValue };
  }
  const merges = [...text.matchAll(/<(?:\w+:)?mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/gi)].map(m => [colRow(m[1]), colRow(m[2])]);
  return { rows: rows.map(r => r || []), formulaNoValue, merges, tooBig: false, cached };
}

function attrValue(tag, name) {
  const re = new RegExp(`(?:^|[\\s/>])(?:[\\w.]+:)?${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const match = re.exec(String(tag || ""));
  return match ? decodeXml(match[2]) : "";
}

function relPairs(xml) {
  const map = {};
  for (const tag of String(xml || "").matchAll(/<(?:[\w.]+:)?Relationship\b[^>]*>/g)) {
    const id = attrValue(tag[0], "Id");
    const target = attrValue(tag[0], "Target");
    if (id && target) map[id] = target;
  }
  return map;
}

function sheetPath(names, target) {
  if (!target) return "";
  let t = String(target).replace(/\\/g, "/");
  if (t.startsWith("/")) t = t.slice(1);
  else if (!/^xl\//i.test(t)) t = "xl/" + t.replace(/^\.\//, "");
  const parts = [];
  for (const part of t.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  const norm = parts.join("/");
  return (names || []).find(name => String(name).replace(/\\/g, "/") === norm) || "";
}

export async function readXlsx(bytes, opts = {}) {
  const zip = await readZip(bytes);
  if (!zip.ok) return zip;
  const names = Object.keys(zip.files);
  if (names.some(n => /mimetype$/i.test(n) && /opendocument|apple.numbers|iwork/i.test(xmlText(zip.files[n])))) return fail("unsupported");
  const wb = names.find(n => /xl\/workbook\.xml$/i.test(n));
  if (!wb) return fail("not-workbook");
  const wbText = xmlText(zip.files[wb]);
  if (/<encryption/i.test(wbText)) return fail("encrypted-workbook");
  const date1904 = /date1904="1"|date1904="true"/i.test(wbText);
  const sheets = [...wbText.matchAll(/<(?:[\w.]+:)?sheet\b[^>]*>/g)].map(m => {
    const tag = m[0];
    const hidden = /state\s*=\s*(["'])hidden\1|state\s*=\s*(["'])veryHidden\2/i.test(tag);
    return { name: attrValue(tag, "name"), id: attrValue(tag, "id"), hidden };
  }).filter(sheet => sheet.name);
  const relsName = names.find(n => /xl\/_rels\/workbook\.xml\.rels$/i.test(n));
  const rels = relsName ? xmlText(zip.files[relsName]) : "";
  const relMap = relPairs(rels);
  const ssName = names.find(n => /xl\/sharedStrings\.xml$/i.test(n));
  const strings = ssName ? sharedStrings(zip.files[ssName]) : [];
  const styleName = names.find(n => /xl\/styles\.xml$/i.test(n));
  const dateStyles = dateStyleSet(styleName ? zip.files[styleName] : null);
  const tables = [];
  const skipped = [];
  for (const sheet of sheets) {
    const path = sheetPath(names, relMap[sheet.id] || "");
    if (!path) { skipped.push(sheet.name); continue; }
    const parsed = parseSheet(zip.files[path], strings, dateStyles, date1904);
    if (parsed.tooBig) return fail("too-big", { limit: "rows" });
    const warnings = [];
    if (parsed.formulaNoValue) warnings.push(`${parsed.formulaNoValue} formula without a value`);
    const dataMerges = (parsed.merges || []).filter(pair => pair[0] && pair[1]);
    const built = buildTable(parsed.rows, {
      name: sheet.name,
      encoding: "xlsx",
      warnings,
      hidden: sheet.hidden,
      formulaBlanks: parsed.formulaNoValue,
      monthFirst: opts.monthFirst,
      remembered: opts.remembered,
    });
    if (!built.ok) {
      if (built.code === "empty") skipped.push(sheet.name);
      else if (built.code === "too-big") return built;
      continue;
    }
    if (dataMerges.length) built.warnings = [...built.warnings, "Merged cells in file"];
    tables.push(built);
  }
  if (!tables.length) return fail("empty", { skipped });
  return { ok: true, tables, skipped };
}

export async function readImportFile(bytes, opts = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const name = String(opts.name || "");
  const ext = extOf(name);
  if (u8.length > LIMITS.fileBytes) return fail("too-big", { limit: "file" });
  if (ext === "mab" || isSalted(u8)) return fail("encrypted-backup");
  if (ext === "xls" || ext === "numbers" || ext === "ods" || isOle(u8)) return fail("unsupported");
  if (ext === "xlsx" || ext === "xlsm") {
    if (!isZip(u8)) return fail("not-workbook");
    return readXlsx(u8, opts);
  }
  if (isZip(u8)) return readXlsx(u8, opts);
  const utf16 = (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) || (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF);
  if (!utf16 && looksBinary(u8)) return fail("binary");
  const decoded = decodeBytes(u8, opts.encoding);
  const trimmed = decoded.text.trim();
  if ((ext === "json" || trimmed.startsWith("{") || trimmed.startsWith("[")) && ext !== "csv" && ext !== "tsv") {
    const asJson = readJsonText(decoded.text);
    if (asJson) return asJson;
    if (ext === "json") return fail("unsupported");
  }
  return readCsvText(decoded.text, { ...opts, encoding: decoded.encoding });
}

const GearImport = {
  LIMITS, UNDO_MS, WRITE_BATCH, HIST_KEY, MAP_KEY, DEFAULT_CATEGORIES, FIELD_LABELS,
  nrm, maskSerial, serialAriaLabel, chunk, newUlid, normalizeHeader, priceKind, confidenceOf, confidenceLabel,
  findHeaderRow, detectSource, mapColumns, headerHash, parsePaid, excelSerialToIso, parseDate,
  columnDateOrder, normalizeCaliber, buildTable, planImport, countPlan, summaryLine,
  undoImportState, missingImportIds, changedAfterImport, escapeSaveReport, loadHistory, saveHistory, undoOpen, activeUndoEntry,
  typeColumnIsGun,
  importHistoryLabel, importHistoryCanUndo, loadMaps, rememberMap,
  decodeBytes, parseDelimited, readCsvText, readJsonText, readZip, readXlsx, readImportFile, looksBinary,
};
globalThis.GearImport = GearImport;
