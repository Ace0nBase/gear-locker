import { applyQaMode, isLocalHost, localFileLooksLive } from "./qa-guard.js";

function field(text, name) {
  const m = new RegExp(name + '\\s*:\\s*"([^"]*)"').exec(text || "");
  return m ? m[1] : "";
}

async function readLocalOverride() {
  try {
    const r = await fetch("config.local.js", { cache: "no-store" });
    if (!r.ok) return null;
    const text = await r.text();
    if (localFileLooksLive(text)) {
      return { rejected: true, reason: "config.local.js points at the live app. Local test mode will not start." };
    }
    const projectId = field(text, "projectId");
    const lookupUrl = field(text, "lookupUrl");
    const apiKey = field(text, "apiKey");
    if (!projectId && !lookupUrl) return null;
    return {
      override: {
        firebase: {
          apiKey: apiKey || "demo-gear-locker",
          authDomain: "localhost",
          projectId: projectId || "demo-gear-locker",
          storageBucket: "demo-gear-locker.appspot.com",
          messagingSenderId: "000000000000",
          appId: "1:000000000000:web:demo",
        },
        lookupUrl: lookupUrl || "http://127.0.0.1:8787",
      },
    };
  } catch {
    return null;
  }
}

const flag = new URLSearchParams(location.search).get("env") === "emulator";
const local = isLocalHost(location.hostname);
// js/qa-sync.js already decided, before Firebase can start. Do not change that decision here.
if (!window.GEAR_QA_READY && !window.GEAR_QA_BLOCKED) {
  const loaded = flag && local ? await readLocalOverride() : null;
  if (loaded && loaded.rejected) {
    window.FIREBASE_CONFIG = null;
    window.LOOKUP_URL = "";
    window.GEAR_QA = false;
    window.GEAR_QA_READY = false;
    window.GEAR_QA_BLOCKED = true;
    window.GEAR_QA_REASON = loaded.reason;
  } else {
    applyQaMode(window, location, loaded && loaded.override);
  }
}

if (window.GEAR_QA_BLOCKED) {
  const show = () => {
    const gate = document.getElementById("gate");
    const msg = document.getElementById("gateMsg");
    const fields = document.getElementById("gateFields");
    if (gate) gate.hidden = false;
    if (fields) fields.hidden = true;
    if (msg) msg.textContent = window.GEAR_QA_REASON || "Emulator mode will not open the live locker.";
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
  else show();
}
