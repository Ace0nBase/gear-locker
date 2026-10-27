import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deflateRawSync } from "node:zlib";
import { applyMarketPrices, settleDeal, importRestricted, importSkipsLookup } from "../js/logic.js";
import {
  readImportFile, readCsvText, planImport, undoImportState, changedAfterImport, mapColumns,
  normalizeHeader, maskSerial, parseDate, excelSerialToIso, columnDateOrder, headerHash,
  rememberMap, loadMaps, chunk, WRITE_BATCH, decodeBytes, nrm, summaryLine,
} from "../js/import-engine.js";

const enc = s => new TextEncoder().encode(s);

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.data);
    const method = file.method == null ? 0 : file.method;
    const comp = file.comp || data;
    const uncomp = file.uncomp == null ? data.length : file.uncomp;
    const flags = file.flags || 0;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(uncomp, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, comp);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(uncomp, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, centralBuf, end]));
}

function sheetXml(rows, extras = "") {
  const body = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const col = String.fromCharCode(65 + c);
      const ref = `${col}${r + 1}`;
      if (value && typeof value === "object") {
        const t = value.t ? ` t="${value.t}"` : "";
        const s = value.s != null ? ` s="${value.s}"` : "";
        const inner = value.f ? `<f>${value.f}</f>` : "";
        const v = value.v != null ? `<v>${value.v}</v>` : "";
        return `<c r="${ref}"${t}${s}>${inner}${v}</c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData>${extras}</worksheet>`;
}

function workbook(date1904) {
  return `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${date1904 ? ' date1904="1"' : ""}/><sheets><sheet name="Guns" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;

function xlsx(rows, opts = {}) {
  return zipStore([
    { name: "xl/workbook.xml", data: Buffer.from(workbook(opts.date1904)) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(RELS) },
    { name: "xl/styles.xml", data: Buffer.from(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml(rows, opts.extras || "")) },
  ]);
}

const memory = () => {
  const m = new Map();
  return {
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
};

test("header matching uses the header text only", () => {
  assert.equal(normalizeHeader("Serial #").key, "serial");
  assert.equal(normalizeHeader("S/N").key, "s n");
  assert.equal(normalizeHeader("Barrel (in)").key, "barrel");
  assert.equal(normalizeHeader("Barrel (in)").unit, "in");
  assert.equal(normalizeHeader("\uFEFFManufacturer").key, "manufacturer");
  const mapped = mapColumns(["Item", "Count", "Notes"]);
  assert.equal(mapped.columns.find(c => c.header === "Item").field === "serial", false);
  assert.equal(mapped.columns.find(c => c.header === "Notes").field, "notes");
  const serialish = mapColumns(["Notes"]);
  assert.equal(serialish.columns[0].field, "notes");
});

test("competitor headers map serial, make, model, caliber, and date as Sure", async () => {
  const csv = enc([
    "Manufacturer,Model,Type,Serial Number,Caliber,Purchase Date,Purchase Price,Current Value,Purchased From,Rounds Fired",
    "Tarnway Arms (example),Ranger,Rifle,SAMPLE-0007,5.56,6/1/2021,899.50,1200,Example Shop,40",
  ].join("\n"));
  const parsed = await readImportFile(csv, { name: "myarmory_firearms.csv" });
  assert.equal(parsed.ok, true);
  const table = parsed.tables[0];
  assert.equal(table.source, "myarmory");
  const field = id => table.columns.find(c => c.field === id);
  for (const id of ["brand", "model", "serial", "caliber", "acquired"]) {
    assert.equal(field(id).confidence, "hi", id);
    assert.ok(field(id).score >= 90, id);
  }
  const paid = table.columns.find(c => c.key === "purchase price");
  assert.equal(paid.field, "paid");
  assert.equal(paid.locked, false);
  const current = table.columns.find(c => c.key === "current value");
  assert.equal(current.locked, true);
  assert.equal(current.field, "ignore");
  const plan = planImport(parsed.tables, { now: "2026-10-27T12:00:00.000Z", importId: "01TESTULID000000000000" });
  const gun = plan.items[0];
  assert.equal(gun.category, "Firearms");
  assert.equal(gun.arm, "FA");
  assert.equal(gun.serial, "SAMPLE-0007");
  assert.equal(gun.paid, 899.5);
  assert.equal(gun.paidSource, "manual");
  assert.equal(gun.value, undefined);
  assert.equal(gun.retailNew, undefined);
  assert.equal(gun.cpr, undefined);
  assert.equal(gun.priceSource, undefined);
  assert.equal(JSON.stringify(gun).includes("1200"), false);
  assert.equal(gun.caliber, "5.56 NATO");
  assert.equal(gun.acquired, "2021-06-01");
  assert.equal(gun.baseRounds, 40);
  assert.equal(importRestricted(gun), true);
  assert.equal(importSkipsLookup(gun), true);
  const priced = applyMarketPrices(gun, {
    retailNew: 500, value: 400, usedLow: 10, sources: [{ url: "https://example.com/a", label: "store" }], priceNote: "on sale",
  }, "2026-10-27");
  assert.equal(priced.paid, 899.5);
  assert.equal(priced.paidSource, "manual");
  assert.equal(priced.retailNew, undefined);
  assert.equal(priced.value, undefined);
  assert.equal(priced.marketSources, undefined);
  assert.equal(settleDeal(gun, { price: 80, url: "https://example.com/a", where: "shop" }).price, null);
  assert.equal(settleDeal(gun, { price: 80, url: "https://example.com/a" }).restricted, true);
});

test("restricted shelves keep What I paid and drop market value columns", () => {
  const rows = [
    ["Manufacturer", "Model", "Type", "Serial Number", "Caliber", "Purchase Price", "Current Value"],
    ["Ferrowind", "Can", "Suppressor", "SAMPLE-1031", "9mm", "650", "900"],
    ["Ferrowind", "Box mag", "Magazine", "", "", "25.00", "40"],
    ["Ferrowind", "Flat", "Trigger", "", "", "89", "120"],
    ["Ferrowind", "Lower", "Lower receiver", "SAMPLE-2002", "5.56", "149.99", "300"],
  ];
  const parsed = readCsvText(rows.map(r => r.join(",")).join("\n"));
  const plan = planImport(parsed.tables, { now: "2026-10-27T00:00:00.000Z", importId: "01RESTRICTEDPAID00001" });
  const byName = Object.fromEntries(plan.items.map(i => [i.name, i]));
  for (const name of ["Ferrowind Can", "Box mag", "Flat", "Ferrowind Lower"]) {
    const item = byName[name] || plan.items.find(i => i.name.includes(name.split(" ").slice(-1)[0]));
    assert.ok(item, name);
    assert.equal(item.paidSource, "manual");
    assert.equal(item.value, undefined);
    assert.equal(item.retailNew, undefined);
    assert.equal(item.cpr, undefined);
    assert.equal(importRestricted(item), true);
    assert.equal(JSON.stringify(item).includes("900") || JSON.stringify(item).includes("300"), false);
  }
  assert.equal(byName["Ferrowind Can"].paid, 650);
  assert.equal(byName["Ferrowind Can"].category, "Suppressors");
  assert.equal(plan.items.find(i => i.armType === "Lower receiver" || i.category === "Lower receiver").paid, 149.99);
  const ammoCsv = "Caliber,Manufacturer,Quantity,Lot Number,Purchase Price,Current Value\n9mm,Federal,1000,LOT1,280.00,310";
  const ammo = planImport(readCsvText(ammoCsv).tables, { now: "2026-10-27T00:00:00.000Z", importId: "01AMMO" });
  assert.equal(ammo.ammo.length, 1);
  assert.equal(ammo.ammo[0].paid, 280);
  assert.equal(ammo.ammo[0].paidSource, "manual");
  assert.equal(ammo.ammo[0].cpr, undefined);
  assert.equal(ammo.ammo[0].rounds, 1000);
  assert.equal(importRestricted(ammo.ammo[0]), true);
  const pouch = planImport(readCsvText("Item,Brand,Quantity,Price\nAdmin pouch,Crye,1,40.5").tables, { importId: "01GEAR", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(pouch.items[0].category === "Firearms", false);
  assert.equal(pouch.items[0].paid, 40.5);
  assert.equal(pouch.items[0].paidSource, "manual");
  const kept = applyMarketPrices(pouch.items[0], { retailNew: 80, value: 70 }, "2026-10-27");
  assert.equal(kept.paid, 40.5);
  assert.equal(kept.paidSource, "manual");
});

test("duplicates default to skip and undo restores a merge", () => {
  const existing = [{ id: "have", name: "Ranger", brand: "Tarnway Arms (example)", serial: "SAMPLE-0007", caliber: "", notes: "original", updatedAt: "2026-01-01T00:00:00.000Z" }];
  const csv = "Manufacturer,Model,Serial Number,Caliber,Type\nTarnway Arms (example),Ranger,SAMPLE-0007,5.56,Rifle\nOther,Two,SAMPLE-0007,9mm,Pistol\n";
  const plan = planImport(readCsvText(csv).tables, { items: existing, now: "2026-10-27T00:00:00.000Z", importId: "01DUP" });
  assert.equal(plan.rows.filter(r => r.skipped).length, 2);
  assert.equal(plan.items.length, 0);
  const merged = planImport(readCsvText(csv).tables, {
    items: existing,
    now: "2026-10-27T00:00:00.000Z",
    importId: "01MERGE",
    rowDecisions: { 0: { 0: "merge", 1: "add" } },
  });
  assert.equal(merged.merges.length, 1);
  assert.equal(merged.merges[0].patch.caliber, "5.56 NATO");
  assert.equal(merged.merges[0].patch.importUndo.caliber, "");
  assert.equal(merged.items.length, 1);
  assert.ok(merged.items[0].tags.includes("possible duplicate"));
  const afterMerge = existing.map(row => row.id === "have" ? { ...row, ...merged.merges[0].patch } : row);
  const undone = undoImportState([...afterMerge, ...merged.items], [], "01MERGE", "2026-10-27T01:00:00.000Z");
  const restored = undone.items.find(i => i.id === "have");
  assert.equal(restored.caliber, undefined);
  assert.equal(restored.notes, "original");
  assert.equal(restored.importId, undefined);
  assert.equal(undone.items.find(i => i.id === merged.items[0].id).deleted, true);
  assert.equal(undone.items.some(i => i.importId === "01MERGE"), false);
});

test("undo removes a batch and reports later edits", () => {
  const plan = planImport(readCsvText("Item,Brand\nPouch,Crye\nRadio,Bao").tables, { importId: "01BATCH", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(plan.items.length, 2);
  assert.equal(chunk(plan.items, WRITE_BATCH).every(part => part.length <= 400), true);
  assert.equal(chunk(Array.from({ length: 801 }, (_, i) => i), 400).map(p => p.length).join(","), "400,400,1");
  const edited = { ...plan.items[0], updatedAt: "2026-10-28T00:00:00.000Z" };
  assert.equal(changedAfterImport([edited, plan.items[1]], "01BATCH").length, 1);
  const undone = undoImportState(plan.items, [], "01BATCH", "2026-10-27T02:00:00.000Z");
  assert.equal(undone.items.every(i => i.deleted), true);
});

test("accessories link to the parent serial", () => {
  const csv = [
    "Manufacturer,Model,Type,Serial Number,Mounted On",
    "Tarnway Arms (example),Ranger,Rifle,SAMPLE-0007,",
    "Optic Co,Dot,Red dot,SAMPLE-OPT,",
    "Light Co,Scout,Weapon light,,SAMPLE-0007",
  ].join("\n");
  const plan = planImport(readCsvText(csv).tables, { importId: "01MOUNT", now: "2026-10-27T00:00:00.000Z" });
  const gun = plan.items.find(i => i.serial === "SAMPLE-0007");
  const light = plan.items.find(i => i.name.includes("Scout"));
  const dot = plan.items.find(i => i.name.includes("Dot"));
  assert.equal(light.mountedOn, gun.id);
  assert.equal(dot.category, "NVG & Optics");
  assert.equal(dot.arm, "OP");
  assert.equal(dot.target || plan.rows.find(r => r.serial === "SAMPLE-OPT").target, "gear");
});

test("encodings, separators, quotes, and a header that is not on row 1", async () => {
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF, ...enc("Manufacturer,Serial Number\nTarnway,SAMPLE-1\n")]);
  const bomRead = await readImportFile(bom, { name: "bom.csv" });
  assert.equal(bomRead.tables[0].columns[0].key.startsWith("manufacturer"), true);
  assert.equal(bomRead.tables[0].columns[0].key.includes("\uFEFF"), false);
  const latin = new Uint8Array([..."Caliber,Notes\n".split("").map(c => c.charCodeAt(0)), 0x39, 0x6D, 0x6D, 0x2C, 0x4D, 0x75, 0x6E, 0x69, 0x63, 0x69, 0xF3, 0x6E, 0x0A]);
  const latinRead = await readImportFile(latin, { name: "ammo.csv" });
  assert.equal(latinRead.tables[0].encoding, "windows-1252");
  assert.equal(latinRead.tables[0].grid[0].join(" "), "9mm Munición");
  const utf16 = Buffer.from("\uFEFFManufacturer\tNotes\nTarnway\tétagère 日本語メモ\n", "utf16le");
  const u16 = await readImportFile(new Uint8Array(utf16), { name: "tab.tsv" });
  assert.equal(u16.tables[0].separator, "\t");
  assert.match(u16.tables[0].grid[0][1], /étagère 日本語メモ/);
  const pipe = await readImportFile(enc("Manufacturer|Model\nTarnway|Ranger\n"), { name: "generic_pipe.csv" });
  assert.equal(pipe.tables[0].separator, "|");
  const semi = await readImportFile(enc("sep=;\nCaliber;Brand\n9mm;Federal\n"), { name: "semi.csv" });
  assert.equal(semi.tables[0].separator, ";");
  assert.equal(semi.tables[0].grid[0][0], "9mm");
  const quoted = readCsvText('Name,Notes\n"Pouch","line1\nstill, one"\n');
  assert.equal(quoted.tables[0].grid[0][1], "line1\nstill, one");
  const open = readCsvText('Name,Notes\nGood,"ok"\nBad,"no end\n');
  assert.equal(open.tables[0].partial, 3);
  assert.equal(open.tables[0].grid.length, 1);
  const banner = readCsvText("My list\nExported on 2026-10-01\n\nManufacturer,Model,Serial Number\nTarnway,Ranger,SAMPLE-9\n");
  assert.equal(banner.tables[0].headerRow, 4);
  const dup = mapColumns(["Notes", "Notes"]);
  assert.equal(dup.columns.every(c => c.field === "notes"), true);
  assert.equal(columnDateOrder(["13/01/2020", "02/01/2020"], true), "dmy");
  assert.equal(parseDate("13/32/2019", true).flag, "bad-date");
  assert.equal(parseDate("2020", true).iso, "2020-01-01");
  assert.equal(excelSerialToIso(44348, false), "2021-06-01");
  assert.equal(excelSerialToIso(42886, true), "2021-06-01");
  assert.equal(maskSerial("SAMPLE-0007"), "••••0007");
  assert.equal(nrm("sample-0007"), "SAMPLE0007");
});

test("xlsx dates, formulas, guntrack headers, and refused files", async () => {
  const book = xlsx([
    ["Exported list"],
    ["Exported on"],
    [""],
    ["SERIAL NUMBER", "TYPE OF FIREARM", "CALIBER", "DATE PURCHASED", "PURCHASE PRICE", "MANUFACTURER", "MODEL/NAME", "CURRENT VALUE"],
    ["SAMPLE-0007", "Rifle", "5.56", { t: "n", s: 1, v: "44348" }, "899", "Tarnway Arms (example)", "Ranger", "1200"],
    ["", "", "", { f: "1+1" }, "", "", "", ""],
  ], { extras: `<mergeCells><mergeCell ref="A1:C1"/></mergeCells>` });
  const parsed = await readImportFile(book, { name: "guntrack_export.xlsx" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tables[0].source, "guntrack");
  assert.equal(parsed.tables[0].headerRow, 4);
  assert.match(parsed.tables[0].warnings.join(" "), /Merged cells/);
  const plan = planImport(parsed.tables, { importId: "01X", now: "2026-10-27T00:00:00.000Z" });
  const gun = plan.items.find(i => i.serial === "SAMPLE-0007");
  assert.equal(gun.acquired, "2021-06-01");
  assert.equal(gun.paid, 899);
  assert.equal(gun.paidSource, "manual");
  assert.equal(JSON.stringify(gun).includes("1200"), false);
  assert.equal(JSON.stringify(plan).includes("1+1"), false);
  const dated = xlsx([
    ["SERIAL NUMBER", "DATE PURCHASED", "MANUFACTURER", "MODEL/NAME", "TYPE OF FIREARM"],
    ["SAMPLE-1", { t: "n", s: 1, v: "42886" }, "Tarnway", "Ranger", "Rifle"],
  ], { date1904: true });
  const y1904 = await readImportFile(dated, { name: "generic_1904_dates.xlsx" });
  const plan1904 = planImport(y1904.tables, { importId: "01D", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(plan1904.items[0].acquired, "2021-06-01");
  const bomb = zipStore([{ name: "xl/workbook.xml", data: Buffer.from("<workbook/>"), uncomp: 50 * 1024 * 1024, comp: Buffer.from("x") }]);
  const refused = await readImportFile(bomb, { name: "zip_bomb_like.xlsx" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "too-big");
  assert.equal((await readImportFile(enc("Salted__secret"), { name: "backup.bin" })).code, "encrypted-backup");
  assert.equal((await readImportFile(enc("hello"), { name: "backup.mab" })).code, "encrypted-backup");
  assert.equal((await readImportFile(new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0]), { name: "old.xls" })).code, "unsupported");
  assert.equal((await readImportFile(new Uint8Array(200).fill(0), { name: "binary_renamed.csv" })).code, "binary");
  assert.equal((await readImportFile(enc(""), { name: "empty.csv" })).code, "empty");
  assert.equal((await readImportFile(enc("A,B\n"), { name: "header_only.csv" })).code, "empty");
  const json = await readImportFile(enc(JSON.stringify({
    firearms: [{ "MANUFACTURER": "Tarnway", "MODEL/NAME": "Ranger", "SERIAL NUMBER": "SAMPLE-7", "TYPE OF FIREARM": "Rifle", "PURCHASE PRICE": "10", accessories: [{ "MODEL/NAME": "Dot", "SERIAL NUMBER": "OPT-1" }] }],
  })), { name: "guntrack.json" });
  assert.equal(json.ok, true);
  assert.equal(json.tables[0].source, "guntrack");
  const nested = planImport(json.tables, { importId: "01J", now: "2026-10-27T00:00:00.000Z" });
  const child = nested.items.find(i => i.serial === "OPT-1");
  const parent = nested.items.find(i => i.serial === "SAMPLE-7");
  assert.equal(child.mountedOn, parent.id);
  assert.equal(parent.paid, 10);
  assert.equal(parent.paidSource, "manual");
});

test("remembered maps store header hashes only, and the summary counts skips", () => {
  const store = memory();
  const keys = ["manufacturer", "serial number"];
  rememberMap(store, keys, ["brand", "serial"]);
  const raw = store.getItem("gearLocker.importMaps");
  assert.equal(raw.includes("SAMPLE"), false);
  assert.equal(raw.includes(".csv"), false);
  assert.deepEqual(loadMaps(store)[headerHash(keys)], ["brand", "serial"]);
  const line = summaryLine({ firearms: 42, gear: 118, ammo: 9, skipped: 3 });
  assert.equal(line, "Import 42 firearms, 118 gear items, 9 ammo lots. 3 duplicates skipped.");
});

test("the importer source never calls the network", async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = url => { calls.push(String(url)); throw new Error("network"); };
  try {
    const parsed = await readImportFile(enc("Manufacturer,Model,Serial Number\nTarnway,Ranger,SAMPLE-0007\n"), { name: "guns.csv" });
    assert.equal(parsed.ok, true);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = orig;
  }
  const files = ["js/import-engine.js", "js/import-worker.js", "js/import-ui.js", "sw.js"];
  for (const file of files) {
    const src = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.equal(/\bfetch\s*\(/.test(src), false, file);
    assert.equal(/XMLHttpRequest|WebSocket|importScripts\(/.test(src), false, file);
    assert.equal(/https?:\/\//.test(src), false, file);
  }
  const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(sw, /blob:/);
  assert.match(sw, /data:/);
  assert.match(sw, /r\.method !== "GET"/);
  const ui = fs.readFileSync(new URL("../js/import-ui.js", import.meta.url), "utf8");
  const engine = fs.readFileSync(new URL("../js/import-engine.js", import.meta.url), "utf8");
  assert.match(ui, /Your file is read on this phone\. Nothing is uploaded until you save, and then only to your own account\./);
  assert.match(ui, /My Armory/);
  assert.match(ui, /myArmsCache/);
  assert.match(ui, /GUNTRACK/);
  assert.doesNotMatch(ui, /\bAndroid\b|\bDesktop\b|\bPC\b/);
  assert.doesNotMatch(engine, /\bAndroid\b|\bDesktop\b|\bPC\b/);
  assert.doesNotMatch(engine, /IMPORT_RESTRICTED_PAID/);
  for (const file of ["index.html", "js/core.js", "js/logic.js", "js/arms.js", "js/cloud.js", "js/security.js", "js/comms.js", "sw.js", "js/import-engine.js"]) {
    const src = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /My Armory|myArmsCache|GUNTRACK/, file);
  }
});
