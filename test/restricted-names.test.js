import test from "node:test";
import assert from "node:assert/strict";
import { saleRestricted, lookupAnswerRestricted } from "../js/logic.js";

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
