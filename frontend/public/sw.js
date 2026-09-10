/* Service Worker «Спасибо»: кэш оболочки + Web Push */

const CACHE_NAME = 'spasibo-shell-v7';
const MEDIA_CACHE = 'spasibo-media-v4';
const SHELL_URLS = ['/', '/index.html', '/site.webmanifest', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== MEDIA_CACHE && !key.startsWith('spasibo-shell-assets-'))
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/telegram/photo-proxy')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (url.pathname.startsWith('/media/raster')) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) {
            return cached;
          }
          return fetch(event.request).then((response) => {
            if (response && response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        }),
      ),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    // JS/CSS с хэшами — только сеть; картинки из /assets/ кешируем.
    if (/\.(png|jpe?g|webp|gif|svg|avif)(\?|#|$)/i.test(url.pathname)) {
      event.respondWith(
        caches.open(MEDIA_CACHE).then((cache) =>
          cache.match(event.request).then((cached) => {
            if (cached) {
              return cached;
            }
            return fetch(event.request).then((response) => {
              if (response && response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            });
          }),
        ),
      );
      return;
    }
    event.respondWith(fetch(event.request));
    return;
  }

  if (url.pathname === '/index.html' || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  if (url.pathname === '/sw.js' || url.pathname.endsWith('/site.webmanifest')) {
    event.respondWith(fetch(event.request));
    return;
  }
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Спасибо',
    body: 'Новое уведомление',
    url: '/',
    tag: 'spasibo-notification',
  };

  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    if (event.data) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      tag: payload.tag,
      data: { url: payload.url },
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
