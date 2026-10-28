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

test("the hourly sweep deletes expireAt hits by age, then walks markers with no expireAt by cursor", async () => {
  resetFirestoreTokenCache();
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const kv = new Map();
  const env = {
    FIREBASE_PROJECT: "demo",
    FIREBASE_SA_JSON: JSON.stringify({
      client_email: "sweep@example.iam.gserviceaccount.com",
      private_key: pem,
    }),
    WATCH: {
      get: async (key) => kv.get(key) || null,
      put: async (key, value) => { kv.set(key, value); },
      delete: async (key) => { kv.delete(key); },
    },
  };
  const deleted = [];
  const queries = [];
  const lists = [];
  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  const oldAt = new Date(NOW - DELETED_USER_TTL_MS - 5000).toISOString();
  const recent = new Date(NOW - 86400000).toISOString();
  let queryCalls = 0;
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    const method = String(opts && opts.method || "GET");
    const json = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data, text: async () => "" });
    if (u.includes("oauth2.googleapis.com")) return json(200, { access_token: "tok", expires_in: 3600 });
    if (method === "DELETE") {
      deleted.push(u);
      return json(200, {});
    }
    if (method === "POST" && u.includes(":runQuery")) {
      queries.push(JSON.parse(opts.body));
      queryCalls++;
      if (queryCalls === 1) {
        return json(200, [
          { document: doc("zzz-expired", { expireAt: { timestampValue: "2026-01-02T00:00:00.000Z" } }) },
          { document: doc("yyy-older", { expireAt: { timestampValue: "2026-01-01T00:00:00.000Z" } }) },
        ]);
      }
      return json(200, [{}]);
    }
    lists.push(u);
    const token = new URL(u).searchParams.get("pageToken") || "";
    if (!token) {
      return json(200, {
        documents: [
          doc("aaa-fresh", { at: { stringValue: recent } }),
          doc("has-expire", { expireAt: { timestampValue: "2026-01-01T00:00:00.000Z" } }),
        ],
        nextPageToken: "cursor-2",
      });
    }
    return json(200, {
      documents: [
        doc("nnn-old", { at: { stringValue: oldAt } }),
      ],
    });
  };
  try {
    const first = await sweepTombstones(env, fetchImpl, NOW, { pageSize: 2, deleteBudget: 10 });
    assert.equal(first.deleted, 2);
    assert.equal(queries.length, 1);
    const q = queries[0].structuredQuery;
    assert.equal(q.from[0].collectionId, "deletedUsers");
    assert.equal(q.where.fieldFilter.field.fieldPath, "expireAt");
    assert.equal(q.where.fieldFilter.op, "LESS_THAN");
    assert.equal(q.where.fieldFilter.value.timestampValue, new Date(NOW).toISOString());
    assert.equal(q.orderBy.length, 1);
    assert.equal(q.orderBy[0].field.fieldPath, "expireAt");
    assert.equal(q.orderBy[0].direction, "ASCENDING");
    assert.match(deleted[0], /zzz-expired$/);
    assert.match(deleted[1], /yyy-older$/);
    assert.equal(kv.get("tombstone:cursor"), "cursor-2");
    assert.equal(lists.length, 1);
    assert.equal(new URL(lists[0]).searchParams.get("pageToken"), null);

    const second = await sweepTombstones(env, fetchImpl, NOW, { pageSize: 2, deleteBudget: 10 });
    assert.equal(second.deleted, 1);
    assert.match(deleted[2], /nnn-old$/);
    assert.equal(new URL(lists[1]).searchParams.get("pageToken"), "cursor-2");
    assert.equal(kv.has("tombstone:cursor"), false);
    assert.deepEqual(logs, ["tombstones: 2", "tombstones: 1"]);
    assert.equal(logs.join("\n").includes("secret"), false);
    assert.equal(logs.join("\n").includes("zzz-expired"), false);
    assert.equal(logs.join("\n").includes("nnn-old"), false);
  } finally {
    console.log = orig;
    resetFirestoreTokenCache();
  }
});
