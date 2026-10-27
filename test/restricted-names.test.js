import test from "node:test";
import assert from "node:assert/strict";
import { saleRestricted, lookupAnswerRestricted, pickModelAnswer, settleLookup, settleDeal, countedValue, csvExportField, keepManualPrice, gunMarketUrl, publicWeightNote } from "../js/logic.js";

test("firearm, suppressor, ammunition, and lower-receiver shelves are weight-only", () => {
  const blocked = [
    { category: "Firearms", name: "North line" },
    { category: "Suppressors", name: "Tube" },
    { category: "Ammunition", name: "Practice box" },
    { category: "Ammo", name: "Practice box" },
    { category: "Reloading", name: "Bench press" },
    { category: "Cartridges", name: "Practice box" },
    { category: "Lower receivers", name: "Widget" },
    { category: "Frames", name: "Widget" },
    { category: "Receivers", name: "Widget" },
    { category: "Silencers", name: "Tube" },
    { category: "NFA", name: "Widget" },
    { category: "Pouches", name: "Cap", arm: "FA" },
    { category: "Misc", name: "Cap", arm: "SU" },
    { kind: "ammo", name: "Practice box" },
    { tab: "ammo", category: "Misc", name: "Practice box" },
  ];
  blocked.forEach(item => assert.equal(saleRestricted(item), true, JSON.stringify(item)));
  assert.equal(saleRestricted({ category: "Mags & Ammo Storage", name: "Ammo can" }), false);
  assert.equal(saleRestricted({ category: "Knives & Tools", name: "Fold 940", arm: "KN" }), false);
  assert.equal(saleRestricted({ category: "NVG & Optics", name: "Lumen 4-16", arm: "OP" }), false);
});

test("branded gear with a model number still prices in ordinary categories", () => {
  const open = [
    ["Comms & Radios", "Harbor HT-100"],
    ["NVG & Optics", "Lumen 4-16"],
    ["Packs & Bags", "Ridge 65"],
    ["Knives & Tools", "Fold 940"],
    ["Misc", "Harbor HT-100"],
    ["Comms & Radios", "A&B + C.D"],
  ];
  open.forEach(([category, name]) => {
    const item = { category, name };
    assert.equal(saleRestricted(item), false, name);
    const priced = settleLookup(item, {
      retailNew: 40, usedLow: 20, usedHigh: 30, value: 28, weightOz: 12,
      priceNote: "Local shelf $40", weightNote: "maker spec 12 oz",
      sources: [{ label: "Local shelf", url: "https://example.com/harbor" }],
    });
    assert.equal(priced.apply, true, name);
    assert.equal(priced.retailNew, 40, name);
    assert.equal(priced.value, 28, name);
    assert.equal(priced.sources.length, 1, name);
  });
});

test("a blocked shelf keeps a typed price and drops a market price", () => {
  const rifle = { category: "Firearms", name: "North line", retailNew: 1800, value: 1500, priceSource: "market", valueSource: "market" };
  const typed = keepManualPrice({ ...rifle, priceSource: "manual", valueSource: "manual" }, true);
  assert.equal(typed.retailNew, 1800);
  assert.equal(typed.value, 1500);
  assert.equal(typed.priceSource, "manual");
  assert.equal(typed.valueSource, "manual");
  assert.equal(countedValue(typed), 1500);
  assert.equal(csvExportField(typed, "retailNew"), 1800);
  assert.equal(csvExportField(typed, "value"), 1500);

  const fromForm = keepManualPrice({ ...rifle, retailNew: 1800, value: 1500 }, true);
  assert.equal(fromForm.priceSource, "manual");
  assert.equal(fromForm.valueSource, "manual");
  assert.equal(countedValue(fromForm), 1500);

  const leftover = keepManualPrice({ ...rifle, retailNew: 0, value: 0 }, false);
  assert.equal(leftover.retailNew, 0);
  assert.equal(leftover.value, 0);
  assert.equal(countedValue(leftover), 0);
  assert.equal(csvExportField(leftover, "retailNew"), "");

  const settled = settleLookup({ category: "Firearms", name: "North line" }, {
    retailNew: 900, value: 800, weightOz: 40, weightNote: "four hundred at the village outfitter",
    sources: [{ label: "listing", url: "https://www.gunbroker.com/item/1" }],
  });
  assert.equal(settled.apply, true);
  assert.equal(settled.retailNew, null);
  assert.equal(settled.value, null);
  assert.equal(settled.weightOz, 40);
  assert.equal(settled.weightNote, "");
  assert.deepEqual(settled.sources, []);
  const clientAsked = settleLookup({ category: "Suppressors", name: "Tube", weightOnly: false }, {
    retailNew: 500, value: 400, weightOz: 8, weightNote: "maker spec 8 oz",
  });
  assert.equal(clientAsked.retailNew, null);
  assert.equal(clientAsked.weightNote, "maker spec 8 oz");
});

test("a firearm retailer link is removed in every category and the price stays", () => {
  const coat = { category: "Comms & Radios", name: "Harbor HT-100" };
  const mixed = settleLookup(coat, {
    retailNew: 40, value: 28, weightOz: 12, priceNote: "Local shelf $40. See https://www.luckygunner.com/rifle",
    sources: [
      { label: "Local shelf", url: "https://example.com/harbor" },
      { label: "listing", url: "https://www.gunbroker.com/item/77" },
      { label: "Arms list", url: "https://www.armslist.com/posts/1" },
      { label: "Guns America", url: "https://www.gunsamerica.com/77" },
      { label: "Palmetto", url: "https://palmettostatearmory.com/rifle" },
      { label: "Seek", url: "https://ammoseek.com/ammo" },
      { label: "Lucky", url: "https://www.luckygunner.com/rifle" },
      { label: "Shop", url: "https://www.silencershop.com/tube" },
      { label: "Brownells rifle", url: "https://www.brownells.com/firearms/north-line/" },
      { label: "Brownells sling", url: "https://www.brownells.com/slings/harbor-sling/" },
    ],
  });
  assert.equal(mixed.retailNew, 40);
  assert.equal(mixed.value, 28);
  assert.equal(mixed.sources.map(s => s.label).join(","), "Local shelf,Brownells sling");
  assert.equal(mixed.priceNote.includes("luckygunner"), false);
  assert.equal(lookupAnswerRestricted({ sources: mixed.sources }), false);
  assert.equal(gunMarketUrl("https://www.brownells.com/slings/harbor-sling/"), false);
  assert.equal(gunMarketUrl("https://www.rei.com/kywi-556"), false);
  assert.equal(lookupAnswerRestricted({
    priceNote: "REI $229.50, fits a small frame",
    weightNote: "24 x 12",
    sources: [{ label: "REI", url: "https://www.rei.com/product/556" }],
  }), false);

  const deal = settleDeal(coat, {
    price: 40, where: "Local shelf", url: "https://www.gunbroker.com/item/77", note: "Used, $40.50 shipped",
  });
  assert.equal(deal.price, 40);
  assert.equal(deal.url, "");
  assert.match(deal.note, /40\.50/);
  const blockedDeal = settleDeal({ category: "Ammo", name: "Practice box" }, {
    price: 1, url: "https://example.com/box", note: "in stock",
  });
  assert.equal(blockedDeal.price, null);
  assert.equal(blockedDeal.url, "");
});

test("more than one JSON object cannot return a marketplace link", () => {
  const text = '{"retailNew":40,"value":28,"sources":[{"label":"Local shelf","url":"https://example.com/harbor"}]} {"retailNew":40,"value":28,"url":"https://www.gunbroker.com/item/77","sources":[{"label":"listing","url":"https://www.luckygunner.com/rifle"}]}';
  const picked = pickModelAnswer(text);
  assert.equal(picked.linksDropped, true);
  assert.deepEqual(picked.sources, []);
  assert.equal(picked.url, "");
  assert.equal(picked.retailNew, 40);
  const settled = settleLookup({ category: "Packs & Bags", name: "Ridge 65" }, picked);
  assert.equal(settled.retailNew, 40);
  assert.deepEqual(settled.sources, []);
  const one = pickModelAnswer('{"retailNew":40,"sources":[{"label":"Local shelf","url":"https://example.com/harbor"},{"label":"listing","url":"https://www.silencershop.com/tube"}]}');
  assert.equal(one.linksDropped, undefined);
  assert.equal(one.sources.length, 1);
  assert.equal(one.sources[0].url, "https://example.com/harbor");
});

test("a restricted weight note drops spelled amounts and retailer words", () => {
  assert.equal(publicWeightNote("four hundred at the village outfitter"), "");
  assert.equal(publicWeightNote("two fifty from a corner shop"), "");
  assert.equal(publicWeightNote("picked up at a local retailer"), "");
  assert.equal(publicWeightNote("maker spec 24.5 oz"), "maker spec 24.5 oz");
  assert.equal(publicWeightNote("two point sling spec"), "two point sling spec");
});
