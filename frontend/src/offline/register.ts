import { registerSW } from 'virtual:pwa-register';

type Update = (reloadPage?: boolean) => Promise<void>;
let pendingUpdate: Update | null = null;

/** The waiting new version, if one has downloaded (it may arrive before the page that shows it has mounted). */
export function getPendingUpdate() {
  return pendingUpdate;
}

/** Registers the service worker that makes the app shell available offline. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      pendingUpdate = update;
      window.dispatchEvent(new CustomEvent('cmis:update-available', { detail: { update } }));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('cmis:offline-ready'));
    },
  });
}
