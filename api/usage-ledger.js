// One SQLite Durable Object serializes the global free-spend counter and the per-uid quotas.
// The free cap is global, so every reserve has to land on this same instance.
// reserve() and reconcile() do not await: SQLite exec is synchronous, and the input gate
// does not let another request run until this method returns.
// The class extends DurableObject so the real binding exposes these methods over RPC.

import { DurableObject } from "cloudflare:workers";
import { applyReserve, applyReconcile, quotaCounterExpired } from "../js/logic.js";

const SPEND = "spend:free";
const SEEDED = "seeded:spend";

export class UsageLedger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL)").toArray();
  }

  _rows(sql, ...args) {
    return this.ctx.storage.sql.exec(sql, ...args).toArray();
  }

  _get(k) {
    const rows = this._rows("SELECT v FROM kv WHERE k = ?", k);
    return rows.length ? Math.round(+rows[0].v || 0) : 0;
  }

  _has(k) {
    return this._rows("SELECT 1 AS n FROM kv WHERE k = ?", k).length > 0;
  }

  _put(k, v) {
    this.ctx.storage.sql.exec(
      "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      k,
      Math.round(+v || 0),
    ).toArray();
  }

  _del(k) {
    this.ctx.storage.sql.exec("DELETE FROM kv WHERE k = ?", k).toArray();
  }

  reserve(req) {
    req = req || {};
    if (req.seedSpend != null && req.seedSpend !== "" && !this._has(SEEDED)) {
      this._put(SPEND, Math.max(this._get(SPEND), Math.max(0, Math.round(+req.seedSpend || 0))));
      this._put(SEEDED, 1);
    }
    const state = {
      spend: this._get(SPEND),
      daily: req.dailyKey ? this._get(req.dailyKey) : 0,
      month: req.monthKey ? this._get(req.monthKey) : 0,
      alert: req.alertKey ? this._get(req.alertKey) : 0,
    };
    const out = applyReserve(state, req);
    if (!out.ok) return { ok: false, status: out.status, error: out.error, reserved: 0 };
    this._put(SPEND, out.state.spend);
    if (req.dailyKey && req.dailyAdd) this._put(req.dailyKey, out.state.daily);
    if (req.monthKey && req.monthAdd && !req.skipMonth) this._put(req.monthKey, out.state.month);
    if (req.alertKey && req.alertAdd) this._put(req.alertKey, out.state.alert);
    const id = String(req.id || "");
    if (id && out.reserved) this._put("hold:" + id, out.reserved);
    return { ok: true, status: 200, error: "", reserved: out.reserved, id };
  }

  reconcile(req) {
    req = req || {};
    const id = String(req.id || "");
    const holdKey = id ? "hold:" + id : "";
    if (holdKey && !this._has(holdKey)) return { ok: true, duplicate: true, spend: this._get(SPEND), billed: 0 };
    const reserved = holdKey ? this._get(holdKey) : Math.max(0, Math.round(+req.reserved || 0));
    const out = applyReconcile({ spend: this._get(SPEND) }, { reserved, actual: req.actual });
    this._put(SPEND, out.state.spend);
    if (holdKey) this._del(holdKey);
    return { ok: true, duplicate: false, spend: out.state.spend, billed: out.billed };
  }

  read(req) {
    const values = {};
    for (const key of (req && req.keys) || []) values[String(key)] = this._get(String(key));
    return { ok: true, values };
  }

  prune(req) {
    const now = req && req.now ? new Date(req.now) : new Date();
    const rows = this._rows("SELECT k FROM kv");
    let removed = 0;
    for (const row of rows) {
      if (!quotaCounterExpired(row.k, now)) continue;
      this._del(row.k);
      removed++;
    }
    return { ok: true, removed };
  }

  clearUser(req) {
    const uid = String((req && req.uid) || "");
    if (!uid || /[^A-Za-z0-9]/.test(uid)) return { ok: false };
    for (const prefix of ["q:" + uid + ":", "a:" + uid + ":", "m:" + uid + ":"]) {
      const rows = this._rows("SELECT k FROM kv WHERE k GLOB ?", prefix + "*");
      for (const row of rows) this._del(row.k);
    }
    return { ok: true };
  }
}
