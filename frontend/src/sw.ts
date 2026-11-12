/// <reference lib="webworker" />
/**
 * Service worker: precaches the application shell so the app opens without
 * internet, serves index.html for client-side routes, and wakes open pages to
 * flush the synchronisation outbox when Background Sync fires.
 *
 * API data is NOT cached here — offline data lives in IndexedDB, scoped to the
 * signed-in user and wiped on sign-out.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/media\//, /^\/django-admin\//] }));

// Uploaded images (logos, photos) – cache for offline viewing.
registerRoute(
  ({ url }) => url.pathname.startsWith('/media/') && /\.(png|jpe?g|webp)$/i.test(url.pathname),
  new CacheFirst({ cacheName: 'cmis-media', plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 86400 })] }),
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
