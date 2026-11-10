// Immer zuerst die neueste Version vom Server holen (ohne Browser-Zwischenspeicher),
// nur ohne Netz die gespeicherte Kopie nehmen.
const CACHE = 'ze-v4';
const DATEIEN = ['./', './index.html', './mini.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN.map(u => new Request(u, { cache: 'reload' }))))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;   // Google-Anfragen nie zwischenspeichern
  const netz = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) { const kopie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopie)); } return r; });
  const ausCache = () => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'));
  // Bei sehr schlechtem Netz nach 6 s die gespeicherte Version zeigen
  e.respondWith(new Promise(ok => {
    let fertig = false;
    const t = setTimeout(() => ausCache().then(r => { if (!fertig && r) { fertig = true; ok(r); } }), 6000);
    netz.then(r => { clearTimeout(t); if (!fertig) { fertig = true; ok(r); } })
        .catch(() => { clearTimeout(t); ausCache().then(r => { if (!fertig) { fertig = true; ok(r || Response.error()); } }); });
  }));
});
