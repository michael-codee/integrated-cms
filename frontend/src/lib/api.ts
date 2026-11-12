/**
 * Thin fetch wrapper for the CMIS REST API.
 *
 * - Short-lived access token kept in memory only; the refresh token lives in
 *   an httpOnly cookie the browser sends to /api/auth/ automatically.
 * - Transparent single-flight token refresh on 401.
 * - Every request carries the device id (used by sync & the audit trail).
 * - Network failures raise `OfflineError` so callers can fall back to the
 *   local IndexedDB store and outbox.
 */
import { getDeviceId } from './device';

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown, message?: string) {
    super(message || extractMessage(data) || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
  /** Field-level validation errors returned by DRF ({field: [messages]}). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.data && typeof this.data === 'object' && !Array.isArray(this.data)) {
      for (const [k, v] of Object.entries(this.data as Record<string, unknown>)) {
        if (k === 'detail' || k === 'code') continue;
        out[k] = Array.isArray(v) ? v.map(String).join(' ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
    }
    return out;
  }
}

export class OfflineError extends Error {
  constructor() {
    super('You appear to be offline. The change has been kept on this device.');
  }
}

function extractMessage(data: unknown): string | undefined {
  if (!data) return undefined;
  if (typeof data === 'string') return data.slice(0, 300);
  if (typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === 'string') return d.detail;
    if (Array.isArray(d.non_field_errors)) return String(d.non_field_errors[0]);
    if (Array.isArray(d.detail)) return String(d.detail[0]);
    const first = Object.entries(d)[0];
    if (first) {
      const [k, v] = first;
      const msg = Array.isArray(v) ? v[0] : v;
      if (typeof msg === 'string') return k === 'non_field_errors' ? msg : `${k.replace(/_/g, ' ')}: ${msg}`;
    }
  }
  return undefined;
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onAuthLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function hasAccessToken() {
  return !!accessToken;
}
export function setOnAuthLost(cb: () => void) {
  onAuthLost = cb;
}

export type Query = Record<string, string | number | boolean | undefined | null | (string | number)[]>;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Query;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  ifMatch?: number;
  raw?: boolean; // return the Response (for downloads)
  noRefresh?: boolean;
}

export function buildQuery(params?: Query) {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => q.append(k, String(x)));
    else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export async function refreshAccess(): Promise<{ access: string; user: unknown } | null> {
  let res: Response;
  try {
    res = await fetch('/api/auth/refresh/', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CMIS-Client': 'web', 'X-Device-Id': getDeviceId() },
    });
  } catch {
    throw new OfflineError();
  }
  if (!res.ok) {
    accessToken = null;
    return null;
  }
  const data = await res.json();
  accessToken = data.access;
  return data;
}

async function singleFlightRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = refreshAccess()
      .then((d) => !!d)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
  }
  return refreshing;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = (opts.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-CMIS-Client': 'web',
    'X-Device-Id': getDeviceId(),
    ...(opts.headers || {}),
  };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.ifMatch !== undefined) headers['If-Match'] = String(opts.ifMatch);
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const url = `/api${path}${buildQuery(opts.params)}`;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new OfflineError();
  }

  if (res.status === 401 && !opts.noRefresh && !path.startsWith('/auth/login')) {
    const ok = await singleFlightRefresh();
    if (ok) return api<T>(path, { ...opts, noRefresh: true });
    onAuthLost?.();
  }
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, await safeJson(res));
    return res as unknown as T;
  }
  if (res.status === 204) return undefined as T;
  const data = await safeJson(res);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/** Paginated DRF list response. */
export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Download a file (PDF/Excel/CSV export) using the authenticated session. */
export async function download(path: string, params?: Query, fallbackName = 'export') {
  const res = await api<Response>(path, { params, raw: true });
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const name = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
