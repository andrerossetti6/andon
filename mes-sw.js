// Service Worker do MES Malha Forte — carrega a app offline (shell cacheado).
// As escritas offline são tratadas pela fila IndexedDB no mes.js, não aqui.
const CACHE = 'mf-shell-v30';
const SHELL = [
  '/mes.html',
  '/mes.js',
  '/style.css',
  '/mes.webmanifest',
  '/logo.png',
  'https://cdn.jsdelivr.net/npm/papaparse@5/papaparse.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API: nunca cacheia — a fila offline cuida das escritas; leituras falham graciosamente
  if (url.pathname.startsWith('/api/')) return;
  // Shell estático: cache-first (carrega offline), atualiza o cache em background
  if (e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const rede = fetch(e.request).then(resp => {
          if (resp && resp.ok && (url.origin === location.origin)) {
            const clone = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return resp;
        }).catch(() => cached);
        return cached || rede;
      })
    );
  }
});
