/**
 * Offline-aware write path used by every form that must work without
 * internet (members, attendance, finance, assets, programs, reports).
 *
 * Online: the change goes straight to the API (with an Idempotency-Key) and
 * the server copy is cached locally as "synced".
 * Offline: the change is stored in IndexedDB as "pending" and appended to the
 * outbox; the sync engine replays it when connectivity returns.
 */
import { api, ApiError, OfflineError } from '@/lib/api';
import { getDeviceId, uuid } from '@/lib/device';
import { db, getMeta, type LocalRecord, type OutboxItem } from './db';

export interface ChangeRequest {
  entity: string;
  op: OutboxItem['op'];
  method: OutboxItem['method'];
  url: string; // API path, e.g. "/members/"
  body?: Record<string, unknown>;
  recordId: string;
  label: string;
  baseVersion?: number;
  /** Whether this change may be queued offline (false for e.g. approvals). */
  offline?: boolean;
}

export type ChangeResult<T> = { state: 'synced'; data: T } | { state: 'queued'; data: Record<string, unknown> };

async function currentUserId() {
  const s = await getMeta<{ user: { id: string } }>('session');
  return s?.user.id || 'unknown';
}

export async function cacheRecords(entity: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const now = new Date().toISOString();
  await db.transaction('rw', db.records, async () => {
    for (const row of rows) {
      const id = String(row.id);
      const existing = await db.records.get([entity, id]);
      if (existing && existing.syncState !== 'synced') continue; // never clobber unsynced local edits
      await db.records.put({
        entity, id, data: { ...(existing?.data || {}), ...row }, version: Number(row.version ?? 1), syncState: 'synced',
        orgUnit: (row.org_unit as string) || undefined, updatedAt: String(row.updated_at || now),
        serverSeq: row.sync_seq as number | undefined,
      });
    }
  });
}

export async function localRecords(entity: string): Promise<LocalRecord[]> {
  return db.records.where('entity').equals(entity).toArray();
}

export async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    // @ts-expect-error Background Sync is not in every TS DOM lib
    await reg?.sync?.register('cmis-outbox');
  } catch {
    /* unsupported: the app's online listener and timer will sync instead */
  }
}

export async function submitChange<T = Record<string, unknown>>(req: ChangeRequest): Promise<ChangeResult<T>> {
  const changeId = uuid();
  const queue = async (): Promise<ChangeResult<T>> => {
    const now = new Date().toISOString();
    const existing = await db.records.get([req.entity, req.recordId]);
    const merged: Record<string, unknown> = { ...(existing?.data || {}), ...(req.body || {}), id: req.recordId };
    await db.transaction('rw', db.records, db.outbox, async () => {
      if (req.op !== 'action') {
        await db.records.put({
          entity: req.entity, id: req.recordId, data: merged, version: existing?.version ?? 0, syncState: 'pending',
          orgUnit: (merged.org_unit as string) || existing?.orgUnit, updatedAt: now,
        });
      }
      await db.outbox.add({
        changeId, entity: req.entity, recordId: req.recordId, op: req.op, method: req.method, url: req.url,
        body: req.body, baseVersion: req.baseVersion, label: req.label, status: 'pending', attempts: 0,
        createdAt: now, updatedAt: now, userId: await currentUserId(), deviceId: getDeviceId(),
      });
    });
    window.dispatchEvent(new CustomEvent('cmis:outbox-changed'));
    requestBackgroundSync();
    return { state: 'queued', data: merged };
  };

  // Changes that depend on earlier unsynced changes to the same record must wait in line.
  const blocked = await db.outbox.where('recordId').equals(req.recordId).filter((o) => o.status !== 'done').count();
  if (blocked > 0 && req.offline !== false) return queue();
  if (typeof navigator !== 'undefined' && !navigator.onLine && req.offline !== false) return queue();

  try {
    const data = await api<T>(req.url, {
      method: req.method, body: req.body, idempotencyKey: changeId,
      ifMatch: req.op === 'update' ? req.baseVersion : undefined,
    });
    if (data && typeof data === 'object' && 'id' in (data as object) && req.op !== 'action') {
      await cacheRecords(req.entity, [data as Record<string, unknown>]);
    }
    return { state: 'synced', data };
  } catch (e) {
    if (e instanceof OfflineError && req.offline !== false) return queue();
    if (e instanceof OfflineError) throw new ApiError(0, null, 'This action needs an internet connection.');
    throw e;
  }
}
