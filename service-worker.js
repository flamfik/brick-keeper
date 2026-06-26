const CACHE_NAME = "brick-keeper-v1.0b";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=1.0b",
  "./js/app.js?v=1.0b",
  "./js/backups.js?v=1.0b",
  "./js/csv.js?v=1.0b",
  "./js/file-storage.js?v=1.0b",
  "./js/i18n.js?v=1.0b",
  "./js/inventory.js?v=1.0b",
  "./js/mysql-storage.js?v=1.0b",
  "./js/scanner.js?v=1.0b",
  "./js/set-catalog.js?v=1.0b",
  "./js/sql-storage.js?v=1.0b",
  "./js/storage.js?v=1.0b",
  "./data/bricks.json?v=1.0b",
  "./data/colors.csv?v=1.0b",
  "./manifest.webmanifest",
  "./icons/app-icon.svg",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
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
  if (url.pathname.includes("/api/")) return;

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
