// Drives UsageLedger through wrangler's local Durable Object binding, not a direct method call.
import test from "node:test";
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";

async function post(worker, path, body) {
  const res = await worker.fetch("http://example.com" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, JSON.stringify(data));
  return data;
}

test("the real USAGE binding records a mocked $3.05 lookup and clears that user's counters", { timeout: 120000 }, async () => {
  const worker = await unstable_dev(new URL("./usage-ledger.worker.js", import.meta.url).pathname, {
    config: new URL("../api/wrangler.toml", import.meta.url).pathname,
    experimental: { disableExperimentalWarning: true },
    local: true,
    logLevel: "error",
  });
  try {
    const held = await post(worker, "/reserve", {
      id: "look-305",
      reserve: 1000,
      cap: 50_000_000,
      dailyAdd: 1,
      dailyLimit: 40,
      monthAdd: 1,
      monthLimit: 40,
      dailyKey: "q:user1:2026-10-27",
      monthKey: "m:user1:2026-10",
      seedSpend: 0,
    });
    assert.equal(held.ok, true);
    assert.equal(held.reserved, 1000);
    const rec = await post(worker, "/reconcile", { id: "look-305", actual: 3_050_000 });
    assert.equal(rec.ok, true);
    assert.equal(rec.duplicate, false);
    assert.equal(rec.billed, 3_050_000);
    const read = await post(worker, "/read", { keys: ["spend:free", "q:user1:2026-10-27", "m:user1:2026-10"] });
    assert.equal(read.values["spend:free"], 3_050_000);
    assert.equal(read.values["q:user1:2026-10-27"], 1);
    assert.equal(read.values["m:user1:2026-10"], 1);
    const cleared = await post(worker, "/clear", { uid: "user1" });
    assert.equal(cleared.ok, true);
    const after = await post(worker, "/read", { keys: ["spend:free", "q:user1:2026-10-27", "m:user1:2026-10"] });
    assert.equal(after.values["spend:free"], 3_050_000);
    assert.equal(after.values["q:user1:2026-10-27"], 0);
    assert.equal(after.values["m:user1:2026-10"], 0);
  } finally {
    await worker.stop();
  }
});
