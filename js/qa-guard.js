// Local test mode. This never copies the live project id or the live lookup address.
// The flag ?env=emulator only works on localhost. Anywhere else it turns the app off
// instead of falling through to the live project.

export const QA_PROJECT = "demo-gear-locker";
export const QA_LOOKUP = "http://127.0.0.1:8787";
export const PRODUCTION_PROJECT = "gear-locker-c248c";
export const PRODUCTION_API_KEY = "AIzaSyBexXFiQtDEnmlL2z0x4FXD7YCbeAHTGC4";

export const QA_FIREBASE = {
  apiKey: "demo-gear-locker",
  authDomain: "localhost",
  projectId: QA_PROJECT,
  storageBucket: "demo-gear-locker.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:demo",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname || ""));
}

export function validateQaTarget(cfg, lookupUrl) {
  if (!cfg || cfg.projectId !== QA_PROJECT) return "Local test mode only talks to the demo-gear-locker emulator.";
  if (cfg.projectId === PRODUCTION_PROJECT) return "Local test mode refused the live Firebase project.";
  if (cfg.apiKey === PRODUCTION_API_KEY) return "Local test mode refused the live Firebase key.";
  if (/workers\.dev|firebaseapp\.com|googleapis\.com/i.test(String(lookupUrl || ""))) return "Local test mode refused a live lookup address.";
  let u;
  try { u = new URL(lookupUrl); } catch { return "Local test mode needs a lookup address on this computer."; }
  if (u.protocol !== "http:") return "Local test mode only uses http on this computer.";
  if (!isLocalHost(u.hostname)) return "Local test mode only uses a lookup server on this computer.";
  if (u.port !== "8787") return "Local test mode only uses lookup port 8787.";
  return "";
}

export function applyQaMode(win, loc, localOverride) {
  const params = new URLSearchParams(loc.search || "");
  const flag = params.get("env") === "emulator";
  if (!flag) return { mode: "off" };
  win.FIREBASE_CONFIG = null;
  win.LOOKUP_URL = "";
  win.GEAR_QA = false;
  win.GEAR_QA_READY = false;
  win.GEAR_QA_BLOCKED = true;
  const local = isLocalHost(loc.hostname) && (loc.protocol === "http:" || loc.protocol === "https:");
  if (!local) {
    win.GEAR_QA_REASON = "Emulator mode only runs on this computer. This page will not open the live locker.";
    return { mode: "blocked", reason: win.GEAR_QA_REASON };
  }
  const cfg = localOverride && localOverride.firebase ? { ...QA_FIREBASE, ...localOverride.firebase } : { ...QA_FIREBASE };
  const lookup = localOverride && localOverride.lookupUrl ? localOverride.lookupUrl : QA_LOOKUP;
  const err = validateQaTarget(cfg, lookup);
  if (err) {
    win.GEAR_QA_REASON = err;
    return { mode: "blocked", reason: err };
  }
  win.FIREBASE_CONFIG = cfg;
  win.LOOKUP_URL = lookup;
  win.GEAR_QA = true;
  win.GEAR_QA_READY = true;
  win.GEAR_QA_BLOCKED = false;
  win.GEAR_QA_REASON = "";
  return { mode: "emulator" };
}

export function localFileLooksLive(text) {
  return /gear-locker-c248c|AIzaSyBexXFiQtDEnmlL2z0x4FXD7YCbeAHTGC4|workers\.dev|firebaseapp\.com/i.test(String(text || ""));
}

export function isGoogleApiScript(src) {
  return String(src || "").indexOf("https://apis.google.com/js/api.js") === 0;
}
