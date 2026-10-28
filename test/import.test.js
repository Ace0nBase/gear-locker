import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deflateRawSync } from "node:zlib";
import { applyMarketPrices, settleDeal, importRestricted, importSkipsLookup, photoIdHardBlocked, photoIdSuggestion, saleRestricted, magShelfPending, csvCell } from "../js/logic.js";
import {
  readImportFile, readCsvText, planImport, undoImportState, changedAfterImport, mapColumns,
  normalizeHeader, maskSerial, parseDate, excelSerialToIso, columnDateOrder, headerHash,
  rememberMap, loadMaps, chunk, WRITE_BATCH, decodeBytes, nrm, summaryLine, normalizeCaliber, serialAriaLabel,
  escapeSaveReport, loadHistory, saveHistory, activeUndoEntry, importHistoryLabel, importHistoryCanUndo,
  missingImportIds, typeColumnIsGun,
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
  const mag = plan.items.find(i => i.category === "Magazines");
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
  assert.equal(photoIdSuggestion("Magazines"), "");
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
  assert.equal(byType("Glass").target, "needs");
  assert.equal(byType("Glass").category, "");
  assert.equal(byType("Cabinet").target, "needs");
  assert.equal(byType("Brush").category, "Cleaning & Maintenance");
  assert.equal(byType("Opener").target, "needs");
  assert.equal(byType("Panel").target, "needs");
  assert.equal(byType("Strap").category, "Holsters & Slings");
  assert.equal(byType("Rig").category, "Holsters & Slings");
  assert.equal(byType("Scout").target, "needs");
  assert.equal(byType("Target").target, "needs");
  assert.equal(byType("Tool").target, "needs");
  assert.equal(byType("Box").target, "needs");
  assert.equal(byType("Buck").target, "needs");
  assert.equal(byType("PMAG").category, "Magazines");
  assert.equal(byType("Tin").category, "Ammo Storage & Loaders");
  assert.equal(mac.rows.find(row => row.name.includes("Holster Co")).target, "needs");
  assert.equal(plans.flatMap(plan => plan.rows).some(row => row.target === "armory" && /scope|sling|holster|safe|cleaning|shell|opener|panel|light/i.test(row.name + row.category)), false);
});

test("belt and armor types use the renamed shelves, and old names migrate", () => {
  const csv = [
    "Item,Type,Price",
    "Inner,Belt,40",
    "Outer,Battle belt,80",
    "Rig,Chest rig,120",
    "Plate,Plate carrier,200",
    "Old mag,Magazines & Belts,14",
    "Old belt,Belts & Rigs,90",
    "Old can,Mags & Ammo Storage,18",
    "Linked,Linked ammo,30",
    "Belted,Belted ammo,30",
    "Mag,Magazine,12",
  ].join("\n");
  const plan = planImport(readCsvText(csv).tables, { importId: "01RENAME", now: "2026-10-27T00:00:00.000Z" });
  const row = name => plan.rows.find(item => item.name === name);
  const saved = name => plan.items.find(item => item.name === name);
  assert.equal(row("Inner").category, "Belts");
  assert.equal(row("Inner").target, "gear");
  assert.equal(saved("Inner").importPricedAllowlist, true);
  assert.equal(saleRestricted(saved("Inner")), false);
  assert.equal(row("Outer").category, "Belts");
  assert.equal(saved("Outer").importPricedAllowlist, true);
  assert.equal(row("Rig").category, "Armor & Carriers");
  assert.equal(row("Plate").category, "Armor & Carriers");
  assert.equal(saved("Rig").importPricedAllowlist, true);
  assert.equal(saved("Plate").importPricedAllowlist, true);
  assert.equal(row("Old mag").target, "needs");
  assert.equal(row("Old mag").category, "");
  assert.equal(saved("Old mag"), undefined);
  assert.equal(row("Old belt").target, "needs");
  assert.equal(row("Old belt").category, "");
  assert.equal(saved("Old belt"), undefined);
  assert.equal(row("Old can").category, "Ammo Storage & Loaders");
  assert.equal(saved("Old can").migratedFromMagShelf, true);
  assert.equal(row("Mag").category, "Magazines");
  assert.equal(saleRestricted(saved("Mag")), true);
  assert.equal(saved("Mag").importPricedAllowlist, undefined);
  assert.equal(row("Linked").target, "needs");
  assert.equal(row("Linked").category, "");
  assert.equal(row("Belted").target, "needs");
  assert.equal(row("Belted").category, "");
  assert.equal(plan.rows.some(item => /belted|linked/i.test(item.category || "")), false);
});

test("an old combined shelf waits for a category and does not read the item name", () => {
  const csv = [
    "Item,Type,Price",
    "PMAG 30,Magazines & Belts,14",
    "Blue Alpha battle belt,Magazines & Belts,80",
    "Triple mag pouch,Magazines & Belts,24",
    "Spiritus chest rig,Belts & Rigs,180",
    "AWS belt,Belts & Rigs,90",
    "Duty,Duty belt,70",
    "Rigger,Rigger belt,60",
    "Apostrophe,Rigger's belt,55",
    "Box,Magazine,12",
  ].join("\n");
  const plan = planImport(readCsvText(csv).tables, { importId: "01OLDSHELF", now: "2026-10-27T00:00:00.000Z" });
  const row = name => plan.rows.find(item => item.name === name);
  for (const name of ["PMAG 30", "Blue Alpha battle belt", "Triple mag pouch", "Spiritus chest rig", "AWS belt"]) {
    assert.equal(row(name).target, "needs", name);
    assert.equal(row(name).category, "", name);
    assert.equal(plan.items.some(item => item.name === name), false, name);
  }
  assert.equal(plan.items.some(item => item.category === "Magazines" && /belt|pouch|rig/i.test(item.name)), false);
  assert.equal(row("Duty").category, "Belts");
  assert.equal(row("Rigger").category, "Belts");
  assert.equal(row("Apostrophe").category, "Belts");
  assert.equal(row("Box").category, "Magazines");
  assert.equal(saleRestricted(plan.items.find(item => item.name === "Box")), true);
});

test("an import note uses the local date", () => {
  const iso = "2026-10-27T03:30:00.000Z";
  const d = new Date(iso);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const pouch = { id: "p1", name: "Chest Pouch (example)", brand: "Ferrowind", category: "Pouches", serial: "SAMPLE-5001" };
  const csv = "Brand,Item,Type,Serial Number,Notes\nFerrowind,Chest Pouch (example),Pouches,SAMPLE-5001,From the old list\n";
  const plan = planImport(readCsvText(csv).tables, {
    items: [pouch], importId: "01NOTE", now: iso, rowDecisions: { 0: { 0: "merge" } },
  });
  assert.equal(plan.merges.length, 1);
  assert.match(plan.merges[0].patch.notes, new RegExp(`Imported ${local}:`));
  assert.match(plan.merges[0].patch.notes, /From the old list/);
  const engine = fs.readFileSync(new URL("../js/import-engine.js", import.meta.url), "utf8");
  assert.equal(engine.includes("now.slice(0, 10)"), false);
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
  const savingEscape = ui.slice(escapeAt, askAt);
  assert.ok(savingEscape.indexOf("S.cancelSave = true") < savingEscape.indexOf("paint()"));
  assert.match(ui, /rollbackBusy \|\| S\.cancelSave \? "Stopping…"/);
  const stopSave = ui.slice(ui.indexOf("async function undoImport"), ui.indexOf("async function undoImport") + 280);
  assert.ok(stopSave.indexOf("S.cancelSave = true") < stopSave.indexOf("paint()"));
  assert.match(ui.slice(ui.indexOf("function summaryView"), ui.indexOf("function doneView")), /text: "Stop"/);
  assert.match(ui, /escapeSaveReport/);
  const reportAt = ui.indexOf("const report = escapeSaveReport");
  const cancel = ui.slice(reportAt, ui.indexOf("S.tables.forEach", reportAt));
  assert.match(cancel, /S\.saving = false/);
  assert.ok(cancel.indexOf("undoImportState") !== -1 && cancel.indexOf("undoImportState") < cancel.indexOf("paint()"));
  assert.ok(cancel.indexOf("paint()") < cancel.indexOf("toast(report)"));
  const claimAt = cancel.lastIndexOf("toast(report)");
  assert.ok(cancel.indexOf('status: "rollback"') !== -1 && cancel.indexOf('status: "rollback"') < claimAt);
  assert.ok(cancel.indexOf("mirror()") !== -1 && cancel.indexOf("mirror()") < claimAt);
  assert.ok(claimAt < cancel.indexOf("rollbackWork"));
  assert.match(cancel, /S\.importId = ""/);
  assert.match(cancel, /rollbackBusy = true/);
  assert.doesNotMatch(cancel, /__warboxFlushCloud/);
  assert.match(ui, /!S\.saving && !rollbackBusy/);
  const csv = "Manufacturer,Model,Serial Number,Type\nTarnway,Ranger,FA-1,Rifle\nTarnway,Spare,FA-2,Rifle\n";
  const fresh = planImport(readCsvText(csv).tables, { importId: "01ESC", now: "2026-10-27T00:00:00.000Z" });
  const rolled = undoImportState(fresh.items, [], "01ESC", "2026-10-27T01:00:00.000Z");
  const again = planImport(readCsvText(csv).tables, { items: rolled.items, importId: "01NEXT", now: "2026-10-27T02:00:00.000Z" });
  assert.equal(again.counts.firearms, fresh.counts.firearms);
  assert.equal(again.counts.total, fresh.counts.total);
  assert.equal(again.counts.skipped, 0);
});

test("a new import after a rollback does not reuse batch or item ids", () => {
  const lines = ["Brand,Item,Type,Serial Number"];
  for (let i = 0; i < 5; i++) lines.push(`Ferrowind,Pouch ${i},Pouches,SN-${i}`);
  const tables = readCsvText(lines.join("\n")).tables;
  const first = planImport(tables, { importId: "01BATCHOLD111", now: "2026-10-27T00:00:00.000Z" });
  const undone = undoImportState(first.items, [], first.importId, "2026-10-27T00:01:00.000Z");
  assert.ok(undone.items.every(row => row.deleted));
  const oldIds = new Set(first.items.map(row => row.id));
  const second = planImport(tables, { importId: "01BATCHNEW222", items: undone.items, now: "2026-10-27T00:02:00.000Z" });
  assert.notEqual(second.importId, first.importId);
  assert.equal(second.items.length, first.items.length);
  assert.ok(second.items.every(row => !oldIds.has(row.id)));
  const combined = [...undone.items, ...second.items];
  assert.equal(combined.filter(row => !row.deleted).length, second.items.length);
  assert.deepEqual(missingImportIds(combined, second.importId, second.items.map(row => row.id)), []);
  const reused = planImport(tables, { importId: first.importId, items: undone.items, now: "2026-10-27T00:03:00.000Z" });
  assert.ok(reused.items.every(row => !oldIds.has(row.id)));
  const collided = [...undone.items];
  reused.items.forEach(row => collided.push(row));
  assert.equal(collided.filter(row => !row.deleted).length, reused.items.length);
  assert.deepEqual(missingImportIds(collided, first.importId, reused.items.map(row => row.id)), []);
});

test("a gun type in the type column asks before a priced bulk category", () => {
  assert.equal(typeColumnIsGun("Rifle"), true);
  assert.equal(typeColumnIsGun("Rifle w/ scope"), true);
  assert.equal(typeColumnIsGun("Suppressor"), true);
  assert.equal(typeColumnIsGun("Lower receiver"), true);
  assert.equal(typeColumnIsGun("Pouches"), false);
  assert.equal(typeColumnIsGun("Red dot"), false);
  assert.equal(typeColumnIsGun("AR-15"), false);
  assert.equal(typeColumnIsGun(""), false);
  for (const gear of ["Rifle case", "Pistol holster", "Gun safe", "Rifle sling", "Rifle scope", "Upper receiver", "Lower parts kit"]) {
    assert.equal(typeColumnIsGun(gear), false, gear);
  }
  const needs = planImport(readCsvText("Item,Type\nGlass,Rifle w/ scope\nDot,Red dot\n").tables, {
    importId: "01GUNTYPE", now: "2026-10-27T00:00:00.000Z",
  });
  const glass = needs.rows.find(row => row.name === "Glass");
  assert.equal(glass.target, "needs");
  assert.equal(glass.sourceType, "Rifle w/ scope");
  assert.equal(typeColumnIsGun(glass.sourceType), true);
  assert.equal(typeColumnIsGun(needs.rows.find(row => row.name === "Dot").sourceType), false);
  const ui = fs.readFileSync(new URL("../js/import-ui.js", import.meta.url), "utf8");
  const bulk = ui.slice(ui.indexOf('act === "bulk-category"'), ui.indexOf('act === "bulk-category"') + 900);
  assert.match(bulk, /typeColumnIsGun\(row\.sourceType\)/);
  assert.match(bulk, /window\.confirm/);
  assert.match(bulk, /saleRestricted\(\{ category: value \}\)/);
  assert.equal(bulk.includes("row.name"), false);
  assert.match(ui, /missingImportIds/);
  const saveFn = ui.slice(ui.indexOf("async function saveImport"), ui.indexOf("async function undoImport"));
  const partialAt = saveFn.indexOf("are saved.");
  const importedAt = saveFn.indexOf("} imported");
  assert.match(saveFn, /\$\{live\} of \$\{expected\.length\} are saved\./);
  assert.ok(partialAt !== -1 && importedAt !== -1 && partialAt < importedAt);
  assert.ok(saveFn.indexOf("return;", partialAt) < importedAt);
});

test("a stopped import stays on that batch until the rollback is stored", () => {
  const store = memory();
  const now = Date.parse("2026-10-27T01:00:05.000Z");
  saveHistory(store, { id: "01OLD", at: "2026-10-27T00:00:00.000Z", counts: { total: 10 }, status: "saved" });
  saveHistory(store, {
    id: "01NEW", at: "2026-10-27T01:00:00.000Z", counts: { total: 1200 },
    status: "rollback", rollback: true, undone: false, progress: { done: 400, total: 1200 },
  });
  const pending = activeUndoEntry(loadHistory(store), now);
  assert.equal(pending.id, "01NEW");
  assert.equal(pending.rollback, true);
  assert.equal(importHistoryLabel(pending), "Incomplete. Undo or finish");
  assert.equal(importHistoryCanUndo(pending), true);
  const stored = loadHistory(store).find(row => row.id === "01NEW");
  assert.equal(stored.status, "rollback");
  assert.equal(stored.undone, false);
  saveHistory(store, { id: "01NEW", at: "2026-10-27T01:00:00.000Z", counts: { total: 1200 }, status: "undone", undone: true, rollback: false });
  const after = activeUndoEntry(loadHistory(store), now);
  assert.equal(after.id, "01OLD");
  assert.equal(importHistoryLabel(loadHistory(store).find(row => row.id === "01NEW")), "Undone");
  assert.equal(importHistoryCanUndo(loadHistory(store).find(row => row.id === "01NEW")), false);
  const ui = fs.readFileSync(new URL("../js/import-ui.js", import.meta.url), "utf8");
  assert.match(ui, /activeUndoEntry\(/);
  assert.match(ui, /Stopping…/);
  assert.match(ui, /liveImportRows\(row\.id\)\.length === 0/);
  assert.match(ui, /resumePendingRollbacks/);
  assert.match(ui, /__warboxFlushCloud/);
  const sec = fs.readFileSync(new URL("../js/security.js", import.meta.url), "utf8");
  assert.match(sec, /GearImport\.importHistoryLabel/);
  assert.match(sec, /GearImport\.importHistoryCanUndo/);
  const cloud = fs.readFileSync(new URL("../js/cloud.js", import.meta.url), "utf8");
  assert.match(cloud, /__warboxCloudSeen=true/);
  assert.match(cloud, /__warboxFlushCloud=flushCloudWrites/);
});

test("a merge keeps pricing on existing priced gear", () => {
  const pouch = {
    id: "pouch1",
    name: "Chest Pouch (example)",
    brand: "Ferrowind",
    category: "Pouches",
    serial: "SAMPLE-5001",
    value: 40,
    priceSource: "market",
    marketSources: [{ url: "https://example.com/pouch", label: "Example" }],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const csv = "Brand,Item,Type,Serial Number,Purchase Price\nFerrowind,Chest Pouch (example),Pouches,SAMPLE-5001,39.50\n";
  const plan = planImport(readCsvText(csv).tables, {
    items: [pouch], importId: "01MERGEPOUCH", now: "2026-10-27T00:00:00.000Z",
    rowDecisions: { 0: { 0: "merge" } },
  });
  assert.equal(plan.merges.length, 1);
  assert.equal(plan.merges[0].patch.category, undefined);
  const merged = { ...pouch, ...plan.merges[0].patch };
  assert.equal(merged.category, "Pouches");
  assert.equal(merged.paid, 39.5);
  assert.equal(merged.paidSource, "manual");
  assert.equal(merged.value, 40);
  assert.equal(merged.priceSource, "market");
  assert.equal(merged.marketSources[0].url, "https://example.com/pouch");
  assert.equal(merged.importPricedAllowlist, true);
  assert.equal(importRestricted(merged), false);
  assert.equal(importSkipsLookup(merged), false);
  const looked = applyMarketPrices(merged, {
    value: 42,
    sources: [{ url: "https://example.com/pouch", label: "Example" }],
  }, "2026-10-27");
  assert.equal(looked.paid, 39.5);
  assert.equal(looked.paidSource, "manual");
  assert.equal(looked.marketSources[0].url, "https://example.com/pouch");
  const deal = settleDeal(merged, { price: 35, url: "https://example.com/deal", where: "shop" });
  assert.equal(deal.price, 35);
  assert.equal(deal.url, "https://example.com/deal");
  const undone = undoImportState([merged], [], "01MERGEPOUCH", "2026-10-27T01:00:00.000Z");
  const back = undone.items[0];
  assert.equal(back.category, "Pouches");
  assert.equal(back.value, 40);
  assert.equal(back.marketSources[0].url, "https://example.com/pouch");
  assert.equal(back.paid, undefined);
  assert.equal(back.importPricedAllowlist, undefined);
  assert.equal(back.importId, undefined);
  assert.equal(importSkipsLookup(back), false);

  const rifleCsv = "Brand,Item,Type,Serial Number,Purchase Price\nFerrowind,Chest Pouch (example),Rifle,SAMPLE-5001,39.50\n";
  const riflePlan = planImport(readCsvText(rifleCsv).tables, {
    items: [pouch], importId: "01MERGERIFLE", now: "2026-10-27T04:00:00.000Z",
    rowDecisions: { 0: { 0: "merge" } },
  });
  assert.equal(riflePlan.merges.length, 1);
  const riflePatch = riflePlan.merges[0].patch;
  assert.equal(riflePatch.arm, undefined);
  assert.equal(riflePatch.armType, undefined);
  assert.equal(riflePatch.kind, undefined);
  assert.equal(riflePatch.tab, undefined);
  assert.equal(riflePatch.category, undefined);
  const rifleMerged = { ...pouch, ...riflePatch };
  assert.equal(rifleMerged.category, "Pouches");
  assert.equal(rifleMerged.arm || "", "");
  assert.equal(rifleMerged.paid, 39.5);
  assert.equal(rifleMerged.paidSource, "manual");
  assert.equal(rifleMerged.value, 40);
  assert.equal(rifleMerged.marketSources[0].url, "https://example.com/pouch");
  assert.equal(saleRestricted({ category: rifleMerged.category }), false);
  assert.equal(importRestricted(rifleMerged), false);
  assert.equal(importSkipsLookup(rifleMerged), false);
  const rifleDeal = settleDeal(rifleMerged, { price: 35, url: "https://example.com/deal", where: "shop" });
  assert.equal(rifleDeal.price, 35);
  assert.equal(rifleDeal.url, "https://example.com/deal");

  const held = { ...pouch, id: "held", importId: "01OLD", importIds: ["01OLD"] };
  const heldPlan = planImport(readCsvText(csv).tables, {
    items: [held], importId: "01NEWER", now: "2026-10-27T02:00:00.000Z",
    rowDecisions: { 0: { 0: "merge" } },
  });
  const heldMerged = { ...held, ...heldPlan.merges[0].patch };
  assert.equal(heldMerged.category, "Pouches");
  assert.equal(heldMerged.paid, 39.5);
  assert.equal(heldMerged.importPricedAllowlist, undefined);
  assert.equal(importRestricted(heldMerged), true);
  assert.equal(importSkipsLookup(heldMerged), true);

  const restricted = [
    { category: "Firearms", arm: "FA", type: "Rifle", serial: "FA-9" },
    { category: "Suppressors", arm: "SU", type: "Suppressor", serial: "SU-9" },
    { category: "Lower receiver", arm: "FA", type: "Lower receiver", serial: "LR-9" },
    { category: "Magazines & Belts", arm: "", type: "Magazine", serial: "MAG-9" },
    { category: "Ammunition", arm: "", kind: "ammo", type: "Misc", serial: "AM-9" },
  ];
  restricted.forEach(spec => {
    const current = {
      id: "r-" + spec.serial, name: "Restricted", brand: "Ferrowind", category: spec.category,
      arm: spec.arm, kind: spec.kind || "", serial: spec.serial, value: 80,
      marketSources: [{ url: "https://example.com/no", label: "no" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const row = `Brand,Item,Type,Serial Number,Purchase Price\nFerrowind,Restricted,${spec.type},${spec.serial},12.00\n`;
    const next = planImport(readCsvText(row).tables, {
      items: [current], importId: "01RESTRICT", now: "2026-10-27T03:00:00.000Z",
      rowDecisions: { 0: { 0: "merge" } },
    });
    assert.equal(next.merges.length, 1, spec.category);
    const item = { ...current, ...next.merges[0].patch };
    assert.equal(item.category, spec.category, spec.category);
    assert.equal(item.paid, 12, spec.category);
    assert.equal(item.importPricedAllowlist, undefined, spec.category);
    assert.equal(importRestricted(item), true, spec.category);
    assert.equal(importSkipsLookup(item), true, spec.category);
    assert.equal(settleDeal(item, { price: 9, url: "https://example.com/no", where: "shop" }).price, null, spec.category);
    const priced = applyMarketPrices(item, { value: 90, sources: [{ url: "https://example.com/no", label: "no" }] }, "2026-10-27");
    assert.equal(priced.marketSources, undefined, spec.category);
    assert.equal(priced.paid, 12, spec.category);
  });
});

test("the preview can show every row that needs a category", () => {
  const ui = fs.readFileSync(new URL("../js/import-ui.js", import.meta.url), "utf8");
  const preview = ui.slice(ui.indexOf("function previewView"), ui.indexOf("function previewCard"));
  assert.match(preview, /Show all \$\{needsTotal\} rows that need a category/);
  assert.match(preview, /S\.showAllNeeds && S\.filter === "needs"/);
  assert.match(preview, /showEveryNeeds \? rows : rows\.slice/);
  const click = ui.slice(ui.indexOf('act === "all-needs"'), ui.indexOf('act === "all-needs"') + 200);
  assert.match(click, /S\.showAllNeeds = true/);
  assert.match(click, /S\.filter = "needs"/);
  assert.match(click, /S\.previewFrom = 0/);
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

test("a firearm plus an accessory needs a category and is not priced", () => {
  const types = [
    "Rifle w/ scope",
    "Pistol with light",
    "Shotgun w/ sling",
    "Gun w/ red dot",
    "Pistol + holster",
    "Rifle w/ bipod",
    "Rifle & case",
    "RIFLE W/ SCOPE",
    "pistol WITH light",
    "Shotgun w/sling",
    "GUN W/ RED DOT",
    "Pistol+holster",
    "rifle w/ bipod",
    "Rifle and case",
    "rifle & case",
    "AR-15 w/ optic",
    "AK-47 w/ scope",
    "M4 w/ red dot",
    "Glock 19 w/ light",
    "1911 w/ holster",
    "12 ga w/ sling",
    "Sidearm w/ light",
    "Musket w/ sling",
    "Derringer w/ holster",
    "Weapon w/ light",
    "AR-15/optic",
    "AR-15, optic",
    "Glock 19 with light",
    "1911 + holster",
    "AK-47 & scope",
    "M4 and red dot",
  ];
  const csv = ["Item,Type,Purchase Price", ...types.map((type, i) => `Piece ${i},${csvCell(type)},25`)].join("\n");
  const plan = planImport(readCsvText(csv).tables, { importId: "01N1", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.ammo.length, 0);
  assert.equal(plan.rows.length, types.length);
  plan.rows.forEach((row, i) => {
    assert.equal(row.target, "needs", types[i]);
    assert.equal(row.needsCategory, true, types[i]);
    assert.equal(row.category, "", types[i]);
  });
  for (const type of types) {
    const held = { importId: "01N1", category: "NVG & Optics", armType: type, paid: 25, paidSource: "manual" };
    assert.equal(importRestricted(held), true, type);
    assert.equal(importSkipsLookup(held), true, type);
    const priced = applyMarketPrices(held, {
      retailNew: 80, value: 70, usedLow: 10, sources: [{ url: "https://shop.example/a", label: "store" }], priceNote: "on sale",
    }, "2026-10-27");
    assert.equal(priced.retailNew, undefined, type);
    assert.equal(priced.value, undefined, type);
    assert.equal(priced.marketSources, undefined, type);
    assert.equal(priced.priceNote, undefined, type);
    assert.equal(priced.paid, 25, type);
    assert.equal(priced.paidSource, "manual", type);
    const deal = settleDeal(held, { price: 40, url: "https://shop.example/a", where: "shop" });
    assert.equal(deal.price, null, type);
    assert.equal(deal.url, "", type);
    assert.equal(deal.restricted, true, type);
  }
  const picked = planImport(readCsvText("Item,Type,Purchase Price\nGlass,Rifle w/ scope,25\n").tables, {
    importId: "01N1P", now: "2026-10-27T00:00:00.000Z", rowCategories: { 0: { 0: "Pouches" } },
  });
  assert.equal(picked.items.length, 1);
  assert.equal(picked.items[0].category, "Pouches");
  assert.equal(picked.items[0].importCategoryPicked, true);
  assert.equal(importRestricted(picked.items[0]), false);
  assert.equal(importSkipsLookup(picked.items[0]), false);
  const open = applyMarketPrices(picked.items[0], { retailNew: 80, value: 70, sources: [{ url: "https://shop.example/a", label: "store" }] }, "2026-10-27");
  assert.equal(open.retailNew, 80);
  assert.equal(open.paid, 25);
  assert.equal(open.paidSource, "manual");
  const plain = planImport(readCsvText("Item,Type,Serial Number,Purchase Price\nRanger,Rifle,FA-1,100\nDot,Red dot,,40\nStrap,Sling,,15\nKit,Cleaning kit,,20\nPanel,Lower leg panel,,30\n").tables, {
    importId: "01N1B", now: "2026-10-27T00:00:00.000Z",
  });
  const rifle = plain.items.find(item => item.serial === "FA-1");
  assert.equal(rifle.category, "Firearms");
  assert.equal(rifle.importPricedAllowlist, undefined);
  assert.equal(importRestricted(rifle), true);
  assert.equal(importSkipsLookup(rifle), true);
  const dot = plain.rows.find(row => row.name === "Dot");
  assert.equal(dot.category, "NVG & Optics");
  assert.equal(plain.items.find(item => item.name === "Dot").importPricedAllowlist, true);
  assert.equal(importRestricted(plain.items.find(item => item.name === "Dot")), false);
  const dotPriced = applyMarketPrices(plain.items.find(item => item.name === "Dot"), {
    retailNew: 80, value: 70, sources: [{ url: "https://shop.example/optic", label: "store" }],
  }, "2026-10-27");
  assert.equal(dotPriced.retailNew, 80);
  assert.equal(dotPriced.marketSources.length, 1);
  assert.equal(plain.rows.find(row => row.name === "Strap").category, "Holsters & Slings");
  assert.equal(plain.rows.find(row => row.name === "Kit").category, "Cleaning & Maintenance");
  assert.equal(plain.rows.find(row => row.name === "Panel").target, "needs");
  const waiting = { importId: "01N1", needsCategory: true, category: "", name: "Ammo can", paid: 5, paidSource: "manual" };
  assert.equal(importSkipsLookup(waiting), true);
  const waitingPriced = applyMarketPrices(waiting, { retailNew: 20, value: 18, sources: [{ url: "https://shop.example/a", label: "store" }], priceNote: "sale" }, "2026-10-27");
  assert.equal(waitingPriced.retailNew, undefined);
  assert.equal(waitingPriced.marketSources, undefined);
  assert.equal(waitingPriced.paid, 5);
  assert.equal(settleDeal(waiting, { price: 9, url: "https://shop.example/a", where: "shop" }).url, "");
  assert.equal(settleDeal(waiting, { price: 9, url: "https://shop.example/a" }).price, null);
});

test("plain text named xlsx is refused", async () => {
  const text = fs.readFileSync(new URL("./fixtures/scripts-pr10s/not_really.xlsx", import.meta.url));
  const refused = await readImportFile(text, { name: "not_really.xlsx" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "not-workbook");
  assert.equal(refused.message, "This isn't a spreadsheet workbook.");
  const eocd = new Uint8Array([0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0]);
  const short = await readImportFile(eocd, { name: "not_really.xlsx" });
  assert.equal(short.code, "not-workbook");
  assert.equal(short.message, "This isn't a spreadsheet workbook.");
});

test("platform names, combo markers, and look-alikes stay unpriced", () => {
  const base = [
    "AR-15 w/ optic", "AK-47 w/ scope", "M4 w/ red dot", "Glock 19 w/ light", "1911 w/ holster",
    "12 ga w/ sling", "Sidearm w/ light", "Musket w/ sling", "Derringer w/ holster", "Weapon w/ light",
    "Rifle w/ scope", "Pistol with light", "Shotgun w/ sling", "Gun w/ red dot", "Pistol + holster",
    "Rifle w/ bipod", "Rifle & case",
  ];
  const variants = [];
  for (const type of base) {
    variants.push(type);
    variants.push(type.replace(" ", "\u200b"));
    variants.push(type.replace("/", "/\u200c"));
    variants.push(`${type}\u200d`);
    variants.push(`\uFEFF${type}`);
    variants.push(type.replace(/o/i, "o\u0301"));
    variants.push(type.replaceAll("o", "\u043e").replaceAll("O", "\u041e").replaceAll("a", "\u0430").replaceAll("e", "\u0435").replaceAll("p", "\u0440").replaceAll("c", "\u0441"));
    variants.push(type.replaceAll("o", "\u03bf").replaceAll("A", "\u0391").replaceAll("i", "\u03b9"));
    variants.push([...type].map(ch => {
      const code = ch.charCodeAt(0);
      return code >= 33 && code <= 126 ? String.fromCharCode(code + 0xFEE0) : ch;
    }).join(""));
  }
  const extraDir = new URL("./fixtures/scripts-pr10t/", import.meta.url);
  if (fs.existsSync(extraDir)) {
    for (const name of fs.readdirSync(extraDir)) {
      const text = fs.readFileSync(new URL(name, extraDir), "utf8");
      for (const line of text.split(/\r\n|\n|\r/)) {
        const cell = line.split(",")[0].replace(/^"|"$/g, "").trim();
        if (cell && !/^type$/i.test(cell)) variants.push(cell);
      }
    }
  }
  const csv = ["Item,Type,Purchase Price", ...variants.map((type, i) => `Piece ${i},${csvCell(type)},25`)].join("\n");
  const plan = planImport(readCsvText(csv).tables, { importId: "01ADX", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.ammo.length, 0);
  plan.rows.forEach((row, i) => {
    assert.equal(row.target, "needs", variants[i]);
    assert.equal(row.category, "", variants[i]);
    const held = { importId: "01ADX", category: "NVG & Optics", armType: variants[i], paid: 25, paidSource: "manual" };
    assert.equal(importRestricted(held), true, variants[i]);
    assert.equal(importSkipsLookup(held), true, variants[i]);
    const priced = applyMarketPrices(held, { retailNew: 90, value: 80, sources: [{ url: "https://shop.example/a", label: "store" }], priceNote: "sale" }, "2026-10-27");
    assert.equal(priced.retailNew, undefined, variants[i]);
    assert.equal(priced.marketSources, undefined, variants[i]);
    assert.equal(settleDeal(held, { price: 40, url: "https://shop.example/a", where: "shop" }).url, "", variants[i]);
  });
  const lone = planImport(readCsvText("Item,Type\nGlass,Scope\n").tables, { importId: "01SCOPE", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(lone.items[0].category, "NVG & Optics");
  assert.equal(lone.items[0].importPricedAllowlist, true);
  assert.equal(importSkipsLookup(lone.items[0]), false);
});

test("an untyped ammo can whose text is in the bullet column needs a category", async () => {
  const candidates = [
    "../qa/fixtures/import-scan/myarmory_ammo_win1252_semicolon.csv",
    "../fixtures/import-scan/myarmory_ammo_win1252_semicolon.csv",
    "./fixtures/import-scan/myarmory_ammo_win1252_semicolon.csv",
  ];
  const real = candidates.map(rel => new URL(rel, import.meta.url)).find(url => fs.existsSync(url));
  if (real) {
    const parsed = await readImportFile(fs.readFileSync(real), { name: "myarmory_ammo_win1252_semicolon.csv" });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.tables[0].encoding, "windows-1252");
    assert.equal(parsed.tables[0].separator, ";");
    const table = parsed.tables[0];
    const plan = planImport(parsed.tables, { importId: "01REALCAN", now: "2026-10-27T00:00:00.000Z" });
    const idx = 11 - table.headerRow - 1;
    const row = plan.rows[idx];
    assert.ok(row, "row 11");
    assert.equal(row.target, "needs");
    assert.equal(row.category, "");
    const bullet = table.columns.find(col => col.field === "load");
    if (bullet) assert.notEqual(String(table.grid[idx][bullet.index] || "").trim(), "");
  }
  const header = "Manufacturer;Caliber;Bullet;Quantity;Lot Number;Type;Notes";
  const ammo = (n, lot) => `Federal;9mm;FMJ;20;${lot};;box ${n}`;
  const lines = [header, ...Array.from({ length: 9 }, (_, i) => ammo(i + 1, `LOT${i + 1}`)), "Federal;;Ammo can;1;;;Munici"];
  const bytes = Uint8Array.from(lines.join("\r\n") + "\r\n", ch => ch === "\u00f3" ? 0xF3 : ch.charCodeAt(0));
  const text = [...bytes];
  text.splice(text.length - 3, 0, 0xF3);
  const parsed = await readImportFile(Uint8Array.from(text), { name: "myarmory_ammo_win1252_semicolon.csv" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tables[0].encoding, "windows-1252");
  assert.equal(parsed.tables[0].separator, ";");
  assert.equal(parsed.tables[0].defaultTarget, "ammo");
  const plan = planImport(parsed.tables, { importId: "01CAN2", now: "2026-10-27T00:00:00.000Z" });
  const can = plan.rows[9];
  assert.equal(can.target, "needs");
  assert.equal(can.category, "");
  assert.equal(plan.rows.slice(0, 9).every(row => row.target === "ammo"), true);
  assert.equal(plan.ammo.length, 9);
  const stored = planImport(readCsvText("Item,Type\nRange tin,Ammo can\n").tables, { importId: "01CAN3", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(stored.rows[0].target, "gear");
  assert.equal(stored.rows[0].category, "Ammo Storage & Loaders");
  assert.equal(stored.items[0].importPricedAllowlist, true);
  assert.equal(importSkipsLookup(stored.items[0]), false);
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
