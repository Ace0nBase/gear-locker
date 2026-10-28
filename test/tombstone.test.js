import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { tombstoneDue, DELETED_USER_TTL_MS } from "../js/logic.js";
import { resetFirestoreTokenCache, sweepTombstones } from "../api/firestore-admin.js";

const NOW = Date.parse("2026-10-28T00:00:00.000Z");

function doc(uid, fields, createTime) {
  return {
    name: "projects/demo/databases/(default)/documents/deletedUsers/" + uid,
    fields,
    createTime,
  };
}

test("a marker is due from expireAt, or from the deletion time plus 30 days", () => {
  assert.equal(tombstoneDue(doc("old", {
    expireAt: { timestampValue: "2026-10-27T00:00:00.000Z" },
  }), NOW), true);
  assert.equal(tombstoneDue(doc("fresh", {
    expireAt: { timestampValue: "2026-11-27T00:00:00.000Z" },
  }), NOW), false);
  const oldAt = new Date(NOW - DELETED_USER_TTL_MS - 1000).toISOString();
  assert.equal(tombstoneDue(doc("aged", { at: { stringValue: oldAt } }), NOW), true);
  const recent = new Date(NOW - 86400000).toISOString();
  assert.equal(tombstoneDue(doc("recent", { at: { stringValue: recent } }), NOW), false);
  const created = new Date(NOW - DELETED_USER_TTL_MS - 1000).toISOString();
  assert.equal(tombstoneDue(doc("created", {}, created), NOW), true);
  assert.equal(tombstoneDue(doc("unknown", {}), NOW), false);
  assert.equal(tombstoneDue(doc("blank", { at: { stringValue: "" } }, "not-a-date"), NOW), false);
});

test("the hourly sweep deletes a bounded page of expired markers and logs only the count", async () => {
  resetFirestoreTokenCache();
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const env = {
    FIREBASE_PROJECT: "demo",
    FIREBASE_SA_JSON: JSON.stringify({
      client_email: "sweep@example.iam.gserviceaccount.com",
      private_key: pem,
    }),
  };
  const deleted = [];
  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  const pages = [
    {
      documents: [
        doc("secret-user-a", { expireAt: { timestampValue: "2026-10-01T00:00:00.000Z" } }),
        doc("secret-user-b", { expireAt: { timestampValue: "2026-12-01T00:00:00.000Z" } }),
        doc("secret-user-c", { at: { stringValue: new Date(NOW - DELETED_USER_TTL_MS - 5000).toISOString() } }),
      ],
      nextPageToken: "page-2",
    },
    {
      documents: [
        doc("secret-user-d", { expireAt: { timestampValue: "2026-09-01T00:00:00.000Z" } }),
      ],
    },
  ];
  let listed = 0;
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    const json = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data, text: async () => "" });
    if (u.includes("oauth2.googleapis.com")) return json(200, { access_token: "tok", expires_in: 3600 });
    if (String(opts && opts.method || "GET") === "DELETE") {
      deleted.push(u);
      return json(200, {});
    }
    const body = pages[listed] || { documents: [] };
    listed++;
    return json(200, body);
  };
  try {
    const out = await sweepTombstones(env, fetchImpl, NOW, { pageSize: 3, deleteBudget: 2, pageBudget: 5 });
    assert.equal(out.deleted, 2);
    assert.equal(deleted.length, 2);
    assert.match(deleted[0], /secret-user-a$/);
    assert.match(deleted[1], /secret-user-c$/);
    assert.deepEqual(logs, ["tombstones: 2"]);
    assert.equal(logs.join("\n").includes("secret-user"), false);
    assert.equal(listed, 1);
  } finally {
    console.log = orig;
    resetFirestoreTokenCache();
  }
});
