/* =========================================================
   Service Worker — Rattazzi Cartellini Prezzi
   Cache offline minimale: la pagina index.html viene servita
   dalla cache se la rete non è disponibile.
   ========================================================= */

const CACHE_NAME = 'rattazzi-v3.1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('SW install cache error:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Ignora richieste non GET
  if (event.request.method !== 'GET') return;

  // Non cachare richieste esterne (es. CDN)
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      // Network first con fallback su cache
      const network = fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, copy)).catch(()=>{});
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));

      return cached || network;
    })
  );
});