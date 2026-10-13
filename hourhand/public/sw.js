// Makes Hourhand installable and shows a branded page when offline. Bump CACHE when the offline page or icons change.
// Only /offline and the icons are ever cached: no API responses, dashboard HTML or anything tied to a cookie.
const CACHE = "hourhand-shell-v1";
const SHELL = ["/offline", "/icons/192", "/icons/512", "/icons/maskable-512", "/icons/180"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("/offline")));
});
