// Blocking script. It must run immediately after config.js and before Firebase starts.
// The emulator flag is applied here, synchronously, so a later script cannot open the live project.
(function () {
  if (new URLSearchParams(location.search).get("env") !== "emulator") return;
  window.FIREBASE_CONFIG = null;
  window.LOOKUP_URL = "";
  window.GEAR_QA = false;
  window.GEAR_QA_READY = false;
  window.GEAR_QA_BLOCKED = true;
  var host = location.hostname;
  var local = (host === "localhost" || host === "127.0.0.1") && (location.protocol === "http:" || location.protocol === "https:");
  if (!local) {
    window.GEAR_QA_REASON = "Emulator mode only runs on this computer. This page will not open the live locker.";
    return;
  }
  var text = "";
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "config.local.js", false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300) text = xhr.responseText || "";
  } catch (e) { text = ""; }
  if (/gear-locker-c248c|AIzaSyBexXFiQtDEnmlL2z0x4FXD7YCbeAHTGC4|workers\.dev|firebaseapp\.com/i.test(text)) {
    window.GEAR_QA_REASON = "config.local.js points at the live app. Local test mode will not start.";
    return;
  }
  function field(name) {
    var m = new RegExp(name + "\\s*:\\s*\"([^\"]*)\"").exec(text);
    return m ? m[1] : "";
  }
  var cfg = {
    apiKey: field("apiKey") || "demo-gear-locker",
    authDomain: "localhost",
    projectId: field("projectId") || "demo-gear-locker",
    storageBucket: "demo-gear-locker.appspot.com",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:demo"
  };
  var lookup = field("lookupUrl") || "http://127.0.0.1:8787";
  var urlOk = false;
  try {
    var u = new URL(lookup);
    urlOk = u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port === "8787";
  } catch (e) { urlOk = false; }
  if (cfg.projectId !== "demo-gear-locker" || cfg.apiKey === "AIzaSyBexXFiQtDEnmlL2z0x4FXD7YCbeAHTGC4" || /workers\.dev|firebaseapp\.com|googleapis\.com/i.test(lookup) || !urlOk) {
    window.GEAR_QA_REASON = "Local test mode refused a live or non-local address.";
    return;
  }
  window.FIREBASE_CONFIG = cfg;
  window.LOOKUP_URL = lookup;
  window.GEAR_QA = true;
  window.GEAR_QA_READY = true;
  window.GEAR_QA_BLOCKED = false;
  window.GEAR_QA_REASON = "";
})();
