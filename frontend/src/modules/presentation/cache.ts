/**
 * A small copy of the plans and songs the desk has opened, kept on this computer so a service
 * that has started keeps running if the connection drops (the desk falls back to this copy).
 */
const KEY = 'rlwm-presentation-cache-v1'; // also cleared on sign-out (offline/db.ts)
const MAX = 60;

type Store = Record<string, { at: number; value: unknown }>;

function read(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Store; } catch { return {}; }
}

function write(store: Store) {
  const entries = Object.entries(store).sort((a, b) => b[1].at - a[1].at).slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* storage full or blocked */ }
}

export async function withLocalCopy<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const value = await load();
    const store = read();
    store[key] = { at: Date.now(), value };
    write(store);
    return value;
  } catch (e) {
    const hit = read()[key];
    if (hit) return hit.value as T;
    throw e;
  }
}

