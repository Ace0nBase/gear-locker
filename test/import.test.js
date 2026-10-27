import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deflateRawSync } from "node:zlib";
import { applyMarketPrices, settleDeal, importRestricted, importSkipsLookup, photoIdHardBlocked, photoIdSuggestion, saleRestricted, magShelfPending, csvCell } from "../js/logic.js";
import {
  readImportFile, readCsvText, planImport, undoImportState, changedAfterImport, mapColumns,
  normalizeHeader, maskSerial, parseDate, excelSerialToIso, columnDateOrder, headerHash,
  rememberMap, loadMaps, chunk, WRITE_BATCH, decodeBytes, nrm, summaryLine, normalizeCaliber, serialAriaLabel,
  escapeSaveReport,
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
    ["Ferrowind", "Ranger", "Rifle", "SAMPLE-0007", "5.56", "899.50", ""],
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
  const mag = plan.items.find(i => i.category === "Magazines & Belts");
  const trig = plan.items.find(i => i.category === "Triggers & Parts");
  const lower = plan.items.find(i => i.category === "Lower receiver");
  const rifle = plan.items.find(i => i.category === "Firearms");
  const can = plan.items.find(i => i.category === "Suppressors");
  assert.equal(saleRestricted(mag), true);
  assert.equal(saleRestricted(trig), true);
  assert.equal(saleRestricted(rifle), true);
  assert.equal(importSkipsLookup(mag), true);
  assert.equal(importSkipsLookup(trig), true);
  assert.equal(photoIdHardBlocked(mag), false);
  assert.equal(photoIdHardBlocked(trig), false);
  assert.equal(photoIdHardBlocked(lower), true);
  assert.equal(photoIdHardBlocked(rifle), true);
  assert.equal(photoIdHardBlocked(can), true);
  assert.equal(photoIdSuggestion("Magazines & Belts"), "");
  assert.equal(photoIdSuggestion("Triggers & Parts"), "");
  assert.equal(photoIdSuggestion("Firearms"), "");
  assert.equal(photoIdSuggestion("Suppressors"), "");
  assert.equal(photoIdSuggestion("Ammo Storage & Loaders"), "Ammo Storage & Loaders");
  for (const item of [mag, trig, lower, rifle, can]) {
    const priced = applyMarketPrices(item, {
      retailNew: 10, value: 9, usedLow: 1, sources: [{ url: "https://example.com/a", label: "store" }], priceNote: "on sale",
    }, "2026-10-27");
    assert.equal(priced.paidSource, "manual");
    assert.equal(priced.retailNew, undefined);
    assert.equal(priced.value, undefined);
    assert.equal(priced.marketSources, undefined);
    assert.equal(priced.priceNote, undefined);
    assert.equal(settleDeal(item, { price: 8, url: "https://example.com/a", where: "shop" }).price, null);
  }
  const shelf = planImport(readCsvText("Item,Type,Price\nSteel can,Ammo Storage & Loaders,18\n").tables, { importId: "01SHELF", now: "2026-10-27T00:00:00.000Z" });
  const stored = shelf.items[0];
  assert.equal(stored.category, "Ammo Storage & Loaders");
  assert.equal(saleRestricted(stored), false);
  assert.equal(importSkipsLookup(stored), false);
  assert.equal(stored.paid, 18);
  assert.equal(stored.paidSource, "manual");
  const storedPriced = applyMarketPrices(stored, { retailNew: 22, value: 20, sources: [{ url: "https://example.com/can", label: "store" }] }, "2026-10-27");
  assert.equal(storedPriced.paid, 18);
  assert.equal(storedPriced.paidSource, "manual");
  assert.equal(storedPriced.retailNew, 22);
  const ammoCsv = "Caliber,Manufacturer,Quantity,Lot Number,Purchase Price,Current Value\n9mm,Federal,1000,LOT1,280.00,310";
  const ammo = planImport(readCsvText(ammoCsv).tables, { now: "2026-10-27T00:00:00.000Z", importId: "01AMMO" });
  assert.equal(ammo.ammo.length, 1);
  assert.equal(ammo.ammo[0].paid, 280);
  assert.equal(ammo.ammo[0].paidSource, "manual");
  assert.equal(ammo.ammo[0].cpr, undefined);
  assert.equal(ammo.ammo[0].rounds, 1000);
  assert.equal(importRestricted(ammo.ammo[0]), true);
  const pouch = planImport(readCsvText("Item,Brand,Quantity,Price\nAdmin pouch,Crye,1,40.5").tables, { importId: "01GEAR", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(pouch.rows[0].target, "needs");
  assert.equal(pouch.items.length, 0);
  const placed = planImport(readCsvText("Item,Brand,Quantity,Price\nAdmin pouch,Crye,1,40.5").tables, {
    importId: "01GEAR", now: "2026-10-27T00:00:00.000Z", rowCategories: { 0: { 0: "Pouches" } },
  });
  assert.equal(placed.items[0].category, "Pouches");
  assert.equal(placed.items[0].paid, 40.5);
  assert.equal(placed.items[0].paidSource, "manual");
  const kept = applyMarketPrices(placed.items[0], { retailNew: 80, value: 70 }, "2026-10-27");
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
  const plan = planImport(readCsvText("Category,Item,Brand\nPouches,Pouch,Crye\nComms & Radios,Radio,Bao").tables, { importId: "01BATCH", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(plan.items.length, 2);
  assert.equal(chunk(plan.items, WRITE_BATCH).every(part => part.length <= 400), true);
  assert.equal(chunk(Array.from({ length: 801 }, (_, i) => i), 400).map(p => p.length).join(","), "400,400,1");
  const edited = { ...plan.items[0], updatedAt: "2026-10-28T00:00:00.000Z" };
  assert.equal(changedAfterImport([edited, plan.items[1]], "01BATCH").length, 1);
  const stamped = { ...plan.items[0], updatedAt: "2026-10-28T00:00:00.000Z", importBookkeeping: "2026-10-28T00:00:00.000Z" };
  assert.equal(changedAfterImport([stamped, plan.items[1]], "01BATCH").length, 0);
  const userEdit = { ...plan.items[0], updatedAt: "2026-10-28T00:00:00.000Z", importEdited: true, importBookkeeping: "2026-10-28T00:00:00.000Z" };
  assert.equal(changedAfterImport([userEdit], "01BATCH").length, 1);
  const undone = undoImportState(plan.items, [], "01BATCH", "2026-10-27T02:00:00.000Z");
  assert.equal(undone.items.every(i => i.deleted), true);
  assert.equal(undone.items.some(i => i.importId), false);
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
  assert.equal(open.tables[0].warnings[0], "Couldn't read from row 3. A quote was left open.");
  const stuck = readCsvText('Name,Notes\nBad,"no end');
  assert.equal(stuck.ok, false);
  assert.equal(stuck.code, "partial");
  assert.equal(stuck.message, "Couldn't read from row 2. A quote was left open.");
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
  const child = nested.rows.find(i => i.serial === "OPT-1");
  const parent = nested.items.find(i => i.serial === "SAMPLE-7");
  assert.equal(child.target, "needs");
  assert.equal(nested.items.some(i => i.serial === "OPT-1"), false);
  const linked = planImport(json.tables, {
    importId: "01J", now: "2026-10-27T00:00:00.000Z", rowCategories: { 0: { 1: "NVG & Optics" } },
  });
  const optic = linked.items.find(i => i.serial === "OPT-1");
  assert.equal(optic.mountedOn, linked.items.find(i => i.serial === "SAMPLE-7").id);
  assert.equal(parent.paid, 10);
  assert.equal(parent.paidSource, "manual");
  assert.equal((await readImportFile(new Uint8Array(200).fill(0), { name: "binary_renamed.csv" })).message, "This doesn't look like a spreadsheet.");
  const fakeBook = zipStore([{ name: "xl/not-a-workbook.xml", data: Buffer.from("<x/>") }]);
  const fake = await readImportFile(fakeBook, { name: "fake.xlsx" });
  assert.equal(fake.code, "not-workbook");
  assert.equal(fake.message, "This isn't a spreadsheet workbook.");
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

test("unknown types stay uncategorized and sheets follow relationship ids", async () => {
  const mixed = [
    "Manufacturer,Model,Type,Serial Number,Purchase Price",
    "Acme,Widget,Gadget,SN-1,12",
    "Acme,Ranger,Rifle,SN-2,100",
    "Acme,Dot,Red dot,SN-3,40",
    "Acme,Rifle,,SN-4,50",
  ].join("\n");
  const parsed = readCsvText(mixed);
  assert.equal(parsed.tables[0].defaultTarget, "needs");
  const plan = planImport(parsed.tables, { importId: "01MIX", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(plan.rows.find(r => r.serial === "SN-1").target, "needs");
  assert.equal(plan.rows.find(r => r.serial === "SN-4").target, "needs");
  assert.equal(plan.items.some(i => i.serial === "SN-1" || i.serial === "SN-4"), false);
  assert.equal(plan.items.filter(i => i.category === "Firearms").map(i => i.serial).join(","), "SN-2");
  const gun = plan.items.find(i => i.serial === "SN-2");
  assert.equal(gun.paid, 100);
  assert.equal(gun.paidSource, "manual");
  assert.equal(plan.items.find(i => i.serial === "SN-3").category, "NVG & Optics");
  const forced = planImport(readCsvText("Item,Serial Number\nWidget,SN-9\n").tables, { targets: { 0: "armory" }, importId: "01FORCE", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(forced.rows[0].target, "needs");
  assert.equal(forced.items.length, 0);
  const latin = new Uint8Array([
    ..."Type,Item,Caliber,Notes\nAmmo can,Range tin,9mm,Munici".split("").map(c => c.charCodeAt(0)),
    0xF3,
    ..."n\nAmmunition,Ammo can,9mm,ball\n".split("").map(c => c.charCodeAt(0)),
  ]);
  const latinRead = await readImportFile(latin, { name: "windows1252.csv" });
  assert.equal(latinRead.tables[0].encoding, "windows-1252");
  const routed = planImport(latinRead.tables, { importId: "01CAN", now: "2026-10-27T00:00:00.000Z" });
  const can = routed.rows.find(r => r.name === "Range tin");
  const named = routed.rows.find(r => r.name === "Ammo can");
  assert.equal(can.category, "Ammo Storage & Loaders");
  assert.equal(can.target, "gear");
  assert.equal(named.target, "ammo");
  assert.equal(normalizeCaliber(".30-30 Win").suggestion, "");
  assert.equal(normalizeCaliber(".30-30 Win").value, ".30-30 Win");
  assert.equal(normalizeCaliber("6.5 Creedmoor").value, "6.5 Creedmoor");
  assert.equal(normalizeCaliber("6.5 Creedmoor").suggestion, "");
  const calibers = planImport(readCsvText("Type,Caliber\nAmmunition,.30-30 Win\nAmmunition,6.5 Creedmoor\n").tables, { importId: "01CAL", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(JSON.stringify(calibers.rows).includes("Could be .308 Win"), false);
  assert.equal(calibers.ammo.find(a => a.caliber === "6.5 Creedmoor").caliber, "6.5 Creedmoor");
  assert.equal(serialAriaLabel("AB-0001", true), "ending 0001");
  const existing = [{ id: "g1", name: "=CMD", brand: "Crye", category: "Pouches", serial: "=SN1", updatedAt: "2026-01-01T00:00:00.000Z" }];
  const again = planImport(readCsvText('Category,Item,Brand/Model,Serial Number\nPouches,"\'=CMD",Crye,"\'=SN1"\n').tables, {
    items: existing, importId: "01RE", now: "2026-10-27T00:00:00.000Z",
  });
  assert.equal(again.rows[0].name, "=CMD");
  assert.equal(again.rows[0].serial, "=SN1");
  assert.equal(again.rows[0].skipped, true);
  assert.equal(again.items.length, 0);
  const made = planImport(readCsvText("Manufacturer,Model,Serial Number,Type\nTarnway,Ranger,SAMPLE-0007,Rifle\n").tables, { importId: "01A", now: "2026-10-27T00:00:00.000Z" });
  const created = made.items[0];
  const merged = planImport(readCsvText("Manufacturer,Model,Serial Number,Caliber,Type\nTarnway,Ranger,SAMPLE-0007,5.56,Rifle\n").tables, {
    items: [created], importId: "01B", now: "2026-10-27T01:00:00.000Z", rowDecisions: { 0: { 0: "merge" } },
  });
  assert.equal(merged.merges[0].patch.importId, "01A");
  const combined = { ...created, ...merged.merges[0].patch };
  const aFirst = undoImportState([combined], [], "01A", "2026-10-27T02:00:00.000Z");
  assert.equal(aFirst.items[0].deleted, true);
  const aThenB = undoImportState(aFirst.items, [], "01B", "2026-10-27T03:00:00.000Z");
  assert.equal(aThenB.items[0].deleted, true);
  assert.equal(aThenB.items.some(i => i.importId), false);
  const bFirst = undoImportState([{ ...created, ...merged.merges[0].patch }], [], "01B", "2026-10-27T02:00:00.000Z");
  assert.equal(bFirst.items[0].deleted, undefined);
  assert.equal(bFirst.items[0].importId, "01A");
  const bThenA = undoImportState(bFirst.items, [], "01A", "2026-10-27T03:00:00.000Z");
  assert.equal(bThenA.items[0].deleted, true);
  assert.equal(bThenA.items.some(i => i.importId), false);
  const wb = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Firearms" sheetId="1" r:id="rId1"/><sheet name="Ammunition" sheetId="2" r:id="rId2"/><sheet name="Notes" sheetId="3" r:id="rId3"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="worksheets/sheet1.xml" Id="rId1" Type="worksheet"/><Relationship Target="worksheets/sheet2.xml" Id="rId2" Type="worksheet"/><Relationship Target="worksheets/sheet3.xml" Id="rId3" Type="worksheet"/></Relationships>`;
  const book = zipStore([
    { name: "xl/workbook.xml", data: Buffer.from(wb) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(rels) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml([["SERIAL NUMBER", "TYPE OF FIREARM", "MANUFACTURER", "MODEL/NAME"], ["FIREARM-ROW", "Rifle", "Tarnway", "Ranger"]])) },
    { name: "xl/worksheets/sheet2.xml", data: Buffer.from(sheetXml([["CALIBER", "MANUFACTURER", "LOT NUMBER", "QUANTITY"], ["9mm", "Federal", "AMMO-ROW", "20"]])) },
    { name: "xl/worksheets/sheet3.xml", data: Buffer.from(sheetXml([["Notes", "Item"], ["NOTES-ROW", "Sticky"]])) },
  ]);
  const sheets = await readImportFile(book, { name: "guntrack_export.xlsx" });
  assert.equal(sheets.tables.map(t => t.name).join(","), "Firearms,Ammunition,Notes");
  assert.match(sheets.tables[0].grid[0].join(" "), /FIREARM-ROW/);
  assert.match(sheets.tables[1].grid[0].join(" "), /AMMO-ROW/);
  assert.equal(sheets.tables[1].grid[0].join(" ").includes("FIREARM-ROW"), false);
  assert.match(sheets.tables[2].grid[0].join(" "), /NOTES-ROW/);
  const core = fs.readFileSync(new URL("../js/core.js", import.meta.url), "utf8");
  assert.match(core, /ensureCategoryOption/);
  assert.match(core, /Magazines & Belts/);
  assert.match(core, /Triggers & Parts/);
  assert.match(core, /Lower receiver/);
  assert.match(core, /importEdited/);
  const social = fs.readFileSync(new URL("../js/social.js", import.meta.url), "utf8");
  assert.match(social, /importBookkeeping/);
  const ui = fs.readFileSync(new URL("../js/import-ui.js", import.meta.url), "utf8");
  assert.match(ui, /Needs a category/);
  assert.match(ui, /Set category for all that need one/);
  assert.match(ui, /cancelSave/);
  const css = fs.readFileSync(new URL("../css/import.css", import.meta.url), "utf8");
  assert.match(css, /#importSheet:not\(\[hidden\]\)/);
  assert.match(css, /\.importUndo \.btn\.ghost\{color:var\(--bg\)/);
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

function fixture(name) {
  return fs.readFileSync(new URL("./fixtures/scripts-pr10r/fx/" + name, import.meta.url));
}

test("type values map as whole firearm types and the fixture summary is 11 firearms", async () => {
  const ma = planImport((await readImportFile(fixture("types_myarmory.csv"), { name: "types_myarmory.csv" })).tables, { importId: "01MA", now: "2026-10-27T00:00:00.000Z" });
  const mac = planImport((await readImportFile(fixture("types_mac.csv"), { name: "types_mac.csv" })).tables, { importId: "01MAC", now: "2026-10-27T00:00:00.000Z" });
  const gt = planImport((await readImportFile(fixture("types_gt.xlsx"), { name: "types_gt.xlsx" })).tables, { importId: "01GT", now: "2026-10-27T00:00:00.000Z" });
  const plans = [ma, mac, gt];
  const armory = plans.flatMap(plan => plan.rows.filter(row => row.target === "armory" && !row.skipped));
  assert.deepEqual(armory.map(row => row.serial), ["FA-001", "FA-002", "FA-003", "FA-004", "FA-005", "FA-006", "FA-007", "FA-008", "FA-009", "FA-010", "FA-011"]);
  const counts = plans.reduce((acc, plan) => {
    acc.firearms += plan.counts.firearms;
    acc.gear += plan.counts.gear;
    acc.ammo += plan.counts.ammo;
    acc.skipped += plan.counts.skipped;
    return acc;
  }, { firearms: 0, gear: 0, ammo: 0, skipped: 0 });
  assert.equal(counts.firearms, 11);
  assert.match(summaryLine(counts), /^Import 11 firearms,/);
  const byType = row => plans.flatMap(plan => plan.rows).find(item => item.name.includes(row));
  assert.equal(byType("Glass").category, "NVG & Optics");
  assert.equal(byType("Glass").target, "gear");
  assert.equal(byType("Cabinet").category, "Cases & Bags");
  assert.equal(byType("Brush").category, "Cleaning & Maintenance");
  assert.equal(byType("Opener").target, "needs");
  assert.equal(byType("Panel").target, "needs");
  assert.equal(byType("Strap").category, "Holsters & Slings");
  assert.equal(byType("Rig").category, "Holsters & Slings");
  assert.equal(byType("Scout").category, "Lights & Lasers");
  assert.equal(byType("Target").target, "ammo");
  assert.equal(byType("Tool").target, "needs");
  assert.equal(byType("Box").category, "Cases & Bags");
  assert.equal(byType("Buck").target, "ammo");
  assert.equal(byType("PMAG").category, "Magazines & Belts");
  assert.equal(plans.flatMap(plan => plan.rows).some(row => row.target === "armory" && /scope|sling|holster|safe|cleaning|shell|opener|panel|light/i.test(row.name + row.category)), false);
});

test("a legacy Mags & Ammo Storage import waits for the shelf answer", () => {
  const plan = planImport(readCsvText("Item,Type,Price\nOld can,Mags & Ammo Storage,18\n").tables, { importId: "01SHELF", now: "2026-10-27T00:00:00.000Z" });
  const stored = plan.items[0];
  assert.equal(stored.category, "Ammo Storage & Loaders");
  assert.equal(stored.migratedFromMagShelf, true);
  assert.equal(magShelfPending(stored), true);
  assert.equal(saleRestricted(stored), false);
  assert.equal(stored.paid, 18);
  assert.equal(stored.paidSource, "manual");
  const priced = applyMarketPrices(stored, { retailNew: 30, value: 20, sources: [{ url: "https://example.com/can", label: "store" }], priceNote: "on sale" }, "2026-10-27");
  assert.equal(priced.retailNew, undefined);
  assert.equal(priced.marketSources, undefined);
  assert.equal(priced.priceNote, undefined);
  assert.equal(priced.paid, 18);
  const deal = settleDeal(stored, { price: 10, url: "https://example.com/can", where: "shop" });
  assert.equal(deal.price, null);
  assert.equal(deal.url, "");
});

test("escape during a save reports the rows already written", () => {
  assert.equal(escapeSaveReport(0, 1200), "Stopped. Nothing was saved.");
  assert.equal(escapeSaveReport(400, 1200), "Stopped. Rolled back 400 of 1200. Nothing was saved.");
  const ui = fs.readFileSync(new URL("../js/import-ui.js", import.meta.url), "utf8");
  const escapeAt = ui.indexOf("function onEscape");
  const askAt = ui.indexOf("askClose()", escapeAt);
  assert.ok(ui.slice(escapeAt, askAt).includes("S.saving"));
  assert.ok(ui.slice(escapeAt, askAt).includes("S.cancelSave = true"));
  assert.match(ui, /escapeSaveReport/);
});

test("set category for all reaches duplicates that have no type", () => {
  const csv = "Item,Brand,Serial Number,Type\nRanger,Tarnway,FA-001,Rifle\nRanger copy,Tarnway,FA-001,\nAdmin,Crye,,\n";
  const existing = [{ id: "pouch", name: "Admin", brand: "Crye", category: "Pouches", updatedAt: "2026-01-01T00:00:00.000Z" }];
  const plan = planImport(readCsvText(csv).tables, { items: existing, importId: "01NEED", now: "2026-10-27T00:00:00.000Z" });
  const untyped = plan.rows.filter(row => row.target === "needs");
  assert.equal(untyped.length, 2);
  assert.ok(untyped.every(row => row.duplicate));
  const placed = planImport(readCsvText(csv).tables, {
    items: existing, importId: "01NEED", now: "2026-10-27T00:00:00.000Z",
    rowCategories: { 0: { 1: "Pouches", 2: "Pouches" } },
  });
  assert.equal(placed.rows[1].category, "Pouches");
  assert.equal(placed.rows[1].skipped, true);
  assert.equal(placed.rows[2].category, "Pouches");
  const ui = fs.readFileSync(new URL("../js/import-ui.js", import.meta.url), "utf8");
  const bulk = ui.slice(ui.indexOf('act === "bulk-category"'), ui.indexOf('act === "bulk-category"') + 500);
  assert.equal(bulk.includes("row.skipped"), false);
});

test("a renamed binary file is refused when it contains a NUL or a binary signature", async () => {
  const text = enc("Type,Item\nRifle,Ranger\n");
  const nul = new Uint8Array(text.length);
  nul.set(text);
  nul[8] = 0;
  const sniffed = await readImportFile(nul, { name: "binary_renamed.csv" });
  assert.equal(sniffed.ok, false);
  assert.equal(sniffed.code, "binary");
  assert.equal(sniffed.message, "This doesn't look like a spreadsheet.");
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x61, 0x62, 0x63]);
  assert.equal((await readImportFile(png, { name: "binary_renamed.csv" })).code, "binary");
  const latin = new Uint8Array([..."Type,Notes\nAmmo can,".split("").map(c => c.charCodeAt(0)), 0xF3, ..."n\n".split("").map(c => c.charCodeAt(0))]);
  const kept = await readImportFile(latin, { name: "windows1252.csv" });
  assert.equal(kept.ok, true);
  assert.equal(kept.tables[0].encoding, "windows-1252");
});

test("an ammo can type lands on Ammo Storage & Loaders", () => {
  const plan = planImport(readCsvText("Item,Type\nRange tin,Ammo can\nLabeled,Ammo Storage & Loaders\n").tables, { importId: "01CAN", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(plan.items.every(item => item.category === "Ammo Storage & Loaders"), true);
  assert.equal(plan.items.every(item => item.target === "gear" || plan.rows.find(row => row.name.includes(item.name.split(" ").pop())).target === "gear"), true);
  assert.equal(plan.rows.every(row => row.category === "Ammo Storage & Loaders" && row.target === "gear"), true);
});

test("re-importing this app's export is a duplicate", () => {
  const saved = [
    { id: "gun", name: "Ranger", brand: "Tarnway", category: "Firearms", serial: "FA-001", paid: 100, paidSource: "manual", qty: 1, color: "", condition: "Good", location: "Safe", notes: "", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z" },
    { id: "pouch", name: "=CMD", brand: "Crye", category: "Pouches", paid: 40.5, paidSource: "manual", qty: 1, color: "", condition: "Good", location: "", notes: "", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z" },
  ];
  const headers = ["Category", "Qty", "Item", "Brand/Model", "Color", "Condition", "New retail", "Value each", "Paid each", "Weight (oz)", "Stored", "Notes", "Price source", "Price date"];
  const keys = ["category", "qty", "name", "brand", "color", "condition", "retailNew", "value", "paid", "weight", "location", "notes", "priceSource", "priceDate"];
  const line = item => keys.map(key => csvCell(item[key] ?? "")).join(",");
  const csv = [headers.map(csvCell).join(","), ...saved.map(line)].join("\r\n");
  const plan = planImport(readCsvText(csv).tables, { items: saved, importId: "01RE", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.rows.every(row => row.skipped), true);
  assert.equal(plan.items.length, 0);
  assert.equal(plan.rows.find(row => row.name === "=CMD").name, "=CMD");
});

test("workbook relationships may use single quotes or a namespace prefix", async () => {
  const sheet = sheetXml([["SERIAL NUMBER", "TYPE OF FIREARM", "MANUFACTURER", "MODEL/NAME"], ["FA-010", "Rifle", "Maker", "Long"]]);
  const book = `<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name='Guns' sheetId='1' r:id='rId9'/></x:sheets></x:workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns:ns="http://schemas.openxmlformats.org/package/2006/relationships"><ns:Relationship ns:Id='rId9' ns:Target='worksheets/sheet1.xml' ns:Type='worksheet'/></Relationships>`;
  const bytes = zipStore([
    { name: "xl/workbook.xml", data: Buffer.from(book) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(rels) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet) },
  ]);
  const parsed = await readImportFile(bytes, { name: "quoted-rels.xlsx" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tables[0].name, "Guns");
  assert.match(parsed.tables[0].grid[0].join(" "), /FA-010/);
  const plan = planImport(parsed.tables, { importId: "01REL", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(plan.items[0].category, "Firearms");
  assert.equal(plan.items[0].serial, "FA-010");
});

test("undo after a merge does not warn that the merge itself changed the item", () => {
  const made = planImport(readCsvText("Manufacturer,Model,Serial Number,Type\nTarnway,Ranger,FA-001,Rifle\n").tables, { importId: "01A", now: "2026-10-27T00:00:00.000Z" });
  const created = made.items[0];
  const merged = planImport(readCsvText("Manufacturer,Model,Serial Number,Caliber,Type\nTarnway,Ranger,FA-001,.308,Rifle\n").tables, {
    items: [created], importId: "01B", now: "2026-10-27T01:00:00.000Z", rowDecisions: { 0: { 0: "merge" } },
  });
  const combined = { ...created, ...merged.merges[0].patch };
  assert.equal(changedAfterImport([combined], "01B").length, 0);
  const edited = { ...combined, updatedAt: "2026-10-28T00:00:00.000Z", importEdited: true };
  assert.equal(changedAfterImport([edited], "01B").length, 1);
  const undone = undoImportState([combined], [], "01B", "2026-10-27T02:00:00.000Z");
  assert.equal(undone.items[0].caliber, undefined);
  assert.equal(changedAfterImport(undone.items, "01A").length, 0);
});
