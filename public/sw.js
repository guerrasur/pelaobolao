const CACHE = 'pelaobolao-shell-0.39.1-r1';
const CORE = ['/manifest.webmanifest', '/icon-192.png', '/icon.svg', '/assets/menu-hero.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('pelaobolao-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === '/version.json' || url.pathname === '/sw.js') return;

  // The application shell must always come from Hosting. Caching index.html can
  // strand mobile clients on an old or incomplete bundle after a deploy.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith((async () => {
    const immutable = /^\/assets\/.+-[\w-]{8,}\.(?:js|css)$/.test(url.pathname);
    if (immutable) {
      try {
        const cached = await caches.match(request);
        if (cached) return cached;
      } catch { /* Storage may be unavailable in private browsing. */ }
    }

    try {
      const response = await fetch(request);
      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        // Never persist HTML under an asset URL: Firebase rewrites missing paths
        // to index.html, and caching that response makes a transient bad deploy sticky.
        if (!contentType.includes('text/html')) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
        }
      }
      return response;
    } catch {
      try {
        return (await caches.match(request)) || Response.error();
      } catch {
        return Response.error();
      }
    }
  })());
});
