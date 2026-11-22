/**
 * Videos kept on the media computer itself (sermon clips, song videos, moving backgrounds).
 *
 * They are copied into this browser's own storage rather than uploaded: a five-minute clip is
 * hundreds of megabytes, too much for church connections, and a service must not depend on the
 * internet. The control desk and the projector window open the same files from here.
 * A service plan only records a video's local id and file name, so another computer that has
 * the same file (same name) plays it too.
 *
 * These are church media, not personal records, so they are kept when someone signs out.
 */
import Dexie, { type Table } from 'dexie';
import { useCallback, useEffect, useState } from 'react';

export interface LocalVideo {
  id: string;
  name: string;
  size: number;
  type: string;
  addedAt: number;
  blob: Blob;
}

export type LocalVideoInfo = Omit<LocalVideo, 'blob'>;

class MediaLocalDb extends Dexie {
  videos!: Table<LocalVideo, string>;
  constructor() {
    super('rlwm-media-local');
    this.version(1).stores({ videos: 'id, name, addedAt' });
  }
}

let database: MediaLocalDb | null = null;
const local = () => (database ??= new MediaLocalDb());

const CHANGED = 'rlwm-local-videos';
function announce() {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(CHANGED);
  ch.postMessage('changed');
  ch.close();
}

/** 1.5 GB per file keeps one mistaken pick (a whole film) from filling the disk. */
export const MAX_VIDEO_BYTES = 1.5 * 1024 ** 3;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|mov|mkv)$/i;

const newId = () => `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function addVideoFiles(files: Iterable<File>) {
  const added: LocalVideoInfo[] = [];
  const refused: string[] = [];
  // Ask the browser not to clear these files when the disk gets full.
  try { await navigator.storage?.persist?.(); } catch { /* not supported */ }
  for (const f of files) {
    if (!(f.type.startsWith('video/') || VIDEO_EXT.test(f.name))) { refused.push(`${f.name} is not a video file.`); continue; }
    if (f.size > MAX_VIDEO_BYTES) { refused.push(`${f.name} is larger than 1.5 GB.`); continue; }
    const row: LocalVideo = { id: newId(), name: f.name, size: f.size, type: f.type || 'video/mp4', addedAt: Date.now(), blob: f };
    try {
      await local().videos.put(row);
      const { blob: _b, ...info } = row;
      added.push(info);
    } catch (e) {
      const full = (e as Error).name === 'QuotaExceededError' || /quota/i.test((e as Error).message);
      refused.push(full ? `There is not enough space on this computer for ${f.name}.` : `${f.name} could not be saved: ${(e as Error).message}`);
    }
  }
  if (added.length) announce();
  return { added, refused };
}

export async function listVideos(): Promise<LocalVideoInfo[]> {
  const rows: LocalVideoInfo[] = [];
  // Read only the small fields: the blobs stay on disk.
  await local().videos.orderBy('name').each((v) => { rows.push({ id: v.id, name: v.name, size: v.size, type: v.type, addedAt: v.addedAt }); });
  return rows;
}

export async function getVideoBlob(id: string): Promise<Blob | null> {
  try { return (await local().videos.get(id))?.blob || null; } catch { return null; }
}

export async function deleteVideo(id: string) {
  await local().videos.delete(id);
  announce();
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage || 0, quota: e.quota || 0 } : null;
  } catch { return null; }
}

/** The local id to play for a plan's video: the same id, or a file with the same name added on this computer. */
export function resolveVideo(list: LocalVideoInfo[], id?: string | null, name?: string | null) {
  if (!id && !name) return undefined;
  return list.find((v) => v.id === id) || (name ? list.find((v) => v.name === name) : undefined);
}

export function useLocalVideos() {
  const [videos, setVideos] = useState<LocalVideoInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => {
    listVideos().then((v) => { setVideos(v); setLoaded(true); }, () => setLoaded(true));
  }, []);
  useEffect(() => {
    refresh();
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANGED);
    ch.onmessage = refresh;
    return () => ch.close();
  }, [refresh]);
  return { videos, loaded, refresh };
}

/** An object URL for a local video, released when no longer needed. */
export function useLocalVideoUrl(id?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let u: string | null = null;
    let cancelled = false;
    getVideoBlob(id).then((b) => {
      if (cancelled || !b) { if (!b) setUrl(null); return; }
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => { cancelled = true; if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url;
}

export function formatBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
}
