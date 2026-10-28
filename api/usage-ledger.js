// One SQLite Durable Object serializes the global free-spend counter and the per-uid quotas.
// The free cap is global, so every reserve has to land on this same instance.
// reserve() and reconcile() do not await: SQLite exec is synchronous, and the input gate
// does not let another request run until this method returns.
// The class extends DurableObject so the real binding exposes these methods over RPC.

import { DurableObject } from "cloudflare:workers";
import { applyReserve, applyReconcile, quotaCounterExpired, USAGE_HOLD_STALE_MS, POOL_SEED_KEY, poolLifetimeExpired } from "../js/logic.js";

const SPEND = "spend:free";
const SEEDED = "seeded:spend";
const POOL_SEEDED = "seeded:pool";
const TOMBSTONE_MS = 24 * 60 * 60 * 1000;

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

  // Copy the lifetime pool into October 2026 once. A later month starts at 0.
  _seedPool(spendKey, kvSpend) {
    if (String(spendKey || "") !== POOL_SEED_KEY) return false;
    if (this._has(POOL_SEEDED)) return false;
    const kvKnown = kvSpend != null && kvSpend !== "";
    if (!kvKnown && !this._has(SPEND)) return false;
    const oldLedger = this._get(SPEND);
    const oldKv = kvKnown ? Math.max(0, Math.round(+kvSpend || 0)) : 0;
    const cur = this._get(spendKey);
    this._put(spendKey, Math.max(oldLedger, oldKv, cur));
    this._put(POOL_SEEDED, 1);
    return true;
  }

  _releaseStale(id, uid, day, spendKey, now) {
    if (!id || this._has("done:" + id)) return;
    const holdKey = "hold:" + id;
    const hadHold = this._has(holdKey);
    if (hadHold) {
      const reserved = Math.max(0, this._get(holdKey));
      const month = day ? String(day).slice(0, 7) : "";
      const key = month ? "spend:free:" + month : (spendKey || SPEND);
      if (reserved) this._put(key, Math.max(0, this._get(key) - reserved));
      this._del(holdKey);
    }
    this._del("ht:" + id);
    const flightMark = "flight:" + id;
    const hadFlight = this._has(flightMark);
    if (hadFlight) {
      const n = Math.max(0, this._get(flightMark));
      if (uid && day && n) {
        const agg = "if:" + uid + ":" + day;
        this._put(agg, Math.max(0, this._get(agg) - n));
      }
      this._del(flightMark);
    }
    if (uid && day) this._del("if:" + uid + ":" + day + ":" + id);
    const dh = "dh:" + id;
    if (this._has(dh)) {
      if (uid && day) {
        const ds = "ds:" + uid + ":" + day;
        this._put(ds, Math.max(0, this._get(ds) - this._get(dh)));
      }
      this._del(dh);
    }
    if (hadHold || hadFlight) this._put("rel:" + id, now || Date.now());
  }

  // Only in-flight rows. A full ledger scan would run on every account's reserve.
  _expireStale(nowMs, spendKey) {
    const now = Math.round(+nowMs || Date.now());
    const cutoff = now - USAGE_HOLD_STALE_MS;
    const keys = this._rows("SELECT k FROM kv WHERE k GLOB ?", "if:*").map(row => String(row.k));
    for (const k of keys) {
      const entry = k.match(/^if:([^:]+):(\d{4}-\d{2}-\d{2}):(.+)$/);
      if (!entry) continue;
      if (this._get(k) > cutoff) continue;
      this._releaseStale(entry[3], entry[1], entry[2], spendKey, now);
    }
  }

  _billReleased(req, spendKey, now) {
    const id = String(req.id || "");
    const monthKey = String(req.monthKey || "");
    const refundKey = String(req.refundKey || "");
    const dailySpendKey = String(req.dailySpendKey || "");
    const out = applyReconcile({
      spend: this._get(spendKey),
      daily: 0,
      month: monthKey ? this._get(monthKey) : 0,
      refunds: refundKey ? this._get(refundKey) : 0,
      dailySpend: dailySpendKey ? this._get(dailySpendKey) : 0,
    }, { reserved: 0, actual: req.actual, countRefund: req.countRefund, refundCap: req.refundCap, skipMonth: req.skipMonth, dailyHold: 0 });
    this._put(spendKey, out.state.spend);
    if (out.refunded && monthKey && !req.skipMonth) this._put(monthKey, out.state.month);
    if (out.refunded && refundKey && !req.skipMonth) this._put(refundKey, out.state.refunds);
    if (dailySpendKey) this._put(dailySpendKey, out.state.dailySpend);
    this._del("rel:" + id);
    this._put("done:" + id, now);
    return { ok: true, duplicate: false, released: true, spend: out.state.spend, billed: out.billed, refunded: out.refunded, daily: out.state.daily, month: out.state.month, refunds: out.state.refunds, dailySpend: out.state.dailySpend };
  }

  reserve(req) {
    req = req || {};
    const spendKey = String(req.spendKey || SPEND);
    const now = Math.round(+req.now || Date.now());
    // A monthly pool key starts at 0. The lifetime seed applies only when no month key was named.
    if (!req.spendKey && req.seedSpend != null && req.seedSpend !== "" && !this._has(SEEDED)) {
      this._put(SPEND, Math.max(this._get(SPEND), Math.max(0, Math.round(+req.seedSpend || 0))));
      this._put(SEEDED, 1);
    }
    const poolSeeded = this._seedPool(spendKey, req.seedSpend);
    this._expireStale(now, spendKey);
    const flightKey = String(req.inflightKey || "");
    const state = {
      spend: this._get(spendKey),
      daily: req.dailyKey ? this._get(req.dailyKey) : 0,
      month: req.monthKey ? this._get(req.monthKey) : 0,
      alert: req.alertKey ? this._get(req.alertKey) : 0,
      dailySpend: req.dailySpendKey ? this._get(req.dailySpendKey) : 0,
      inflight: flightKey ? this._get(flightKey) : 0,
    };
    const out = applyReserve(state, req);
    if (!out.ok) return { ok: false, status: out.status, error: out.error, reserved: 0, charged: 0, dailyHeld: 0, poolSeeded };
    this._put(spendKey, out.state.spend);
    if (req.dailySpendKey) this._put(req.dailySpendKey, out.state.dailySpend);
    if (req.dailyKey && out.state.daily !== state.daily) this._put(req.dailyKey, out.state.daily);
    if (req.monthKey && !req.skipMonth && out.state.month !== state.month) this._put(req.monthKey, out.state.month);
    if (req.alertKey && req.alertAdd) this._put(req.alertKey, out.state.alert);
    if (flightKey) this._put(flightKey, out.state.inflight);
    const id = String(req.id || "");
    // A zero hold still marks the call, so a quota refund can run once and a repeat reconcile cannot.
    if (id) {
      this._put("hold:" + id, out.reserved);
      this._put("ht:" + id, now);
    }
    if (id && flightKey && out.charged) {
      this._put("flight:" + id, out.charged);
      this._put(flightKey + ":" + id, now);
    }
    if (id && out.dailyHeld) this._put("dh:" + id, out.dailyHeld);
    return { ok: true, status: 200, error: "", reserved: out.reserved, id, charged: out.charged, dailyHeld: out.dailyHeld || 0, refusedError: out.refusedError || "", poolSeeded };
  }

  reconcile(req) {
    req = req || {};
    const id = String(req.id || "");
    const spendKey = String(req.spendKey || SPEND);
    const now = Math.round(+req.now || Date.now());
    this._seedPool(spendKey, req.seedSpend);
    this._expireStale(now, spendKey);
    const holdKey = id ? "hold:" + id : "";
    if (holdKey && !this._has(holdKey)) {
      if (id && this._has("rel:" + id) && !this._has("done:" + id)) return this._billReleased(req, spendKey, now);
      return { ok: true, duplicate: true, spend: this._get(spendKey), billed: 0, refunded: 0 };
    }
    const reserved = holdKey ? this._get(holdKey) : Math.max(0, Math.round(+req.reserved || 0));
    const dailyKey = String(req.dailyKey || "");
    const monthKey = String(req.monthKey || "");
    const refundKey = String(req.refundKey || "");
    const dailySpendKey = String(req.dailySpendKey || "");
    const out = applyReconcile({
      spend: this._get(spendKey),
      daily: dailyKey ? this._get(dailyKey) : 0,
      month: monthKey ? this._get(monthKey) : 0,
      refunds: refundKey ? this._get(refundKey) : 0,
      dailySpend: dailySpendKey ? this._get(dailySpendKey) : 0,
    }, { reserved, actual: req.actual, countRefund: req.countRefund, refundCap: req.refundCap, skipMonth: req.skipMonth, dailyHold: req.dailyHold });
    this._put(spendKey, out.state.spend);
    if (out.refunded && monthKey && !req.skipMonth) this._put(monthKey, out.state.month);
    if (out.refunded && refundKey && !req.skipMonth) this._put(refundKey, out.state.refunds);
    if (dailySpendKey) this._put(dailySpendKey, out.state.dailySpend);
    if (holdKey) this._del(holdKey);
    if (id) {
      this._del("ht:" + id);
      this._del("dh:" + id);
    }
    const flightMark = id ? "flight:" + id : "";
    if (flightMark && this._has(flightMark)) {
      const n = Math.max(0, this._get(flightMark));
      const ik = String(req.inflightKey || "");
      if (ik && n) this._put(ik, Math.max(0, this._get(ik) - n));
      if (ik) this._del(ik + ":" + id);
      this._del(flightMark);
    }
    if (id) {
      this._del("rel:" + id);
      this._put("done:" + id, now);
    }
    return { ok: true, duplicate: false, spend: out.state.spend, billed: out.billed, refunded: out.refunded, daily: out.state.daily, month: out.state.month, refunds: out.state.refunds, dailySpend: out.state.dailySpend };
  }

  read(req) {
    const values = {};
    for (const key of (req && req.keys) || []) values[String(key)] = this._get(String(key));
    return { ok: true, values };
  }

  prune(req) {
    const now = req && req.now ? new Date(req.now) : new Date();
    const spendKey = String((req && req.spendKey) || "");
    this._expireStale(now.getTime(), spendKey);
    const seeded = this._has(POOL_SEEDED);
    const rows = this._rows("SELECT k FROM kv");
    let removed = 0;
    for (const row of rows) {
      if (row.k === SPEND && !seeded && !poolLifetimeExpired(now)) continue;
      if (String(row.k).startsWith("rel:") || String(row.k).startsWith("done:")) {
        const ts = this._get(row.k);
        if (ts && ts < now.getTime() - TOMBSTONE_MS) {
          this._del(row.k);
          removed++;
        }
        continue;
      }
      if (!quotaCounterExpired(row.k, now)) continue;
      this._del(row.k);
      removed++;
    }
    return { ok: true, removed };
  }

  clearUser(req) {
    const uid = String((req && req.uid) || "");
    if (!uid || /[^A-Za-z0-9]/.test(uid)) return { ok: false };
    for (const prefix of ["q:" + uid + ":", "a:" + uid + ":", "t:" + uid + ":", "ds:" + uid + ":", "if:" + uid + ":", "m:" + uid + ":", "rf:" + uid + ":"]) {
      const rows = this._rows("SELECT k FROM kv WHERE k GLOB ?", prefix + "*");
      for (const row of rows) this._del(row.k);
    }
    return { ok: true };
  }
}
