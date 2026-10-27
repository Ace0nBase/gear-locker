import test from "node:test";
import assert from "node:assert/strict";
import { saleRestricted } from "../js/logic.js";

// QA's 355-name list from the PR #5 retest. R is restricted, U is unrestricted.
const R = true, U = false;
const cases = [
 // N1 brief cases, every category
 ...["Cleaning & Maintenance","Cases & Bags","Pouches","Misc","NVG & Optics","Holsters & Slings","Comms & Radios","Medical","Packs & Bags","Mags & Ammo Storage","Knives & Tools","Lights & Lasers","Clothing & Boots","Belts & Rigs","Armor & Carriers","Helmet & Head"].flatMap(c => [
   [c,"Suppressor",R],[c,"Glock 19",R],[c,"AR-15 lower",R],[c,"9mm 124gr FMJ",R],[c,"5.56 green tip",R],[c,"can",R],[c,"P365",R],[c,".308",R]]),
 // casing / spacing
 ["Misc","SUPPRESSOR",R],["Misc","SuPpReSsOr",R],["Misc","glock19",R],["Misc","GLOCK 19X",R],["Misc","Glock-19",R],["Misc","Glock  19",R],["Misc","G19",R],["Misc","G17 Gen 5",R],["Misc","p 365",R],["Misc","P365XL",R],["Misc","Sig P320",R],["Misc","Sig P226",R],["Misc","Sig MCX",R],["Misc","Ruger 10/22",R],["Misc","Mossberg 590",R],["Misc","Remington 870",R],["Misc","M&P 15",R],["Misc","M&P15",R],["Misc","M&P Shield",R],["Misc","1911",R],["Misc","AK-47",R],["Misc","AK47",R],["Misc","AR-15",R],["Misc","AR15",R],["Misc","Colt 6920",R],["Misc","Daniel Defense DDM4",R],["Misc","HK416",R],["Misc","CZ Scorpion",R],["Misc","Beretta 92FS",R],["Misc","Springfield Hellcat",R],["Misc","Taurus G2C",R],["Misc","Kimber Micro 9",R],["Misc","Henry lever action",R],["Misc","Savage 110",R],["Misc","Tikka T3x",R],
 // misspellings
 ["Misc","supressor",R],["Misc","suppresor",R],["Misc","surpressor",R],["Misc","supresser",R],["Misc","silencor",R],["Misc","sillencer",R],["Misc","moderator",R],["Misc","muzzle can",R],["Misc","SiCo Omega 300",R],["Misc","SilencerCo Omega",R],["Misc","Dead Air Sandman",R],["Misc","Surefire SOCOM556 can",R],["Misc","solvent trap kit",R],["Misc","Thunder Beast Ultra 9",R],["Misc","Rugged Obsidian 45",R],["Misc","HUXWRX Flow",R],["Misc","oil filter adapter",R],["Misc","fuel filter kit 1/2x28",R],
 // receivers/frames
 ["Misc","80 lower",R],["Misc","80% lower",R],["Misc","receiver",R],["Misc","Sig P320 FCU",R],["Misc","stripped lower",R],["Misc","lower receiver",R],["Misc","Polymer80 PF940C",R],["Misc","pistol frame",R],["Misc","upper receiver",U],["Misc","AR upper",U],["Misc","complete upper",U],["Misc","bolt carrier group",U],["Misc","BCG",U],["Misc","barrel 16in 5.56",U],["Misc","trigger group",U],
 // ammo
 ["Misc","12 gauge buckshot",R],["Misc","Federal HST 124 grain",R],["Misc","6.5 Creedmoor ELD-M",R],["Misc","45 ACP",R],["Misc","Blazer Brass 9",R],["Misc","9mm",R],["Misc","9 mm luger",R],["Misc","9x19",R],["Misc","5.56x45",R],["Misc","7.62x39",R],["Misc","300 Blackout",R],["Misc","300 BLK",R],["Misc","22 LR",R],["Misc",".22LR",R],["Misc","22lr",R],["Misc",".223 Rem",R],["Misc","223 Remington",R],["Misc","308 Win",R],["Misc","30-06",R],["Misc","38 Special",R],["Misc","357 Magnum",R],["Misc","40 S&W",R],["Misc","10mm Auto",R],["Misc","12ga slugs",R],["Misc","20 gauge",R],["Misc","M855",R],["Misc","M193",R],["Misc","green tip",R],["Misc","buckshot",R],["Misc","birdshot",R],["Misc","slugs 12",R],["Misc","hollow points",R],["Misc","FMJ",R],["Misc","JHP",R],["Misc","primers",R],["Misc","CCI primers",R],["Misc","gunpowder",R],["Misc","smokeless powder",R],["Misc","Hodgdon H4350",R],["Misc","brass casings",R],["Misc","rounds of 9",R],["Misc","1000 rds 9mm",R],["Misc","box of shells",R],["Misc","shotgun shells",R],
 // unicode / spacing tricks
 ["Misc","S\u0443ppressor",R],["Misc","\u0405uppressor",R],["Misc","Sup\u200Bpressor",R],["Misc","Ｇｌｏｃｋ １９",R],["Misc","Glo\u00ADck 19",R],["Misc","S u p p r e s s o r",R],["Misc","s.u.p.p.r.e.s.s.o.r",R],["Misc","9\u00A0mm",R],["Misc","Glock\u00A019",R],["Misc","Suppressor\u0301",R],["Misc","5,56 ammo",R],
 // brand + model only
 ["Misc","",R,{brand:"Glock",name:"19"}],["Misc","19 Gen 5",R,{brand:"Glock"}],["Misc","Omega 300",R,{brand:"SilencerCo"}],["Misc","Sandman-S",R,{brand:"Dead Air"}],["Misc","P365",R,{brand:"Sig Sauer"}],["Misc","HST 124",R,{brand:"Federal"}],["Misc","870",R,{brand:"Remington"}],["Misc","Hush Puppy",R,{brand:"Silencer Central"}],
 // N7 / false positives
 ["Mags & Ammo Storage","PMAG 30",U],["Mags & Ammo Storage","PMAG 30 5.56",U],["Mags & Ammo Storage","Glock 17 9mm magazine",U],["Misc","Glock 19 magazine",U],["Misc","30 round mag",U],["Misc","AR-15 magazine",U],["Misc","Magpul PMAG 40 7.62",U],["Misc","Glock mag 9mm 15rd",U],["Pouches","magazine pouch",U],["Pouches","double mag pouch 5.56",U],["Misc","mag carrier",U],
 ["Cleaning & Maintenance","cleaning rod",U],["Cleaning & Maintenance","Otis 9mm cleaning kit",U],["Cleaning & Maintenance","bore snake 5.56",U],["Cleaning & Maintenance","bore brush .308",U],["Cleaning & Maintenance","gun oil",U],["Cleaning & Maintenance","rifle cleaning kit",U],["Cleaning & Maintenance","pistol cleaning mat",U],
 ["Cases & Bags","gun case",U],["Cases & Bags","rifle case",U],["Cases & Bags","pistol case",U],["Cases & Bags","range bag",U],["Cases & Bags","AR-15 rifle bag",U],["Cases & Bags","double rifle case",U],["Mags & Ammo Storage","ammo can",U],["Misc","Ammo can 50 cal",U],["Misc","ear pro",U],["Misc","Howard Leight ear pro",U],["Misc","shooting glasses",U],
 ["NVG & Optics","Scope cap",U],["NVG & Optics","rifle scope",U],["NVG & Optics","Vortex Strike Eagle 1-6",U],["NVG & Optics","30mm scope rings",U],["Lights & Lasers","pistol light",U],["Lights & Lasers","rifle light mount",U],["Lights & Lasers","Surefire X300",U],["Lights & Lasers","Streamlight TLR-1",U],["Holsters & Slings","Glock 19 holster",U],["Holsters & Slings","P365 holster",U],["Holsters & Slings","rifle sling",U],["Belts & Rigs","7.62 chest rig",U],["Belts & Rigs","shotgun shell holder",U],["Misc","AR-15 lower parts kit",U],["Packs & Bags","internal frame pack",U],["Misc","Window frame",U],["Misc","can opener",U],["Misc","fuel can",U],["Misc","water can",U],["Misc","Coleman camp stove fuel can",U],["Misc","can light",U],["Misc","soup can",U],["Misc","bear spray can",U],["Comms & Radios","Baofeng UV-5R",U],["Comms & Radios","GMRS radio receiver",U],["Comms & Radios","SDR receiver",U],["Misc","trash can",U],["Misc","9V battery",U],["Misc","AA batteries",U],["Misc","CR123A",U],["Medical","CAT tourniquet",U],["Medical","SAM splint .5",U],["Misc","Pelican 1510",U],["Misc","1.5mm paracord",U],["Misc","550 cord",U],["Misc","3mm hex key",U],["Misc","rangefinder",U],["Misc","binoculars",U],["Misc","headlamp",U],["Misc","Glock knife",U],["Misc","Glock 78 field knife",U],["Misc","Glock pistol case",U],["Misc","Gerber multitool",U],["Misc","Benchmade Bugout",U],["Misc","Bug out bag",U],["Misc","2.5 gal water jug",U],["Misc","10mm wrench",U],["Misc","8mm socket",U],["Misc","M4 sling",U],["Misc","M4 buttstock",U],["Misc","ar stock",U],["Misc","handguard 15in",U],["Misc","rifle bipod",U],["Misc","shotgun sling",U],["Misc","pistol grip",U],["Misc","Pepper spray",U],["Misc","Can-Am ATV",U],["Misc","Candle",U],["Misc","Canteen",U],["Misc","Canon camera",U],["Misc","Canvas tarp",U],["Misc","Mexican blanket",U],["Misc","American flag",U],["Misc","Pistachio snack",U],["Misc","Carbine length gas tube",U],["Misc","Ruger knife",U],["Misc","Sig Sauer hat",U],
];

test("common firearm and ammunition names are restricted and the listed gear is not", () => {
  const miss = [];
  const fp = [];
  for (const [category, name, exp, extra] of cases) {
    const it = { category, name, ...(extra || {}) };
    const got = saleRestricted(it);
    if (exp && !got) miss.push(it.name || it.brand);
    if (!exp && got) fp.push(it.name);
  }
  assert.equal(cases.length, 355);
  assert.deepEqual(miss, []);
  assert.deepEqual(fp, []);
  assert.equal(saleRestricted({ category: "Pouches", name: "Blue pouch", notes: "holds my Glock 19 and suppressor" }), false);
  assert.equal(saleRestricted({ category: "Pouches", name: "Thing", caliber: "9mm" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Box", load: "124gr JHP" }), true);
  assert.equal(saleRestricted({ category: "Pouches", name: "x", arm: "fa" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "x", armType: "semi-auto rifle" }), true);
});
