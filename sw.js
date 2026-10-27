// Offline cache: keeps the app itself available with no signal. Your gear data syncs separately through Firebase.
const CACHE = "gear-locker-v29";
const SHELL = [
  "./",
  "./index.html",
  "./config.js",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/qa-sync.js",
  "./js/qa-boot.js",
  "./js/qa-guard.js",
  "./js/logic.js",
  "./js/core.js",
  "./js/records.js",
  "./js/cloud.js",
  "./js/arms.js",
  "./js/social.js",
  "./js/stacks.js",
  "./js/kits.js",
  "./js/field.js",
  "./js/security.js",
  "./js/comms.js",
  "./icon-192.png",
  "./icon-512.png",
  "./maskable-192.png",
  "./maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon.svg",
  "./favicon-32.png",
  "./favicon-16.png",
];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== location.origin && u.host !== "www.gstatic.com") return;
  e.respondWith(fetch(r, u.origin === location.origin ? { cache: "no-cache" } : {}).then(res => { if (res.ok || res.type === "opaque") { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r).then(m => m || caches.match("./index.html"))));
});
self.addEventListener("push", e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "Price alert", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(data.title || "Price alert", {
    body: data.body || "A saved price hit your target.",
    icon: "icon-192.png",
    data: { url: data.url || "./?tab=wish" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "./?tab=wish";
  e.waitUntil((async () => {
    const url = new URL(target, self.location.origin).href;
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if ("focus" in c) {
        await c.focus();
        if ("navigate" in c) await c.navigate(url);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
