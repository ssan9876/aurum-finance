/**
 * Aurum service worker — makes the self-hosted/web app installable and fast
 * on repeat loads. Strategy:
 *   - /api/* and /mcp are NEVER cached (always live data)
 *   - hashed build assets (/assets/*, /icons/*) are cache-first
 *   - navigations/HTML are network-first with cache fallback, so the shell
 *     still opens when the server is briefly unreachable
 */
const CACHE = 'aurum-v1.3.0';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') return;

  const cacheFirst = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/');

  if (cacheFirst) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(event.request);
        if (hit) return hit;
        const shell = await caches.match('/');
        if (shell) return shell;
        return Response.error();
      })
  );
});
