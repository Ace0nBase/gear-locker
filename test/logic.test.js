import test from "node:test";
import assert from "node:assert/strict";
import {
  clearUserLocal, shareItemFields, decideAccess, chargeDecision, quotaKey, alertQuotaKey,
  selectDueWatches, pinLengthOk, newPasswordOk, mergeByServerTime, mergeKitsByServerTime, serverStampIso,
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
    "gearLocker.extra": "x",
    "other": "stay",
  });
  clearUserLocal(s);
  const left = s.dump();
  assert.equal(left["gearLocker.items"], undefined);
  assert.equal(left["gearLocker.lock"], undefined);
  assert.equal(left["gearLocker.shareName"], undefined);
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
});

test("kit merge uses the server stamp and keeps a pending local edit", () => {
  const local = { home: { name: "local" } };
  const remote = { home: { name: "remote" } };
  assert.equal(mergeKitsByServerTime(local, remote, { localStamp: "2026-10-26T01:00:00.000Z", remoteStamp: "2026-10-26T02:00:00.000Z" }).kept, "remote");
  assert.equal(mergeKitsByServerTime(local, remote, { inflightWriteId: "w", remoteWriteId: "w", localPending: true, remoteStamp: "2026-10-26T02:00:00.000Z" }).kept, "local");
  assert.equal(mergeKitsByServerTime(local, remote, { inflightWriteId: "w", remoteWriteId: "w", localPending: false }).kept, "remote");
});
