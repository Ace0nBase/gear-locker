import test from "node:test";
import assert from "node:assert/strict";
import { saleRestricted, lookupAnswerRestricted, normalizeGearLabel, settleLookup, settleDeal, countedValue } from "../js/logic.js";

// Pattern fixtures. These names are not the QA lists.
test("a firearm, suppressor, frame, or ammunition category is weight-only for every name", () => {
  assert.equal(saleRestricted({ category: "Firearms", name: "Blue sticker" }), true);
  assert.equal(saleRestricted({ category: "Suppressors", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "Ammunition", name: "Practice box" }), true);
  assert.equal(saleRestricted({ category: "Ammo", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "Lower receivers", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "Frames", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "Pouches", name: "Cap", arm: "FA" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Cap", arm: "SU" }), true);
  assert.equal(saleRestricted({ category: "Mags & Ammo Storage", name: "PMAG 30" }), false);
  assert.equal(saleRestricted({ category: "Mags & Ammo Storage", name: "Ammo can" }), false);
});

test("a missing or unknown category still catches a clear caliber, cartridge, or NFA word", () => {
  const restricted = [
    { category: "", name: "6.8 Western" },
    { category: "Zed", name: "25-06" },
    { category: "", name: "7mm-08" },
    { category: "Oddball", name: "large rifle primers" },
    { category: "Misc", name: "16 gauge" },
    { category: "Misc", name: "410 bore" },
    { category: "Misc", name: "00 buck" },
    { category: "Misc", name: "once-fired brass" },
    { category: "Misc", name: "reloading powder" },
    { category: "Misc", name: "drop-in sear" },
    { category: "Misc", name: "baffle cup" },
    { category: "Misc", name: "form paper SBR" },
    { category: "Misc", name: "short barreled SBS" },
    { category: "Misc", name: "Nockon 77" },
    { category: "Misc", name: "Arbor M2" },
    { name: "Range fodder", caliber: "6.8 Western", load: "120gr", rounds: 40 },
  ];
  restricted.forEach(item => assert.equal(saleRestricted(item), true, JSON.stringify(item)));
});

test("gun accessories and look-alike gear keep their prices", () => {
  const open = [
    ["Clothing & Boots", "shell jacket"],
    ["Clothing & Boots", "canvas shell coat"],
    ["Misc", "hitch receiver"],
    ["Misc", "trailer hitch receiver"],
    ["NVG & Optics", "LPVO 1-6x24"],
    ["NVG & Optics", "1-8x24 glass"],
    ["Medical", "P100 filter"],
    ["Comms & Radios", "shotgun mic"],
    ["Comms & Radios", "boom shotgun microphone"],
    ["Belts & Rigs", "pistol belt"],
    ["Belts & Rigs", "duty pistol belt"],
    ["Cases & Bags", "suppressor cover"],
    ["Cases & Bags", "nylon suppressor cover"],
    ["Misc", "bolt carrier group"],
    ["Misc", "complete upper"],
    ["Misc", "steel pistol slide"],
    ["Holsters & Slings", "fits Nockon 19 holster"],
    ["Pouches", "double mag pouch"],
    ["Cleaning & Maintenance", "rod and patch kit"],
    ["Holsters & Slings", "two point sling"],
    ["NVG & Optics", "red dot optic"],
    ["Misc", "desk lamp 60"],
  ];
  open.forEach(([category, name]) => assert.equal(saleRestricted({ category, name }), false, name));
});

test("digit-for-letter spellings fold before the sale check, and model numbers stay numbers", () => {
  assert.equal(saleRestricted({ category: "Misc", name: "b4ffle cup" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "s3ar" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "n0ckon 77" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "\uFF15ilencer" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "h0lster" }), false);
  assert.equal(saleRestricted({ category: "Clothing & Boots", name: "c4nvas field coat" }), false);
  assert.equal(saleRestricted({ category: "Comms & Radios", name: "b0om mic" }), false);
  assert.match(normalizeGearLabel("b0om mic"), /boom/);
  assert.equal(saleRestricted({ category: "Misc", name: "10mm wrench" }), false);
  assert.match(normalizeGearLabel("b4ffle-cup"), /baffle/);
  assert.match(normalizeGearLabel("10mm wrench"), /10mm/);
});

test("a model classification of restricted strips the price, and a bad answer does not unlock one", () => {
  const coat = { category: "Clothing & Boots", name: "Parcel coat" };
  assert.equal(saleRestricted(coat), false);
  const blocked = settleLookup(coat, {
    restricted: true, retailNew: 250, usedLow: 100, usedHigh: 180, value: 160, weightOz: 18,
    priceNote: "REI $250", weightNote: "Midway: 899.99",
    sources: [{ label: "REI", url: "https://www.rei.com/parcel-coat" }],
  });
  assert.equal(blocked.apply, true);
  assert.equal(blocked.restricted, true);
  assert.equal(blocked.retailNew, null);
  assert.equal(blocked.usedLow, null);
  assert.equal(blocked.usedHigh, null);
  assert.equal(blocked.value, null);
  assert.equal(blocked.priceNote, "");
  assert.equal(blocked.weightNote, "");
  assert.deepEqual(blocked.sources, []);
  assert.equal(blocked.weightOz, 18);
  assert.equal(saleRestricted({ ...coat, modelRestricted: true }), true);
  assert.equal(countedValue({ ...coat, modelRestricted: true, value: 160, priceSource: "market" }), 0);

  for (const parsed of [null, {}, { retailNew: 80, value: 70 }, { restricted: "yes", retailNew: 80 }, { restricted: 1, value: 10 }]) {
    const missed = settleLookup(coat, parsed);
    assert.equal(missed.apply, false, JSON.stringify(parsed));
    assert.equal(missed.retailNew, undefined);
  }
  const already = settleLookup({ category: "Firearms", name: "Blue sticker" }, { retailNew: 900, weightOz: 40, weightNote: "Midway: 899.99" });
  assert.equal(already.apply, true);
  assert.equal(already.restricted, true);
  assert.equal(already.retailNew, null);
  assert.equal(already.weightNote, "");
  assert.equal(already.weightOz, 40);
  const unlocked = settleLookup({ category: "Firearms", name: "Blue sticker" }, {
    restricted: false, retailNew: 900, value: 800, priceNote: "shop $900",
    sources: [{ label: "REI", url: "https://www.rei.com/sticker" }],
  });
  assert.equal(unlocked.restricted, true);
  assert.equal(unlocked.retailNew, null);
  assert.equal(unlocked.priceNote, "");
  assert.deepEqual(unlocked.sources, []);
});

test("a benign look-alike keeps its price when the model says it is not restricted", () => {
  const coat = { category: "Clothing & Boots", name: "Parcel coat" };
  const kept = settleLookup(coat, {
    restricted: false, retailNew: 89, usedLow: 40, usedHigh: 70, value: 60, weightOz: 18,
    priceNote: "REI $89.50, fits a small frame", weightNote: "maker spec 18 oz",
    sources: [{ label: "REI", url: "https://www.rei.com/parcel-coat" }],
  });
  assert.equal(kept.apply, true);
  assert.equal(kept.restricted, false);
  assert.equal(kept.retailNew, 89);
  assert.equal(kept.value, 60);
  assert.match(kept.priceNote, /89\.50/);
  assert.equal(kept.weightNote, "maker spec 18 oz");
  assert.equal(kept.sources.length, 1);
  const deal = settleDeal(coat, {
    restricted: false, price: 89.5, where: "REI", url: "https://www.rei.com/parcel-coat",
    condition: "used", note: "Used, $250.30 shipped, fits a small frame",
  });
  assert.equal(deal.restricted, false);
  assert.equal(deal.price, 89.5);
  assert.match(deal.note, /250\.30/);
  assert.match(deal.url, /rei\.com/);
  const dropped = settleDeal(coat, {
    restricted: true, price: 40, where: "REI", url: "https://www.rei.com/parcel-coat", note: "Midway: 899.99",
  });
  assert.equal(dropped.restricted, true);
  assert.equal(dropped.price, null);
  assert.equal(dropped.url, "");
  assert.equal(dropped.where, "");
  assert.equal(dropped.note, "");
  const broken = settleDeal(coat, { price: 40, where: "REI", url: "https://www.rei.com/parcel-coat", note: "$40" });
  assert.equal(broken.restricted, false);
  assert.equal(broken.price, null);
  assert.equal(broken.url, "");
});

test("a price note or a size in a link does not wipe an ordinary item", () => {
  assert.equal(lookupAnswerRestricted({
    restricted: false,
    priceNote: "REI $229.50, fits Glock 19",
    weightNote: "24 x 12",
    sources: [{ label: "REI", url: "https://www.rei.com/product/556" }],
  }), false);
  assert.equal(lookupAnswerRestricted({
    priceNote: "Amazon $1,300",
    sources: [{ label: "Amazon", url: "https://www.amazon.com/dp/30mm" }],
  }), false);
  assert.equal(lookupAnswerRestricted({
    sources: [{ label: "listing", url: "https://www.gunbroker.com/item/1" }],
  }), true);
});
