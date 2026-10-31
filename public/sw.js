// Classic service worker for art a player imported on this origin.
// Keep these three lines in sync with public/js/assetCache.js (that module documents why this file is not a module).
const IMPORTED_ASSET_CACHE = 'sp-imported-assets-v1';
const IMPORTED_ASSET_CACHE_PREFIX = 'sp-imported-assets-';
const IMPORTED_ASSET_PATH = /^\/(?:assets|fonts|media)\/~[0-9a-f]{16}\//;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(IMPORTED_ASSET_CACHE_PREFIX) && name !== IMPORTED_ASSET_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (!IMPORTED_ASSET_PATH.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(IMPORTED_ASSET_CACHE);
    const hit = await cache.match(url.origin + url.pathname);
    if (hit) return hit;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fresh = attempt > 0 ? new Request(url.href, { cache: 'no-store' }) : request;
        const response = await fetch(fresh);
        if (response.ok || response.status === 304) return response;
      } catch (e) { lastError = e; }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    throw lastError;
  })());
});