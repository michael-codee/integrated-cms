/** Stable per-browser device identifier (used for sync and audit). */
const KEY = 'cmis-device-id';
let cached: string | null = null;

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getDeviceId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = uuid();
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached = cached || uuid();
  }
  return cached;
}
