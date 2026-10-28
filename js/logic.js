// Shared checks for the app, the lookup worker, and tests.
// No network, no secrets, no personal data.

export const SHARE_ITEM_KEYS = ["id", "name", "brand", "color", "category", "nick", "qty", "weight", "parent", "caliber", "value", "paid"];
export const MAX_SHARE_ITEMS = 80;

export const USER_LOCAL_KEYS = [
  "gearLocker.items",
  "gearLocker.kits",
  "gearLocker.db",
  "gearLocker.uid",
  "gearLocker.lock",
  "gearLocker.shareName",
  "gearLocker.curKit",
  "gearLocker.tab",
  "gearLocker.timer",
  "gearLocker.offline",
];
export const DEVICE_LOCAL_KEYS = ["gearLocker.keep", "gearLocker.noFolder"];

export function clearUserLocal(storage) {
  if (!storage) return;
  USER_LOCAL_KEYS.forEach(k => { try { storage.removeItem(k); } catch { /* private mode */ } });
  const extra = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith("gearLocker.") && !DEVICE_LOCAL_KEYS.includes(k)) extra.push(k);
    }
  } catch { /* ignore */ }
  extra.forEach(k => { try { storage.removeItem(k); } catch { /* ignore */ } });
}

export function shareItemFields(i, parent, prices) {
  const row = {
    id: String((i && i.id) || ""),
    name: String((i && i.name) || ""),
    brand: String((i && i.brand) || ""),
    color: String((i && i.color) || ""),
    category: String((i && i.category) || ""),
    nick: String((i && i.nick) || ""),
    qty: +((i && i.qty) || 1) || 1,
    weight: i && i.weight != null && i.weight !== "" && isFinite(+i.weight) ? +i.weight : null,
    parent: parent || "",
    caliber: i && i.category === "Firearms" ? String(i.caliber || "") : "",
  };
  if (prices) {
    row.value = countedValue(i);
    row.paid = +((i && i.paid) || 0) || 0;
  }
  return row;
}

export function newWriteId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function serverStampIso(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") {
    const t = Date.parse(v);
    return isFinite(t) ? new Date(t).toISOString() : "";
  }
  if (v instanceof Date) return isFinite(v.getTime()) ? v.toISOString() : "";
  if (typeof v.toDate === "function") {
    try {
      const d = v.toDate();
      if (d instanceof Date && isFinite(d.getTime())) return d.toISOString();
    } catch { /* not a Timestamp */ }
  }
  if (typeof v === "object") {
    const sec = v.seconds != null ? v.seconds : v._seconds;
    if (sec != null && isFinite(+sec)) {
      const ns = v.nanoseconds != null ? v.nanoseconds : (v._nanoseconds || 0);
      return new Date(+sec * 1000 + Math.floor(+ns / 1e6)).toISOString();
    }
  }
  return "";
}

function legacyCategoryId(category) {
  const key = categoryKey(category);
  return key === LEGACY_BELTS_KEY || key === LEGACY_MAGAZINES_KEY || key === LEGACY_STORAGE_KEY;
}

// An explicit Move stamps movedAt. A later save that still carries an old category id does not undo it.
export function keepMovedCategory(winner, local, remote) {
  if (!winner || !legacyCategoryId(winner.category)) return winner;
  const moved = [local, remote].filter(row => row && row.movedAt && !legacyCategoryId(row.category))
    .sort((a, b) => String(a.movedAt).localeCompare(String(b.movedAt)));
  const best = moved[moved.length - 1];
  if (!best) return winner;
  if (winner.category === best.category && winner.movedAt === best.movedAt) return winner;
  return { ...winner, category: best.category, movedAt: best.movedAt };
}

export function mergeCategoryAnswers(local, remote) {
  const out = { ...(local && typeof local === "object" ? local : {}) };
  Object.entries(remote && typeof remote === "object" ? remote : {}).forEach(([id, answer]) => {
    if (!id || !answer || typeof answer !== "object") return;
    const prev = out[id];
    if (!prev || String(answer.at || "") >= String(prev.at || "")) out[id] = answer;
  });
  return out;
}

export function mergeByServerTime(local, remote, inflight) {
  return keepMovedCategory(mergeByServerTimeWinner(local, remote, inflight), local, remote);
}

function mergeByServerTimeWinner(local, remote, inflight) {
  inflight = inflight || {};
  if (!remote) return local;
  if (!local) return remote;
  const lStamp = serverStampIso(local.serverUpdatedAt);
  const rStamp = serverStampIso(remote.serverUpdatedAt);
  const flight = inflight[local.id] || inflight[remote.id] || null;
  if (flight && flight.writeId && remote.writeId === flight.writeId) {
    if (local.updatedAt === flight.updatedAt) return { ...remote, serverUpdatedAt: rStamp || remote.serverUpdatedAt };
    return { ...local, serverUpdatedAt: rStamp || local.serverUpdatedAt };
  }
  if (rStamp && lStamp) {
    if (rStamp > lStamp) return { ...remote, serverUpdatedAt: rStamp };
    if (lStamp > rStamp) return local;
    if (local.updatedAt && remote.updatedAt && local.updatedAt > remote.updatedAt) return { ...local, serverUpdatedAt: lStamp };
    return { ...remote, serverUpdatedAt: rStamp };
  }
  if (rStamp && !lStamp) return { ...remote, serverUpdatedAt: rStamp };
  if (!rStamp && !lStamp) {
    const lu = local.updatedAt || "";
    const ru = remote.updatedAt || "";
    return ru > lu ? remote : local;
  }
  return local;
}

export function mergeKitsByServerTime(local, remote, meta) {
  meta = meta || {};
  const lStamp = serverStampIso(meta.localStamp);
  const rStamp = serverStampIso(meta.remoteStamp);
  const remoteKits = remote || {};
  if (meta.inflightWriteId && meta.remoteWriteId === meta.inflightWriteId) {
    if (meta.localPending) return { kits: local, serverUpdatedAt: rStamp || "", kept: "local" };
    return { kits: remoteKits, serverUpdatedAt: rStamp || "", kept: "remote" };
  }
  if (rStamp && (!lStamp || rStamp > lStamp)) return { kits: remoteKits, serverUpdatedAt: rStamp, kept: "remote" };
  if (lStamp && (!rStamp || lStamp > rStamp)) return { kits: local, serverUpdatedAt: lStamp, kept: "local" };
  if (!rStamp && !lStamp) {
    if (meta.localPending) return { kits: local, serverUpdatedAt: "", kept: "local" };
    if (remote) return { kits: remoteKits, serverUpdatedAt: "", kept: "remote" };
  }
  return { kits: local, serverUpdatedAt: lStamp, kept: "local" };
}

export function parseAllowlist(raw) {
  return String(raw || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function betaOnly(env) {
  return /^(1|true|yes|on)$/i.test(String(env && env.BETA_ONLY || "").trim());
}

export function isReviewEmail(email, env) {
  const list = parseAllowlist(env && env.REVIEW_EMAILS);
  return list.includes(String(email || "").trim().toLowerCase());
}

// A confirmed email can use lookups. BETA_ONLY=true puts the allowlist back in front.
export function decideAccess(user, env) {
  const email = String((user && user.email) || "").trim().toLowerCase();
  if (!user || !user.email_verified) return { ok: false, status: 403, error: "Confirm your email first (check your inbox), then try again.", email };
  if (betaOnly(env)) {
    const allow = parseAllowlist(env && env.ALLOWED_EMAILS);
    if (!allow.length) return { ok: false, status: 403, error: "Lookups are turned off until the owner adds approved emails.", email };
    if (!email || !allow.includes(email)) return { ok: false, status: 403, error: "Lookups are turned off for this account. Ask the owner to add your email.", email };
  }
  return { ok: true, status: 200, error: "", email, review: isReviewEmail(email, env) };
}

export function chargeDecision(used, add, limit) {
  used = Math.max(0, +used || 0);
  add = Math.max(0, +add || 0);
  limit = Math.max(0, +limit || 0);
  if (used + add > limit) return { ok: false, remaining: Math.max(0, limit - used), limit, next: used };
  return { ok: true, remaining: limit - used - add, limit, next: used + add };
}

function utcDay(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function quotaKey(uid, date) {
  return `q:${uid}:${utcDay(date)}`;
}

export function alertQuotaKey(uid, date) {
  return `a:${uid}:${utcDay(date)}`;
}

export function monthQuotaKey(uid, date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `m:${uid}:${y}-${m}`;
}

export const DEFAULT_PLAN_LIMITS = { free: 40, pro: 400, armory: 2000 };
export const DEFAULT_REVIEW_DAILY_LIMIT = 8;
export const DEFAULT_FREE_SPEND_CAP_USD = 25;
export const DEFAULT_SPEND_RATES = { inputPerMillion: 1, outputPerMillion: 5, searchEach: 0.01 };
export const DEFAULT_FALLBACK_RATES = { inputPerMillion: 3, outputPerMillion: 15, searchEach: 0.01 };

function configuredNumber(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  const n = +raw;
  return isFinite(n) && n >= 0 ? n : fallback;
}

export function planMonthlyLimit(plan, env) {
  const name = plan === "pro" || plan === "armory" ? plan : "free";
  const keys = { free: "PLAN_LIMIT_FREE", pro: "PLAN_LIMIT_PRO", armory: "PLAN_LIMIT_ARMORY" };
  return configuredNumber(env && env[keys[name]], DEFAULT_PLAN_LIMITS[name]);
}

export function reviewDailyLimit(env) {
  return configuredNumber(env && env.REVIEW_DAILY_LIMIT, DEFAULT_REVIEW_DAILY_LIMIT);
}

export function spendCapMicro(env) {
  return Math.round(configuredNumber(env && env.FREE_SPEND_CAP_USD, DEFAULT_FREE_SPEND_CAP_USD) * 1e6);
}

export function spendRates(env) {
  return {
    inputPerMillion: configuredNumber(env && env.SPEND_INPUT_PER_MILLION, DEFAULT_SPEND_RATES.inputPerMillion),
    outputPerMillion: configuredNumber(env && env.SPEND_OUTPUT_PER_MILLION, DEFAULT_SPEND_RATES.outputPerMillion),
    searchEach: configuredNumber(env && env.SPEND_SEARCH_EACH, DEFAULT_SPEND_RATES.searchEach),
  };
}

export function ratesForModel(env, model) {
  const base = spendRates(env);
  if (!env || !env.FALLBACK_MODEL || model !== env.FALLBACK_MODEL) return base;
  return {
    inputPerMillion: configuredNumber(env.FALLBACK_INPUT_PER_MILLION, DEFAULT_FALLBACK_RATES.inputPerMillion),
    outputPerMillion: configuredNumber(env.FALLBACK_OUTPUT_PER_MILLION, DEFAULT_FALLBACK_RATES.outputPerMillion),
    searchEach: configuredNumber(env.FALLBACK_SEARCH_EACH, base.searchEach),
  };
}

// The hold uses the higher of the primary and fallback rates. A blank FALLBACK_MODEL turns the fallback off.
export function priciestRates(env) {
  const base = spendRates(env);
  const fallbackOn = !env || env.FALLBACK_MODEL == null || String(env.FALLBACK_MODEL) !== "";
  if (!fallbackOn) return base;
  const alt = ratesForModel(
    { ...(env || {}), FALLBACK_MODEL: (env && env.FALLBACK_MODEL) || "claude-sonnet-5-5" },
    (env && env.FALLBACK_MODEL) || "claude-sonnet-5-5",
  );
  return {
    inputPerMillion: Math.max(base.inputPerMillion, alt.inputPerMillion),
    outputPerMillion: Math.max(base.outputPerMillion, alt.outputPerMillion),
    searchEach: Math.max(base.searchEach, alt.searchEach),
  };
}

// RevenueCat is not connected. Every account stays on the free plan until that lookup exists.
export function lookupPlan() {
  return "free";
}

function tokenCount(...vals) {
  return vals.reduce((sum, v) => sum + Math.max(0, Math.round(+v || 0)), 0);
}

// input_tokens plus cache and web-search result tokens. The search count is billed on its own.
export function usageFromResponse(data) {
  const u = data && data.usage && typeof data.usage === "object" ? data.usage : {};
  const tool = u.server_tool_use && typeof u.server_tool_use === "object" ? u.server_tool_use : {};
  return {
    input_tokens: tokenCount(u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens, tool.web_search_tokens, tool.web_search_result_tokens, u.web_search_tokens),
    output_tokens: Math.max(0, Math.round(+u.output_tokens || 0)),
    web_search_requests: Math.max(0, Math.round(+tool.web_search_requests || +u.web_search_requests || 0)),
  };
}

export function addUsage(a, b) {
  const x = a || {};
  const y = b || {};
  return {
    input_tokens: Math.max(0, +x.input_tokens || 0) + Math.max(0, +y.input_tokens || 0),
    output_tokens: Math.max(0, +x.output_tokens || 0) + Math.max(0, +y.output_tokens || 0),
    web_search_requests: Math.max(0, +x.web_search_requests || 0) + Math.max(0, +y.web_search_requests || 0),
  };
}

// Micro-dollars (millionths of a dollar) so the KV counter stays a whole number.
export function estimateSpendMicro(usage, rates) {
  const u = usage || {};
  const r = rates || DEFAULT_SPEND_RATES;
  const input = Math.round((Math.max(0, +u.input_tokens || 0) / 1e6) * configuredNumber(r.inputPerMillion, DEFAULT_SPEND_RATES.inputPerMillion) * 1e6);
  const output = Math.round((Math.max(0, +u.output_tokens || 0) / 1e6) * configuredNumber(r.outputPerMillion, DEFAULT_SPEND_RATES.outputPerMillion) * 1e6);
  const search = Math.round(Math.max(0, +u.web_search_requests || 0) * configuredNumber(r.searchEach, DEFAULT_SPEND_RATES.searchEach) * 1e6);
  return input + output + search;
}

export function freeSpendBlocked(spentMicro, capMicro, plan, review) {
  if (review || plan !== "free") return false;
  return Math.max(0, +spentMicro || 0) >= Math.max(0, +capMicro || 0);
}

export const LOOKUPS_PAUSED = "Lookups are paused for now. You can keep using the rest of War Box.";
const MONTHLY_FULL = "You've used this month's lookups. They reset next month.";

export function usageDecision(opts) {
  opts = opts || {};
  const plan = opts.plan === "pro" || opts.plan === "armory" ? opts.plan : "free";
  const review = !!opts.review;
  if (freeSpendBlocked(opts.spentMicro, opts.capMicro, plan, review)) {
    return { ok: false, status: 403, error: LOOKUPS_PAUSED, plan, review };
  }
  const daily = chargeDecision(opts.dailyUsed, opts.dailyAdd, opts.dailyLimit);
  if (!daily.ok) {
    return { ok: false, status: 429, error: `Daily lookup limit reached (${daily.limit} per day). Try again tomorrow.`, plan, review, daily };
  }
  if (review) return { ok: true, status: 200, error: "", plan, review, daily, month: null };
  const month = chargeDecision(opts.monthUsed, opts.monthAdd, opts.monthLimit);
  if (!month.ok) return { ok: false, status: 429, error: MONTHLY_FULL, plan, review, daily, month };
  return { ok: true, status: 200, error: "", plan, review, daily, month };
}

export const USER_COLLECTIONS = ["items", "ammo", "sessions", "dope", "maint", "wish", "loans", "freqs", "pace", "meta"];

export function accountDeletePlan(uid) {
  const id = String(uid || "");
  return {
    collections: USER_COLLECTIONS.slice(),
    lendField: "lender",
    kvExact: [`w:${id}`],
    kvPrefixes: [`q:${id}:`, `a:${id}:`, `m:${id}:`],
  };
}

export const DELETE_AUTH_MAX_AGE_SEC = 300;
export const ACCOUNT_DELETE_TIMEOUT_MS = 45000;

// auth_time is seconds. A few seconds of clock skew still counts as a fresh sign-in.
export function signInIsRecent(authTime, nowSec) {
  const at = +authTime;
  const now = nowSec == null ? Math.floor(Date.now() / 1000) : +nowSec;
  if (!isFinite(at) || at <= 0 || !isFinite(now)) return false;
  const age = now - at;
  return age >= -60 && age <= DELETE_AUTH_MAX_AGE_SEC;
}

export function reserveFits(spent, reserve, cap) {
  return Math.max(0, +spent || 0) + Math.max(0, +reserve || 0) <= Math.max(0, +cap || 0);
}

export const MAX_OUTPUT_TOKENS = 4000;

export function clampMaxTokens(n) {
  const v = Math.floor(+n);
  if (!isFinite(v) || v < 1) return 1;
  return Math.min(MAX_OUTPUT_TOKENS, v);
}

// Two characters per token overestimates Claude's count, so the hold stays above the bill.
export function estimateInputTokens(text) {
  return Math.max(0, Math.ceil(String(text == null ? "" : text).length / 2));
}

// Each web search can come back this large, and later rounds send those results again.
export const SEARCH_RESULT_TOKENS = 16000;

export function roundFits(spentMicro, nextMicro, holdMicro) {
  if (holdMicro == null) return true;
  return Math.max(0, Math.round(+spentMicro || 0)) + Math.max(0, Math.round(+nextMicro || 0)) <= Math.max(0, Math.round(+holdMicro || 0));
}

// rounds counts every continuation, including the last JSON turn.
// calls counts a fallback model. searches is the per-round web_search max_uses.
export const MODEL_CALLS = {
  lookup: { maxTokens: 4000, searches: 3, rounds: 5, calls: 2, promptTokens: 8000 },
  identify: { maxTokens: 600, searches: 0, rounds: 1, calls: 1, promptTokens: 20000 },
  deal: { maxTokens: 3000, searches: 2, rounds: 3, calls: 1, promptTokens: 6000 },
  battery: { maxTokens: 2000, searches: 2, rounds: 3, calls: 1, promptTokens: 4000 },
  pace: { maxTokens: 4000, searches: 2, rounds: 4, calls: 1, promptTokens: 8000 },
  paceFollow: { maxTokens: 3000, searches: 0, rounds: 1, calls: 1, promptTokens: 8000 },
};

// One model call. Later rounds re-send the prompt, earlier output, and earlier search results.
// Each searching round can also bill fresh result tokens on that response (web_search_tokens).
function oneCallUsage(input, rounds, maxTokens, searches) {
  let input_tokens = 0;
  for (let i = 0; i < rounds; i++) {
    const resent = i * maxTokens + i * searches * SEARCH_RESULT_TOKENS;
    input_tokens += input + resent + searches * SEARCH_RESULT_TOKENS;
  }
  return {
    input_tokens,
    output_tokens: maxTokens * rounds,
    web_search_requests: searches * rounds,
  };
}

// Hold = real input, search results re-sent on later rounds, and max output, including a fallback call.
export function worstCaseUsage(spec) {
  spec = spec || {};
  const maxTokens = clampMaxTokens(spec.maxTokens);
  const rounds = Math.max(1, Math.floor(+spec.rounds || 1));
  const searches = Math.max(0, Math.floor(+spec.searches || 0));
  const calls = Math.max(1, Math.floor(+spec.calls || 1));
  const input = Math.max(0, Math.floor(spec.inputTokens == null
    ? (spec.promptTokens == null ? 8000 : +spec.promptTokens)
    : +spec.inputTokens));
  let total = { input_tokens: 0, output_tokens: 0, web_search_requests: 0 };
  const once = oneCallUsage(input, rounds, maxTokens, searches);
  for (let i = 0; i < calls; i++) total = addUsage(total, once);
  return total;
}

export function operationWorstUsage(name, inputTokens) {
  if (name === "pace") {
    const pace = { ...MODEL_CALLS.pace };
    const follow = { ...MODEL_CALLS.paceFollow };
    if (inputTokens != null) {
      pace.inputTokens = inputTokens;
      follow.inputTokens = inputTokens;
    }
    return addUsage(worstCaseUsage(pace), worstCaseUsage(follow));
  }
  const spec = { ...(MODEL_CALLS[name] || MODEL_CALLS.lookup) };
  if (inputTokens != null) spec.inputTokens = inputTokens;
  return worstCaseUsage(spec);
}

// One searching round budgeted at the input cap. The hold covers it so a large result stays inside the reserve.
export function flooredSearchRoundMicro(env, spec) {
  spec = spec || {};
  const searches = Math.max(0, Math.floor(+spec.searches || 0));
  if (!searches) return 0;
  return estimateSpendMicro({
    input_tokens: ROUND_INPUT_TOKEN_CAP,
    output_tokens: clampMaxTokens(spec.maxTokens),
    web_search_requests: searches,
  }, priciestRates(env));
}

// Priced at the higher of the primary and fallback model rates.
// A searching op reserves at least one round at the input cap.
// SPEND_RESERVE_USD can only raise a lookup hold, never lower it under that worst case.
export function callHoldMicro(env, op, inputTokens) {
  const name = op || "lookup";
  const usage = operationWorstUsage(name, inputTokens);
  let worst = estimateSpendMicro(usage, priciestRates(env));
  const spec = name === "pace" ? MODEL_CALLS.pace : MODEL_CALLS[name];
  if (spec) worst = Math.max(worst, flooredSearchRoundMicro(env, spec));
  if ((op == null || op === "lookup") && env && env.SPEND_RESERVE_USD != null && String(env.SPEND_RESERVE_USD).trim() !== "") {
    worst = Math.max(worst, Math.round(configuredNumber(env.SPEND_RESERVE_USD, 0) * 1e6));
  }
  return worst;
}

export function worstCaseSpendMicro(env, nameOrSpec) {
  if (nameOrSpec && typeof nameOrSpec === "object") return estimateSpendMicro(worstCaseUsage(nameOrSpec), priciestRates(env));
  return callHoldMicro(env, nameOrSpec || "lookup");
}

export function lookupReserveMicro(env) {
  return callHoldMicro(env, "lookup");
}

export function reconcileSpendMicro(current, reserved, actual) {
  return Math.max(0, Math.round((+current || 0) - (+reserved || 0) + Math.max(0, +actual || 0)));
}

const ALERTS_FULL = "You've used today's price alerts. Try again tomorrow.";

// One synchronous decision for spend, daily quota, monthly quota, and alert quota.
export function applyReserve(state, req) {
  state = state || {};
  req = req || {};
  const spend = Math.max(0, Math.round(+state.spend || 0));
  const daily = Math.max(0, Math.round(+state.daily || 0));
  const month = Math.max(0, Math.round(+state.month || 0));
  const alert = Math.max(0, Math.round(+state.alert || 0));
  const same = { spend, daily, month, alert };
  const reserve = Math.max(0, Math.round(+req.reserve || 0));
  const skipSpend = !!req.skipSpend;
  if (!skipSpend && !reserveFits(spend, reserve, req.cap)) {
    return { ok: false, status: 403, error: LOOKUPS_PAUSED, reserved: 0, state: same };
  }
  const dailyAdd = Math.max(0, +req.dailyAdd || 0);
  const dailyDecision = chargeDecision(daily, dailyAdd, req.dailyLimit);
  if (dailyAdd && !dailyDecision.ok) {
    return { ok: false, status: 429, error: `Daily lookup limit reached (${dailyDecision.limit} per day). Try again tomorrow.`, reserved: 0, state: same };
  }
  let monthNext = month;
  if (!req.skipMonth) {
    const monthAdd = Math.max(0, +req.monthAdd || 0);
    const monthDecision = chargeDecision(month, monthAdd, req.monthLimit);
    if (monthAdd && !monthDecision.ok) return { ok: false, status: 429, error: MONTHLY_FULL, reserved: 0, state: same };
    monthNext = monthAdd ? monthDecision.next : month;
  }
  const alertAdd = Math.max(0, +req.alertAdd || 0);
  let alertNext = alert;
  if (alertAdd) {
    const alertDecision = chargeDecision(alert, alertAdd, req.alertLimit);
    if (!alertDecision.ok) return { ok: false, status: 429, error: ALERTS_FULL, reserved: 0, state: same };
    alertNext = alertDecision.next;
  }
  const held = skipSpend ? 0 : reserve;
  return {
    ok: true,
    status: 200,
    error: "",
    reserved: held,
    state: { spend: spend + held, daily: dailyAdd ? dailyDecision.next : daily, month: monthNext, alert: alertNext },
  };
}

// The real cost is recorded in full. An overage above the hold is kept.
export function applyReconcile(state, req) {
  state = state || {};
  req = req || {};
  const reserved = Math.max(0, Math.round(+req.reserved || 0));
  const actual = Math.max(0, Math.round(+req.actual || 0));
  return {
    ok: true,
    billed: actual,
    state: {
      spend: reconcileSpendMicro(state.spend, reserved, actual),
      daily: Math.max(0, Math.round(+state.daily || 0)),
      month: Math.max(0, Math.round(+state.month || 0)),
      alert: Math.max(0, Math.round(+state.alert || 0)),
    },
  };
}

export const SERVER_DELETE_STEPS = ["firestore", "watch", "auth", "usage"];

export function deleteRetryRoute(hasTombstone) {
  return hasTombstone ? ["server"] : ["client-data", "tombstone", "server"];
}

// Attempt 1 can die on a 502, a timeout, or offline. Auth and usage counters stay.
// A later sign-in only posts to the server, which finishes shares, the auth user, and counters.
export function runDeleteAttempt(state, serverResult) {
  const route = deleteRetryRoute(!!(state && state.tombstone));
  const next = {
    tombstone: !!(state && state.tombstone),
    shares: Math.max(0, +(state && state.shares) || 0),
    gear: Math.max(0, +(state && state.gear) || 0),
    auth: !!(state && state.auth),
    kv: !!(state && state.kv),
  };
  const queriedShares = route[0] !== "server";
  if (queriedShares) {
    next.gear = 0;
    next.shares = 0;
    next.tombstone = true;
  }
  if (serverResult !== "ok") return { ok: false, route, queriedShares, steps: [], state: next };
  next.shares = 0;
  next.gear = 0;
  next.auth = false;
  next.kv = false;
  next.tombstone = true;
  return { ok: true, route, queriedShares, steps: SERVER_DELETE_STEPS.slice(), state: next };
}

const LOAN_EMAIL_FIELDS = ["friendEmail", "lenderEmail", "borrowerEmail", "borrowerEmailLower"];

// Clear this person's email on a loan or lend. Item names are never consulted.
export function loanEmailRedaction(loan, email) {
  const want = String(email || "").trim().toLowerCase();
  if (!want || !loan || typeof loan !== "object") return null;
  let hit = false;
  const copy = { ...loan };
  for (const field of LOAN_EMAIL_FIELDS) {
    if (String(loan[field] || "").trim().toLowerCase() === want) {
      copy[field] = "";
      hit = true;
    }
  }
  return hit ? copy : null;
}

// RevenueCat is not set up. This is the hook that will delete the customer later.
export function deleteRevenueCatCustomer() {
  return { ok: true, skipped: true };
}

export function selectDueWatches(users, opts) {
  opts = opts || {};
  const now = opts.now != null ? +new Date(opts.now) : Date.now();
  const budget = opts.budget != null ? opts.budget : 6;
  const minGapMs = opts.minGapMs != null ? opts.minGapMs : 20 * 3600e3;
  const queues = [];
  for (const u of users || []) {
    const due = (u.list || []).filter(w => {
      if (!w || !w.lastCheck) return true;
      const t = Date.parse(w.lastCheck);
      return !isFinite(t) || now - t >= minGapMs;
    }).slice().sort((a, b) => {
      const ta = a.lastCheck ? Date.parse(a.lastCheck) : 0;
      const tb = b.lastCheck ? Date.parse(b.lastCheck) : 0;
      return (isFinite(ta) ? ta : 0) - (isFinite(tb) ? tb : 0);
    });
    if (due.length) queues.push({ uid: u.uid, due, i: 0 });
  }
  queues.sort((a, b) => {
    const ta = a.due[0].lastCheck ? Date.parse(a.due[0].lastCheck) : 0;
    const tb = b.due[0].lastCheck ? Date.parse(b.due[0].lastCheck) : 0;
    return (isFinite(ta) ? ta : 0) - (isFinite(tb) ? tb : 0);
  });
  const picked = [];
  while (picked.length < budget && queues.some(q => q.i < q.due.length)) {
    for (const q of queues) {
      if (picked.length >= budget) break;
      if (q.i < q.due.length) {
        picked.push({ uid: q.uid, watch: q.due[q.i] });
        q.i++;
      }
    }
  }
  return picked;
}

export function pinLengthOk(pin) {
  return /^\d{6,12}$/.test(String(pin || ""));
}

export function newPasswordOk(pw) {
  return String(pw || "").length >= 12;
}

// reload() updates the user object. Rules and lookups read the ID token, which stays stale until this.
export async function refreshAuthClaims(user) {
  if (!user || typeof user.reload !== "function" || typeof user.getIdToken !== "function") {
    throw new Error("no user");
  }
  await user.reload();
  await user.getIdToken(true);
  return user;
}

// The private loan and the shared lend are one save. A later debounced sync must not be the only copy.
export function loanSharePlan(loan, opts) {
  const removed = !!(opts && opts.removed);
  const verified = !!(opts && opts.verified);
  const email = String((loan && loan.friendEmail) || "").trim();
  const wasShared = !!(loan && loan.lendShared);
  const share = verified && !removed && !!email && !(loan && loan.deleted);
  return {
    writePrivate: true,
    writeLend: share,
    deleteLend: verified && !share && wasShared,
    needsVerify: !verified && !removed && !!email,
  };
}

// Drop client-only flags before a row is written to the server.
// A loan stores friendEmailLower so the server can find it without a lend.
export function serverRow(row) {
  const copy = { ...(row || {}) };
  delete copy.offlinePending;
  if (Object.prototype.hasOwnProperty.call(copy, "friendEmail")) {
    copy.friendEmailLower = String(copy.friendEmail || "").trim().toLowerCase();
  }
  return copy;
}

// The borrower's lend rows name the lender and the loan id. A private loan with no lend has no path.
export function loanTargetsFromLends(lends) {
  const paths = [];
  const seen = new Set();
  for (const lend of lends || []) {
    if (!lend) continue;
    const loanId = String(lend.id || "").trim();
    const lender = String(lend.lender || "").trim();
    if (!loanId || !lender || /[/\s]/.test(loanId) || /[/\s]/.test(lender)) return { ok: false, paths: [] };
    const key = lender + "/" + loanId;
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push({ lender, loanId });
  }
  return { ok: true, paths };
}

// A bad lend is skipped. It must not fail the whole account delete.
export function loanRedactTargets(lends) {
  const paths = [];
  const skipped = [];
  const seen = new Set();
  for (const lend of lends || []) {
    if (!lend) continue;
    const loanId = String(lend.id || "").trim();
    const lender = String(lend.lender || "").trim();
    if (!loanId || !lender || /[/\s]/.test(loanId) || /[/\s]/.test(lender)) {
      skipped.push({ loanId, lender, reason: "lend" });
      continue;
    }
    const key = lender + "/" + loanId;
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push({ lender, loanId });
  }
  return { paths, skipped };
}

// Every saved loan that names a friend email gets a lend mirror. Verified sign-in backfills the ones that missed.
export function loansToMirror(loans, verified) {
  const jobs = [];
  for (const loan of loans || []) {
    if (!loan || !loan.id) continue;
    const plan = loanSharePlan(loan, { verified: !!verified });
    if (!plan.writeLend && !plan.deleteLend) continue;
    jobs.push({ id: String(loan.id), writeLend: !!plan.writeLend, deleteLend: !!plan.deleteLend });
  }
  return jobs;
}

export const ACCOUNT_DELETED_NOTE = "Your account is deleted.";

// The note is written just before sign-out. This page load is the only one that may clear it.
export function deletedAccountGate(loadedWith, shown) {
  const fromLoad = String(loadedWith || "");
  const already = String(shown || "");
  const text = fromLoad || already;
  return {
    text: text || "Sign in to open War Box.",
    clearStored: !!fromLoad,
    shown: text,
  };
}

// Both queues are written before the sign-in is deleted. A failed queue leaves the sign-in in place.
export function deleteCleanupResult(queuesSaved, countersCleared) {
  if (!queuesSaved) {
    return { status: 502, body: { error: "Couldn't finish deleting the account. Your sign-in is still here. Try again." } };
  }
  return {
    status: 200,
    body: { ok: true, deleted: true, cleanup: countersCleared ? "done" : "pending" },
  };
}

// One small record per uid. The hourly job can clear usage counters and then drops the record.
export const CLEANUP_MAX_ATTEMPTS = 24;
export const CLEANUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CLEANUP_RECORD_MAX_BYTES = 256;

export function cleanupQueueBody(uid, nowIso) {
  const id = String(uid || "").trim();
  if (!id || id.length > 128 || /[\s/]/.test(id)) return null;
  const raw = JSON.stringify({ uid: id, at: String(nowIso || ""), attempts: 0 });
  if (raw.length > CLEANUP_RECORD_MAX_BYTES) return null;
  return raw;
}

// Redaction entries are dropped. The record expires after 24 attempts or 7 days, with backoff between tries.
export function cleanupRetryPlan(record, nowMs) {
  const now = nowMs == null ? Date.now() : +nowMs;
  if (!record || typeof record !== "object") return { action: "delete" };
  if (record.usageCleared) return { action: "delete" };
  const atMs = Date.parse(record.at);
  const attempts = Math.max(0, Math.floor(+record.attempts || 0));
  const age = Number.isFinite(atMs) ? now - atMs : CLEANUP_MAX_AGE_MS + 1;
  if (attempts >= CLEANUP_MAX_ATTEMPTS || age > CLEANUP_MAX_AGE_MS) return { action: "delete" };
  const lastMs = Date.parse(record.lastTry);
  const basis = Number.isFinite(lastMs) ? lastMs : (Number.isFinite(atMs) ? atMs : now);
  const waitHours = attempts <= 0 ? 0 : Math.min(24, 2 ** (attempts - 1));
  if (attempts > 0 && now < basis + waitHours * 60 * 60 * 1000) return { action: "wait" };
  const body = {
    uid: String(record.uid || "").slice(0, 128),
    at: Number.isFinite(atMs) ? record.at : new Date(now).toISOString(),
    attempts: attempts + 1,
    lastTry: new Date(now).toISOString(),
  };
  const raw = JSON.stringify(body);
  if (raw.length > CLEANUP_RECORD_MAX_BYTES) return { action: "delete" };
  return { action: "retry", body, raw };
}

// One lender can publish this many lends to the same email. Rules enforce it on create.
export const LEND_EMAIL_CAP = 40;

// Confirmed lender loans go first inside a page. The server job has no overall cap.
export function orderRedactions(candidates, limit) {
  const all = candidates || [];
  const n = limit == null ? all.length : Math.max(0, Math.floor(+limit));
  const ranked = all.map((row, index) => ({
    row,
    index,
    rank: row && row.match ? (row.clearLoan ? 2 : 1) : 0,
  }));
  ranked.sort((a, b) => (b.rank - a.rank) || (a.index - b.index));
  const ordered = ranked.map(item => item.row);
  return { now: ordered.slice(0, n), later: ordered.slice(n) };
}

// Uppercase hex matches Firestore rules hashing.sha256(...).toHexString().
export async function lendMailDocId(email) {
  const addr = String(email || "").trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(addr));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// One cron pass stays under the Workers subrequest limit. The job resumes next hour.
export const REDACT_PAGE_SIZE = 4;
export const REDACT_OPS_BUDGET = 20;
export const REDACT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const REDACT_RECORD_MAX_BYTES = 800;

export function redactionJobBody(uid, email, nowIso) {
  const id = String(uid || "").trim();
  const addr = String(email || "").trim().toLowerCase();
  if (!id || id.length > 128 || /[\s/]/.test(id)) return null;
  if (!addr || addr.length > 200 || !addr.includes("@")) return null;
  const raw = JSON.stringify({
    uid: id,
    email: addr,
    at: String(nowIso || ""),
    attempts: 0,
    phase: "loans",
    cursor: "",
    lendCursor: "",
  });
  if (raw.length > REDACT_RECORD_MAX_BYTES) return null;
  return raw;
}

function redactionRecord(record, extra) {
  const atMs = Date.parse(record && record.at);
  const body = {
    uid: String((record && record.uid) || "").slice(0, 128),
    email: String((record && record.email) || "").trim().toLowerCase().slice(0, 200),
    at: Number.isFinite(atMs) ? record.at : "",
    attempts: extra.attempts,
    lastTry: extra.lastTry,
    phase: extra.phase || (record && record.phase) || "loans",
    cursor: String(extra.cursor != null ? extra.cursor : (record && record.cursor) || "").slice(0, 300),
    lendCursor: String(extra.lendCursor != null ? extra.lendCursor : (record && record.lendCursor) || "").slice(0, 300),
  };
  let raw = JSON.stringify(body);
  if (raw.length > REDACT_RECORD_MAX_BYTES) {
    body.cursor = "";
    body.lendCursor = "";
    raw = JSON.stringify(body);
  }
  if (!body.uid || !body.email || raw.length > REDACT_RECORD_MAX_BYTES) return null;
  return raw;
}

// The job expires 30 days after it was queued. Backoff skips a rewrite while the wait is still running.
export function redactionRetryPlan(record, nowMs) {
  const now = nowMs == null ? Date.now() : +nowMs;
  if (!record || typeof record !== "object") return { action: "delete" };
  const atMs = Date.parse(record.at);
  const age = Number.isFinite(atMs) ? now - atMs : REDACT_MAX_AGE_MS + 1;
  if (!record.email || age > REDACT_MAX_AGE_MS) return { action: "delete" };
  const attempts = Math.max(0, Math.floor(+record.attempts || 0));
  const lastMs = Date.parse(record.lastTry);
  const basis = Number.isFinite(lastMs) ? lastMs : (Number.isFinite(atMs) ? atMs : now);
  const waitHours = attempts <= 0 ? 0 : Math.min(24, 2 ** (attempts - 1));
  if (attempts > 0 && now < basis + waitHours * 60 * 60 * 1000) return { action: "wait" };
  return { action: "retry" };
}

export function redactionProgressBody(record, state, nowMs) {
  const now = nowMs == null ? Date.now() : +nowMs;
  return redactionRecord(record, {
    attempts: 0,
    lastTry: new Date(now).toISOString(),
    phase: state && state.phase,
    cursor: state && state.cursor,
    lendCursor: state && state.lendCursor,
  });
}

export function redactionFailureBody(record, nowMs) {
  const now = nowMs == null ? Date.now() : +nowMs;
  const atMs = Date.parse(record && record.at);
  if (!Number.isFinite(atMs) || now - atMs > REDACT_MAX_AGE_MS) return null;
  return redactionRecord(record, {
    attempts: Math.max(0, Math.floor(+(record && record.attempts) || 0)) + 1,
    lastTry: new Date(now).toISOString(),
  });
}

// A searching round can carry this much input. The loop applies it only after a round that searched,
// so the first call uses the real estimate and still has to fit the hold.
export const ROUND_INPUT_TOKEN_CAP = 1_200_000;

export function roundInputTokens(estimated, searches, searchedAlready) {
  const est = Math.max(0, Math.floor(+estimated || 0));
  const n = Math.max(0, Math.floor(+searches || 0));
  if (!n || !searchedAlready) return est;
  return Math.max(est, ROUND_INPUT_TOKEN_CAP);
}

function sameJson(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], b[i])) return false;
    return true;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!sameJson(a[key], b[key])) return false;
  return true;
}

// updatedAt changes on every build of the lend doc. Extra server fields, such as borrowerReturned, stay.
export function lendNeedsWrite(desired, existing) {
  if (existing == null) return true;
  if (!desired || typeof existing !== "object") return true;
  for (const key of Object.keys(desired)) {
    if (key === "updatedAt" || key === "serverUpdatedAt") continue;
    if (!sameJson(desired[key], existing[key])) return true;
  }
  return false;
}

export function lendAddress(doc) {
  const lower = String((doc && doc.borrowerEmailLower) || "").trim().toLowerCase();
  if (lower) return lower;
  return String((doc && (doc.borrowerEmail || doc.friendEmail)) || "").trim().toLowerCase();
}

// A different friend needs a new lend. The same address, including a case change, stays put.
// The new address is refused when that lender is already at the cap, so the old lend is left alone.
export function lendRetarget(existing, desired, count) {
  const from = lendAddress(existing);
  const to = lendAddress(desired);
  if (!to) return { action: from ? "drop" : "keep" };
  if (!from) return { action: "create" };
  if (from === to) return { action: "keep" };
  if (Math.floor(+count || 0) >= LEND_EMAIL_CAP) {
    return { action: "blocked", message: "That email already has the maximum number of loans from you." };
  }
  return { action: "replace", from, to };
}

// Missing or different lends are written. A changed friend email is a replace, not an in-place edit.
// A second pass over the stored doc, with a new updatedAt, is empty.
export function lendMirrorOps(jobs, desiredById, remoteById) {
  const remote = remoteById || {};
  const desired = desiredById || {};
  const ops = [];
  for (const job of jobs || []) {
    const id = String((job && job.id) || "");
    if (!id) continue;
    const has = Object.prototype.hasOwnProperty.call(remote, id);
    const existing = has ? remote[id] : undefined;
    if (job.writeLend) {
      const doc = desired[id];
      if (!doc) continue;
      const retarget = has ? lendRetarget(existing, doc, 0) : { action: "create" };
      if (retarget.action === "replace") {
        ops.push({ id, op: "replace" });
        continue;
      }
      const compared = retarget.action === "keep" && existing
        ? { ...doc, borrowerEmail: existing.borrowerEmail, borrowerEmailLower: existing.borrowerEmailLower }
        : doc;
      if (lendNeedsWrite(compared, has ? existing : undefined)) ops.push({ id, op: "set" });
    } else if (job.deleteLend && existing) {
      ops.push({ id, op: "delete" });
    }
  }
  return ops;
}

// A recovered loan keeps the item name when the inventory link is gone.
export function loanNeedsItem(loan) {
  const id = String((loan && loan.itemId) || "").trim();
  const name = String((loan && loan.itemName) || "").trim();
  return !id && !name;
}

// A lend with no matching private loan is recovered so the lender can mark it returned.
export function orphanLoansFromLends(privateLoans, lends, nowIso) {
  const have = new Set((privateLoans || []).filter(row => row && row.id).map(row => row.id));
  const stamp = nowIso || "";
  const out = [];
  for (const lend of lends || []) {
    if (!lend || !lend.id || have.has(lend.id)) continue;
    const item = lend.item || {};
    out.push({
      id: lend.id,
      itemId: "",
      itemName: String(item.name || ""),
      itemBrand: String(item.brand || ""),
      itemColor: String(item.color || ""),
      itemCategory: String(item.category || ""),
      borrower: String(lend.borrowerName || ""),
      friendEmail: String(lend.borrowerEmail || ""),
      out: lend.out || "",
      due: lend.due || "",
      returned: lend.returned || "",
      lendShared: true,
      notes: "",
      updatedAt: stamp || String(lend.updatedAt || ""),
      createdAt: stamp || String(lend.updatedAt || ""),
    });
  }
  return out;
}

// A missing file is not a blocked file. Only an explicit denial counts.
export function storagePrivacyVerdict(otherCode, signedOutCode) {
  const code = v => String(v || "");
  const denied = v => code(v) === "storage/unauthorized";
  const missing = v => code(v) === "storage/object-not-found";
  return {
    pass: denied(otherCode) && denied(signedOutCode),
    otherDenied: denied(otherCode),
    signedOutDenied: denied(signedOutCode),
    countedMissingAsBlocked: missing(otherCode) || missing(signedOutCode),
  };
}

// Offline edits have to reach the local queue before a reload. Online edits can wait.
export function cloudWriteDelay(onLine) {
  return onLine === false ? 0 : 400;
}

export function serviceWorkerAllowed(loc, qa) {
  if (!loc) return false;
  if (loc.protocol === "https:") return true;
  const host = loc.hostname === "127.0.0.1" || loc.hostname === "localhost";
  return !!qa && loc.protocol === "http:" && host;
}

// Category text only. Names are not folded, and digit swaps are not rewritten.
function categoryKey(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const LEGACY_STORAGE_CATEGORY = "Mags & Ammo Storage";
export const STORAGE_CATEGORY = "Ammo Storage & Loaders";
export const MAGAZINES_CATEGORY = "Magazines";
export const LEGACY_MAGAZINES_CATEGORY = "Magazines & Belts";
export const BELTS_CATEGORY = "Belts";
export const LEGACY_BELTS_CATEGORY = "Belts & Rigs";
export const ARMOR_CATEGORY = "Armor & Carriers";
const LEGACY_STORAGE_KEY = categoryKey(LEGACY_STORAGE_CATEGORY);
const STORAGE_KEY = categoryKey(STORAGE_CATEGORY);
const LEGACY_MAGAZINES_KEY = categoryKey(LEGACY_MAGAZINES_CATEGORY);
const MAGAZINES_KEY = categoryKey(MAGAZINES_CATEGORY);
const LEGACY_BELTS_KEY = categoryKey(LEGACY_BELTS_CATEGORY);
const BELTS_KEY = categoryKey(BELTS_CATEGORY);
// A saved move applies to the old id and to the shelf that id renames to. A later explicit category is left alone.
const ANSWER_SHELVES = {
  belt: [LEGACY_BELTS_KEY, BELTS_KEY],
  magazines: [LEGACY_MAGAZINES_KEY, MAGAZINES_KEY],
  storage: [LEGACY_STORAGE_KEY, STORAGE_KEY],
};
// Magazines is weight-only. The previous shelf id stays in the block list as an alias.
const WEIGHT_ONLY_CATEGORY_KEYS = new Set([
  MAGAZINES_KEY,
  LEGACY_MAGAZINES_KEY,
  categoryKey("Triggers & Parts"),
]);

// Whole-category renames. A word inside a different shelf does not match, and the item name is never read.
const CATEGORY_RENAMES = new Map([
  [LEGACY_STORAGE_KEY, STORAGE_CATEGORY],
  [LEGACY_MAGAZINES_KEY, MAGAZINES_CATEGORY],
  [LEGACY_BELTS_KEY, BELTS_CATEGORY],
  [categoryKey("Lower Receivers"), "Firearms"],
  [categoryKey("Lower Receiver"), "Firearms"],
  [categoryKey("Ammunition"), "Ammo"],
]);

export function migrateCategoryName(category) {
  if (category == null) return category;
  const raw = String(category);
  if (!raw) return raw;
  return CATEGORY_RENAMES.get(categoryKey(raw)) || raw;
}

function categoryAnswer(book, row) {
  if (!book || !row || !row.id) return null;
  const answer = book[row.id];
  return answer && typeof answer === "object" ? answer : null;
}

function answeredMove(answer, prompt) {
  return !!(answer && answer.prompt === prompt && answer.action === "move" && answer.category);
}

// An explicit category save replaces the stored move, so the old destination cannot snap the row back.
// The returned movedAt is written on the row. A same-category save leaves the answer alone.
export function explicitCategoryChoice(answer, previousCategory, nextCategory, stamp) {
  if (!answer || typeof answer !== "object" || !answer.prompt) return null;
  if (String(previousCategory || "") === String(nextCategory || "")) return null;
  const at = stamp || "";
  return {
    answer: { prompt: answer.prompt, action: "move", category: nextCategory || "", at },
    movedAt: at,
  };
}

// Account answers win before the old id is renamed. A row already parked on Belts, Magazines, or Ammo Storage is put back.
// A category that is neither the old id nor that default shelf is an explicit choice and stays put.
function savedMoveCategory(from, answer) {
  if (!answer || !answeredMove(answer, answer.prompt)) return "";
  const shelves = ANSWER_SHELVES[answer.prompt];
  if (!shelves || !shelves.includes(from)) return "";
  return answer.category;
}

export function migrateRecordCategories(records, stamp, answers) {
  let changed = false;
  const list = Array.isArray(records) ? records : [];
  const book = answers && typeof answers === "object" ? answers : null;
  const next = list.map(row => {
    if (!row || typeof row !== "object") return row;
    const from = categoryKey(row.category);
    const answer = categoryAnswer(book, row);
    const movedTo = savedMoveCategory(from, answer);
    let category = movedTo || migrateCategoryName(row.category);
    const beltAnswered = !!(answer && answer.prompt === "belt");
    const magAnswered = !!(answer && answer.prompt === "magazines");
    const storageAnswered = !!(answer && answer.prompt === "storage");
    let copy = row;
    let dirty = category !== row.category;
    if (dirty) copy = { ...row, category, updatedAt: stamp || row.updatedAt || "" };
    if (from === LEGACY_STORAGE_KEY && !storageAnswered && !copy.migratedFromMagShelf) {
      copy = { ...copy, migratedFromMagShelf: true, updatedAt: stamp || copy.updatedAt || "" };
      dirty = true;
    }
    if (from === LEGACY_BELTS_KEY && !beltAnswered && !copy.migratedFromBeltRig) {
      copy = { ...copy, migratedFromBeltRig: true, updatedAt: stamp || copy.updatedAt || "" };
      dirty = true;
    }
    if (from === LEGACY_MAGAZINES_KEY && !magAnswered && !copy.migratedFromMagazinesBelts) {
      copy = { ...copy, migratedFromMagazinesBelts: true, updatedAt: stamp || copy.updatedAt || "" };
      dirty = true;
    }
    if (storageAnswered && copy.migratedFromMagShelf) {
      copy = { ...copy };
      delete copy.migratedFromMagShelf;
      copy.updatedAt = stamp || copy.updatedAt || "";
      dirty = true;
    }
    if (beltAnswered && copy.migratedFromBeltRig) {
      copy = { ...copy };
      delete copy.migratedFromBeltRig;
      copy.updatedAt = stamp || copy.updatedAt || "";
      dirty = true;
    }
    if (magAnswered && copy.migratedFromMagazinesBelts) {
      copy = { ...copy };
      delete copy.migratedFromMagazinesBelts;
      copy.updatedAt = stamp || copy.updatedAt || "";
      dirty = true;
    }
    if (answeredMove(answer, "belt") || answeredMove(answer, "magazines") || answeredMove(answer, "storage")) {
      if (copy.category === answer.category && !copy.movedAt) {
        copy = { ...copy, movedAt: answer.at || stamp || copy.updatedAt || "" };
        dirty = true;
      }
    }
    if (magazineCategory(copy) && magazineAutoDirty(copy)) {
      copy = clearMagazineAutoPrices({ ...copy, category: migrateCategoryName(copy.category) });
      copy.updatedAt = stamp || copy.updatedAt || "";
      dirty = true;
    }
    if (!dirty) return row;
    changed = true;
    return copy;
  });
  return { records: changed ? next : list, changed };
}

// True only for a row the category migration marked. The item name is never read.
export function magShelfPending(item) {
  return !!(item && item.migratedFromMagShelf === true);
}

// Move is an explicit answer. Dismiss leaves the row on Ammo Storage & Loaders with its prices and links.
export function answerMagShelf(records, action, id, stamp) {
  const list = Array.isArray(records) ? records : [];
  let changed = false;
  const next = list.map(row => {
    if (!magShelfPending(row)) return row;
    const move = action === "move-all" || (action === "move" && row.id === id);
    if (action !== "dismiss" && !move) return row;
    changed = true;
    if (action === "dismiss") {
      const copy = { ...row, updatedAt: stamp || row.updatedAt || "" };
      delete copy.migratedFromMagShelf;
      return copy;
    }
    const moved = keepManualPrice(
      { ...row, category: MAGAZINES_CATEGORY },
      { retailWasManual: row.priceSource === "manual", valueWasManual: row.valueSource === "manual" },
    );
    delete moved.migratedFromMagShelf;
    moved.updatedAt = stamp || row.updatedAt || "";
    return moved;
  });
  return { records: changed ? next : list, changed };
}

// True only for a row the Belts & Rigs rename marked. The item name is never read.
export function beltRigPending(item) {
  return !!(item && item.migratedFromBeltRig === true);
}

// Move sends that one row to Armor & Carriers. Dismiss leaves every pending row on Belts, with its price and links.
// There is no move-all: a battle belt and a chest rig share this shelf until the owner picks.
export function answerBeltRig(records, action, id, stamp) {
  const list = Array.isArray(records) ? records : [];
  let changed = false;
  const next = list.map(row => {
    if (!beltRigPending(row)) return row;
    const move = action === "move" && row.id === id;
    if (action !== "dismiss" && !move) return row;
    changed = true;
    const copy = { ...row, updatedAt: stamp || row.updatedAt || "" };
    delete copy.migratedFromBeltRig;
    if (move) {
      copy.category = ARMOR_CATEGORY;
      copy.movedAt = stamp || copy.updatedAt || "";
    }
    return copy;
  });
  return { records: changed ? next : list, changed };
}

// True only for a row the Magazines & Belts rename marked. The item name is never read.
export function magazinesBeltPending(item) {
  return !!(item && item.migratedFromMagazinesBelts === true);
}

// Move sends that one row to Belts, Pouches, or Ammo Storage & Loaders. Dismiss leaves every pending row on Magazines.
// There is no move-all and no name check: a magazine and a pouch share this shelf until the owner picks.
export function answerMagazinesBelt(records, action, id, stamp) {
  const list = Array.isArray(records) ? records : [];
  const dest = action === "move-belts" ? BELTS_CATEGORY : action === "move-storage" ? STORAGE_CATEGORY : action === "move-pouches" ? "Pouches" : "";
  let changed = false;
  const next = list.map(row => {
    if (!magazinesBeltPending(row)) return row;
    const move = !!dest && row.id === id;
    if (action !== "dismiss" && !move) return row;
    changed = true;
    const copy = { ...row, updatedAt: stamp || row.updatedAt || "" };
    delete copy.migratedFromMagazinesBelts;
    if (move) {
      copy.category = dest;
      copy.movedAt = stamp || copy.updatedAt || "";
    }
    return copy;
  });
  return { records: changed ? next : list, changed };
}

export function magazineCategory(item) {
  const raw = categoryKey(item && item.category);
  const migrated = categoryKey(migrateCategoryName(item && item.category));
  return raw === MAGAZINES_KEY || raw === LEGACY_MAGAZINES_KEY || migrated === MAGAZINES_KEY;
}

function magazineAutoDirty(row) {
  if (!row || typeof row !== "object") return false;
  if (row.priceSource !== "manual" && (+row.retailNew > 0 || row.priceSource || row.priceDate || row.priceNote || row.usedLow != null || row.usedHigh != null)) return true;
  if (row.valueSource !== "manual" && +row.value > 0) return true;
  if (row.priceSource !== "manual" && row.estPrice != null && row.estPrice !== "" && +row.estPrice > 0) return true;
  if (row.link) return true;
  if (Array.isArray(row.marketSources) && row.marketSources.length) return true;
  if (row.deal) return true;
  if (row.target != null && row.target !== "" && +row.target > 0) return true;
  if (row.marketCheck || row.marketCheckAt || row.dealSeen) return true;
  return false;
}

// Drop market value, market data, store links, deal, and watch state. Keep a typed price and what I paid.
export function clearMagazineAutoPrices(row) {
  if (!row || typeof row !== "object" || !magazineCategory(row)) return row;
  const retailManual = row.priceSource === "manual";
  const valueManual = row.valueSource === "manual";
  const out = keepManualPrice({ ...row }, { retailWasManual: retailManual, valueWasManual: valueManual });
  delete out.deal;
  delete out.target;
  delete out.marketCheck;
  delete out.marketCheckAt;
  delete out.dealSeen;
  if (!retailManual) delete out.estPrice;
  if (out.link) out.link = "";
  out.marketSources = [];
  return out;
}

// A slot list may name the current shelf, the old id, or both. Gear that already moved to the new id still matches.
export function slotAllowsCategory(allowed, category) {
  const list = Array.isArray(allowed) ? allowed : [];
  const raw = String(category == null ? "" : category);
  if (!raw) return false;
  if (list.includes(raw)) return true;
  const migrated = migrateCategoryName(raw) || raw;
  if (list.includes(migrated)) return true;
  return list.some(entry => {
    const next = migrateCategoryName(entry);
    return next === raw || next === migrated;
  });
}

export function starterSlotScore(slot, item) {
  if (!slot || !item) return 0;
  const cats = slot.categories || slot[1] || [];
  const kws = slot.keywords || slot[2] || [];
  const ex = slot.exclude || slot[4] || [];
  const text = ` ${[item.name, item.brand, item.notes].join(" ")} `.toLowerCase();
  const category = migrateCategoryName(item.category);
  if (category === "Firearms" || category === "Suppressors" || item.category === "Firearms" || item.category === "Suppressors") return 0;
  if (!slotAllowsCategory(cats, item.category)) return 0;
  if (ex.some(k => text.includes(String(k).toLowerCase()))) return 0;
  const hit = kws.some(k => {
    const word = String(k).trim().toLowerCase();
    if (!word) return false;
    const re = new RegExp("(^|[^a-z0-9])" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return re.test(text);
  });
  if (!hit) return 0;
  let sc = 7;
  if (item.condition === "New" || item.condition === "Good") sc += 1;
  if (item.condition === "Needs-repair") sc -= 3;
  return Math.max(sc, 0.5);
}

// Automatic prices stop at the firearm, suppressor, ammunition, lower-receiver,
// magazine, and trigger-part shelves, and at a firearm or suppressor record.
// The old Magazines & Belts id is an alias for Magazines. Belts and armor stay priced.
// Ammo storage and loaders stay priced. The item name is not checked.
export function saleRestricted(item) {
  if (!item || typeof item !== "object") return false;
  const kind = String(item.kind || item.tab || "").trim().toLowerCase();
  if (kind === "ammo") return true;
  const arm = String(item.arm || "").trim().toUpperCase();
  if (arm === "FA" || arm === "SU") return true;
  const rawKey = categoryKey(item.category);
  const c = categoryKey(migrateCategoryName(item.category));
  if (!c) return false;
  if (c === STORAGE_KEY) return false;
  if (WEIGHT_ONLY_CATEGORY_KEYS.has(c) || WEIGHT_ONLY_CATEGORY_KEYS.has(rawKey)) return true;
  if (/\b(firearms?|handguns?|rifles?|shotguns?|suppressors?|silencers?|nfa)\b/.test(c)) return true;
  if (/\b(ammunitions?|ammo|cartridges?|reloading)\b/.test(c)) return true;
  if (/\b(lowers?|frames?|receivers?)\b/.test(c)) return true;
  return false;
}

export const GEAR_CATEGORIES = ["Firearms","Suppressors","Ammo","Magazines","Triggers & Parts","Armor & Carriers","Belts","Pouches","Holsters & Slings","Helmet & Head","NVG & Optics","Lights & Lasers","Comms & Radios","Medical","Packs & Bags","Cases & Bags","Clothing & Boots","Knives & Tools","Ammo Storage & Loaders","Cleaning & Maintenance","Misc"];

// Shown under the category picker. Magazines are magazines only. Belts are belts. Rigs and carriers are armor.
export const CATEGORY_HINTS = {
  Magazines: "Magazines only, such as a PMAG or a Glock mag. Weight lookup only. No prices or stores.",
  Belts: "Battle belts, duty belts, and rigger's belts. A chest rig or plate carrier belongs in Armor & Carriers.",
  "Armor & Carriers": "Plate carriers, chest rigs, and armor plates.",
};

// Categories Photo ID may fill in. Restricted shelves are left blank so they are not offered as priced.
export function pricedPhotoCategories(categories) {
  return (categories || GEAR_CATEGORIES).filter(c => !saleRestricted({ category: c }));
}

export function photoIdSuggestion(category, categories) {
  const name = String(category || "");
  const allowed = pricedPhotoCategories(categories);
  return allowed.includes(name) ? name : "";
}

// The priced lookup tells the model to withhold a price for these, without the app guessing from the item name.
export const PRICE_BACKSTOP = "If the item is a magazine over 30 rounds, an ammunition (linked) belt, or an auto-fire device (bump stocks, auto sears, or similar), return no price and no sources. Set retailNew, usedLow, usedHigh, and value to null. Set priceNote to \"\" and sources to []. Do not name a store or a seller.";

// Firearm marketplaces and firearm or ammunition retailers, matched by domain.
// Stores that also sell gear drop only a firearm, ammunition, or suppressor path segment.
const GUN_MARKET_HOSTS = new Set([
  "gunbroker.com", "armslist.com", "gunsamerica.com", "palmettostatearmory.com", "ammoseek.com",
  "luckygunner.com", "silencershop.com", "wikiarms.com", "cheaperthandirt.com", "grabagun.com",
  "budsgunshop.com", "aimsurplus.com", "kygunco.com", "classicfirearms.com", "impactguns.com",
  "gunsinternational.com", "galleryofguns.com", "slickguns.com", "truegunvalue.com", "targetsportsusa.com",
  "ammunitiondepot.com", "ammobuy.com", "silencercentral.com", "capitolarmory.com", "guns.com",
  "gun.deals", "ammo.com", "psa.com", "rainierarms.com", "ruger.com", "glock.com", "sgammo.com",
  "bulkammo.com", "dkfirearms.com", "gunbuyer.com", "gunprime.com", "ar15.com",
]);
const SHORTENER_HOSTS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "rebrand.ly", "cutt.ly", "is.gd",
  "shorturl.at", "rb.gy", "tiny.cc", "s.id", "buff.ly", "lnkd.in", "bl.ink", "t.ly",
  "v.gd", "x.co", "qr.ae", "shorte.st", "adf.ly",
]);
const GEAR_STORE_HOSTS = new Set([
  "brownells.com", "primaryarms.com", "natchezss.com", "natchez.com", "cabelas.com", "basspro.com",
  "sportsmans.com", "sportsmanswarehouse.com", "midwayusa.com", "opticsplanet.com", "academy.com",
  "scheels.com", "sportsmansguide.com", "eurooptic.com", "sigsauer.com", "budk.com",
]);
const FIREARM_SEGMENTS = new Set([
  "firearms", "guns", "handguns", "rifles", "pistols", "shotguns", "ammo", "ammunition",
  "suppressors", "suppressor", "silencer", "silencers", "lowers", "nfa", "reloading",
  "receivers", "lower-receivers", "stripped-lowers",
]);
const REDIRECT_KEYS = new Set(["u", "q", "url", "uddg", "target", "dest", "redirect", "redirect_url", "to", "next", "link", "r", "goto", "out"]);
const LINK_TOKEN = /https?:\/\/[^\s<>"']+|\b(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|deals|ly|gl|gd|co|at|cc|id|gy|in|ink|ae|st|ee)\b[^\s<>"']*/gi;

function parsedUrl(value) {
  try { return new URL(String(value)); } catch { return null; }
}

function normalizeHost(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
}

function toHttpUrl(value) {
  const text = String(value || "").trim().replace(/[),.;]+$/, "");
  if (!text) return null;
  const direct = parsedUrl(text);
  if (direct && /^https?:$/i.test(direct.protocol)) return direct;
  if (/^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(text)) {
    const withScheme = parsedUrl("https://" + text);
    if (withScheme && /^https?:$/i.test(withScheme.protocol)) return withScheme;
  }
  return null;
}

function pathText(url) {
  try { return decodeURIComponent(url.pathname || ""); } catch { return url.pathname || ""; }
}

function hostIn(host, names) {
  let h = host;
  while (h) {
    if (names.has(h)) return true;
    const dot = h.indexOf(".");
    if (dot < 0) return false;
    h = h.slice(dot + 1);
  }
  return false;
}

function firearmSegments(url) {
  return pathText(url).split("/").map(part => part.trim().toLowerCase().replace(/\.(html?|aspx|php)$/i, "")).filter(Boolean).some(part => FIREARM_SEGMENTS.has(part));
}

function hostBlocked(url) {
  if (!url) return false;
  const host = normalizeHost(url.hostname);
  if (!host) return false;
  if (hostIn(host, SHORTENER_HOSTS)) return true;
  if (host === "linktr.ee" && /^\/redirects(?:\/|$)/i.test(pathText(url))) return true;
  if (hostIn(host, GUN_MARKET_HOSTS)) return true;
  if (hostIn(host, GEAR_STORE_HOSTS) && firearmSegments(url)) return true;
  return false;
}

function httpTarget(value) {
  let text = String(value || "").trim();
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(text); i++) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch { break; }
  }
  const url = toHttpUrl(text);
  return url && /^https?:$/i.test(url.protocol) ? url : null;
}

function redirectTargets(url) {
  const out = [];
  for (const [key, value] of url.searchParams) {
    if (!REDIRECT_KEYS.has(String(key).toLowerCase())) continue;
    const next = httpTarget(value);
    if (next && next.href !== url.href) out.push(next);
  }
  return out;
}

function chainBlocked(url, unwraps) {
  if (!url) return false;
  if (hostBlocked(url)) return true;
  const nexts = redirectTargets(url);
  if (!nexts.length) return false;
  if (unwraps >= 3) return true;
  return nexts.some(next => chainBlocked(next, unwraps + 1));
}

export function gunMarketUrl(value) {
  return chainBlocked(toHttpUrl(value), 0);
}

export function stripGunMarketSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .filter(s => s && /^https:\/\//.test(s.url || "") && !gunMarketUrl(s.url))
    .slice(0, 4)
    .map(s => ({ label: String(s.label || "source").slice(0, 40), url: String(s.url).slice(0, 400) }));
}

export function stripGunMarketText(note) {
  return String(note || "").replace(LINK_TOKEN, token => gunMarketUrl(token.replace(/[),.;]+$/, "")) ? "" : token).replace(/\s{2,}/g, " ").trim();
}

// True when the answer still carries a firearm-retailer link. A price note, a size, or cents do not count.
export function lookupAnswerRestricted(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const urls = [...sources.map(s => s && s.url), parsed.url].filter(Boolean);
  return urls.some(gunMarketUrl);
}

function priceNumber(v) {
  return (v === null || v === undefined || v === "" || !isFinite(+v)) ? null : +v;
}

function extractTopJsonObjects(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const out = [];
  let i = 0;
  while (i < t.length) {
    if (t[i] !== "{") { i++; continue; }
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { end = j; break; }
    }
    if (end < 0) break;
    const raw = t.slice(i, end + 1);
    let parsed = null;
    for (const cand of [raw, raw.replace(/[\r\n]+/g, " ")]) {
      try { parsed = JSON.parse(cand); break; } catch { parsed = null; }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) out.push(parsed);
    i = end + 1;
  }
  return out;
}

// One lookup or deal object. A second JSON object drops every link, so the last
// object cannot smuggle a marketplace url through. A single object keeps its
// other links and loses firearm-retailer ones.
export function pickModelAnswer(text) {
  const objects = extractTopJsonObjects(text);
  const answers = objects.filter(o => ["retailNew", "usedLow", "usedHigh", "value", "weightOz", "price", "sources", "url"].some(k => k in o));
  if (!answers.length) return null;
  const picked = { ...answers[answers.length - 1] };
  if (objects.length > 1) {
    picked.sources = [];
    picked.url = "";
    picked.linksDropped = true;
  } else {
    picked.sources = stripGunMarketSources(picked.sources);
    if (gunMarketUrl(picked.url)) picked.url = "";
  }
  if (picked.priceNote) picked.priceNote = stripGunMarketText(picked.priceNote);
  return picked;
}

// A blocked category never receives a price. Other gear keeps its price, without firearm-retailer links.
export function settleLookup(item, parsed) {
  const clean = parsed && typeof parsed === "object" ? parsed : null;
  if (!clean) return { apply: false };
  const block = !!(item && (item.weightOnly || saleRestricted(item)));
  const sources = block || clean.linksDropped ? [] : stripGunMarketSources(clean.sources);
  if (block) {
    return {
      apply: true,
      retailNew: null, usedLow: null, usedHigh: null, value: null,
      weightOz: priceNumber(clean.weightOz), priceNote: "",
      weightNote: publicWeightNote(clean.weightNote), sources: [],
    };
  }
  return {
    apply: true,
    retailNew: priceNumber(clean.retailNew), usedLow: priceNumber(clean.usedLow), usedHigh: priceNumber(clean.usedHigh),
    value: priceNumber(clean.value), weightOz: priceNumber(clean.weightOz),
    priceNote: stripGunMarketText(clean.priceNote).slice(0, 240),
    weightNote: stripGunMarketText(clean.weightNote).slice(0, 80),
    sources,
  };
}

// Same condition factors the form uses when a typed retail price fills the insured value.
const CONDITION_FACTOR = { New: 0.9, Good: 0.7, Used: 0.55, Worn: 0.4, "Needs-repair": 0.2 };

// A number the user typed on a blocked item stays. A prefilled market price does not become a typed price.
export function keepManualPrice(item, touch) {
  if (!item || typeof item !== "object" || !saleRestricted(item)) return item;
  const flags = touch && typeof touch === "object" ? touch : {};
  const out = { ...item, marketSources: [] };
  delete out.priceNote;
  delete out.usedLow;
  delete out.usedHigh;
  delete out.deal;
  if ("link" in out) out.link = "";
  const retail = Math.max(0, Math.round(+out.retailNew || 0));
  const value = Math.max(0, Math.round(+out.value || 0));
  const retailDirty = !!flags.retail;
  const valueDirty = !!flags.value;
  const hadUnmarked = flags.unmarked != null ? !!flags.unmarked : unmarkedPrice(out);
  const keepRetail = retail > 0 && (retailDirty || !!flags.retailWasManual || out.priceSource === "manual" || hadUnmarked);
  if (keepRetail) {
    out.retailNew = retail;
    if (retailDirty || flags.retailWasManual || out.priceSource === "manual") out.priceSource = "manual";
  } else {
    out.retailNew = 0;
    delete out.priceSource;
    delete out.priceDate;
  }
  const factor = CONDITION_FACTOR[out.condition] ?? 0.6;
  const derived = keepRetail && retailDirty && !valueDirty && value > 0 && value === Math.round(retail * factor);
  const keepValue = value > 0 && (valueDirty || !!flags.valueWasManual || derived || out.valueSource === "manual" || hadUnmarked);
  if (keepValue) {
    out.value = value;
    if (valueDirty || flags.valueWasManual || derived || out.valueSource === "manual") out.valueSource = "manual";
  } else {
    out.value = 0;
    delete out.valueSource;
  }
  if (out.weightNote) out.weightNote = publicWeightNote(out.weightNote);
  return out;
}

// Price flags belong on the record before the one cloud write. A later snapshot
// echo then has the same flags, and a typed insured value survives a move onto a blocked shelf.
export function stampManualPrices(item, before, touch) {
  if (!item || typeof item !== "object") return item;
  const flags = touch && typeof touch === "object" ? touch : {};
  const out = { ...item };
  const retailTyped = !!flags.retail && +out.retailNew > 0;
  const valueTyped = !!flags.value && +out.value > 0;
  const retailWasManual = !!(before && before.priceSource === "manual");
  const valueWasManual = !!(before && before.valueSource === "manual");
  if (retailTyped) out.priceSource = "manual";
  else if (flags.retail && !(+out.retailNew > 0) && out.priceSource === "manual") {
    delete out.priceSource;
    delete out.priceDate;
  }
  if (valueTyped) out.valueSource = "manual";
  else if (!flags.value && !(+out.value > 0) && out.valueSource === "manual") delete out.valueSource;
  const prior = before && before.priceSource;
  if ((prior === "market" || prior === "auto") && out.priceSource === "manual") clearAutoPriceTrail(out);
  if (before && !flags.retail && userEnteredPrice(before) && positivePrice(before.retailNew)) {
    out.retailNew = before.retailNew;
    if (before.priceSource === "manual") out.priceSource = "manual";
    else if (out.priceSource !== "manual") delete out.priceSource;
  }
  if (before && !flags.value && userEnteredPrice(before) && positivePrice(before.value)) {
    out.value = before.value;
    if (before.valueSource === "manual") out.valueSource = "manual";
    else if (out.valueSource !== "manual") delete out.valueSource;
  }
  if (!saleRestricted(out)) return out;
  return keepManualPrice(out, {
    retail: !!flags.retail,
    value: !!flags.value,
    retailWasManual: retailWasManual || retailTyped,
    valueWasManual: valueWasManual || valueTyped,
    unmarked: !!(before && unmarkedPrice(before)),
  });
}

function weightMissing(item) {
  return !item || item.weight == null || item.weight === "";
}

function positivePrice(value) {
  return value != null && value !== "" && isFinite(+value) && +value > 0;
}

// A price saved before the manual marker still counts. Market and auto are the only prices a lookup may replace.
function unmarkedPrice(item) {
  if (!item || item.priceSource === "manual" || item.priceSource === "market" || item.priceSource === "auto") return false;
  return positivePrice(item.retailNew) || positivePrice(item.value) || positivePrice(item.usedLow) || positivePrice(item.usedHigh);
}

export function userEnteredPrice(item) {
  if (!item || typeof item !== "object") return false;
  return item.priceSource === "manual" || unmarkedPrice(item);
}

function clearAutoPriceTrail(out) {
  delete out.usedLow;
  delete out.usedHigh;
  delete out.priceNote;
  delete out.priceDate;
  delete out.marketSources;
  if (Object.prototype.hasOwnProperty.call(out, "link")) out.link = "";
}

// A hand-entered price is not a price lookup, including a price with no marker.
// Only market and auto prices may be refreshed. Empty prices may be filled.
// A restricted shelf never gets an auto price. A missing weight can still be looked up.
export function lookupPlan(item) {
  const blocked = !item || item.deleted || magShelfPending(item) || saleRestricted(item) || userEnteredPrice(item);
  const weight = !!(item && !item.deleted && !magShelfPending(item) && weightMissing(item));
  return { price: !blocked, weight };
}

// A notes-only save looks up a missing weight or an empty price. It does not refresh a price the user entered.
export function saveNeedsLookup(item) {
  if (!item || item.deleted || magShelfPending(item)) return false;
  const plan = lookupPlan(item);
  if (saleRestricted(item)) return plan.weight;
  if (plan.weight) return true;
  if (!plan.price) return false;
  return item.priceSource !== "market" && item.priceSource !== "auto";
}

export function bulkLookupIds(items) {
  return (Array.isArray(items) ? items : []).filter(item => {
    const plan = lookupPlan(item);
    if (plan.price && item.priceSource !== "market" && item.priceSource !== "auto") return true;
    return plan.weight;
  }).map(item => item && item.id).filter(Boolean);
}

export function singleLookupIds(items) {
  return (Array.isArray(items) ? items : []).filter(item => {
    const plan = lookupPlan(item);
    return plan.price || plan.weight;
  }).map(item => item && item.id).filter(Boolean);
}

// A market lookup fills empty and auto prices. A price the user entered stays, including its value and used range.
export function applyMarketPrices(item, result, day) {
  const out = { ...(item && typeof item === "object" ? item : {}) };
  if (magShelfPending(out) || saleRestricted(out) || userEnteredPrice(out)) return out;
  const res = result && typeof result === "object" ? result : {};
  const n = v => (v == null || v === "" || !isFinite(+v)) ? null : Math.round(+v);
  const retailManual = out.priceSource === "manual" && +out.retailNew > 0;
  const valueManual = out.valueSource === "manual" && +out.value > 0;
  const retail = n(res.retailNew);
  const value = n(res.value);
  if (!retailManual && retail != null) out.retailNew = retail;
  const usedLow = n(res.usedLow);
  const usedHigh = n(res.usedHigh);
  if (usedLow != null) out.usedLow = usedLow;
  if (usedHigh != null) out.usedHigh = usedHigh;
  if (!valueManual && value != null) out.value = value;
  else if (!valueManual && value == null && +out.retailNew > 0) out.value = Math.round(+out.retailNew * (CONDITION_FACTOR[out.condition] ?? 0.6));
  if (!retailManual) {
    out.priceSource = "market";
    if (day) out.priceDate = day;
  }
  out.priceNote = stripGunMarketText(res.priceNote || "").slice(0, 240);
  out.marketSources = stripGunMarketSources(res.sources);
  return out;
}

// A deal for a blocked category has no price and no link. Other gear keeps the price and loses a firearm-retailer link.
export function settleDeal(item, parsed) {
  const empty = blocked => ({ price: null, where: "", url: "", condition: "", note: "", restricted: !!blocked });
  if (saleRestricted(item) || magShelfPending(item)) return empty(!!saleRestricted(item));
  const clean = parsed && typeof parsed === "object" ? parsed : null;
  if (!clean) return empty(false);
  let url = /^https:\/\//.test(clean.url || "") ? String(clean.url).slice(0, 400) : "";
  if (clean.linksDropped || gunMarketUrl(url)) url = "";
  let where = String(clean.where || "").slice(0, 40);
  if (/^https?:/i.test(where) && (clean.linksDropped || gunMarketUrl(where))) where = "";
  const price = isFinite(+clean.price) && +clean.price > 0 ? Math.round(+clean.price * 100) / 100 : null;
  return {
    price, where, url, condition: String(clean.condition || "").slice(0, 20),
    note: stripGunMarketText(clean.note).slice(0, 160), restricted: false,
  };
}

// The calendar day where the app is open, not the UTC date.
export function localDay(d) {
  const dt = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function countedValue(item) {
  if (!item || typeof item !== "object") return 0;
  const n = +item.value;
  if (!isFinite(n) || n <= 0) return 0;
  if ((saleRestricted(item) || magShelfPending(item)) && item.valueSource !== "manual") return 0;
  return n;
}

export function csvExportField(item, key) {
  if (!item || typeof item !== "object") return "";
  if ((saleRestricted(item) || magShelfPending(item)) && item.priceSource !== "manual" && (key === "retailNew" || key === "priceSource" || key === "priceDate")) return "";
  if (key === "value" && (saleRestricted(item) || magShelfPending(item))) {
    const n = countedValue(item);
    return n || "";
  }
  const v = item[key];
  return v == null ? "" : v;
}

function hasPriceNumber(s) {
  const bare = String(s).replace(/\b\d+(?:\.\d+)?\s*(?:oz|ounces?|lb|lbs|pounds?|g|kg|grams?|mm|cm|in|inch|inches)\b/gi, " ");
  return /\b\d{2,5}\.\d{2}\b/.test(bare) || /\b\d{3,5}\b/.test(bare);
}

const NUMBER_WORD = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const SPELLED_AMOUNT = new RegExp(`\\b(?:${NUMBER_WORD})\\s+hundred\\b|\\b(?:${NUMBER_WORD})\\s+thousand\\b|\\b(?:${NUMBER_WORD})\\s+(?:${NUMBER_WORD})\\b`, "i");
const RETAILER = /\b(stores?|shops?|retailers?|outfitters?|dealers?|sellers?|vendors?|merchants?|distributors?|resellers?|gunsmiths?|emporiums?|bazaars?)\b/i;

// A restricted weight note keeps a maker spec. It drops store names and price figures.
export function publicWeightNote(note) {
  let s = String(note || "");
  if (/\$\s*\d|\bUSD\b|\bMSRP\b|\bdollars?\b|\bbucks\b/i.test(s)) return "";
  if (SPELLED_AMOUNT.test(s) || RETAILER.test(s)) return "";
  const store = /\b(amazon|ebay|tacswap|brownells|palmetto|\bpsa\b|midway|opticsplanet|primary\s*arms|gunbroker|cheaper\s*than\s*dirt|cabela'?s|bass\s*pro|sportsman'?s|grabagun|bud'?s?(?:\s*gun)?|aim\s*surplus|eurooptic|armslist|ammoseek|wikiarms|guns\.com|impact\s*guns|kygunco|classic\s*firearms|gun\.deals|scheels|rei|\bbig\s*5\b)\b/i;
  const priceWord = /\b(price|priced|avg|average|sale|sold|cost|retail)\b/i;
  if ((store.test(s) || priceWord.test(s) || /\bfor\s+\d{3,5}(?:\.\d{2})?\b/i.test(s)) && hasPriceNumber(s)) return "";
  s = s.replace(/https?:\/\/\S+/gi, " ");
  s = s.replace(/\bwww\.\S+/gi, " ");
  s = s.replace(store, " ");
  if (/\b(armory|academy|sports|sporting|outdoor|surplus|warehouse|retailer|dealer|gun\s*shop|firearms|scheels|midway|gunbroker)\b/i.test(s)) return "";
  if (hasPriceNumber(s)) return "";
  s = s.replace(/\s{2,}/g, " ").replace(/^[\s,;:.\-|]+|[\s,;:.\-|]+$/g, "");
  return s.slice(0, 80);
}


// Missing or "1" keeps the signed-in session. Only an explicit "0" turns it off.
export function keepSignedIn(storage) {
  try { return !storage || storage.getItem("gearLocker.keep") !== "0"; }
  catch { return true; }
}

// Keep-signed-in off uses a memory cache and drops any disk cache from an earlier session.
export function firestoreMemoryOnly(keep) {
  return keep === false;
}

export const SIGN_OUT_WAIT_MS = 1500;

// True when the save finished, false when it timed out or failed.
export function settleOrTimeout(promise, ms) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    Promise.resolve(promise).then(() => finish(true), () => finish(false));
    setTimeout(() => finish(false), ms);
  });
}

export function signOutConfirmNeeded(settled) {
  return settled === false;
}

// Spreadsheet apps run a cell that starts with these. A leading apostrophe forces text.
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

const ARMORY_ARMS = new Set(["FA", "SU", "OP", "WL", "LA", "KN"]);
const TOOLISH = /multi.?tool|leatherman|gerber|\bsaw\b|shovel|plier|wrench|screwdriver|sharpener|machete|e-?tool/i;

// Attach the item this one is mounted on, so a headlamp on a helmet stays a lookup and a light on a rifle does not.
export function armorySubject(item, host) {
  if (!item || typeof item !== "object") return item;
  if (!host) return item;
  return { ...item, hostCategory: host.category || "", hostArm: host.arm || "" };
}

function onWeapon(item) {
  if (!item || !item.mountedOn) return false;
  const hostCat = String(item.hostCategory || "").trim().toLowerCase();
  const hostArm = String(item.hostArm || "").trim().toUpperCase();
  return hostCat === "firearms" || hostCat === "suppressors" || hostArm === "FA" || hostArm === "SU";
}

// Arms Room records, and gear mounted on a weapon. A headlamp, flashlight, or binoculars on their own still look up.
export function armoryLookupBlocked(privateArms, item) {
  if (!privateArms || !item || typeof item !== "object") return false;
  const arm = String(item.arm || "").trim().toUpperCase();
  if (ARMORY_ARMS.has(arm)) return true;
  if (onWeapon(item)) return true;
  const category = String(item.category || "").trim().toLowerCase();
  if (category === "firearms" || category === "suppressors") return true;
  if (category === "knives & tools") {
    const blob = [item.name, item.brand].map(v => String(v || "")).join(" ");
    return !TOOLISH.test(blob);
  }
  return false;
}

// Firearms, suppressors, lower receivers, and firearm or suppressor records. The opt-out toggle does not turn this off.
export function photoIdHardBlocked(item) {
  if (!item || typeof item !== "object") return false;
  const arm = String(item.arm || "").trim().toUpperCase();
  if (arm === "FA" || arm === "SU") return true;
  const c = categoryKey(migrateCategoryName(item.category));
  if (!c) return false;
  if (/\b(firearms?|suppressors?|silencers?)\b/.test(c)) return true;
  if (/\b(lowers?|frames?|receivers?)\b/.test(c)) return true;
  return false;
}

export function photoIdBlockReason(privateArms, item) {
  if (!photoIdBlocked(privateArms, item)) return "";
  if (privateArms && !photoIdHardBlocked(item) && (!item || !String(item.category || "").trim())) return "Choose a category before photo ID.";
  return "Photo ID isn't available for this record.";
}

// Hard-blocked records stay blocked with the opt-out off. With the opt-out on, a new item needs a category, and other Armory records stay off too.
export function photoIdBlocked(privateArms, item) {
  if (photoIdHardBlocked(item)) return true;
  if (!privateArms) return false;
  if (!item || !String(item.category || "").trim()) return true;
  return armoryLookupBlocked(true, item);
}

// Once a drill has its round count, later bangs are echoes, not another shot.
export function timerShotAccepted(count, rounds) {
  const need = +rounds || 0;
  return !(need && count >= need);
}

// FCC Part 95 channel centers. 1–22 are shared. Repeater outputs are 15–22; inputs are those plus 5 MHz.
const FRS_GMRS_MHZ = [
  462.5625, 462.5875, 462.6125, 462.6375, 462.6625, 462.6875, 462.7125,
  467.5625, 467.5875, 467.6125, 467.6375, 467.6625, 467.6875, 467.7125,
  462.55, 462.575, 462.6, 462.625, 462.65, 462.675, 462.7, 462.725,
];
const GMRS_REPEATER_OUT = [462.55, 462.575, 462.6, 462.625, 462.65, 462.675, 462.7, 462.725];
const GMRS_REPEATER_IN = [467.55, 467.575, 467.6, 467.625, 467.65, 467.675, 467.7, 467.725];
const MURS_MHZ = [151.82, 151.88, 151.94, 154.57, 154.6];
function mhzNear(a, b) { return Math.abs(a - b) < 0.0006; }
function parseMhz(v) {
  const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return isFinite(n) && n > 0 ? n : 0;
}
function formatMhz(v) {
  const n = parseMhz(v);
  return n ? n.toFixed(4).replace(/0{1,2}$/, "") : "";
}
export function radioService(rx, duplex) {
  const n = parseMhz(rx);
  if (!n) return "Other";
  const dup = String(duplex ?? "").trim();
  if (dup === "+" && GMRS_REPEATER_OUT.some(f => mhzNear(n, f))) return "GMRS";
  if (FRS_GMRS_MHZ.some(f => mhzNear(n, f))) return "FRS/GMRS";
  if (GMRS_REPEATER_IN.some(f => mhzNear(n, f))) return "GMRS";
  if ((n >= 144 && n <= 148) || (n >= 420 && n <= 450) || (n >= 222 && n <= 225) || (n >= 50 && n <= 54)) return "Ham";
  if (MURS_MHZ.some(f => mhzNear(n, f))) return "MURS";
  if (n >= 156 && n <= 162.025) return "Marine";
  if (n >= 162.4 && n <= 162.55) return "NOAA weather";
  if (n >= 108 && n <= 137) return "Aviation";
  return "Other";
}

function fieldText(v) { return String(v ?? "").trim(); }
function fieldNumber(v) {
  if (v == null || String(v).trim() === "") return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}
// Two lines can share a count only when a filled place, note, color, price, or insured value matches. A hidden setupOn does not count.
export function mergeFieldConflict(a, b) {
  if (!a || !b) return true;
  for (const key of ["location", "notes", "color"]) {
    const x = fieldText(a[key]);
    const y = fieldText(b[key]);
    if (x && y && x.toLowerCase() !== y.toLowerCase()) return true;
  }
  for (const key of ["paid", "value"]) {
    const x = fieldNumber(a[key]);
    const y = fieldNumber(b[key]);
    if (x != null && y != null && x !== y) return true;
  }
  return false;
}

// A stored repeater offset is figured first. Channels the CHIRP file writes as receive-only still say so, so the table matches the export.
export function radioTxLabel(freq) {
  const f = freq && typeof freq === "object" ? freq : {};
  const rx = parseMhz(f.rx);
  const duplex = f.duplex || "";
  let tx = 0;
  if (duplex === "+") tx = rx + parseMhz(f.offset);
  else if (duplex === "-") tx = rx - parseMhz(f.offset);
  else if (duplex === "split") tx = parseMhz(f.tx);
  else if (duplex !== "off") tx = rx;
  const shifted = tx && Math.abs(tx - rx) > 1e-6;
  const hasOffset = (duplex === "+" || duplex === "-" || duplex === "split") && shifted;
  const txOk = !f.service || f.service === "Ham" || f.service === "Other";
  const rxOnly = duplex === "off" || !txOk;
  if (hasOffset && !rxOnly) return formatMhz(tx);
  if (rxOnly) return "RX only";
  return "simplex";
}

const GearLogic = {
  SHARE_ITEM_KEYS, MAX_SHARE_ITEMS, USER_LOCAL_KEYS, DEVICE_LOCAL_KEYS,
  clearUserLocal, shareItemFields, newWriteId, serverStampIso, mergeByServerTime, mergeKitsByServerTime,
  parseAllowlist, decideAccess, betaOnly, isReviewEmail, chargeDecision, quotaKey, alertQuotaKey, monthQuotaKey, selectDueWatches, pinLengthOk, newPasswordOk,
  DEFAULT_PLAN_LIMITS, DEFAULT_REVIEW_DAILY_LIMIT, DEFAULT_FREE_SPEND_CAP_USD, DEFAULT_SPEND_RATES,
  planMonthlyLimit, reviewDailyLimit, spendCapMicro, spendRates, lookupPlan, usageFromResponse, addUsage, estimateSpendMicro, freeSpendBlocked, usageDecision,
  USER_COLLECTIONS, accountDeletePlan, deleteRevenueCatCustomer,
  DELETE_AUTH_MAX_AGE_SEC, ACCOUNT_DELETE_TIMEOUT_MS, signInIsRecent, LOOKUPS_PAUSED,
  reserveFits, lookupReserveMicro, reconcileSpendMicro, loanEmailRedaction, loanTargetsFromLends, loanRedactTargets, loansToMirror, deleteRetryRoute,
  ACCOUNT_DELETED_NOTE, deletedAccountGate, deleteCleanupResult, cleanupRetryPlan, cleanupQueueBody,
  CLEANUP_MAX_ATTEMPTS, CLEANUP_MAX_AGE_MS, CLEANUP_RECORD_MAX_BYTES, orderRedactions,
  LEND_EMAIL_CAP, lendMailDocId, lendAddress, lendRetarget, REDACT_PAGE_SIZE, REDACT_OPS_BUDGET, REDACT_MAX_AGE_MS, REDACT_RECORD_MAX_BYTES,
  redactionJobBody, redactionRetryPlan, redactionProgressBody, redactionFailureBody,
  lendNeedsWrite, lendMirrorOps,
  ROUND_INPUT_TOKEN_CAP, roundInputTokens, flooredSearchRoundMicro,
  refreshAuthClaims, loanSharePlan, orphanLoansFromLends, serverRow, loanNeedsItem, storagePrivacyVerdict, cloudWriteDelay, serviceWorkerAllowed, saleRestricted,
  countedValue, csvExportField, csvCell, publicWeightNote, lookupAnswerRestricted, localDay,
  gunMarketUrl, stripGunMarketSources, stripGunMarketText, pickModelAnswer, settleLookup, settleDeal, keepManualPrice, stampManualPrices, userEnteredPrice, lookupPlan, saveNeedsLookup, bulkLookupIds, singleLookupIds, applyMarketPrices,
  keepSignedIn, firestoreMemoryOnly, SIGN_OUT_WAIT_MS, settleOrTimeout, signOutConfirmNeeded, armorySubject, armoryLookupBlocked, photoIdBlocked,
  LEGACY_STORAGE_CATEGORY, STORAGE_CATEGORY, MAGAZINES_CATEGORY, LEGACY_MAGAZINES_CATEGORY, BELTS_CATEGORY, LEGACY_BELTS_CATEGORY, ARMOR_CATEGORY, GEAR_CATEGORIES, CATEGORY_HINTS, PRICE_BACKSTOP,
  migrateCategoryName, migrateRecordCategories, explicitCategoryChoice, magShelfPending, answerMagShelf, beltRigPending, answerBeltRig,
  magazinesBeltPending, answerMagazinesBelt, magazineCategory, clearMagazineAutoPrices, slotAllowsCategory, starterSlotScore,
  keepMovedCategory, mergeCategoryAnswers, pricedPhotoCategories, photoIdSuggestion, photoIdHardBlocked, photoIdBlockReason,
  timerShotAccepted, radioService, radioTxLabel, mergeFieldConflict,
};
globalThis.GearLogic = GearLogic;
