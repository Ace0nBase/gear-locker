import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { lendMailDocId } from "../js/logic.js";

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

async function shareLend(uid, email, verified, id, data, n) {
  const db = as(uid, email, verified);
  const hash = await lendMailDocId(data.borrowerEmailLower || data.borrowerEmail);
  const batch = writeBatch(db);
  batch.set(doc(db, "users/" + uid + "/lendMail/" + hash), { n: n == null ? 1 : n, loanId: id });
  batch.set(doc(db, "lends/" + id), data);
  await batch.commit();
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
  await assertSucceeds(shareLend("owner", "owner@example.com", true, "loan1", loan()));
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

test("a verified lender commits the private loan and the shared lend together", async () => {
  await env.clearFirestore();
  const owner = as("owner", "owner@example.com", true);
  const batch = writeBatch(owner);
  const hash = await lendMailDocId("friend@example.com");
  batch.set(doc(owner, "users/owner/loans/loan1"), {
    id: "loan1", borrower: "Friend", friendEmail: "friend@example.com", friendEmailLower: "friend@example.com", itemId: "i1", updatedAt: "2026-10-26T00:00:00.000Z",
  });
  batch.set(doc(owner, "users/owner/lendMail/" + hash), { n: 1, loanId: "loan1" });
  batch.set(doc(owner, "lends/loan1"), loan());
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(owner, "users/owner/loans/loan1")));
  const borrower = as("friend", "friend@example.com", true);
  await assertSucceeds(getDoc(doc(borrower, "lends/loan1")));
  await assertFails(getDoc(doc(borrower, "users/owner/loans/loan1")));
  const unverified = as("owner", "owner@example.com", false);
  const blocked = writeBatch(unverified);
  blocked.set(doc(unverified, "users/owner/loans/loan2"), { id: "loan2", borrower: "Friend" });
  blocked.set(doc(unverified, "lends/loan2"), { ...loan(), updatedAt: "2026-10-26T01:00:00.000Z" });
  await assertFails(blocked.commit());
  await env.withSecurityRulesDisabled(async context => {
    const open = context.firestore();
    assert.equal((await getDoc(doc(open, "users/owner/loans/loan2"))).exists(), false);
    assert.equal((await getDoc(doc(open, "lends/loan2"))).exists(), false);
  });
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
  await assertSucceeds(getDocs(query(collection(owner, "shares"), where("owner", "==", "owner"))));
  const stranger = as("stranger", "stranger@example.com", true);
  await assertFails(getDocs(query(collection(stranger, "shares"), where("owner", "==", "owner"))));
  const snap = await getDoc(doc(open, "shares/share1"));
  assert.equal(snap.data().items[0].serial, undefined);
  assert.equal(snap.data().items[0].notes, undefined);
});

test("a tombstone blocks later writes and the named person can clear their email", async () => {
  await env.clearFirestore();
  const owner = as("owner", "owner@example.com", true);
  await assertSucceeds(setDoc(doc(owner, "users/owner/loans/loan1"), {
    id: "loan1", borrower: "Friend", friendEmail: "friend@example.com", notes: "private range note", itemId: "i1", updatedAt: "2026-10-26T00:00:00.000Z",
  }));
  await assertSucceeds(shareLend("owner", "owner@example.com", true, "loan1", loan()));
  await assertSucceeds(setDoc(doc(owner, "users/owner/items/i1"), { name: "Pouch" }));
  await assertSucceeds(setDoc(doc(owner, "shares/share1"), share("owner")));
  await assertSucceeds(shareLend("owner", "owner@example.com", true, "loan2", { ...loan(), borrowerEmail: "named@example.com", borrowerEmailLower: "named@example.com" }));
  const borrower = as("friend", "friend@example.com", true);
  await assertFails(getDoc(doc(borrower, "users/owner/loans/loan1")));
  await assertFails(getDocs(query(collectionGroup(borrower, "loans"), where("friendEmail", "==", "friend@example.com"))));
  await assertFails(updateDoc(doc(borrower, "users/owner/loans/loan1"), {
    friendEmail: "", updatedAt: "2026-10-27T00:00:00.000Z",
  }));
  await assertSucceeds(updateDoc(doc(borrower, "users/owner/loans/loan1"), {
    friendEmail: "", updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(borrower, "users/owner/loans/loan1"), { borrower: "Nope" }));
  const stranger = as("stranger", "stranger@example.com", true);
  await assertFails(updateDoc(doc(stranger, "users/owner/loans/loan1"), {
    friendEmail: "", updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(borrower, "lends/loan1"), {
    borrowerEmail: "", borrowerEmailLower: "", updatedAt: "2026-10-27T00:00:00.000Z",
  }));
  await assertSucceeds(updateDoc(doc(borrower, "lends/loan1"), {
    borrowerEmail: "", borrowerEmailLower: "", updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(owner, "deletedUsers/owner"), { uid: "owner", at: "2026-10-27T00:00:00.000Z" }));
  await assertFails(setDoc(doc(owner, "users/owner/items/i2"), { name: "Belt" }));
  await assertFails(setDoc(doc(owner, "shares/share2"), share("owner")));
  await assertSucceeds(getDocs(query(collection(owner, "shares"), where("owner", "==", "owner"))));
  await assertFails(getDocs(collection(owner, "shares")));
  await assertSucceeds(deleteDoc(doc(owner, "shares/share1")));
  await assertSucceeds(deleteDoc(doc(owner, "users/owner/items/i1")));
  await assertSucceeds(deleteDoc(doc(owner, "lends/loan1")));
  const named = as("named", "named@example.com", true);
  await assertSucceeds(setDoc(doc(named, "deletedUsers/named"), { uid: "named", at: "2026-10-27T00:00:00.000Z" }));
  await assertSucceeds(updateDoc(doc(named, "lends/loan2"), {
    borrowerEmail: "", borrowerEmailLower: "", updatedAt: serverTimestamp(),
  }));
  const ownLoan = await assertSucceeds(getDoc(doc(owner, "users/owner/loans/loan1")));
  assert.equal(ownLoan.data().notes, "private range note");
  await assertSucceeds(getDoc(doc(owner, "deletedUsers/owner")));
  await assertFails(updateDoc(doc(owner, "deletedUsers/owner"), { at: "later" }));
  await assertFails(deleteDoc(doc(owner, "deletedUsers/owner")));
  const other = as("friend", "friend@example.com", true);
  await assertSucceeds(setDoc(doc(other, "users/friend/items/i1"), { name: "Pouch" }));
});

test("a capitalized friend email can be cleared, and a missing loan is not created", async () => {
  await env.clearFirestore();
  const owner = as("owner", "owner@example.com", true);
  await assertSucceeds(setDoc(doc(owner, "users/owner/loans/caps"), {
    id: "caps", friendEmail: "QA-B@Example.test", updatedAt: "2026-10-26T00:00:00.000Z",
  }));
  const borrower = as("vee", "qa-b@example.test", true);
  await assertFails(updateDoc(doc(borrower, "users/owner/loans/missing"), {
    friendEmail: "", updatedAt: serverTimestamp(),
  }));
  await env.withSecurityRulesDisabled(async context => {
    assert.equal((await getDoc(doc(context.firestore(), "users/owner/loans/missing"))).exists(), false);
  });
  const stranger = as("stranger", "stranger@example.com", true);
  await assertFails(updateDoc(doc(stranger, "users/owner/loans/caps"), {
    friendEmail: "", updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(borrower, "users/owner/loans/caps"), {
    friendEmail: "", updatedAt: serverTimestamp(),
  }));
  const left = await getDoc(doc(owner, "users/owner/loans/caps"));
  assert.equal(left.data().friendEmail, "");
  assert.equal(typeof left.data().updatedAt.toDate, "function");
});

test("a deleted-address record cannot be written, and a missing lend delete is denied", async () => {
  await env.clearFirestore();
  const owner = as("owner", "owner@example.com", true);
  await assertFails(setDoc(doc(owner, "deletedEmails/abc"), { at: serverTimestamp() }));
  await assertFails(deleteDoc(doc(owner, "lends/missing")));
  await assertSucceeds(shareLend("owner", "owner@example.com", true, "open", loan()));
  await assertSucceeds(deleteDoc(doc(owner, "lends/open")));
});

test("one lender can publish 40 lends to an email and not a 41st", async () => {
  await env.clearFirestore();
  const owner = as("owner", "owner@example.com", true);
  await assertFails(setDoc(doc(owner, "lends/plain"), loan()));
  await assertSucceeds(shareLend("owner", "owner@example.com", true, "loan1", loan()));
  const hash = await lendMailDocId("friend@example.com");
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users/owner/lendMail/" + hash), { n: 40, loanId: "loan1" });
  });
  const extra = writeBatch(owner);
  extra.set(doc(owner, "users/owner/lendMail/" + hash), { n: 41, loanId: "extra" });
  extra.set(doc(owner, "lends/extra"), loan());
  await assertFails(extra.commit());
});
