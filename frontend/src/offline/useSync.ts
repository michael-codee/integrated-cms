import { useEffect, useState } from 'react';
import { db, type OutboxItem } from './db';
import { getSyncStatus, type SyncStatus } from './sync';

export function useSyncStatus() {
  const [s, setS] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => {
    const on = (e: Event) => setS({ ...(e as CustomEvent<SyncStatus>).detail });
    window.addEventListener('cmis:sync-status', on);
    return () => window.removeEventListener('cmis:sync-status', on);
  }, []);
  return s;
}

/** Live view of the outbox (re-reads whenever it changes). */
export function useOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => db.outbox.orderBy('seq').reverse().toArray().then((rows) => { if (alive) setItems(rows); });
    load();
    window.addEventListener('cmis:outbox-changed', load);
    window.addEventListener('cmis:sync-status', load);
    return () => { alive = false; window.removeEventListener('cmis:outbox-changed', load); window.removeEventListener('cmis:sync-status', load); };
  }, []);
  const open = items.filter((i) => i.status !== 'done');
  return {
    items,
    pending: open.filter((i) => i.status === 'pending' || i.status === 'syncing').length,
    failed: open.filter((i) => i.status === 'failed').length,
    conflicts: open.filter((i) => i.status === 'conflict').length,
    open: open.length,
  };
}
