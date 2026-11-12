import { registerSW } from 'virtual:pwa-register';

/** Registers the service worker that makes the app shell available offline. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent('cmis:update-available', { detail: { update } }));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('cmis:offline-ready'));
    },
  });
}
