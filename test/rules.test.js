import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

let env;

const item = {
  id: "i1", name: "Pouch", brand: "A", color: "Black", category: "Pouches", nick: "",
  qty: 1, weight: 4, parent: "", caliber: "", value: 10, paid: 8,
};
const share = owner => ({
  owner, title: "Range kit", kind: "kit", from: "", prices: false, items: [item], updatedAt: "2026-10-26T00:00:00.000Z",
});
const loan = () => ({
  lender: "owner",
  lenderEmail: "owner@example.com",
  borrowerEmail: "Friend@Example.com",
  borrowerEmailLower: "friend@example.com",
  borrowerName: "Friend",
  item: { name: "Pouch", brand: "A", color: "Black", category: "Pouches" },
  out: "2026-10-01",
  due: "",
  returned: "",
  updatedAt: "2026-10-26T00:00:00.000Z",
});

function as(uid, email, verified) {
  return env.authenticatedContext(uid, { email, email_verified: !!verified }).firestore();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-gear-locker",
    firestore: { rules: fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});

after(async () => {
  await env.cleanup();
});

test("a person can read and write only their own locker, even before email is confirmed", async () => {
  await env.clearFirestore();
  const owner = as("owner", "owner@example.com", false);
  await assertSucceeds(setDoc(doc(owner, "users/owner/items/i1"), { name: "Pouch", serial: "ABC" }));
  await assertSucceeds(getDoc(doc(owner, "users/owner/items/i1")));
  const friend = as("friend", "friend@example.com", true);
  await assertFails(getDoc(doc(friend, "users/owner/items/i1")));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "users/owner/items/i1")));
});

test("loans are readable only by the lender or a confirmed matching email", async () => {
  await env.clearFirestore();
  await assertSucceeds(setDoc(doc(as("owner", "owner@example.com", true), "lends/loan1"), loan()));
  const unverified = as("friend", "friend@example.com", false);
  await assertFails(getDoc(doc(unverified, "lends/loan1")));
  await assertFails(getDocs(query(collection(unverified, "lends"), where("borrowerEmailLower", "==", "friend@example.com"))));
  const lower = as("friend", "friend@example.com", true);
  await assertSucceeds(getDoc(doc(lower, "lends/loan1")));
  await assertSucceeds(getDocs(query(collection(lower, "lends"), where("borrowerEmailLower", "==", "friend@example.com"))));
  const exact = as("friend", "Friend@Example.com", true);
  await assertSucceeds(getDocs(query(collection(exact, "lends"), where("borrowerEmail", "==", "Friend@Example.com"))));
  await assertSucceeds(getDoc(doc(as("owner", "owner@example.com", false), "lends/loan1")));
  const borrower = as("friend", "friend@example.com", true);
  await assertFails(updateDoc(doc(borrower, "lends/loan1"), { item: { name: "Changed" } }));
  await assertSucceeds(updateDoc(doc(borrower, "lends/loan1"), { borrowerReturned: "2026-10-26", updatedAt: "2026-10-26T01:00:00.000Z" }));
  await assertFails(deleteDoc(doc(borrower, "lends/loan1")));
});

test("share links can be opened by id and cannot be listed or carry serials", async () => {
  await env.clearFirestore();
  const owner = as("owner", "owner@example.com", false);
  await assertSucceeds(setDoc(doc(owner, "shares/share1"), share("owner")));
  await assertFails(setDoc(doc(owner, "shares/bad"), { ...share("owner"), items: [{ ...item, serial: "SECRET", notes: "closet" }] }));
  const open = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(open, "shares/share1")));
  await assertFails(getDocs(collection(open, "shares")));
  await assertFails(getDocs(collection(owner, "shares")));
  const snap = await getDoc(doc(open, "shares/share1"));
  assert.equal(snap.data().items[0].serial, undefined);
  assert.equal(snap.data().items[0].notes, undefined);
});
