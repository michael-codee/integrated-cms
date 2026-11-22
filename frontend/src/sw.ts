/// <reference lib="webworker" />
/**
 * Service worker: precaches the application shell so the app opens without
 * internet, serves index.html for client-side routes, and wakes open pages to
 * flush the synchronisation outbox when Background Sync fires.
 *
 * API data is NOT cached here — offline data lives in IndexedDB, scoped to the
 * signed-in user and wiped on sign-out.
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

cleanupOutdatedCaches();
// Take control of the page that installed us, so the very first visit already works offline.
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

// The media pages get their own copy of the app shell, served with a Permissions-Policy that allows
// the camera and capture card (the rest of the app keeps them switched off).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/presentation.html'), { allowlist: [/^\/presentation(\/|$)/] }));
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/media\//, /^\/django-admin\//, /^\/presentation(\/|$)/] }));

// Uploaded images (logos, photos) – cache for offline viewing.
registerRoute(
  ({ url }) => url.pathname.startsWith('/media/') && /\.(png|jpe?g|webp)$/i.test(url.pathname),
  new CacheFirst({ cacheName: 'cmis-media', plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 86400 })] }),
);

// The Bible text for the media screens: kept after first use so scripture works offline.
registerRoute(
  ({ url }) => url.pathname.startsWith('/bible/'),
  new CacheFirst({ cacheName: 'cmis-bible', plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 365 * 86400 })] }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Background Sync: ask open windows to replay the outbox (they hold the auth token).
self.addEventListener('sync', ((event: Event & { tag: string; waitUntil: (p: Promise<unknown>) => void }) => {
  if (event.tag === 'cmis-outbox') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => clients.forEach((c) => c.postMessage({ type: 'cmis:sync-now' }))),
    );
  }
}) as EventListener);
