import test from "node:test";
import assert from "node:assert/strict";
import { applyQaMode, localFileLooksLive, isGoogleApiScript, QA_PROJECT, PRODUCTION_API_KEY } from "../js/qa-guard.js";

function win() {
  return { FIREBASE_CONFIG: { projectId: "gear-locker-c248c", apiKey: PRODUCTION_API_KEY }, LOOKUP_URL: "https://gear-locker-api.ace0nbase.workers.dev" };
}

test("the emulator flag does nothing when it is off", () => {
  const w = win();
  const r = applyQaMode(w, { hostname: "ace0nbase.github.io", protocol: "https:", search: "" });
  assert.equal(r.mode, "off");
  assert.equal(w.FIREBASE_CONFIG.projectId, "gear-locker-c248c");
  assert.match(w.LOOKUP_URL, /workers\.dev/);
});

test("the emulator flag on the live site turns the app off", () => {
  const w = win();
  const r = applyQaMode(w, { hostname: "ace0nbase.github.io", protocol: "https:", search: "?env=emulator" });
  assert.equal(r.mode, "blocked");
  assert.equal(w.FIREBASE_CONFIG, null);
  assert.equal(w.LOOKUP_URL, "");
  assert.equal(w.GEAR_QA, false);
  assert.equal(w.GEAR_QA_BLOCKED, true);
});

test("localhost emulator mode uses only the demo project", () => {
  const w = win();
  const r = applyQaMode(w, { hostname: "127.0.0.1", protocol: "http:", search: "?env=emulator" });
  assert.equal(r.mode, "emulator");
  assert.equal(w.FIREBASE_CONFIG.projectId, QA_PROJECT);
  assert.equal(w.FIREBASE_CONFIG.apiKey, "demo-gear-locker");
  assert.equal(w.LOOKUP_URL, "http://127.0.0.1:8787");
  assert.equal(w.GEAR_QA, true);
});

test("a local override cannot point at production", () => {
  const w = win();
  const r = applyQaMode(w, { hostname: "localhost", protocol: "http:", search: "?env=emulator" }, {
    firebase: { projectId: "gear-locker-c248c", apiKey: PRODUCTION_API_KEY },
    lookupUrl: "https://gear-locker-api.ace0nbase.workers.dev",
  });
  assert.equal(r.mode, "blocked");
  assert.equal(w.FIREBASE_CONFIG, null);
  assert.equal(w.LOOKUP_URL, "");
  assert.equal(localFileLooksLive("projectId: \"gear-locker-c248c\""), true);
  assert.equal(localFileLooksLive("projectId: \"demo-gear-locker\""), false);
});

test("the Google popup helper script is recognized so local test mode can refuse it", () => {
  assert.equal(isGoogleApiScript("https://apis.google.com/js/api.js"), true);
  assert.equal(isGoogleApiScript("https://apis.google.com/js/api.js?onload=cb"), true);
  assert.equal(isGoogleApiScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"), false);
  assert.equal(isGoogleApiScript(""), false);
});
