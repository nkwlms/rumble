const CACHE = 'rumble-v1';
const PRECACHE = ['/rumble/', '/rumble/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Push notifications ────────────────────────────────────────────────────────

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}

  const title = data.title || "It's your turn!";
  const body  = data.body  || 'A move is waiting in Rumble';
  const gameId = data.gameId;

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:      '/rumble/icon-192.png',
      badge:     '/rumble/icon-192.png',
      tag:       gameId ? `rumble-${gameId}` : 'rumble',
      renotify:  true,
      data:      { gameId },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const gameId = e.notification.data?.gameId;
  const url = gameId
    ? `${self.location.origin}/rumble/?game=${gameId}`
    : `${self.location.origin}/rumble/`;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/rumble/') && 'focus' in c) {
          return c.focus().then(w => w.navigate(url));
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ── Fetch (cache-first for same-origin) ───────────────────────────────────────

self.addEventListener('fetch', e => {
  // Only handle GET requests; skip cross-origin (Google Apps Script, etc.)
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      // Return cached immediately if available, fall back to network
      return cached || network;
    })
  );
});
