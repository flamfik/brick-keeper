const CACHE_NAME = "brick-keeper-v0.9.6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=0.9.6",
  "./js/app.js?v=0.9.6",
  "./js/file-storage.js?v=0.9.6",
  "./js/i18n.js?v=0.9.6",
  "./js/inventory.js?v=0.9.6",
  "./js/storage.js?v=0.9.6",
  "./data/bricks.json?v=0.9.6",
  "./data/colors.json?v=0.9.6",
  "./manifest.webmanifest",
  "./icons/app-icon.svg",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
