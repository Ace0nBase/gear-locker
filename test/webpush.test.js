import test from "node:test";
import assert from "node:assert/strict";
import { encryptWebPush, decryptWebPush, pushEndpointOk, bytesToB64url } from "../api/webpush.js";

test("push endpoints stay on known push services", () => {
  assert.equal(pushEndpointOk("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(pushEndpointOk("https://web.push.apple.com/abc"), true);
  assert.equal(pushEndpointOk("https://updates.push.services.mozilla.com/wpush/v2/abc"), true);
  assert.equal(pushEndpointOk("https://foo.push.services.mozilla.com/abc"), true);
  assert.equal(pushEndpointOk("https://notify.windows.com/x"), false);
  assert.equal(pushEndpointOk("https://wns.notify.windows.com/x"), true);
  assert.equal(pushEndpointOk("http://fcm.googleapis.com/abc"), false);
  assert.equal(pushEndpointOk("https://example.com/push"), false);
  assert.equal(pushEndpointOk("https://user:pass@fcm.googleapis.com/abc"), false);
});

test("aes128gcm payload round-trips", async () => {
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub = { keys: { p256dh: bytesToB64url(pub), auth: bytesToB64url(auth) } };
  const sender = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptWebPush(sub, JSON.stringify({ title: "Price alert", url: "./?tab=wish" }), salt, sender);
  const text = await decryptWebPush(body, sub, receiver);
  assert.equal(text, JSON.stringify({ title: "Price alert", url: "./?tab=wish" }));
});
