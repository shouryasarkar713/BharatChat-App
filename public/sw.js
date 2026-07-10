// Service Worker for BharatChat — handles push notifications and message caching
const CACHE_NAME = 'bharatchat-v1';
const STATIC_ASSETS = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
      self.clients.claim(),
    ])
  );
});

// Receive push events from the server (or from the page via showNotification)
self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'BharatChat', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'BharatChat';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag,
    data: payload.data || {},
    renotify: !!payload.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification clicks — focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Focus existing tab if any
      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          if ('focus' in client) {
            client.focus();
            client.postMessage({ type: 'notification-click', url: targetUrl });
            return;
          }
        }
      }
      // Otherwise open a new tab
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
