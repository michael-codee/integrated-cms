/**
 * Synchronisation engine.
 *
 * push — replays the outbox in the order changes were made. Each change keeps
 *        its Idempotency-Key, so a replay after a lost reply is harmless. Edits
 *        carry If-Match with the version they were based on; if the server
 *        copy moved on, the change becomes a conflict for the Sync Centre and
 *        nothing is overwritten. Later changes to the same record wait.
 * pull — fetches records changed since the last cursor for each entity the
 *        user may see, and removes records deleted on the server.
 */
import { api, ApiError, hasAccessToken, OfflineError } from '@/lib/api';
import { uuid } from '@/lib/device';
import { db, getMeta, setMeta, type OutboxItem } from './db';
import { cacheRecords } from './repository';

export const SYNC_ENTITIES = ['members', 'attendance', 'programs', 'transactions', 'assets'] as const;
export type SyncPhase = 'idle' | 'pushing' | 'pulling' | 'error';
export interface SyncStatus { phase: SyncPhase; lastSync?: string; lastError?: string }

let running: Promise<void> | null = null;
let status: SyncStatus = { phase: 'idle' };

function emit(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  window.dispatchEvent(new CustomEvent('cmis:sync-status', { detail: status }));
}
export const getSyncStatus = () => status;

const notifyOutbox = () => window.dispatchEvent(new CustomEvent('cmis:outbox-changed'));

async function setItem(item: OutboxItem, patch: Partial<OutboxItem>) {
  await db.outbox.update(item.seq!, { ...patch, updatedAt: new Date().toISOString() });
}

async function markRecord(entity: string, id: string, syncState: 'failed' | 'conflict') {
  const rec = await db.records.get([entity, id]);
  if (rec) await db.records.put({ ...rec, syncState });
}

/** Replays queued changes. Stops at the first network/server failure. */
export async function pushOutbox() {
  const items = await db.outbox.where('status').anyOf('pending', 'syncing').sortBy('seq');
  const blocked = new Set((await db.outbox.where('status').anyOf('failed', 'conflict').toArray()).map((o) => o.recordId));
  for (const item of items) {
    if (blocked.has(item.recordId)) continue; // an earlier change to this record needs attention first
    await setItem(item, { status: 'syncing', attempts: item.attempts + 1 });
    try {
      const data = await api<Record<string, unknown> | undefined>(item.url, {
        method: item.method, body: item.body, idempotencyKey: item.changeId,
        ifMatch: item.op === 'update' && item.baseVersion ? item.baseVersion : undefined,
      });
      await setItem(item, { status: 'done', lastError: undefined });
      if (data && typeof data === 'object' && 'id' in data && item.op !== 'action') {
        const rec = await db.records.get([item.entity, String(data.id)]);
        if (rec) await db.records.put({ ...rec, syncState: 'synced' });
        await cacheRecords(item.entity, [data]);
        // Later queued edits of this record were based on the local copy; move their base forward.
        const later = await db.outbox.where('recordId').equals(item.recordId).filter((o) => o.status === 'pending' && o.op === 'update').toArray();
        for (const l of later) await db.outbox.update(l.seq!, { baseVersion: Number(data.version ?? l.baseVersion) });
      } else if (item.op === 'delete') {
        await db.records.delete([item.entity, item.recordId]);
      }
    } catch (e) {
      if (e instanceof OfflineError) { await setItem(item, { status: 'pending' }); throw e; }
      if (e instanceof ApiError && (e.status === 401 || e.status >= 500 || e.status === 429 || (e.status === 409 && (e.data as { code?: string })?.code === 'in_progress'))) {
        await setItem(item, { status: 'pending', lastError: e.message });
        throw e;
      }
      if (e instanceof ApiError && e.status === 409 && (e.data as { code?: string })?.code === 'version_conflict') {
        await setItem(item, { status: 'conflict', conflict: e.data, lastError: e.message });
        await markRecord(item.entity, item.recordId, 'conflict');
      } else {
        await setItem(item, { status: 'failed', lastError: e instanceof Error ? e.message : String(e) });
        await markRecord(item.entity, item.recordId, 'failed');
      }
      blocked.add(item.recordId);
    } finally {
      notifyOutbox();
    }
  }
  // Keep a week of completed changes for the history list.
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
  await db.outbox.where('status').equals('done').filter((o) => o.updatedAt < cutoff).delete();
}

interface PullPage { entity: string; results: Record<string, unknown>[]; deleted: string[]; cursor: number; more: boolean; skipped?: boolean }

export async function pullChanges() {
  for (const entity of SYNC_ENTITIES) {
    let cursor = (await getMeta<number>(`cursor:${entity}`)) || 0;
    for (let page = 0; page < 50; page++) {
      const data = await api<PullPage>('/sync/pull/', { params: { entity, cursor, limit: 500 } });
      if (data.skipped) break;
      await cacheRecords(entity, data.results);
      if (data.deleted.length) {
        await db.transaction('rw', db.records, async () => {
          for (const id of data.deleted) {
            const rec = await db.records.get([entity, id]);
            if (rec && rec.syncState === 'synced') await db.records.delete([entity, id]);
          }
        });
      }
      cursor = data.cursor;
      await setMeta(`cursor:${entity}`, cursor);
      if (!data.more) break;
    }
  }
}

/** Push then pull. Concurrent calls share one run. */
export function syncNow(): Promise<void> {
  if (running) return running;
  if (!hasAccessToken() || (typeof navigator !== 'undefined' && !navigator.onLine)) return Promise.resolve();
  running = (async () => {
    try {
      emit({ phase: 'pushing', lastError: undefined });
      await pushOutbox();
      emit({ phase: 'pulling' });
      await pullChanges();
      const at = new Date().toISOString();
      await setMeta('lastSync', at);
      emit({ phase: 'idle', lastSync: at });
    } catch (e) {
      emit({ phase: e instanceof OfflineError ? 'idle' : 'error', lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Retry a failed change (after the user corrected the cause, or for a transient error). */
export async function retryChange(seq: number) {
  const item = await db.outbox.get(seq);
  if (!item) return;
  await db.outbox.update(seq, { status: 'pending', lastError: undefined, conflict: undefined });
  const rec = await db.records.get([item.entity, item.recordId]);
  if (rec) await db.records.put({ ...rec, syncState: 'pending' });
  notifyOutbox();
  await syncNow();
}

/** Drop a local change; the server copy is restored on the next pull or straight away when given. */
export async function discardChange(seq: number, serverCopy?: Record<string, unknown>) {
  const item = await db.outbox.get(seq);
  if (!item) return;
  await db.outbox.delete(seq);
  const others = await db.outbox.where('recordId').equals(item.recordId).filter((o) => o.status !== 'done').count();
  if (!others) {
    await db.records.delete([item.entity, item.recordId]);
    if (serverCopy) await cacheRecords(item.entity, [serverCopy]);
    else if (item.op !== 'create') await setMeta(`cursor:${item.entity}`, 0); // fetch a fresh copy
  }
  notifyOutbox();
}

/** Re-apply the device version on top of the newer server copy (user's explicit decision). */
export async function applyMineOver(seq: number, serverVersion: number) {
  const item = await db.outbox.get(seq);
  if (!item) return;
  await db.outbox.update(seq, { status: 'pending', baseVersion: serverVersion, conflict: undefined, lastError: undefined, changeId: uuid() });
  const rec = await db.records.get([item.entity, item.recordId]);
  if (rec) await db.records.put({ ...rec, syncState: 'pending' });
  notifyOutbox();
  await syncNow();
}

let started = false;
export function startSyncEngine() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const kick = () => { void syncNow(); };
  window.addEventListener('online', kick);
  let t: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('cmis:outbox-changed', () => { if (!running) { clearTimeout(t); t = setTimeout(kick, 800); } });
  navigator.serviceWorker?.addEventListener('message', (ev) => { if (ev.data?.type === 'cmis:sync-now') kick(); });
  setInterval(kick, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  getMeta<string>('lastSync').then((lastSync) => emit({ lastSync }));
  setTimeout(kick, 1500);
}
