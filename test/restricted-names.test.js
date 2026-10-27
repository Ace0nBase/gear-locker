import test from "node:test";
import assert from "node:assert/strict";
import { saleRestricted, lookupAnswerRestricted, pickModelAnswer, settleLookup, settleDeal, countedValue, csvExportField, keepManualPrice, gunMarketUrl, stripGunMarketText, publicWeightNote, applyMarketPrices, stampManualPrices, mergeByServerTime, serverRow } from "../js/logic.js";

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
  assert.equal(saleRestricted({ category: "Ammo Storage & Loaders", name: "Ammo can" }), false);
  assert.equal(saleRestricted({ category: "Magazines", name: "PMAG 30" }), true);
  assert.equal(saleRestricted({ category: "Magazines & Belts", name: "PMAG 30" }), true);
  assert.equal(saleRestricted({ category: "Belts", name: "AWS SMU" }), false);
  assert.equal(saleRestricted({ category: "Triggers & Parts", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "bump stock" }), false);
  assert.equal(saleRestricted({ category: "Pouches", name: "30 round magazine" }), false);
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

test("a blocked shelf keeps a typed price and drops a prefilled market price", () => {
  const rifle = { category: "Firearms", name: "North line", condition: "Good", retailNew: 1800, value: 1500, priceSource: "market", valueSource: "market" };
  const typed = keepManualPrice({ ...rifle, priceSource: "manual", valueSource: "manual" }, { retail: false, value: false, retailWasManual: true, valueWasManual: true });
  assert.equal(typed.retailNew, 1800);
  assert.equal(typed.value, 1500);
  assert.equal(typed.priceSource, "manual");
  assert.equal(typed.valueSource, "manual");
  assert.equal(countedValue(typed), 1500);
  assert.equal(csvExportField(typed, "retailNew"), 1800);
  assert.equal(csvExportField(typed, "value"), 1500);

  const fromForm = keepManualPrice({ ...rifle, retailNew: 1800, value: 1500 }, { retail: true, value: true, retailWasManual: false, valueWasManual: false });
  assert.equal(fromForm.priceSource, "manual");
  assert.equal(fromForm.valueSource, "manual");
  assert.equal(countedValue(fromForm), 1500);

  const derived = keepManualPrice({ ...rifle, retailNew: 1800, value: 1260, priceSource: "market" }, { retail: true, value: false, retailWasManual: false, valueWasManual: false });
  assert.equal(derived.retailNew, 1800);
  assert.equal(derived.value, 1260);
  assert.equal(derived.priceSource, "manual");
  assert.equal(derived.valueSource, "manual");

  const leftover = keepManualPrice({ ...rifle, retailNew: 0, value: 0 }, { retail: false, value: false });
  assert.equal(leftover.retailNew, 0);
  assert.equal(leftover.value, 0);
  assert.equal(leftover.priceSource, undefined);
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

test("moving an auto-priced item onto a blocked shelf clears the price instead of converting it", () => {
  const market = {
    name: "North line", condition: "Good", retailNew: 40, value: 28,
    priceSource: "market", valueSource: "market", priceDate: "2026-10-27",
    priceNote: "Local shelf", usedLow: 20, usedHigh: 30,
    marketSources: [{ label: "Local shelf", url: "https://example.com/gear" }],
    link: "https://example.com/gear", deal: { price: 30 },
  };
  const quiet = { retail: false, value: false, retailWasManual: false, valueWasManual: false };
  const paths = [
    { category: "Firearms", arm: "" },
    { category: "Suppressors", arm: "" },
    { category: "Pouches", arm: "FA" },
    { category: "Misc", arm: "SU" },
  ];
  paths.forEach(path => {
    const cleared = keepManualPrice({ ...market, ...path }, quiet);
    const label = path.category + " " + path.arm;
    assert.equal(cleared.retailNew, 0, label);
    assert.equal(cleared.value, 0, label);
    assert.equal(cleared.priceSource, undefined, label);
    assert.equal(cleared.valueSource, undefined, label);
    assert.equal(cleared.priceDate, undefined, label);
    assert.equal(cleared.priceNote, undefined, label);
    assert.equal(cleared.deal, undefined, label);
    assert.equal(cleared.link, "", label);
    assert.deepEqual(cleared.marketSources, [], label);
    assert.equal(countedValue(cleared), 0, label);
    assert.equal(csvExportField(cleared, "retailNew"), "", label);
    assert.equal(csvExportField(cleared, "value"), "", label);
  });
  const back = { ...keepManualPrice({ ...market, category: "Firearms" }, quiet), category: "Pouches", arm: "" };
  assert.equal(saleRestricted(back), false);
  assert.equal(back.priceSource, undefined);
  assert.equal(back.valueSource, undefined);
  const priced = settleLookup(back, {
    retailNew: 40, value: 28, weightOz: 12,
    sources: [{ label: "Local shelf", url: "https://example.com/gear" }],
  });
  assert.equal(priced.retailNew, 40);
  assert.equal(priced.value, 28);
  assert.equal(priced.sources.length, 1);
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
      { label: "Brownells parts", url: "https://www.brownells.com/rifle-parts/" },
    ],
  });
  assert.equal(mixed.retailNew, 40);
  assert.equal(mixed.value, 28);
  assert.equal(mixed.sources.map(s => s.label).join(","), "Local shelf,Brownells sling,Brownells parts");
  assert.equal(gunMarketUrl("https://www.brownells.com/rifle-parts/"), false);
  assert.equal(mixed.priceNote.includes("luckygunner"), false);
  assert.equal(lookupAnswerRestricted({ sources: mixed.sources }), false);
  assert.equal(gunMarketUrl("https://www.brownells.com/slings/harbor-sling/"), false);
  assert.equal(gunMarketUrl("https://www.brownells.com/guns/north-line/"), true);
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
  const noted = settleDeal(coat, {
    price: 40, where: "Local shelf", url: "https://example.com/deal",
    note: "Used $40.50, see gunbroker.com/item/1 and https://bit.ly/abc",
  });
  assert.equal(noted.price, 40);
  assert.match(noted.note, /40\.50/);
  assert.equal(/gunbroker|bit\.ly/i.test(noted.note), false);
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

test("bare domains, redirects, shorteners, and firearm-seller pages drop", () => {
  assert.equal(stripGunMarketText("See gunbroker.com/item/1 today"), "See today");
  assert.equal(stripGunMarketText("armslist.com"), "");
  assert.equal(stripGunMarketText("www.psa.com"), "");
  assert.equal(stripGunMarketText("Check GUNBROKER.COM. today"), "Check today");
  assert.equal(stripGunMarketText("https://gunbroker.com./item/1"), "");
  assert.equal(stripGunMarketText("fits a small frame $250.30"), "fits a small frame $250.30");
  assert.equal(stripGunMarketText("maker spec 24.5 oz"), "maker spec 24.5 oz");
  assert.equal(stripGunMarketText("Primary Arms page"), "Primary Arms page");
  assert.equal(gunMarketUrl("https://www.google.com/url?q=https%3A%2F%2Fwww.gunbroker.com%2Fitem%2F1"), true);
  assert.equal(gunMarketUrl("https://www.google.com/url?u=https%3A%2F%2Fexample.com%2Fgear"), false);
  assert.equal(gunMarketUrl("https://www.google.com/url?url=https%3A%2F%2Fbit.ly%2Fabc"), true);
  ["https://bit.ly/abc", "https://tinyurl.com/x", "https://t.co/x", "https://goo.gl/x", "https://ow.ly/x", "https://rebrand.ly/x", "https://cutt.ly/x", "https://is.gd/x"].forEach(url => {
    assert.equal(gunMarketUrl(url), true, url);
  });
  assert.equal(gunMarketUrl("https://notaco.com/x"), false);
  const sellers = [
    "https://slickguns.com/1",
    "https://truegunvalue.com/1",
    "https://www.targetsportsusa.com/1",
    "https://ammo.com/556",
    "https://www.ammunitiondepot.com/1",
    "https://ammobuy.com/1",
    "https://www.silencercentral.com/1",
    "https://capitolarmory.com/1",
    "https://www.budsgunshop.com/1",
    "https://grabagun.com/1",
    "https://www.guns.com/1",
    "https://www.classicfirearms.com/1",
    "https://gun.deals/1",
    "https://wikiarms.com/1",
  ];
  sellers.forEach(url => assert.equal(gunMarketUrl(url), true, url));
  assert.equal(gunMarketUrl("https://www.sportsmans.com/shooting/firearms/north-line/"), true);
  assert.equal(gunMarketUrl("https://www.sportsmanswarehouse.com/guns/north-line/"), true);
  assert.equal(gunMarketUrl("https://www.sportsmans.com/camping/tent/"), false);
  assert.equal(gunMarketUrl("https://www.primaryarms.com/guns/ar"), true);
  assert.equal(gunMarketUrl("https://www.primaryarms.com/optics/red-dot"), false);
  assert.equal(gunMarketUrl("https://www.natchezss.com/ammo/practice-box/"), true);
  assert.equal(gunMarketUrl("https://www.natchezss.com/clothing/coat/"), false);
  assert.equal(gunMarketUrl("https://www.cabelas.com/shop/en/firearms"), true);
  assert.equal(gunMarketUrl("https://www.cabelas.com/shop/en/fishing"), false);
  assert.equal(gunMarketUrl("https://www.basspro.com/shop/en/firearms"), true);
  assert.equal(gunMarketUrl("https://www.basspro.com/shop/en/boats"), false);
  const wrapped = encodeURIComponent("https://www.gunbroker.com/item/1");
  assert.equal(gunMarketUrl("https://evil.example/?u=" + wrapped), true);
  assert.equal(gunMarketUrl("https://l.facebook.com/l.php?u=" + wrapped), true);
  assert.equal(gunMarketUrl("https://out.reddit.com/out?url=" + wrapped), true);
  assert.equal(gunMarketUrl("https://duckduckgo.com/l/?uddg=" + wrapped), true);
  assert.equal(gunMarketUrl("https://www.google.co.uk/url?q=" + wrapped), true);
  assert.equal(gunMarketUrl("https://www.google.de/url?q=" + encodeURIComponent("https://example.com/gear")), false);
  assert.equal(gunMarketUrl("https://evil.example/?target=" + wrapped), true);
  assert.equal(gunMarketUrl("https://evil.example/?dest=" + wrapped), true);
  assert.equal(gunMarketUrl("https://evil.example/?redirect=" + wrapped), true);
  assert.equal(gunMarketUrl("https://evil.example/?redirect_url=" + wrapped), true);
  assert.equal(gunMarketUrl("https://evil.example/?to=" + wrapped), true);
  assert.equal(gunMarketUrl("https://evil.example/?u=" + encodeURIComponent("https://example.com/gear")), false);
  const nested = "https://evil.example/?u=" + encodeURIComponent("https://l.facebook.com/l.php?u=" + encodeURIComponent("https://duckduckgo.com/l/?uddg=" + wrapped));
  assert.equal(gunMarketUrl(nested), true);
  ["https://shorturl.at/abc", "https://rb.gy/abc", "https://tiny.cc/abc", "https://s.id/abc", "https://buff.ly/abc", "https://lnkd.in/abc", "https://bl.ink/abc", "https://t.ly/abc", "https://v.gd/abc", "https://x.co/abc", "https://qr.ae/abc", "https://shorte.st/abc", "https://adf.ly/abc", "https://linktr.ee/redirects/abc"].forEach(url => {
    assert.equal(gunMarketUrl(url), true, url);
  });
  assert.equal(gunMarketUrl("https://linktr.ee/harbor"), false);
  ["rainierarms.com", "ruger.com", "glock.com", "sgammo.com", "bulkammo.com", "dkfirearms.com", "gunbuyer.com", "gunprime.com", "ar15.com"].forEach(host => {
    assert.equal(gunMarketUrl(`https://www.${host}/rifle-scopes/`), true, host);
  });
  const redirected = settleLookup({ category: "Comms & Radios", name: "Harbor HT-100" }, {
    retailNew: 40, value: 28, priceNote: "Local shelf https://www.google.com/url?q=https%3A%2F%2Fgunbroker.com%2Fitem%2F1",
    sources: [
      { label: "Local shelf", url: "https://example.com/harbor" },
      { label: "redirect", url: "https://www.google.com/url?u=https%3A%2F%2Fwww.guns.com%2F1" },
      { label: "short", url: "https://bit.ly/abc" },
    ],
  });
  assert.equal(redirected.retailNew, 40);
  assert.equal(/gunbroker/i.test(redirected.priceNote), false);
  assert.deepEqual(redirected.sources.map(s => s.label), ["Local shelf"]);
});

test("firearm pages match a whole path segment and gear pages stay", () => {
  const blocked = ["firearms", "guns", "handguns", "rifles", "pistols", "shotguns", "ammo", "ammunition", "suppressors", "lowers"];
  blocked.forEach(seg => {
    assert.equal(gunMarketUrl(`https://www.brownells.com/${seg}/north-line/`), true, seg);
    assert.equal(gunMarketUrl(`https://www.midwayusa.com/${seg}`), true, seg + " trailing");
    assert.equal(gunMarketUrl(`https://www.OpticsPlanet.com/${seg.toUpperCase()}/`), true, seg + " case");
  });
  const gear = ["rifle-scopes", "pistol-holsters", "rifle-slings", "weapon-lights", "pistol-red-dots", "rifle-cleaning-kits", "rifle-cases", "ammo-cans"];
  const stores = ["brownells.com", "primaryarms.com", "midwayusa.com", "opticsplanet.com", "academy.com", "scheels.com", "sportsmansguide.com", "eurooptic.com", "sigsauer.com", "budk.com"];
  gear.forEach(seg => {
    stores.forEach(host => assert.equal(gunMarketUrl(`https://www.${host}/${seg}/`), false, host + " " + seg));
  });
  assert.equal(gunMarketUrl("https://www.sigsauer.com/pistols"), true);
  assert.equal(gunMarketUrl("https://www.academy.com/camping/tent/"), false);
});

test("a typed price on ordinary gear is not replaced by a market lookup", () => {
  const lookup = {
    retailNew: 40, usedLow: 20, usedHigh: 30, value: 28, priceNote: "Local shelf",
    sources: [{ label: "Local shelf", url: "https://example.com/gear" }],
  };
  const typedRetail = applyMarketPrices({
    category: "Pouches", name: "Parcel coat", condition: "Good",
    retailNew: 180, value: 126, priceSource: "manual",
  }, lookup, "2026-10-27");
  assert.equal(typedRetail.retailNew, 180);
  assert.equal(typedRetail.priceSource, "manual");
  assert.equal(typedRetail.value, 28);
  assert.equal(typedRetail.usedLow, 20);

  const typedValue = applyMarketPrices({
    category: "Pouches", name: "Parcel coat", retailNew: 0, value: 90, valueSource: "manual",
  }, lookup, "2026-10-27");
  assert.equal(typedValue.value, 90);
  assert.equal(typedValue.valueSource, "manual");
  assert.equal(typedValue.retailNew, 40);
  assert.equal(typedValue.priceSource, "market");

  const typedBoth = applyMarketPrices({
    category: "Comms & Radios", name: "Harbor HT-100",
    retailNew: 55, value: 40, priceSource: "manual", valueSource: "manual",
  }, lookup, "2026-10-27");
  assert.equal(typedBoth.retailNew, 55);
  assert.equal(typedBoth.value, 40);
  assert.equal(typedBoth.priceSource, "manual");
  assert.equal(typedBoth.valueSource, "manual");

  const empty = applyMarketPrices({ category: "Pouches", name: "Parcel coat", condition: "Good" }, lookup, "2026-10-27");
  assert.equal(empty.retailNew, 40);
  assert.equal(empty.value, 28);
  assert.equal(empty.priceSource, "market");
  assert.equal(empty.priceDate, "2026-10-27");
});

test("an edited retail and insured value survive the snapshot, a reload, and the next lookups", () => {
  const before = {
    id: "p1", category: "Pouches", name: "Parcel coat", condition: "Good",
    retailNew: 40, value: 28, priceSource: "market", valueSource: "market",
    updatedAt: "2026-10-26T01:00:00.000Z",
  };
  const draft = { ...before, retailNew: 90, value: 333, updatedAt: "2026-10-27T01:00:00.000Z" };
  const saved = stampManualPrices(draft, before, { retail: true, value: true });
  assert.equal(saved.retailNew, 90);
  assert.equal(saved.value, 333);
  assert.equal(saved.priceSource, "manual");
  assert.equal(saved.valueSource, "manual");
  assert.equal(saved.updatedAt, draft.updatedAt);
  const echo = { ...saved, serverUpdatedAt: "2026-10-27T01:00:01.000Z", writeId: "w1" };
  const merged = mergeByServerTime(saved, echo, { p1: { writeId: "w1", updatedAt: saved.updatedAt } });
  assert.equal(merged.priceSource, "manual");
  assert.equal(merged.valueSource, "manual");
  assert.equal(merged.retailNew, 90);
  assert.equal(merged.value, 333);
  const reloaded = serverRow(JSON.parse(JSON.stringify(saved)));
  const lookup = { retailNew: 40, usedLow: 20, usedHigh: 30, value: 28, priceNote: "Local shelf", sources: [] };
  const checked = applyMarketPrices(reloaded, lookup, "2026-10-27");
  const lookedUp = applyMarketPrices(checked, lookup, "2026-10-27");
  assert.equal(lookedUp.retailNew, 90);
  assert.equal(lookedUp.value, 333);
  assert.equal(lookedUp.priceSource, "manual");
  assert.equal(lookedUp.valueSource, "manual");
});

test("a typed insured value stays when the item moves to Firearms", () => {
  const before = {
    id: "p1", category: "Pouches", name: "Parcel coat", condition: "Good",
    retailNew: 40, value: 333, priceSource: "market", valueSource: "manual",
    priceNote: "Local shelf", marketSources: [{ label: "Local shelf", url: "https://example.com/gear" }],
    link: "https://example.com/gear",
  };
  const saved = stampManualPrices({ ...before, category: "Firearms" }, before, { retail: false, value: false });
  assert.equal(saved.value, 333);
  assert.equal(saved.valueSource, "manual");
  assert.equal(saved.retailNew, 0);
  assert.equal(saved.priceSource, undefined);
  assert.equal(saved.priceNote, undefined);
  assert.equal(countedValue(saved), 333);
  const auto = stampManualPrices(
    { ...before, value: 28, valueSource: "market", category: "Suppressors" },
    { ...before, value: 28, valueSource: "market" },
    { retail: false, value: false },
  );
  assert.equal(auto.value, 0);
  assert.equal(auto.valueSource, undefined);
  assert.equal(auto.retailNew, 0);
  assert.equal(countedValue(auto), 0);
});

test("a redirect chain deeper than three hops is dropped", () => {
  const safe = "https://example.com/gear";
  const wrap = url => "https://evil.example/?u=" + encodeURIComponent(url);
  const three = wrap(wrap(wrap(safe)));
  const four = wrap(three);
  assert.equal(gunMarketUrl(three), false);
  assert.equal(gunMarketUrl(four), true);
  const gun = encodeURIComponent("https://www.gunbroker.com/item/1");
  assert.equal(gunMarketUrl("https://evil.example/?u=" + encodeURIComponent(safe) + "&q=" + gun), true);
  ["next", "link", "r", "goto", "out"].forEach(key => {
    assert.equal(gunMarketUrl("https://evil.example/?" + key + "=" + gun), true, key);
  });
  assert.equal(gunMarketUrl("https://example.com/gear?r=1"), false);
  assert.equal(gunMarketUrl("https://evil.example/?r=1&next=" + encodeURIComponent(safe)), false);
});

test("a file extension does not hide a firearm path segment", () => {
  const pages = ["firearms.html", "guns.php", "nfa.htm", "silencers.aspx", "suppressor", "silencer", "silencers", "reloading", "receivers", "lower-receivers.php", "stripped-lowers"];
  pages.forEach(seg => assert.equal(gunMarketUrl(`https://www.brownells.com/${seg}`), true, seg));
  assert.equal(gunMarketUrl("https://www.opticsplanet.com/rifle-scopes.html"), false);
  assert.equal(gunMarketUrl("https://www.midwayusa.com/rifle-parts/"), false);
});

test("a restricted weight note drops spelled amounts and retailer words", () => {
  assert.equal(publicWeightNote("four hundred at the village outfitter"), "");
  assert.equal(publicWeightNote("two fifty from a corner shop"), "");
  assert.equal(publicWeightNote("picked up at a local retailer"), "");
  assert.equal(publicWeightNote("maker spec 24.5 oz"), "maker spec 24.5 oz");
  assert.equal(publicWeightNote("two point sling spec"), "two point sling spec");
});
