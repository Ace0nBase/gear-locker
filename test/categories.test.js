import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GEAR_CATEGORIES, LEGACY_STORAGE_CATEGORY, STORAGE_CATEGORY, PRICE_BACKSTOP, CATEGORY_HINTS,
  MAGAZINES_CATEGORY, LEGACY_MAGAZINES_CATEGORY, BELTS_CATEGORY, LEGACY_BELTS_CATEGORY, ARMOR_CATEGORY,
  saleRestricted, migrateCategoryName, migrateRecordCategories,
  settleLookup, settleDeal, keepManualPrice, stampManualPrices, countedValue, csvExportField, applyMarketPrices,
  magShelfPending, answerMagShelf, beltRigPending, answerBeltRig, magazinesBeltPending, answerMagazinesBelt,
  clearMagazineAutoPrices, slotAllowsCategory, starterSlotScore, explicitCategoryChoice, keepMovedCategory, mergeByServerTime, mergeCategoryAnswers,
  photoIdBlocked, photoIdHardBlocked, photoIdBlockReason, photoIdSuggestion, pricedPhotoCategories,
} from "../js/logic.js";
import { SEED_ITEMS } from "../seed-data.mjs";

const priced = {
  retailNew: 40, usedLow: 20, usedHigh: 30, value: 28, weightOz: 12.5,
  priceNote: "Shelf $40", weightNote: "maker spec 12.5 oz",
  sources: [{ label: "Shelf", url: "https://example.com/item" }],
};

test("Magazines and Triggers & Parts are weight-only, and the item name is not used", () => {
  for (const category of ["Magazines", "MAGAZINES", LEGACY_MAGAZINES_CATEGORY, "magazines & belts", "Triggers & Parts", "TRIGGERS & PARTS"]) {
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
  assert.equal(saleRestricted({ category: "Belts", name: "chest rig" }), false);
  assert.equal(saleRestricted({ category: "Belts & Rigs", name: "plate carrier" }), false);
  assert.equal(saleRestricted({ category: "Armor & Carriers", name: "JPC" }), false);
  assert.equal(saleRestricted({ category: "Knives & Tools", name: "trigger" }), false);
});

test("a typed price and what I paid stay on a weight-only shelf", () => {
  for (const category of ["Magazines", "Magazines & Belts", "Triggers & Parts", "Firearms"]) {
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
  assert.equal(out.records[0].migratedFromMagShelf, true);
  assert.equal(out.records[1].category, "Pouches");
  assert.equal(out.records[1].updatedAt, "old");
  assert.equal(out.records[1].migratedFromMagShelf, undefined);
  const again = migrateRecordCategories(out.records, "later");
  assert.equal(again.changed, false);
  assert.equal(again.records, out.records);
});

test("the old shelf keeps market data and does not move an item because of its name", () => {
  const stamp = "2026-10-27T12:00:00.000Z";
  const sources = [{ label: "Shop", url: "https://example.com/can" }];
  const out = migrateRecordCategories([
    { id: "can", category: LEGACY_STORAGE_CATEGORY, name: "PMAG 30", priceSource: "market", retailNew: 18, value: 14, link: "https://example.com/can", marketSources: sources, paid: 12, marketCheck: "done" },
    { id: "pouch", category: "Pouches", name: "mag pouch", priceSource: "market", retailNew: 22, link: "https://example.com/pouch" },
    { id: "belt", category: "Belts & Rigs", name: "battle belt", priceSource: "market", retailNew: 80, link: "https://example.com/belt" },
  ], stamp);
  const can = out.records[0];
  assert.equal(can.category, STORAGE_CATEGORY);
  assert.equal(can.name, "PMAG 30");
  assert.equal(magShelfPending(can), true);
  assert.equal(can.priceSource, "market");
  assert.equal(can.retailNew, 18);
  assert.equal(can.link, "https://example.com/can");
  assert.equal(can.marketSources, sources);
  assert.equal(can.marketCheck, "done");
  assert.equal(can.paid, 12);
  assert.equal(saleRestricted(can), false);
  assert.equal(out.records[1].category, "Pouches");
  assert.equal(magShelfPending(out.records[1]), false);
  assert.equal(out.records[2].category, "Belts");
  assert.equal(out.records[2].migratedFromMagShelf, undefined);
  assert.equal(beltRigPending(out.records[2]), true);
  assert.equal(out.records[2].retailNew, 80);
  assert.equal(out.records[2].link, "https://example.com/belt");
  assert.equal(countedValue(can), 0);
  assert.equal(countedValue({ ...can, valueSource: "manual", value: 14 }), 14);
  assert.equal(csvExportField(can, "retailNew"), "");
  const pricedAgain = applyMarketPrices(can, { retailNew: 99, value: 80, sources: [{ label: "Other", url: "https://example.com/other" }] }, "2026-10-28");
  assert.equal(pricedAgain.retailNew, 18);
  assert.equal(pricedAgain.marketSources, sources);
  const deal = settleDeal(can, { price: 9, url: "https://example.com/deal", where: "Shop" });
  assert.equal(deal.price, null);
  assert.equal(deal.url, "");
  const kept = answerMagShelf(out.records, "dismiss", "", "2026-10-27T13:00:00.000Z");
  assert.equal(magShelfPending(kept.records[0]), false);
  assert.equal(kept.records[0].category, STORAGE_CATEGORY);
  assert.equal(kept.records[0].priceSource, "market");
  assert.equal(kept.records[0].link, "https://example.com/can");
  assert.equal(kept.records[0].marketSources, sources);
  assert.equal(countedValue(kept.records[0]), 14);
  const moved = answerMagShelf(out.records, "move", "can", "2026-10-27T13:00:00.000Z");
  assert.equal(moved.records[0].category, "Magazines");
  assert.equal(magShelfPending(moved.records[0]), false);
  assert.equal(moved.records[0].paid, 12);
  assert.equal(moved.records[0].link, "");
  assert.equal(moved.records[0].priceSource, undefined);
  assert.equal(moved.records[1].category, "Pouches");
  const allMoved = answerMagShelf([
    { id: "a", category: STORAGE_CATEGORY, migratedFromMagShelf: true, name: "One", paid: 1, priceSource: "market", retailNew: 5 },
    { id: "b", category: STORAGE_CATEGORY, migratedFromMagShelf: true, name: "Two", paid: 2 },
    { id: "c", category: "Pouches", name: "mag", paid: 3 },
  ], "move-all", "", stamp);
  assert.equal(allMoved.records[0].category, "Magazines");
  assert.equal(allMoved.records[1].category, "Magazines");
  assert.equal(allMoved.records[2].category, "Pouches");
  assert.equal(allMoved.records[2].name, "mag");
});

test("old magazine and belt ids rename in place, and a rig moves only when the owner says so", () => {
  assert.equal(migrateCategoryName(LEGACY_MAGAZINES_CATEGORY), MAGAZINES_CATEGORY);
  assert.equal(migrateCategoryName("  magazines & belts "), MAGAZINES_CATEGORY);
  assert.equal(migrateCategoryName(MAGAZINES_CATEGORY), MAGAZINES_CATEGORY);
  assert.equal(migrateCategoryName(LEGACY_BELTS_CATEGORY), BELTS_CATEGORY);
  assert.equal(migrateCategoryName("BELTS & RIGS"), BELTS_CATEGORY);
  assert.equal(migrateCategoryName(BELTS_CATEGORY), BELTS_CATEGORY);
  assert.equal(migrateCategoryName(ARMOR_CATEGORY), ARMOR_CATEGORY);
  assert.equal(migrateCategoryName("Lower Receivers"), "Firearms");
  assert.equal(migrateCategoryName("Lower Receiver"), "Firearms");
  assert.equal(migrateCategoryName("Ammunition"), "Ammo");
  assert.equal(migrateCategoryName("Ammo"), "Ammo");
  const legacyRestricted = migrateRecordCategories([
    { id: "ammo", name: "Practice box", category: "Ammunition", retailNew: 40, value: 30, paid: 25 },
    { id: "lower", name: "Practice box", category: "Lower Receivers", retailNew: 120, value: 100, paid: 90 },
    { id: "pouch", name: "Ammunition pouch", category: "Pouches", retailNew: 18 },
  ], "2026-10-28T00:00:00.000Z");
  assert.equal(legacyRestricted.records[0].category, "Ammo");
  assert.equal(legacyRestricted.records[0].name, "Practice box");
  assert.equal(legacyRestricted.records[0].retailNew, 40);
  assert.equal(legacyRestricted.records[0].value, 30);
  assert.equal(saleRestricted(legacyRestricted.records[0]), true);
  assert.equal(legacyRestricted.records[1].category, "Firearms");
  assert.equal(legacyRestricted.records[1].name, "Practice box");
  assert.equal(legacyRestricted.records[1].retailNew, 120);
  assert.equal(saleRestricted(legacyRestricted.records[1]), true);
  assert.equal(legacyRestricted.records[2].category, "Pouches");
  assert.equal(saleRestricted(legacyRestricted.records[2]), false);
  assert.equal(GEAR_CATEGORIES.includes("Ammo"), true);
  assert.equal(GEAR_CATEGORIES.includes("Firearms"), true);
  const stamp = "2026-10-27T12:00:00.000Z";
  const later = "2026-10-27T13:00:00.000Z";
  const out = migrateRecordCategories([
    { id: "rig", category: "Belts & Rigs", name: "Spiritus MK4 chest rig", priceSource: "market", retailNew: 220, value: 180, link: "https://example.com/rig", paid: 200 },
    { id: "belt", category: "Belts & Rigs", name: "AWS SMU belt", priceSource: "manual", retailNew: 160, value: 140, link: "https://example.com/belt" },
    { id: "named", category: "Magazines & Belts", name: "Blue Alpha battle belt", paid: 80, priceSource: "manual", retailNew: 90, value: 70 },
    { id: "pmag", category: "Magazines", name: "PMAG 30 Gen M3", paid: 14 },
    { id: "jpc", category: "Armor & Carriers", name: "Crye JPC 2.0", priceSource: "market", retailNew: 240 },
    { id: "pouch", category: "Pouches", name: "Spiritus MK4 chest rig", priceSource: "market", retailNew: 40 },
    { id: "done", category: "Belts", name: "Blue Force Gear belt", priceSource: "market", retailNew: 90 },
  ], stamp);
  assert.equal(out.changed, true);
  assert.equal(out.records[0].category, "Belts");
  assert.equal(beltRigPending(out.records[0]), true);
  assert.equal(out.records[0].name, "Spiritus MK4 chest rig");
  assert.equal(out.records[0].retailNew, 220);
  assert.equal(out.records[0].link, "https://example.com/rig");
  assert.equal(out.records[0].paid, 200);
  assert.equal(saleRestricted(out.records[0]), false);
  assert.equal(countedValue(out.records[0]), 180);
  assert.equal(out.records[1].category, "Belts");
  assert.equal(beltRigPending(out.records[1]), true);
  assert.equal(out.records[2].category, "Magazines");
  assert.equal(out.records[2].migratedFromMagShelf, undefined);
  assert.equal(magazinesBeltPending(out.records[2]), true);
  assert.equal(beltRigPending(out.records[2]), false);
  assert.equal(saleRestricted(out.records[2]), true);
  assert.equal(out.records[2].paid, 80);
  assert.equal(out.records[2].retailNew, 90);
  assert.equal(out.records[2].priceSource, "manual");
  assert.equal(out.records[2].value, 0);
  assert.equal(out.records[3].category, "Magazines");
  assert.equal(out.records[3].updatedAt, undefined);
  assert.equal(out.records[4].category, "Armor & Carriers");
  assert.equal(out.records[4].updatedAt, undefined);
  assert.equal(out.records[5].category, "Pouches");
  assert.equal(out.records[6].category, "Belts");
  assert.equal(beltRigPending(out.records[6]), false);
  assert.equal(out.records[6].updatedAt, undefined);
  const again = migrateRecordCategories(out.records, later);
  assert.equal(again.changed, false);
  assert.equal(again.records, out.records);
  const fromOtherDevice = migrateRecordCategories([
    again.records[6],
    { id: "remote", category: "Belts & Rigs", name: "Ferro Slickster", priceSource: "market", retailNew: 180, link: "https://example.com/slickster", updatedAt: "older" },
  ], later);
  assert.equal(fromOtherDevice.records[0], again.records[6]);
  assert.equal(fromOtherDevice.records[1].category, "Belts");
  assert.equal(beltRigPending(fromOtherDevice.records[1]), true);
  assert.equal(fromOtherDevice.records[1].updatedAt, later);
  const guessed = answerBeltRig(out.records, "move", "pouch", later);
  assert.equal(guessed.changed, false);
  assert.equal(guessed.records[5].category, "Pouches");
  const bulk = answerBeltRig(out.records, "move-all", "", later);
  assert.equal(bulk.changed, false);
  assert.equal(bulk.records[0].category, "Belts");
  assert.equal(beltRigPending(bulk.records[0]), true);
  const moved = answerBeltRig(out.records, "move", "rig", later);
  assert.equal(moved.changed, true);
  assert.equal(moved.records[0].category, "Armor & Carriers");
  assert.equal(beltRigPending(moved.records[0]), false);
  assert.equal(moved.records[0].priceSource, "market");
  assert.equal(moved.records[0].retailNew, 220);
  assert.equal(moved.records[0].link, "https://example.com/rig");
  assert.equal(moved.records[0].paid, 200);
  assert.equal(moved.records[0].movedAt, later);
  assert.equal(moved.records[1].category, "Belts");
  assert.equal(beltRigPending(moved.records[1]), true);
  const dismissed = answerBeltRig(out.records, "dismiss", "", later);
  assert.equal(dismissed.records[0].category, "Belts");
  assert.equal(dismissed.records[1].category, "Belts");
  assert.equal(beltRigPending(dismissed.records[0]), false);
  assert.equal(beltRigPending(dismissed.records[1]), false);
  assert.equal(dismissed.records[0].link, "https://example.com/rig");
  assert.equal(dismissed.records[0].priceSource, "market");
  assert.equal(countedValue(dismissed.records[0]), 180);
  const settled = settleLookup({ category: "Belts", name: "AWS SMU" }, {
    retailNew: 160, usedLow: 90, usedHigh: 140, value: 120, weightOz: 18,
    priceNote: "See https://www.gunbroker.com/item/1",
    sources: [{ label: "GunBroker", url: "https://www.gunbroker.com/item/1" }, { label: "Shop", url: "https://example.com/belt" }],
  });
  assert.equal(settled.retailNew, 160);
  assert.equal(settled.sources.length, 1);
  assert.equal(settled.sources[0].url, "https://example.com/belt");
  assert.doesNotMatch(settled.priceNote, /gunbroker/i);
  const blocked = settleLookup({ category: "Magazines", name: "PMAG 30" }, {
    retailNew: 18, value: 14, sources: [{ label: "GunBroker", url: "https://www.gunbroker.com/item/2" }], priceNote: "https://www.gunbroker.com/item/2",
  });
  assert.equal(blocked.retailNew, null);
  assert.deepEqual(blocked.sources, []);
  assert.equal(blocked.priceNote, "");
});

test("moving a magazine shelf row clears auto prices and an old id does not undo the move", () => {
  const stamp = "2026-10-27T12:00:00.000Z";
  const later = "2026-10-27T13:00:00.000Z";
  const sources = [{ label: "Amazon", url: "https://www.amazon.com/pmag" }];
  const out = migrateRecordCategories([
    {
      id: "pmag", category: "Magazines & Belts", name: "PMAG 30", paid: 14,
      retailNew: 28, value: 28, priceSource: "market", priceDate: "2026-10-01", priceNote: "Amazon $28",
      usedLow: 20, usedHigh: 30, link: "https://www.amazon.com/pmag", marketSources: sources,
      marketCheck: "done", marketCheckAt: "2026-10-01", deal: { price: 22 }, target: 25, estPrice: 28,
    },
    {
      id: "typed", category: "Magazines", name: "Lancer", paid: 16,
      retailNew: 20, value: 18, priceSource: "manual", valueSource: "manual",
    },
  ], stamp);
  const pmag = out.records[0];
  assert.equal(pmag.category, "Magazines");
  assert.equal(magazinesBeltPending(pmag), true);
  assert.equal(pmag.paid, 14);
  assert.equal(pmag.retailNew, 0);
  assert.equal(pmag.value, 0);
  assert.equal(pmag.priceSource, undefined);
  assert.equal(pmag.link, "");
  assert.deepEqual(pmag.marketSources, []);
  assert.equal(pmag.deal, undefined);
  assert.equal(pmag.target, undefined);
  assert.equal(pmag.estPrice, undefined);
  assert.equal(pmag.marketCheck, undefined);
  assert.equal(pmag.priceNote, undefined);
  assert.equal(countedValue(pmag), 0);
  assert.equal(out.records[1].retailNew, 20);
  assert.equal(out.records[1].value, 18);
  assert.equal(out.records[1].paid, 16);
  assert.equal(magazinesBeltPending(out.records[1]), false);
  const again = migrateRecordCategories(out.records, later);
  assert.equal(again.changed, false);
  assert.equal(again.records, out.records);
  const filled = applyMarketPrices(pmag, { retailNew: 40, value: 30, sources }, "2026-10-28");
  assert.equal(filled.retailNew, 0);
  assert.equal(filled.value, 0);
  const moved = answerMagazinesBelt(out.records, "move-belts", "pmag", later);
  assert.equal(moved.records[0].category, "Belts");
  assert.equal(moved.records[0].movedAt, later);
  assert.equal(magazinesBeltPending(moved.records[0]), false);
  assert.equal(moved.records[0].paid, 14);
  const stored = answerMagazinesBelt(out.records, "move-storage", "pmag", later);
  assert.equal(stored.records[0].category, "Ammo Storage & Loaders");
  const guessed = answerMagazinesBelt(out.records, "move-all", "", later);
  assert.equal(guessed.changed, false);
  assert.equal(guessed.records[0].category, "Magazines");
  const dismissed = answerMagazinesBelt(out.records, "dismiss", "", later);
  assert.equal(dismissed.records[0].category, "Magazines");
  assert.equal(magazinesBeltPending(dismissed.records[0]), false);
  const book = mergeCategoryAnswers({}, { pmag: { prompt: "magazines", action: "dismiss", category: "Magazines", at: later } });
  const revived = migrateRecordCategories([
    { id: "pmag", category: "Magazines & Belts", name: "PMAG 30", paid: 14, retailNew: 28, value: 28, priceSource: "market", link: "https://www.amazon.com/pmag", updatedAt: "2026-10-27T15:00:00.000Z" },
  ], "2026-10-27T16:00:00.000Z", book);
  assert.equal(revived.records[0].category, "Magazines");
  assert.equal(magazinesBeltPending(revived.records[0]), false);
  assert.equal(revived.records[0].retailNew, 0);
  assert.equal(revived.records[0].paid, 14);
  const kept = keepMovedCategory(
    { id: "rig", category: "Belts & Rigs", name: "renamed on the old phone", updatedAt: "2026-10-27T18:00:00.000Z" },
    { id: "rig", category: "Armor & Carriers", name: "Ferro Slickster", movedAt: later, updatedAt: later },
    { id: "rig", category: "Belts & Rigs", name: "renamed on the old phone", updatedAt: "2026-10-27T18:00:00.000Z" },
  );
  assert.equal(kept.category, "Armor & Carriers");
  assert.equal(kept.movedAt, later);
  assert.equal(kept.name, "renamed on the old phone");
  const merged = mergeByServerTime(
    { id: "rig", category: "Armor & Carriers", name: "Ferro Slickster", movedAt: later, updatedAt: later },
    { id: "rig", category: "Belts & Rigs", name: "renamed on the old phone", updatedAt: "2026-10-27T18:00:00.000Z" },
  );
  assert.equal(merged.category, "Armor & Carriers");
  assert.equal(merged.movedAt, later);
  assert.equal(merged.name, "renamed on the old phone");
  const reread = migrateRecordCategories([merged], "2026-10-27T19:00:00.000Z");
  assert.equal(reread.changed, false);
  assert.equal(reread.records[0].category, "Armor & Carriers");
  assert.equal(clearMagazineAutoPrices({ category: "Belts", retailNew: 80, paid: 70 }).retailNew, 80);
  assert.equal(saleRestricted({ category: "Ammunition", name: "belted 5.56" }), true);
  assert.equal(saleRestricted({ category: "Ammunition", name: "ammunition belt" }), true);
  assert.equal(saleRestricted({ kind: "ammo", category: "Ammunition", name: "linked belt" }), true);
  assert.equal(GEAR_CATEGORIES.some(c => /linked/i.test(c)), false);
});

test("a migrated seed kit keeps the Range Day loader score", () => {
  const loader = SEED_ITEMS.find(i => i.id === "loader");
  const carrier = SEED_ITEMS.find(i => i.id === "carrier");
  const belt = SEED_ITEMS.find(i => i.id === "belt");
  const ammocan = SEED_ITEMS.find(i => i.id === "ammocan");
  const snap = SEED_ITEMS.find(i => i.id === "snapcaps");
  const pouch = SEED_ITEMS.find(i => i.id === "pistolmag");
  const loaderSlot = ["Mag loader", ["Ammo Storage & Loaders", "Mags & Ammo Storage", "Magazines & Belts", "Knives & Tools"], ["loader", "uplula", "maglula", "lula", "speed loader", "stripper"], "", []];
  const ammocanSlot = ["Ammo can", ["Ammo Storage & Loaders", "Mags & Ammo Storage", "Magazines & Belts", "Cases & Bags"], ["ammo can", "ammo box", "ammo bag", "ammo crate", "ammo"], "", []];
  const snapSlot = ["Snap caps", ["Ammo Storage & Loaders", "Magazines", "Magazines & Belts", "Misc"], ["snap cap", "dummy round", "dummy rounds", "a-zoom", "azoom", "inert round"], "", []];
  const pistolSlot = ["Pistol mag pouch", ["Pouches", "Ammo Storage & Loaders", "Magazines", "Magazines & Belts"], ["pistol mag", "pistol", "9mm", "handgun", "glock"], "", []];
  const carrierSlot = ["Plate carrier / chest rig", ["Armor & Carriers", "Belts"], ["plate carrier", "carrier", "jpc", "avs", "apc", "chest rig", "spc", "fcpc", "lv-119", "slickster", "micro rig", "mk3", "mk4"], "", ["belt"]];
  assert.equal(starterSlotScore(loaderSlot, loader), 8);
  const migrated = migrateRecordCategories(SEED_ITEMS, "2026-10-27T12:00:00.000Z").records;
  const movedLoader = migrated.find(i => i.id === "loader");
  assert.equal(movedLoader.category, "Ammo Storage & Loaders");
  assert.equal(starterSlotScore(loaderSlot, movedLoader), 8);
  assert.equal(starterSlotScore(ammocanSlot, migrated.find(i => i.id === "ammocan")), 8);
  assert.equal(starterSlotScore(snapSlot, migrated.find(i => i.id === "snapcaps")), 8);
  assert.equal(starterSlotScore(pistolSlot, migrated.find(i => i.id === "pistolmag")), 8);
  assert.equal(migrated.find(i => i.id === "belt").category, "Belts");
  assert.equal(migrated.find(i => i.id === "carrier").category, "Armor & Carriers");
  assert.equal(starterSlotScore(carrierSlot, { ...carrier, category: "Belts" }), 8);
  assert.equal(starterSlotScore(carrierSlot, { ...carrier, category: "Belts & Rigs" }), 8);
  assert.equal(slotAllowsCategory(loaderSlot[1], ammocan.category), true);
  assert.equal(slotAllowsCategory(loaderSlot[1], "Magazines"), true);
  assert.equal(slotAllowsCategory(pistolSlot[1], snap.category), true);
  assert.equal(slotAllowsCategory(carrierSlot[1], belt.category), true);
  assert.equal(slotAllowsCategory(carrierSlot[1], "Belts & Rigs"), true);
  const before = SEED_ITEMS.filter(i => ["headset", "eyepro", "mags", "holster", "sling", "targets", "loader", "ammocan", "ifak", "tq"].includes(i.id))
    .reduce((n, i) => n + (starterSlotScore(i.id === "loader" ? loaderSlot : i.id === "ammocan" ? ammocanSlot : ["x", [i.category], [String(i.name).toLowerCase().split(" ")[0]], "", []], i) > 0 ? 1 : 0), 0);
  assert.equal(before, 10);
  const after = migrated.filter(i => ["headset", "eyepro", "mags", "holster", "sling", "targets", "loader", "ammocan", "ifak", "tq"].includes(i.id))
    .reduce((n, i) => n + (starterSlotScore(i.id === "loader" ? loaderSlot : i.id === "ammocan" ? ammocanSlot : ["x", [migrateCategoryName(i.category), i.category], [String(i.name).toLowerCase().split(" ")[0]], "", []], i) > 0 ? 1 : 0), 0);
  assert.equal(after, 10);
});

test("a fresh device applies saved move answers before the old id is renamed", () => {
  const stamp = "2026-10-27T19:00:00.000Z";
  const answers = {
    rig: { prompt: "belt", action: "move", category: "Armor & Carriers", at: "2026-10-27T12:00:00.000Z" },
    healed: { prompt: "belt", action: "move", category: "Armor & Carriers", at: "2026-10-27T12:00:00.000Z" },
    pouch: { prompt: "magazines", action: "move", category: "Pouches", at: "2026-10-27T12:00:00.000Z" },
    parked: { prompt: "magazines", action: "move", category: "Pouches", at: "2026-10-27T12:00:00.000Z" },
    stayed: { prompt: "belt", action: "move", category: "Belts", at: "2026-10-27T20:00:00.000Z" },
    kept: { prompt: "belt", action: "move", category: "Belts", at: "2026-10-27T08:00:00.000Z" },
    chosen: { prompt: "belt", action: "move", category: "Armor & Carriers", at: "2026-10-27T12:00:00.000Z" },
  };
  const out = migrateRecordCategories([
    { id: "rig", category: "Belts & Rigs", name: "Spiritus MK4 chest rig", updatedAt: "2026-10-27T18:00:00.000Z" },
    { id: "healed", category: "Belts", name: "Spiritus MK4 chest rig", updatedAt: "2026-10-27T18:00:00.000Z" },
    { id: "other", category: "Belts & Rigs", name: "AWS SMU battle belt", updatedAt: "2026-10-27T18:00:00.000Z" },
    { id: "kept", category: "Armor & Carriers", name: "Crye JPC", movedAt: "2026-10-27T11:00:00.000Z", updatedAt: "2026-10-27T11:00:00.000Z" },
    { id: "pouch", category: "Magazines & Belts", name: "QA triple mag pouch", updatedAt: "2026-10-27T18:00:00.000Z" },
    { id: "parked", category: "Magazines", name: "QA triple mag pouch", updatedAt: "2026-10-27T18:00:00.000Z" },
    { id: "mag", category: "Magazines & Belts", name: "PMAG 30", updatedAt: "2026-10-27T18:00:00.000Z" },
    { id: "chosen", category: "Pouches", name: "Blue Alpha battle belt", updatedAt: "2026-10-27T18:00:00.000Z" },
    { id: "stayed", category: "Belts & Rigs", name: "rigger's belt", updatedAt: "2026-10-27T18:00:00.000Z" },
  ], stamp, answers);
  const row = id => out.records.find(r => r.id === id);
  assert.equal(row("rig").category, "Armor & Carriers");
  assert.equal(row("rig").migratedFromBeltRig, undefined);
  assert.equal(row("rig").movedAt, "2026-10-27T12:00:00.000Z");
  assert.equal(row("healed").category, "Armor & Carriers");
  assert.equal(row("healed").movedAt, "2026-10-27T12:00:00.000Z");
  assert.equal(row("other").category, "Belts");
  assert.equal(row("other").migratedFromBeltRig, true);
  assert.equal(row("other").movedAt, undefined);
  assert.equal(row("kept").category, "Armor & Carriers");
  assert.equal(row("kept").movedAt, "2026-10-27T11:00:00.000Z");
  assert.equal(row("pouch").category, "Pouches");
  assert.equal(row("pouch").migratedFromMagazinesBelts, undefined);
  assert.equal(row("parked").category, "Pouches");
  assert.equal(row("mag").category, "Magazines");
  assert.equal(row("mag").migratedFromMagazinesBelts, true);
  assert.equal(row("chosen").category, "Pouches");
  assert.equal(row("chosen").movedAt, undefined);
  assert.equal(row("stayed").category, "Belts");
  assert.equal(row("stayed").migratedFromBeltRig, undefined);
  const again = migrateRecordCategories(out.records, "2026-10-27T21:00:00.000Z", answers);
  assert.equal(again.records.find(r => r.id === "rig").category, "Armor & Carriers");
  assert.equal(again.records.find(r => r.id === "other").category, "Belts");
  assert.equal(again.records.find(r => r.id === "kept").category, "Armor & Carriers");
  assert.equal(again.records.find(r => r.id === "chosen").category, "Pouches");
});

test("a wishlist save replaces the saved move and keeps the chosen shelf", () => {
  const old = { prompt: "belt", action: "move", category: "Armor & Carriers", at: "2026-10-27T12:00:00.000Z" };
  const stamp = "2026-10-27T18:00:00.000Z";
  assert.equal(explicitCategoryChoice(null, "Belts & Rigs", "Belts", stamp), null);
  assert.equal(explicitCategoryChoice(old, "Armor & Carriers", "Armor & Carriers", stamp), null);
  const choice = explicitCategoryChoice(old, "Armor & Carriers", "Belts", stamp);
  assert.equal(choice.answer.prompt, "belt");
  assert.equal(choice.answer.action, "move");
  assert.equal(choice.answer.category, "Belts");
  assert.equal(choice.answer.at, stamp);
  assert.equal(choice.movedAt, stamp);
  const wish = { id: "rig", name: "Rigger belt", category: "Belts", movedAt: choice.movedAt, updatedAt: stamp };
  const kept = migrateRecordCategories([wish], "2026-10-27T18:00:00.300Z", { rig: choice.answer });
  assert.equal(kept.records[0].category, "Belts");
  assert.equal(kept.records[0].movedAt, stamp);
  const snapped = migrateRecordCategories(
    [{ id: "rig", name: "Rigger belt", category: "Belts", updatedAt: stamp }],
    "2026-10-27T18:00:00.300Z",
    { rig: old },
  );
  assert.equal(snapped.records[0].category, "Armor & Carriers");
  const cleared = explicitCategoryChoice(
    { prompt: "magazines", action: "move", category: "Pouches", at: "2026-10-27T12:00:00.000Z" },
    "Pouches",
    "Magazines",
    stamp,
  );
  assert.equal(cleared.answer.category, "Magazines");
  const pouch = migrateRecordCategories(
    [{ id: "pouch", name: "KYWI", category: "Magazines", movedAt: cleared.movedAt }],
    "2026-10-27T18:00:00.300Z",
    { pouch: cleared.answer },
  );
  assert.equal(pouch.records[0].category, "Magazines");
});

test("every checklist slot accepts the old and new ids and scores like main", () => {
  const coreSrc = fs.readFileSync(new URL("../js/core.js", import.meta.url), "utf8");
  const start = coreSrc.indexOf("var S={");
  const end = coreSrc.indexOf("var KITS=");
  const block = coreSrc.slice(start + "var S=".length, end).trim().replace(/;$/, "");
  const coreSlots = Function(`"use strict"; return (${block});`)();
  const stacks = fs.readFileSync(new URL("../js/stacks.js", import.meta.url), "utf8");
  const live = Function(`"use strict"; return (${block});`)();
  live.mags = Function(`"use strict"; return (${stacks.match(/S\.mags=(\[[^\n]*\]);/)[1]});`)();
  delete live.pistolmags;
  const pairs = [["Magazines", "Magazines & Belts"], ["Belts", "Belts & Rigs"], ["Ammo Storage & Loaders", "Mags & Ammo Storage"]];
  for (const [id, slot] of Object.entries(coreSlots)) {
    for (const [a, b] of pairs) {
      assert.equal(slot[1].includes(a), slot[1].includes(b), `${id} lists ${a} without ${b}`);
    }
  }
  const mainCats = {
    carrier: ["Armor & Carriers", "Belts & Rigs"],
    belt: ["Belts & Rigs"],
    riflemag: ["Pouches", "Ammo Storage & Loaders", "Magazines & Belts", "Armor & Carriers"],
    pistolmag: ["Pouches", "Ammo Storage & Loaders", "Magazines & Belts"],
    mags: ["Ammo Storage & Loaders", "Magazines & Belts"],
    ammocan: ["Ammo Storage & Loaders", "Magazines & Belts", "Cases & Bags"],
    loader: ["Ammo Storage & Loaders", "Magazines & Belts", "Knives & Tools"],
    snapcaps: ["Ammo Storage & Loaders", "Magazines & Belts", "Misc"],
  };
  const asMain = cat => {
    if (cat === "Magazines" || cat === "Magazines & Belts") return "Magazines & Belts";
    if (cat === "Belts" || cat === "Belts & Rigs") return "Belts & Rigs";
    if (cat === "Mags & Ammo Storage") return "Ammo Storage & Loaders";
    return cat;
  };
  const casesFor = cat => {
    if (cat === "Magazines" || cat === "Magazines & Belts") return ["Magazines", "Magazines & Belts"];
    if (cat === "Belts" || cat === "Belts & Rigs") return ["Belts", "Belts & Rigs"];
    if (cat === "Ammo Storage & Loaders" || cat === "Mags & Ammo Storage") return ["Ammo Storage & Loaders", "Mags & Ammo Storage"];
    return [cat];
  };
  const strict = (cats, slot, item) => {
    if (!item || item.category === "Firearms" || item.category === "Suppressors") return 0;
    if (!cats.includes(item.category)) return 0;
    const text = ` ${[item.name, item.brand, item.notes].join(" ")} `.toLowerCase();
    const ex = slot[4] || [];
    if (ex.some(k => text.includes(String(k).toLowerCase()))) return 0;
    const hit = (slot[2] || []).some(k => {
      const word = String(k).trim().toLowerCase();
      if (!word) return false;
      return new RegExp("(^|[^a-z0-9])" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(text);
    });
    if (!hit) return 0;
    let sc = 7;
    if (item.condition === "New" || item.condition === "Good") sc += 1;
    if (item.condition === "Needs-repair") sc -= 3;
    return Math.max(sc, 0.5);
  };
  const items = [
    ...SEED_ITEMS,
    { id: "qa-triple", name: "QA triple mag pouch", category: "Magazines & Belts", condition: "Good" },
  ];
  for (const item of items) {
    for (const category of casesFor(item.category)) {
      const probe = { ...item, category };
      for (const [id, slot] of Object.entries(live)) {
        const ours = starterSlotScore(slot, probe);
        const mains = strict(mainCats[id] || slot[1], slot, { ...probe, category: asMain(category) });
        assert.equal(ours, mains, `${item.name} on ${category} / ${id}: ${ours} vs ${mains}`);
      }
    }
  }
  const triple = { id: "qa-triple", name: "QA triple mag pouch", category: "Magazines & Belts", condition: "Good" };
  assert.equal(starterSlotScore(live.riflemag, triple), 8);
  assert.equal(strict(mainCats.riflemag, live.riflemag, triple), 8);
  const moved = answerMagazinesBelt([{ ...triple, category: "Magazines", migratedFromMagazinesBelts: true }], "move-pouches", "qa-triple", "2026-10-27T12:00:00.000Z").records[0];
  assert.equal(moved.category, "Pouches");
  assert.equal(moved.movedAt, "2026-10-27T12:00:00.000Z");
  assert.equal(starterSlotScore(live.riflemag, moved), 8);
  assert.equal(starterSlotScore(live.pistolmag, { name: "Glock pistol mag pouch", category: "Pouches", condition: "Good" }), 8);
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
  assert.equal(photoIdBlocked(false, { category: "Magazines", name: "PMAG" }), false);
  assert.equal(photoIdBlocked(false, { category: "Magazines & Belts", name: "PMAG" }), false);
  assert.equal(photoIdBlocked(false, { category: "NVG & Optics", name: "Red dot", arm: "OP" }), false);
  assert.equal(photoIdBlocked(true, { category: "NVG & Optics", name: "Red dot", arm: "OP" }), true);
  assert.equal(photoIdBlockReason(true, { category: "" }), "Choose a category before photo ID.");
  assert.equal(photoIdBlockReason(true, { category: "Pouches", name: "Admin" }), "");
});

test("photo ID never offers a restricted category as a priced suggestion", () => {
  const pricedCats = pricedPhotoCategories();
  for (const name of ["Firearms", "Suppressors", "Magazines", "Magazines & Belts", "Triggers & Parts"]) {
    assert.equal(pricedCats.includes(name), false, name);
    assert.equal(photoIdSuggestion(name), "");
  }
  assert.equal(photoIdSuggestion("Pouches"), "Pouches");
  assert.equal(photoIdSuggestion("Ammo Storage & Loaders"), "Ammo Storage & Loaders");
  assert.equal(photoIdSuggestion("Belts"), "Belts");
  assert.equal(photoIdSuggestion("Armor & Carriers"), "Armor & Carriers");
  assert.equal(photoIdSuggestion("Belts & Rigs"), "");
  assert.equal(photoIdSuggestion("Not a category"), "");
  assert.equal(photoIdSuggestion(""), "");
  assert.ok(GEAR_CATEGORIES.includes("Magazines"));
  assert.ok(GEAR_CATEGORIES.includes("Belts"));
  assert.ok(GEAR_CATEGORIES.includes("Armor & Carriers"));
  assert.ok(GEAR_CATEGORIES.includes("Triggers & Parts"));
  assert.ok(GEAR_CATEGORIES.includes(STORAGE_CATEGORY));
  assert.equal(GEAR_CATEGORIES.includes(LEGACY_STORAGE_CATEGORY), false);
  assert.equal(GEAR_CATEGORIES.includes(LEGACY_MAGAZINES_CATEGORY), false);
  assert.equal(GEAR_CATEGORIES.includes(LEGACY_BELTS_CATEGORY), false);
  assert.equal(GEAR_CATEGORIES.some(c => /linked/i.test(c)), false);
  assert.match(CATEGORY_HINTS.Magazines, /PMAG/);
  assert.match(CATEGORY_HINTS.Belts, /rigger's belt/);
  assert.match(CATEGORY_HINTS["Armor & Carriers"], /chest rig/);
  assert.doesNotMatch(Object.values(CATEGORY_HINTS).join(" "), /Android|Desktop|\bPC\b|Edge/);
});

test("the price prompt backstop names magazines over 30 rounds, ammunition belts, and auto-fire devices", () => {
  assert.match(PRICE_BACKSTOP, /magazine over 30 rounds/);
  assert.match(PRICE_BACKSTOP, /an ammunition \(linked\) belt/);
  assert.doesNotMatch(PRICE_BACKSTOP, /\ba belt\b/);
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
  assert.match(core, /showBeltRigPrompt/);
  assert.match(worker, /A plate carrier or chest rig uses Armor & Carriers/);
  assert.match(worker, /A battle belt, duty belt, or rigger's belt uses Belts/);
  assert.doesNotMatch(core, /on Mags & Ammo Storage/);
  assert.match(core, /Mags &amp; Ammo Storage/);
  assert.match(fs.readFileSync(new URL("../js/arms.js", import.meta.url), "utf8"), /photoIdSuggestion/);
  assert.match(fs.readFileSync(new URL("../js/arms.js", import.meta.url), "utf8"), /idBtn"\)\.disabled|btn\.disabled=blocked/);
});
