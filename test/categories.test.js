import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GEAR_CATEGORIES, LEGACY_STORAGE_CATEGORY, STORAGE_CATEGORY, PRICE_BACKSTOP,
  saleRestricted, migrateCategoryName, migrateRecordCategories,
  settleLookup, settleDeal, keepManualPrice, stampManualPrices, countedValue, csvExportField, applyMarketPrices,
  photoIdBlocked, photoIdHardBlocked, photoIdBlockReason, photoIdSuggestion, pricedPhotoCategories,
} from "../js/logic.js";

const priced = {
  retailNew: 40, usedLow: 20, usedHigh: 30, value: 28, weightOz: 12.5,
  priceNote: "Shelf $40", weightNote: "maker spec 12.5 oz",
  sources: [{ label: "Shelf", url: "https://example.com/item" }],
};

test("Magazines & Belts and Triggers & Parts are weight-only, and the item name is not used", () => {
  for (const category of ["Magazines & Belts", "magazines & belts", "Triggers & Parts", "TRIGGERS & PARTS"]) {
    const item = { category, name: "Garden clip", brand: "Acme", paid: 18 };
    assert.equal(saleRestricted(item), true, category);
    const settled = settleLookup(item, priced);
    assert.equal(settled.retailNew, null);
    assert.equal(settled.usedLow, null);
    assert.equal(settled.usedHigh, null);
    assert.equal(settled.value, null);
    assert.equal(settled.priceNote, "");
    assert.deepEqual(settled.sources, []);
    assert.equal(settled.weightOz, 12.5);
    const deal = settleDeal(item, { price: 12, where: "Shelf", url: "https://example.com/item", note: "in stock" });
    assert.equal(deal.price, null);
    assert.equal(deal.url, "");
    assert.equal(deal.restricted, true);
  }
  assert.equal(saleRestricted({ category: "Misc", name: "bump stock" }), false);
  assert.equal(saleRestricted({ category: "Misc", name: "auto sear" }), false);
  assert.equal(saleRestricted({ category: "Pouches", name: "30 round magazine" }), false);
  assert.equal(saleRestricted({ category: "Belts & Rigs", name: "belt" }), false);
  assert.equal(saleRestricted({ category: "Knives & Tools", name: "trigger" }), false);
});

test("a typed price and what I paid stay on a weight-only shelf", () => {
  for (const category of ["Magazines & Belts", "Triggers & Parts", "Firearms"]) {
    const typed = keepManualPrice({
      category, name: "Box", paid: 42, condition: "Good",
      retailNew: 80, value: 70, priceSource: "manual", valueSource: "manual", link: "https://example.com/buy",
    }, { retailWasManual: true, valueWasManual: true });
    assert.equal(typed.paid, 42, category);
    assert.equal(typed.retailNew, 80, category);
    assert.equal(typed.value, 70, category);
    assert.equal(typed.priceSource, "manual", category);
    assert.equal(typed.link, "", category);
    assert.equal(countedValue(typed), 70, category);
    assert.equal(csvExportField(typed, "paid"), 42, category);
    const market = keepManualPrice({
      category, name: "Box", paid: 42, retailNew: 80, value: 70, priceSource: "market", valueSource: "market",
    }, {});
    assert.equal(market.paid, 42, category);
    assert.equal(market.retailNew, 0, category);
    assert.equal(market.value, 0, category);
    assert.equal(countedValue(market), 0, category);
    const stamped = stampManualPrices({ category, name: "Box", paid: 15, retailNew: 20, value: 18 }, null, { retail: true, value: true });
    assert.equal(stamped.paid, 15, category);
    assert.equal(stamped.priceSource, "manual", category);
    assert.equal(stamped.valueSource, "manual", category);
  }
});

test("Ammo Storage & Loaders keeps prices, including the old category name", () => {
  for (const category of [STORAGE_CATEGORY, LEGACY_STORAGE_CATEGORY, "ammo storage & loaders"]) {
    const item = { category, name: "Ammo can" };
    assert.equal(saleRestricted(item), false, category);
    const settled = settleLookup(item, priced);
    assert.equal(settled.retailNew, 40, category);
    assert.equal(settled.value, 28, category);
    assert.equal(settled.sources.length, 1, category);
    const deal = settleDeal(item, { price: 12, where: "Shelf", url: "https://example.com/can", note: "in stock" });
    assert.equal(deal.price, 12, category);
    assert.equal(deal.restricted, false, category);
  }
  const filled = applyMarketPrices({ category: STORAGE_CATEGORY, name: "Loader", paid: 9 }, priced, "2026-10-27");
  assert.equal(filled.paid, 9);
  assert.equal(filled.retailNew, 40);
  assert.equal(filled.priceSource, "market");
});

test("the magazine substring exemption is gone, so restriction follows the category", () => {
  assert.equal(saleRestricted({ category: "Firearms magazines", name: "Box" }), true);
  assert.equal(saleRestricted({ category: "Storage firearms", name: "Bin" }), true);
  assert.equal(saleRestricted({ category: "Magazine pouches", name: "Admin" }), false);
  assert.equal(saleRestricted({ category: "Pouches", name: "mag pouch" }), false);
});

test("the old storage category string migrates and keeps its other fields", () => {
  assert.equal(migrateCategoryName(LEGACY_STORAGE_CATEGORY), STORAGE_CATEGORY);
  assert.equal(migrateCategoryName("  mags & ammo storage "), STORAGE_CATEGORY);
  assert.equal(migrateCategoryName("Pouches"), "Pouches");
  assert.equal(migrateCategoryName(""), "");
  assert.equal(migrateCategoryName(null), null);
  const stamp = "2026-10-27T12:00:00.000Z";
  const out = migrateRecordCategories([
    { id: "a", category: LEGACY_STORAGE_CATEGORY, name: "Can", paid: 11, updatedAt: "old" },
    { id: "b", category: "Pouches", name: "Admin", updatedAt: "old" },
  ], stamp);
  assert.equal(out.changed, true);
  assert.equal(out.records[0].category, STORAGE_CATEGORY);
  assert.equal(out.records[0].paid, 11);
  assert.equal(out.records[0].updatedAt, stamp);
  assert.equal(out.records[1].category, "Pouches");
  assert.equal(out.records[1].updatedAt, "old");
  const again = migrateRecordCategories(out.records, "later");
  assert.equal(again.changed, false);
  assert.equal(again.records, out.records);
});

test("photo ID is blocked for firearm records even when the armory opt-out is off", () => {
  const open = { category: "Pouches", name: "Admin pouch", arm: "" };
  assert.equal(photoIdBlocked(false, open), false);
  assert.equal(photoIdHardBlocked(open), false);
  assert.equal(photoIdBlockReason(false, open), "");
  assert.equal(photoIdBlocked(false, { category: "" }), false);
  const blocked = [
    { category: "Firearms", name: "Rifle" },
    { category: "Suppressors", name: "Tube" },
    { category: "Silencers", name: "Tube" },
    { category: "Lower receivers", name: "Widget" },
    { category: "Frames", name: "Widget" },
    { category: "Receivers", name: "Widget" },
    { category: "Pouches", name: "Admin", arm: "FA" },
    { category: "Misc", name: "Tube", arm: "SU" },
  ];
  for (const item of blocked) {
    assert.equal(photoIdHardBlocked(item), true, JSON.stringify(item));
    assert.equal(photoIdBlocked(false, item), true, JSON.stringify(item));
    assert.equal(photoIdBlocked(true, item), true, JSON.stringify(item));
    assert.equal(photoIdBlockReason(false, item), "Photo ID isn't available for this record.");
  }
  assert.equal(photoIdBlocked(false, { category: "Magazines & Belts", name: "Box" }), false);
  assert.equal(photoIdBlocked(false, { category: "NVG & Optics", name: "Red dot", arm: "OP" }), false);
  assert.equal(photoIdBlocked(true, { category: "NVG & Optics", name: "Red dot", arm: "OP" }), true);
  assert.equal(photoIdBlockReason(true, { category: "" }), "Choose a category before photo ID.");
  assert.equal(photoIdBlockReason(true, { category: "Pouches", name: "Admin" }), "");
});

test("photo ID never offers a restricted category as a priced suggestion", () => {
  const pricedCats = pricedPhotoCategories();
  for (const name of ["Firearms", "Suppressors", "Magazines & Belts", "Triggers & Parts"]) {
    assert.equal(pricedCats.includes(name), false, name);
    assert.equal(photoIdSuggestion(name), "");
  }
  assert.equal(photoIdSuggestion("Pouches"), "Pouches");
  assert.equal(photoIdSuggestion("Ammo Storage & Loaders"), "Ammo Storage & Loaders");
  assert.equal(photoIdSuggestion("Belts & Rigs"), "Belts & Rigs");
  assert.equal(photoIdSuggestion("Not a category"), "");
  assert.equal(photoIdSuggestion(""), "");
  assert.ok(GEAR_CATEGORIES.includes("Magazines & Belts"));
  assert.ok(GEAR_CATEGORIES.includes("Triggers & Parts"));
  assert.ok(GEAR_CATEGORIES.includes(STORAGE_CATEGORY));
  assert.equal(GEAR_CATEGORIES.includes(LEGACY_STORAGE_CATEGORY), false);
});

test("the price prompt backstop names magazines over 30 rounds, belts, and auto-fire devices", () => {
  assert.match(PRICE_BACKSTOP, /magazine over 30 rounds/);
  assert.match(PRICE_BACKSTOP, /belt/);
  assert.match(PRICE_BACKSTOP, /auto-fire device/);
  assert.match(PRICE_BACKSTOP, /bump stocks/);
  assert.match(PRICE_BACKSTOP, /auto sears/);
  assert.match(PRICE_BACKSTOP, /no price and no sources/);
  assert.match(PRICE_BACKSTOP, /sources to \[\]/);
  const worker = fs.readFileSync(new URL("../api/worker.js", import.meta.url), "utf8");
  const core = fs.readFileSync(new URL("../js/core.js", import.meta.url), "utf8");
  assert.match(worker, /\$\{PRICE_BACKSTOP\}/);
  assert.match(worker, /photoIdHardBlocked\(subject\)/);
  assert.match(worker, /Photo ID isn't available for this record/);
  assert.match(worker, /photoIdSuggestion\(j\.category, CATS\)/);
  assert.match(worker, /pricedPhotoCategories\(CATS\)/);
  assert.match(worker, /set category to ""/);
  assert.ok(worker.indexOf("Do not look up a price") < worker.indexOf("${PRICE_BACKSTOP}"));
  assert.match(core, /GearLogic\.GEAR_CATEGORIES/);
  assert.match(core, /applyCategoryMigration/);
  assert.match(core, /migrateRecordCategories/);
  assert.doesNotMatch(core, /Mags & Ammo Storage/);
  assert.match(fs.readFileSync(new URL("../js/arms.js", import.meta.url), "utf8"), /photoIdSuggestion/);
  assert.match(fs.readFileSync(new URL("../js/arms.js", import.meta.url), "utf8"), /idBtn"\)\.disabled|btn\.disabled=blocked/);
});
