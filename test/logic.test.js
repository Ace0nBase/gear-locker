import test from "node:test";
import assert from "node:assert/strict";
import {
  clearUserLocal, shareItemFields, decideAccess, chargeDecision, quotaKey, alertQuotaKey,
  selectDueWatches, pinLengthOk, newPasswordOk, mergeByServerTime, mergeKitsByServerTime, serverStampIso,
  refreshAuthClaims, loanSharePlan, orphanLoansFromLends, serverRow, loanNeedsItem, storagePrivacyVerdict, cloudWriteDelay, serviceWorkerAllowed,
  saleRestricted,
  keepSignedIn, firestoreMemoryOnly, settleOrTimeout, signOutConfirmNeeded, SIGN_OUT_WAIT_MS, armoryLookupBlocked,
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
  const priced = shareItemFields({ id: "g", name: "Rifle", category: "Firearms", caliber: "5.56", value: 1, paid: 2 }, "", true);
  assert.equal(priced.caliber, "5.56");
  assert.equal(priced.value, 1);
  assert.equal(priced.serial, undefined);
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

test("price search and sale links skip firearms, ammunition, and the parts that are firearms", () => {
  assert.equal(saleRestricted({ category: "Firearms", name: "Rifle" }), true);
  assert.equal(saleRestricted({ category: "firearms", name: "Carbine" }), true);
  assert.equal(saleRestricted({ category: "FIREARMS", name: "Rifle" }), true);
  assert.equal(saleRestricted({ category: "Suppressors", name: "Can" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Glock 19 pistol" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Ruger 10/22 rifle" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Remington 870 shotgun" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "S&W revolver" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Home defense handgun" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "16 inch carbine" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "AR-15 rifle" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "AR 15 lower" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Aero M4E1 lower" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Polymer80 PF940C frame" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Glock 19 frame" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Stripped lower receiver" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Pistol frame" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "80% frame" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "supressor" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "SilencerCo Omega 300" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "9mm 115gr" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Federal 5.56 M193" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "12ga buckshot" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Hornady Critical Defense 9mm" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: ".308 Win 168gr match" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "22LR bulk pack" }), true);
  assert.equal(saleRestricted({ category: "Mags & Ammo Storage", name: "9mm 115gr" }), true);
  assert.equal(saleRestricted({ name: "Range ammo", caliber: "9mm", load: "115gr FMJ", rounds: 500 }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "9mm ammunition" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "115gr FMJ" }), true);
  assert.equal(saleRestricted({ category: "Pouches", name: "Admin pouch", arm: "FA" }), true);
  assert.equal(saleRestricted({ category: "Misc", name: "Tube", arm: "SU" }), true);
  assert.equal(saleRestricted({ category: "Mags & Ammo Storage", name: "Ammo can" }), false);
  assert.equal(saleRestricted({ category: "Pouches", name: "Ammo pouch" }), false);
  assert.equal(saleRestricted({ category: "Misc", name: "Ammo pouch" }), false);
  assert.equal(saleRestricted({ category: "Pouches", name: "Double mag pouch" }), false);
  assert.equal(saleRestricted({ category: "NVG & Optics", name: "Red dot" }), false);
  assert.equal(saleRestricted({ category: "Comms & Radios", name: "Handheld receiver" }), false);
  assert.equal(saleRestricted({ category: "Holsters & Slings", name: "Holster" }), false);
  assert.equal(saleRestricted({ category: "Holsters & Slings", name: "Glock 19 holster" }), false);
  assert.equal(saleRestricted({ category: "Misc", name: "Glock 19 holster" }), false);
  assert.equal(saleRestricted({ category: "Misc", name: "Upper receiver" }), false);
  assert.equal(saleRestricted({ category: "Misc", name: "Pack frame" }), false);
  assert.equal(saleRestricted(null), false);
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

test("never send arms room items blocks photo and battery lookups for those items", () => {
  assert.equal(armoryLookupBlocked(false, { category: "Firearms", name: "Rifle" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Firearms", name: "Rifle" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "Firearms", arm: "no", name: "Rifle" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "Suppressors", name: "Can" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "NVG & Optics", name: "Red dot" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "NVG & Optics", name: "NOD" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "Lights & Lasers", name: "Weapon light" }), true);
  assert.equal(armoryLookupBlocked(true, { arm: "OP", name: "Scope" }), true);
  assert.equal(armoryLookupBlocked(true, { arm: "WL", name: "Light" }), true);
  assert.equal(armoryLookupBlocked(true, { arm: "LA", name: "PEQ" }), true);
  assert.equal(armoryLookupBlocked(true, { arm: "KN", category: "Knives & Tools", name: "Fixed blade" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "Knives & Tools", name: "Fixed blade" }), true);
  assert.equal(armoryLookupBlocked(true, { category: "Knives & Tools", name: "Leatherman" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Pouches", name: "Mag pouch", arm: "no" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Comms & Radios", name: "Handheld radio" }), false);
  assert.equal(armoryLookupBlocked(true, { category: "Helmet & Head", name: "Headset" }), false);
  assert.equal(armoryLookupBlocked(true, null), false);
});

test("kit merge uses the server stamp and keeps a pending local edit", () => {
  const local = { home: { name: "local" } };
  const remote = { home: { name: "remote" } };
  assert.equal(mergeKitsByServerTime(local, remote, { localStamp: "2026-10-26T01:00:00.000Z", remoteStamp: "2026-10-26T02:00:00.000Z" }).kept, "remote");
  assert.equal(mergeKitsByServerTime(local, remote, { inflightWriteId: "w", remoteWriteId: "w", localPending: true, remoteStamp: "2026-10-26T02:00:00.000Z" }).kept, "local");
  assert.equal(mergeKitsByServerTime(local, remote, { inflightWriteId: "w", remoteWriteId: "w", localPending: false }).kept, "remote");
});
