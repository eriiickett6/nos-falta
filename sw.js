/* Nos Falta · service worker
   - La app (HTML, iconos, librería) se guarda para abrir sin internet.
   - Los datos (Supabase) NO pasan por aquí: la app guarda la casa en el móvil y una cola de cambios.
   - Sube la versión (V) si cambia la lista de archivos básicos. */
const V = 'nf-app-v2';
const CORE = ['./', 'index.html', 'privacidad.html', 'manifest.webmanifest',
  'img/brand/logo-32.png', 'img/brand/logo-64.png', 'img/brand/logo-96.png', 'img/brand/logo-180.png', 'img/brand/logo-192.png', 'img/brand/logo-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const CACHEABLE = u => u.origin === self.location.origin || u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname.endsWith('supabase.co')) return;            // datos en vivo: los gestiona la app

  // Páginas: primero la red (para tener siempre la última versión); sin red, la copia guardada
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(u.pathname.endsWith('privacidad.html') ? 'privacidad.html' : 'index.html', cp)); }
      return r;
    }).catch(() => caches.match(u.pathname.endsWith('privacidad.html') ? 'privacidad.html' : 'index.html')));
    return;
  }

  // Archivos propios, librería y fuente: copia guardada al instante y se renueva por detrás
  if (CACHEABLE(u)) {
    e.respondWith(caches.open(V).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
  // Fotos de productos de otras webs: no se guardan (ocuparían demasiado espacio)
});
