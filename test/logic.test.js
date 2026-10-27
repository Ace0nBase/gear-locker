import test from "node:test";
import assert from "node:assert/strict";
import {
  clearUserLocal, shareItemFields, decideAccess, chargeDecision, quotaKey, alertQuotaKey,
  selectDueWatches, pinLengthOk, newPasswordOk, mergeByServerTime, mergeKitsByServerTime, serverStampIso,
  refreshAuthClaims, loanSharePlan, orphanLoansFromLends, serverRow, loanNeedsItem, storagePrivacyVerdict, cloudWriteDelay, serviceWorkerAllowed,
  saleRestricted, countedValue, csvExportField, csvCell, publicWeightNote, lookupAnswerRestricted, localDay,
  timerShotAccepted, radioService, radioTxLabel,
  keepSignedIn, firestoreMemoryOnly, settleOrTimeout, signOutConfirmNeeded, SIGN_OUT_WAIT_MS, armorySubject, armoryLookupBlocked, photoIdBlocked,
} from "../js/logic.js";

function memStorage(seed) {
  const data = { ...seed };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    key: i => Object.keys(data)[i] || null,
    get length() { return Object.keys(data).length; },
    dump: () => ({ ...data }),
  };
}

test("clearUserLocal removes per-user keys and keeps device keys", () => {
  const s = memStorage({
    "gearLocker.items": "[]",
    "gearLocker.lock": "{\"pinHash\":\"abc\"}",
    "gearLocker.shareName": "Alex",
    "gearLocker.keep": "1",
    "gearLocker.noFolder": "1",
    "gearLocker.offline": "{\"items\":[{\"serial\":\"SN\"}]}",
    "gearLocker.extra": "x",
    "other": "stay",
  });
  clearUserLocal(s);
  const left = s.dump();
  assert.equal(left["gearLocker.items"], undefined);
  assert.equal(left["gearLocker.lock"], undefined);
  assert.equal(left["gearLocker.shareName"], undefined);
  assert.equal(left["gearLocker.offline"], undefined);
  assert.equal(left["gearLocker.extra"], undefined);
  assert.equal(left["gearLocker.keep"], "1");
  assert.equal(left["gearLocker.noFolder"], "1");
  assert.equal(left.other, "stay");
});

test("shareItemFields drops serials, notes, location, and arm ids", () => {
  const row = shareItemFields({
    id: "a", name: "Pouch", brand: "Crye", color: "RG", category: "Pouches", nick: "1", qty: 2, weight: 4,
    serial: "SECRET", notes: "in the closet", location: "bin 2", armId: "OP-1", caliber: "9mm", value: 20, paid: 15,
  }, "parent", false);
  assert.equal(row.serial, undefined);
  assert.equal(row.notes, undefined);
  assert.equal(row.location, undefined);
  assert.equal(row.armId, undefined);
  assert.equal(row.value, undefined);
  assert.equal(row.caliber, "");
  assert.equal(row.parent, "parent");
  assert.equal(row.name, "Pouch");
  const priced = shareItemFields({ id: "g", name: "Rifle", category: "Firearms", caliber: "5.56", value: 1, paid: 2, valueSource: "manual" }, "", true);
  assert.equal(priced.caliber, "5.56");
  assert.equal(priced.value, 1);
  assert.equal(priced.serial, undefined);
  const stale = shareItemFields({ id: "g2", name: "Rifle", category: "Firearms", value: 400, priceSource: "market", paid: 9 }, "", true);
  assert.equal(stale.value, 0);
  assert.equal(stale.paid, 9);
});

test("decideAccess denies an empty allowlist, strangers, and unverified email", () => {
  const user = { email: "Owner@Example.com", email_verified: true };
  assert.equal(decideAccess(user, { ALLOWED_EMAILS: "" }).ok, false);
  assert.match(decideAccess(user, { ALLOWED_EMAILS: "" }).error, /approved emails/);
  assert.equal(decideAccess(user, { ALLOWED_EMAILS: "friend@example.com" }).ok, false);
  assert.equal(decideAccess({ email: "owner@example.com", email_verified: false }, { ALLOWED_EMAILS: "owner@example.com" }).ok, false);
  assert.equal(decideAccess({ email: "owner@example.com", email_verified: true }, { ALLOWED_EMAILS: " owner@example.com , friend@example.com " }).ok, true);
});

test("chargeDecision and quota keys stay inside the daily cap", () => {
  assert.equal(chargeDecision(39, 2, 40).ok, false);
  assert.equal(chargeDecision(38, 2, 40).ok, true);
  assert.equal(chargeDecision(38, 2, 40).next, 40);
  const day = new Date("2026-10-26T23:30:00Z");
  assert.equal(quotaKey("u1", day), "q:u1:2026-10-26");
  assert.equal(alertQuotaKey("u1", day), "a:u1:2026-10-26");
});

test("selectDueWatches round-robins inside the hourly budget and skips fresh checks", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const old = "2026-10-25T00:00:00Z";
  const fresh = "2026-10-26T10:00:00Z";
  const users = [
    { uid: "a", list: [{ id: "a1", lastCheck: old }, { id: "a2", lastCheck: old }, { id: "a3", lastCheck: fresh }] },
    { uid: "b", list: [{ id: "b1", lastCheck: "" }, { id: "b2", lastCheck: old }] },
  ];
  const picked = selectDueWatches(users, { now, budget: 3, minGapMs: 20 * 3600e3 });
  assert.deepEqual(picked.map(p => p.uid + ":" + p.watch.id), ["b:b1", "a:a1", "b:b2"]);
  assert.equal(selectDueWatches(users, { now, budget: 6, minGapMs: 20 * 3600e3 }).some(p => p.watch.id === "a3"), false);
});

test("new PINs need 6 to 12 digits and new passwords need 12 characters", () => {
  assert.equal(pinLengthOk("1234"), false);
  assert.equal(pinLengthOk("123456"), true);
  assert.equal(pinLengthOk("1234567890123"), false);
  assert.equal(pinLengthOk("12ab56"), false);
  assert.equal(newPasswordOk("short-pass"), false);
  assert.equal(newPasswordOk("long-enough-1"), true);
});

test("cloud merge prefers the server stamp and keeps a newer local edit on echo", () => {
  const local = { id: "1", name: "local", updatedAt: "2026-10-26T02:00:00.000Z", serverUpdatedAt: "2026-10-26T01:00:00.000Z" };
  const remote = { id: "1", name: "remote", updatedAt: "2026-10-26T00:00:00.000Z", serverUpdatedAt: "2026-10-26T03:00:00.000Z" };
  assert.equal(mergeByServerTime(local, remote).name, "remote");
  assert.equal(mergeByServerTime(remote, local).name, "remote");
  const noStamp = mergeByServerTime(
    { id: "1", name: "disk-new", updatedAt: "2026-10-26T05:00:00.000Z" },
    { id: "1", name: "disk-old", updatedAt: "2026-10-26T04:00:00.000Z" }
  );
  assert.equal(noStamp.name, "disk-new");
  assert.equal(mergeByServerTime(
    { id: "1", name: "pending", updatedAt: "2026-10-26T09:00:00.000Z" },
    { id: "1", name: "server", updatedAt: "2026-10-26T01:00:00.000Z", serverUpdatedAt: { seconds: 1761436800, nanoseconds: 0 } }
  ).name, "server");
  const echo = mergeByServerTime(
    { id: "1", name: "edited-again", updatedAt: "2026-10-26T04:00:00.000Z", serverUpdatedAt: "" },
    { id: "1", name: "echo", updatedAt: "2026-10-26T02:00:00.000Z", serverUpdatedAt: "2026-10-26T03:00:00.000Z", writeId: "w1" },
    { "1": { writeId: "w1", updatedAt: "2026-10-26T02:00:00.000Z" } }
  );
  assert.equal(echo.name, "edited-again");
  assert.equal(echo.serverUpdatedAt, "2026-10-26T03:00:00.000Z");
  const same = mergeByServerTime(
    { id: "1", name: "local", updatedAt: "2026-10-26T02:00:00.000Z" },
    { id: "1", name: "echo", updatedAt: "2026-10-26T02:00:00.000Z", serverUpdatedAt: "2026-10-26T03:00:00.000Z", writeId: "w1" },
    { "1": { writeId: "w1", updatedAt: "2026-10-26T02:00:00.000Z" } }
  );
  assert.equal(same.name, "echo");
  assert.ok(serverStampIso({ toDate: () => new Date("2026-10-26T03:00:00.000Z") }));
  const pending = mergeByServerTime(
    { id: "1", name: "edited offline", updatedAt: "2026-10-26T05:00:00.000Z", offlinePending: true },
    { id: "1", name: "server", updatedAt: "2026-10-26T04:00:00.000Z", serverUpdatedAt: "2026-10-26T04:00:00.000Z" }
  );
  assert.equal(pending.name, "server");
  const newerRemote = mergeByServerTime(
    { id: "1", name: "edited offline", updatedAt: "2026-10-26T05:00:00.000Z", offlinePending: true },
    { id: "1", name: "server", updatedAt: "2026-10-26T06:00:00.000Z", serverUpdatedAt: "2026-10-26T06:00:00.000Z" }
  );
  assert.equal(newerRemote.name, "server");
});

test("confirming an email refreshes the ID token before anything else reads it", async () => {
  const calls = [];
  const user = {
    emailVerified: false,
    async reload() { calls.push("reload"); this.emailVerified = true; },
    async getIdToken(force) { calls.push("token:" + force); return "fresh"; },
  };
  const out = await refreshAuthClaims(user);
  assert.equal(out, user);
  assert.deepEqual(calls, ["reload", "token:true"]);
  assert.equal(user.emailVerified, true);
  await assert.rejects(() => refreshAuthClaims(null));
});

test("a shared loan writes the private record and the lend together", () => {
  const share = loanSharePlan({ id: "l1", friendEmail: "friend@example.com", lendShared: false }, { verified: true });
  assert.equal(share.writePrivate, true);
  assert.equal(share.writeLend, true);
  assert.equal(share.deleteLend, false);
  const stop = loanSharePlan({ id: "l1", friendEmail: "friend@example.com", lendShared: true }, { verified: true, removed: true });
  assert.equal(stop.writePrivate, true);
  assert.equal(stop.writeLend, false);
  assert.equal(stop.deleteLend, true);
  const localOnly = loanSharePlan({ id: "l1", friendEmail: "", lendShared: false }, { verified: true });
  assert.equal(localOnly.writeLend, false);
  assert.equal(localOnly.deleteLend, false);
  const unverified = loanSharePlan({ id: "l1", friendEmail: "friend@example.com" }, { verified: false });
  assert.equal(unverified.writeLend, false);
  assert.equal(unverified.needsVerify, true);
});

test("an orphan lend becomes a private loan the lender can close", () => {
  const loans = [{ id: "kept", borrower: "Sam" }];
  const lends = [
    { id: "kept", borrowerName: "Sam", item: { name: "Already here" } },
    { id: "orphan", borrowerName: "Riley", borrowerEmail: "riley@example.com", out: "2026-10-01", due: "2026-10-08", item: { name: "Test Light", brand: "Acme", color: "Black", category: "Lights" } },
  ];
  const recovered = orphanLoansFromLends(loans, lends, "2026-10-26T00:00:00.000Z");
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, "orphan");
  assert.equal(recovered[0].itemName, "Test Light");
  assert.equal(recovered[0].itemBrand, "Acme");
  assert.equal(recovered[0].borrower, "Riley");
  assert.equal(recovered[0].friendEmail, "riley@example.com");
  assert.equal(recovered[0].lendShared, true);
  assert.equal(recovered[0].notes, "");
  assert.equal(recovered[0].itemId, "");
  assert.equal(loanNeedsItem(recovered[0]), false);
  assert.equal(loanNeedsItem({ itemId: "i1" }), false);
  assert.equal(loanNeedsItem({ itemId: "", itemName: "  " }), true);
  assert.equal(loanNeedsItem({}), true);
  assert.equal(orphanLoansFromLends([{ id: "kept" }, { id: "orphan", deleted: true }], lends).length, 0);
});

test("server rows drop the offline flag and keep the rest of the item", () => {
  const src = { id: "1", name: "Rifle", serial: "ABC", notes: "closet", location: "safe", offlinePending: true };
  const row = serverRow(src);
  assert.equal(row.offlinePending, undefined);
  assert.equal("offlinePending" in row, false);
  assert.equal(row.serial, "ABC");
  assert.equal(row.notes, "closet");
  assert.equal(row.location, "safe");
  assert.equal(src.offlinePending, true);
});

test("a missing storage file is not counted as blocked", () => {
  assert.equal(storagePrivacyVerdict("storage/unauthorized", "storage/unauthorized").pass, true);
  assert.equal(storagePrivacyVerdict("storage/object-not-found", "storage/unauthorized").pass, false);
  assert.equal(storagePrivacyVerdict("storage/object-not-found", "storage/unauthorized").countedMissingAsBlocked, true);
  assert.equal(storagePrivacyVerdict("ok", "storage/unauthorized").pass, false);
  assert.equal(storagePrivacyVerdict("storage/unauthorized", "ok").pass, false);
});

test("offline edits flush immediately and the local test page can cache itself", () => {
  assert.equal(cloudWriteDelay(false), 0);
  assert.equal(cloudWriteDelay(true), 400);
  assert.equal(serviceWorkerAllowed({ protocol: "https:", hostname: "ace0nbase.github.io" }, false), true);
  assert.equal(serviceWorkerAllowed({ protocol: "http:", hostname: "127.0.0.1" }, true), true);
  assert.equal(serviceWorkerAllowed({ protocol: "http:", hostname: "localhost" }, true), true);
  assert.equal(serviceWorkerAllowed({ protocol: "http:", hostname: "127.0.0.1" }, false), false);
  assert.equal(serviceWorkerAllowed({ protocol: "http:", hostname: "example.com" }, true), false);
});

test("price search skips firearm, suppressor, ammunition, and lower-receiver shelves", () => {
  assert.equal(saleRestricted({ category: "Firearms", name: "North line" }), true);
  assert.equal(saleRestricted({ category: "firearms", name: "North line" }), true);
  assert.equal(saleRestricted({ category: "FIREARMS", name: "North line" }), true);
  assert.equal(saleRestricted({ category: "Suppressors", name: "Tube" }), true);
  assert.equal(saleRestricted({ category: "Ammunition", name: "Practice box" }), true);
  assert.equal(saleRestricted({ category: "Ammo", name: "Practice box" }), true);
  assert.equal(saleRestricted({ category: "Reloading", name: "Press" }), true);
  assert.equal(saleRestricted({ category: "Lower receivers", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "Frames", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "Handguns", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "Rifles", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "Shotguns", name: "Widget" }), true);
  assert.equal(saleRestricted({ category: "NFA", name: "Widget" }), true);
  assert.equal(saleRestricted({ kind: "ammo", name: "Practice box" }), true);
  assert.equal(saleRestricted({ tab: "ammo", category: "Misc", name: "Practice box" }), true);
  assert.equal(saleRestricted({ category: "Pouches", name: "Admin pouch", arm: "FA" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Tube", arm: "SU" }), true);
  assert.equal(saleRestricted({ category: "Mags & Ammo Storage", name: "Ammo can" }), false);
  assert.equal(saleRestricted({ category: "Pouches", name: "Ammo pouch" }), false);
  assert.equal(saleRestricted({ category: "Misc", name: "Harbor HT-100" }), false);
  assert.equal(saleRestricted({ category: "NVG & Optics", name: "Lumen 4-16" }), false);
  assert.equal(saleRestricted({ category: "Comms & Radios", name: "Harbor HT-100" }), false);
  assert.equal(saleRestricted({ category: "Packs & Bags", name: "Ridge 65" }), false);
  assert.equal(saleRestricted({ category: "Knives & Tools", name: "Fold 940" }), false);
  assert.equal(saleRestricted({ category: "NVG & Optics", name: "Red dot", arm: "OP" }), false);
  assert.equal(saleRestricted(null), false);
});

test("a looked-up price on a restricted item is not an insured value", () => {
  const leftover = { category: "Firearms", name: "Rifle", value: 800, priceSource: "market", retailNew: 900, priceDate: "2026-01-01" };
  assert.equal(countedValue(leftover), 0);
  assert.equal(countedValue({ category: "Firearms", name: "Rifle", value: 800, valueSource: "manual" }), 800);
  assert.equal(countedValue({ category: "Pouches", name: "Admin pouch", value: 40, priceSource: "market" }), 40);
  assert.equal(csvExportField(leftover, "retailNew"), "");
  assert.equal(csvExportField(leftover, "priceSource"), "");
  assert.equal(csvExportField(leftover, "priceDate"), "");
  assert.equal(csvExportField(leftover, "value"), "");
  assert.equal(csvExportField({ category: "Firearms", name: "Rifle", value: 800, valueSource: "manual", retailNew: 1, priceSource: "manual", priceDate: "2026-01-01" }, "value"), 800);
  assert.equal(csvExportField({ category: "Pouches", name: "Admin pouch", retailNew: 50, priceSource: "market", priceDate: "2026-02-02" }, "retailNew"), 50);
});

test("a restricted weight note drops store names, links, and prices", () => {
  assert.equal(publicWeightNote("Maker spec https://www.amazon.com/dp/1 via Amazon"), "Maker spec via");
  assert.equal(publicWeightNote("Brownells listing, www.brownells.com"), "listing");
  assert.equal(publicWeightNote("Local test weight"), "Local test weight");
  assert.equal(publicWeightNote("Primary Arms page"), "page");
  assert.equal(publicWeightNote("Sold at State Armory for $899. MSRP $1,299 at Academy Sports"), "");
  assert.equal(publicWeightNote("lists 30 oz, $1,299 at Academy Sports MSRP $1,350"), "");
  assert.equal(publicWeightNote("Sold at State Armory"), "");
  assert.equal(publicWeightNote("Midway: 899.99"), "");
  assert.equal(publicWeightNote("GunBroker avg 1299"), "");
  assert.equal(publicWeightNote("Listed at Scheels for 899 dollars"), "");
  assert.equal(publicWeightNote("sold by Big 5 for 899"), "");
  assert.equal(publicWeightNote("about nine hundred bucks at Cabelas"), "");
  assert.equal(publicWeightNote("maker spec 24.5 oz"), "maker spec 24.5 oz");
  assert.equal(publicWeightNote("four hundred at the village outfitter"), "");
  assert.equal(publicWeightNote("two fifty from a corner shop"), "");
  assert.equal(publicWeightNote("picked up at a local retailer"), "");
  assert.equal(publicWeightNote("two point sling spec"), "two point sling spec");
  assert.equal(lookupAnswerRestricted({ priceNote: "four hundred dollars" }), false);
  assert.equal(lookupAnswerRestricted({ priceNote: "GunBroker listing", sources: [{ label: "listing", url: "https://gunbroker.com/x" }] }), true);
  assert.equal(lookupAnswerRestricted({ priceNote: "Typical pouch", sources: [{ label: "Local test shop", url: "https://example.com/gear" }] }), false);
  assert.equal(lookupAnswerRestricted({ priceNote: "REI $229.50, fits Glock 19", weightNote: "maker spec, 24 x 12 x 12 in", sources: [{ label: "REI", url: "https://www.rei.com/kywi-556" }] }), false);
  assert.equal(lookupAnswerRestricted({ priceNote: "Amazon $39 for 30mm rings", sources: [{ label: "OpticsPlanet", url: "https://www.opticsplanet.com/1-6x24.html" }] }), false);
  assert.equal(lookupAnswerRestricted({ priceNote: "Crye $1,300 with plates", sources: [{ label: "Crye", url: "https://www.cryeprecision.com/jpc" }] }), false);
  const evening = new Date(2026, 9, 26, 22, 10);
  assert.equal(localDay(evening), "2026-10-26");
});

test("keep-signed-in off uses a memory cache and sign-out confirms only when a save is still pending", async () => {
  assert.equal(keepSignedIn(memStorage({})), true);
  assert.equal(keepSignedIn(memStorage({ "gearLocker.keep": "1" })), true);
  assert.equal(keepSignedIn(memStorage({ "gearLocker.keep": "0" })), false);
  assert.equal(firestoreMemoryOnly(true), false);
  assert.equal(firestoreMemoryOnly(false), true);
  assert.equal(SIGN_OUT_WAIT_MS, 1500);
  assert.equal(signOutConfirmNeeded(true), false);
  assert.equal(signOutConfirmNeeded(false), true);
  assert.equal(await settleOrTimeout(Promise.resolve("saved"), 50), true);
  assert.equal(await settleOrTimeout(new Promise(() => {}), 30), false);
  assert.equal(await settleOrTimeout(Promise.reject(new Error("failed")), 50), false);
});

test("never send Armory items blocks records and weapon-mounted gear, and photo ID waits for a category", () => {
  assert.equal(armoryLookupBlocked(false, { category: "Firearms", name: "Rifle" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Firearms", name: "Rifle" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "Firearms", arm: "no", name: "Rifle" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "Suppressors", name: "Can" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "NVG & Optics", name: "Red dot" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "NVG & Optics", name: "NOD" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "NVG & Optics", name: "Binoculars" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Lights & Lasers", name: "Weapon light" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Lights & Lasers", name: "Flashlight" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Helmet & Head", name: "Headlamp" }), false);
  assert.equal(armoryLookupBlocked(true, { arm: "OP", category: "NVG & Optics", name: "Red dot" }), true);
  assert.equal(armoryLookupBlocked(true, { arm: "WL", name: "Light" }), true);
  assert.equal(armoryLookupBlocked(true, { arm: "LA", name: "PEQ" }), true);
  assert.equal(armoryLookupBlocked(true, { arm: "KN", category: "Knives & Tools", name: "Fixed blade" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "Knives & Tools", name: "Fixed blade" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "Knives & Tools", name: "Leatherman" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Pouches", name: "Mag pouch", arm: "no" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Comms & Radios", name: "Handheld radio" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Helmet & Head", name: "Headset" }), false);
  assert.equal(armoryLookupBlocked(true, null), false);
  const onRifle = armorySubject(
    { category: "Helmet & Head", name: "Headlamp", mountedOn: "rifle1" },
    { category: "Firearms", arm: "FA" },
  );
  assert.equal(onRifle.hostCategory, "Firearms");
  assert.equal(armoryLookupBlocked(true, onRifle), true);
  const onHelmet = armorySubject(
    { category: "Lights & Lasers", name: "Headlamp", mountedOn: "helm1" },
    { category: "Helmet & Head", arm: "no" },
  );
  assert.equal(armoryLookupBlocked(true, onHelmet), false);
  assert.equal(photoIdBlocked(false, { category: "" }), false);
  assert.equal(photoIdBlocked(true, { category: "" }), true);
  assert.equal(photoIdBlocked(true, {}), true);
  assert.equal(photoIdBlocked(true, null), true);
  assert.equal(photoIdBlocked(true, { category: "Pouches", name: "Admin pouch" }), false);
  assert.equal(photoIdBlocked(true, { category: "Helmet & Head", name: "Headlamp" }), false);
  assert.equal(photoIdBlocked(true, { category: "Lights & Lasers", name: "Flashlight" }), false);
  assert.equal(photoIdBlocked(true, { category: "NVG & Optics", name: "Binoculars" }), false);
  assert.equal(photoIdBlocked(true, { category: "Firearms", name: "Rifle" }), true);
  assert.equal(photoIdBlocked(true, onRifle), true);
});

test("a drill stops accepting shots once it has its round count", () => {
  assert.equal(timerShotAccepted(0, 6), true);
  assert.equal(timerShotAccepted(5, 6), true);
  assert.equal(timerShotAccepted(6, 6), false);
  assert.equal(timerShotAccepted(7, 6), false);
  assert.equal(timerShotAccepted(3, 0), true);
  assert.equal(timerShotAccepted(3, ""), true);
});

test("462 and 467 MHz channels follow the shared FRS/GMRS plan", () => {
  assert.equal(radioService(462.5625), "FRS/GMRS");
  assert.equal(radioService(462.7125), "FRS/GMRS");
  assert.equal(radioService(467.5625), "FRS/GMRS");
  assert.equal(radioService(467.7125), "FRS/GMRS");
  assert.equal(radioService(462.55), "FRS/GMRS");
  assert.equal(radioService(462.725), "FRS/GMRS");
  assert.equal(radioService("467.5500"), "GMRS");
  assert.equal(radioService(467.725), "GMRS");
  assert.equal(radioService(467.6), "GMRS");
  assert.equal(radioService(151.82), "MURS");
  assert.equal(radioService(151.88), "MURS");
  assert.equal(radioService(151.94), "MURS");
  assert.equal(radioService(154.57), "MURS");
  assert.equal(radioService(154.6), "MURS");
  assert.equal(radioService(146.52), "Ham");
  assert.equal(radioService(162.55), "NOAA weather");
});

test("off-channel frequencies are not FRS, GMRS, or MURS, and a duplex + import is a repeater", () => {
  for (const rx of [464.5, 465, 462.7375, 462.5375, 467.5375, 467.7375, 152, 153]) {
    assert.equal(radioService(rx), "Other", String(rx));
  }
  assert.equal(radioService(462.675, "+"), "GMRS");
  assert.equal(radioService("462.675000", "+"), "GMRS");
  assert.equal(radioService(462.55, "+"), "GMRS");
  assert.equal(radioService(462.725, "+"), "GMRS");
  assert.equal(radioService(462.675), "FRS/GMRS");
  assert.equal(radioService(462.675, "off"), "FRS/GMRS");
  assert.equal(radioService(467.55), "GMRS");
});

test("a GMRS repeater offset labels receive-only, and a ham offset still shows transmit", () => {
  assert.equal(radioTxLabel({ rx: "462.550", duplex: "+", offset: "5", service: "GMRS" }), "RX only");
  assert.equal(radioTxLabel({ rx: "462.725", duplex: "+", offset: "5", service: "GMRS" }), "RX only");
  assert.equal(radioTxLabel({ rx: "462.5625", duplex: "off", service: "FRS/GMRS" }), "RX only");
  assert.equal(radioTxLabel({ rx: "151.820", service: "MURS" }), "RX only");
  assert.equal(radioTxLabel({ rx: "146.520", duplex: "+", offset: "0.600", service: "Ham" }), "147.12");
  assert.equal(radioTxLabel({ rx: "146.940", duplex: "-", offset: "0.600", service: "Ham" }), "146.34");
  assert.equal(radioTxLabel({ rx: "446.000", duplex: "split", tx: "445.000", service: "Ham" }), "445.00");
  assert.equal(radioTxLabel({ rx: "146.520", duplex: "", service: "Ham" }), "simplex");
  assert.equal(radioTxLabel({ rx: "146.520", duplex: "off", service: "Ham" }), "RX only");
});

test("csv cells neutralize spreadsheet formulas and stay quoted", () => {
  for (const ch of ["=", "+", "-", "@", "\t", "\r"]) {
    assert.equal(csvCell(ch + "1+1"), `"'${ch}1+1"`);
  }
  assert.equal(csvCell('=say "hi", there'), `"'=say ""hi"", there"`);
  assert.equal(csvCell("plain"), '"plain"');
  assert.equal(csvCell("a=b"), '"a=b"');
  assert.equal(csvCell("a,b\nline"), '"a,b\nline"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(12), '"12"');
});

test("kit merge uses the server stamp and keeps a pending local edit", () => {
  const local = { home: { name: "local" } };
  const remote = { home: { name: "remote" } };
  assert.equal(mergeKitsByServerTime(local, remote, { localStamp: "2026-10-26T01:00:00.000Z", remoteStamp: "2026-10-26T02:00:00.000Z" }).kept, "remote");
  assert.equal(mergeKitsByServerTime(local, remote, { inflightWriteId: "w", remoteWriteId: "w", localPending: true, remoteStamp: "2026-10-26T02:00:00.000Z" }).kept, "local");
  assert.equal(mergeKitsByServerTime(local, remote, { inflightWriteId: "w", remoteWriteId: "w", localPending: false }).kept, "remote");
});
