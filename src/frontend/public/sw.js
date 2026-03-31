const CACHE_NAME = 'manga-wl-v1';

const isExcluded = (url) => {
  return (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('blob.caffeine.ai') ||
    url.hostname.includes('ic0.app') ||
    url.hostname.includes('icp-api.io') ||
    url.hostname.includes('internetcomputer.org') ||
    url.hostname.includes('dfinity.network') ||
    url.hostname.includes('identity.ic0.app')
  );
};

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (isExcluded(url)) return;

  // Cache-first, update in background (stale-while-revalidate)
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});
