/**
 * Local (IndexedDB) database for offline-first operation.
 *
 * records — server records cached for offline viewing, plus records created or
 *           edited on this device that are not yet confirmed by the server.
 * outbox  — the synchronisation queue: one entry per local change, replayed to
 *           the API in order with an Idempotency-Key so it is applied once.
 * meta    — sync cursors, last sync time and the cached signed-in profile.
 */
import Dexie, { type Table } from 'dexie';

export type SyncState = 'synced' | 'pending' | 'failed' | 'conflict';

export interface LocalRecord {
  entity: string; // e.g. "members"
  id: string; // UUID (generated on the device for new records)
  data: Record<string, unknown>;
  version: number;
  syncState: SyncState;
  orgUnit?: string;
  updatedAt: string; // last modification on this device or server
  serverSeq?: number;
}

export type OutboxStatus = 'pending' | 'syncing' | 'failed' | 'conflict' | 'done';

export interface OutboxItem {
  seq?: number;
  changeId: string; // Idempotency-Key
  entity: string;
  recordId: string;
  op: 'create' | 'update' | 'delete' | 'action';
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  body?: Record<string, unknown>;
  baseVersion?: number;
  label: string; // human description for the Sync Centre
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  conflict?: unknown;
  createdAt: string;
  updatedAt: string;
  userId: string;
  deviceId: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

class CmisDatabase extends Dexie {
  records!: Table<LocalRecord, [string, string]>;
  outbox!: Table<OutboxItem, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('rlwm-cmis');
    this.version(1).stores({
      records: '[entity+id], entity, syncState, updatedAt, orgUnit',
      outbox: '++seq, &changeId, status, entity, recordId, createdAt',
      meta: 'key',
    });
  }
}

export const db = new CmisDatabase();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

/** Remove every locally stored record (used on sign-out / account switch). */
export async function wipeLocalData() {
  await db.transaction('rw', db.records, db.outbox, db.meta, async () => {
    await db.records.clear();
    await db.outbox.clear();
    await db.meta.clear();
  });
}
