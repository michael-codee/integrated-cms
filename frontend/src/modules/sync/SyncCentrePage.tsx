import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, CloudOff, CloudUpload, Laptop, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { getDeviceId } from '@/lib/device';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Modal, PageHeader, StatCard, StatusBadge, Tabs, useToast } from '@/components/ui';
import { dateTime, relative } from '@/lib/format';
import { db, getMeta, type OutboxItem } from '@/offline/db';
import { applyMineOver, discardChange, retryChange, syncNow } from '@/offline/sync';
import { useOutbox, useSyncStatus } from '@/offline/useSync';

interface ServerConflict { id: number; entity: string; entity_id: string; label: string; user_name: string; device_id: string; org_unit_name: string | null; client_payload: Record<string, unknown>; server_snapshot: Record<string, unknown>; base_version: number | null; server_version: number | null; reason: string; status: 'open' | 'resolved'; resolution: string; resolved_by_name: string | null; resolved_at: string | null; created_at: string }
interface Device { id: number; device_id: string; label: string; user_agent: string; first_seen: string; last_seen: string; last_sync_at: string | null }

const ENTITY_LABEL: Record<string, string> = { members: 'Member', attendance: 'Attendance', programs: 'Program', transactions: 'Finance entry', assets: 'Asset' };
const LOCKED_FINANCE = ['submitted', 'approved', 'rejected', 'reversed'];

function fmt(v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Field-by-field comparison of the device change against the current server copy. */
function Compare({ mine, server }: { mine: Record<string, unknown>; server: Record<string, unknown> }) {
  const keys = Object.keys(mine).filter((k) => !['id', 'client_created_at', 'client_updated_at'].includes(k));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Your change</th><th className="py-1">Server now</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {keys.map((k) => {
            const differs = fmt(mine[k]) !== fmt(server[k]);
            return (
              <tr key={k} className={clsx(differs && 'bg-gold-50/60 dark:bg-gold-900/20')}>
                <td className="py-1.5 pr-3 font-medium">{k.replace(/_/g, ' ')}</td>
                <td className="py-1.5 pr-3">{fmt(mine[k])}</td>
                <td className="py-1.5">{fmt(server[k])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConflictDialog({ item, onClose }: { item: OutboxItem; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const info = (item.conflict || {}) as { server?: Record<string, unknown>; conflict?: number; detail?: string };
  const server = info.server || {};
  const financeLocked = item.entity === 'transactions' && LOCKED_FINANCE.includes(String(server.status));
  const resolveOnServer = async (resolution: 'keep_server' | 'use_mine') => {
    if (info.conflict) await api(`/sync/conflicts/${info.conflict}/resolve/`, { method: 'POST', body: { resolution } }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ['sync'] });
  };
  const keepServer = async () => {
    setBusy(true);
    try { await resolveOnServer('keep_server'); await discardChange(item.seq!, server); toast.success('Kept the server version. Your change was discarded.'); onClose(); }
    finally { setBusy(false); }
  };
  const useMine = async () => {
    setBusy(true);
    try { await resolveOnServer('use_mine'); await applyMineOver(item.seq!, Number(server.version)); toast.success('Your change was re-sent on top of the latest version.'); onClose(); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Resolve a conflict" subtitle={item.label}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Later</Button>
        <Button variant="secondary" loading={busy} onClick={keepServer}>Keep server version</Button>
        <Button loading={busy} disabled={financeLocked || !server.version} onClick={useMine}>Apply my change</Button>
      </>}>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{info.detail || 'Someone else changed this record after this device last loaded it.'} Highlighted rows differ.</p>
      {financeLocked && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">This finance entry has been {String(server.status)} on the server. Approved financial records are never overwritten from a device; keep the server version and, if needed, ask for a reversing entry.</p>}
      <Compare mine={item.body || {}} server={server} />
    </Modal>
  );
}

function OutboxRow({ item, onConflict, onDiscard }: { item: OutboxItem; onConflict: () => void; onDiscard: () => void }) {
  const online = useOnline();
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
      <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        item.status === 'conflict' || item.status === 'failed' ? 'bg-red-50 text-red-600 dark:bg-red-950/40' : item.status === 'done' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40' : 'bg-gold-50 text-gold-700 dark:bg-gold-900/30')}>
        {item.status === 'done' ? <CheckCircle2 className="h-4 w-4" /> : item.status === 'conflict' || item.status === 'failed' ? <AlertTriangle className="h-4 w-4" /> : <CloudUpload className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{item.label}</span>
        <span className="block text-xs text-slate-500">{ENTITY_LABEL[item.entity] || item.entity} · saved {relative(item.createdAt)}{item.attempts ? ` · ${item.attempts} attempt${item.attempts > 1 ? 's' : ''}` : ''}</span>
        {item.lastError && item.status !== 'done' && <span className="mt-0.5 block text-xs text-red-700 dark:text-red-300">{item.lastError}</span>}
      </span>
      <StatusBadge status={item.status === 'done' ? 'synced' : item.status} label={item.status === 'done' ? 'uploaded' : item.status === 'syncing' ? 'uploading' : undefined} />
      {item.status === 'conflict' && <Button size="sm" onClick={onConflict}>Resolve</Button>}
      {item.status === 'failed' && <Button size="sm" variant="secondary" disabled={!online} icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => retryChange(item.seq!)}>Retry</Button>}
      {(item.status === 'failed' || item.status === 'pending') && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDiscard}>Discard</Button>}
    </li>
  );
}

export default function SyncCentrePage() {
  const online = useOnline();
  const toast = useToast();
  const { items, pending, failed, conflicts } = useOutbox();
  const { phase, lastSync, lastError } = useSyncStatus();
  const [tab, setTab] = useState<'queue' | 'history' | 'server' | 'devices'>('queue');
  const [resolving, setResolving] = useState<OutboxItem | null>(null);
  const [discarding, setDiscarding] = useState<OutboxItem | null>(null);
  const [cached, setCached] = useState<number | null>(null);
  const [storedLast, setStoredLast] = useState<string | undefined>();
  useEffect(() => { db.records.count().then(setCached); getMeta<string>('lastSync').then(setStoredLast); }, [phase]);
  const status = useQuery({ queryKey: ['sync', 'status'], enabled: online, queryFn: () => api<{ open_conflicts: number; devices: Device[] }>('/sync/status/') });
  const serverConflicts = useQuery({ queryKey: ['sync', 'conflicts'], enabled: online && tab === 'server', queryFn: () => api<Page<ServerConflict>>('/sync/conflicts/', { params: { page_size: 50 } }) });
  const busy = phase === 'pushing' || phase === 'pulling';
  const open = items.filter((i) => i.status !== 'done');
  const done = items.filter((i) => i.status === 'done');
  const me = getDeviceId();
  const last = lastSync || storedLast;
  return (
    <div className="space-y-6">
      <PageHeader title="Sync Centre" subtitle="Changes saved on this device and their upload to the server."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Sync Centre' }]}
        actions={<Button icon={<RefreshCw className={clsx('h-4 w-4', busy && 'animate-spin')} />} disabled={!online || busy} onClick={() => syncNow().then(() => toast.success('Synchronised.'))}>{busy ? 'Synchronising…' : 'Synchronise now'}</Button>} />
      {!online && <p className="flex items-center gap-2 rounded-lg bg-gold-50 px-4 py-3 text-sm text-gold-900 dark:bg-gold-900/30 dark:text-gold-100"><CloudOff className="h-4 w-4" /> You are offline. Changes stay safely on this device and upload automatically when the connection returns.</p>}
      {phase === 'error' && lastError && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">The last synchronisation stopped: {lastError}</p>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Waiting to upload" value={pending.toLocaleString()} icon={<CloudUpload className="h-5 w-5" />} tone={pending ? 'gold' : 'slate'} />
        <StatCard label="Need attention" value={(failed + conflicts).toLocaleString()} hint={conflicts ? `${conflicts} conflict${conflicts > 1 ? 's' : ''}` : undefined} icon={<AlertTriangle className="h-5 w-5" />} tone={failed + conflicts ? 'red' : 'slate'} />
        <StatCard label="Last synchronised" value={last ? relative(last) : 'Never'} hint={last ? dateTime(last) : undefined} icon={<RefreshCw className="h-5 w-5" />} tone="slate" />
        <StatCard label="Records on this device" value={cached == null ? '…' : cached.toLocaleString()} hint="Available offline" icon={<Laptop className="h-5 w-5" />} tone="slate" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'queue', label: <>On this device {open.length > 0 && <Badge tone={failed + conflicts ? 'red' : 'yellow'}>{open.length}</Badge>}</> },
        { value: 'history', label: 'Recently uploaded' },
        { value: 'server', label: <>All conflicts {!!status.data?.open_conflicts && <Badge tone="red">{status.data.open_conflicts}</Badge>}</> },
        { value: 'devices', label: 'My devices' },
      ]} />
      {tab === 'queue' && (
        <Card>{open.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">{open.map((i) => <OutboxRow key={i.seq} item={i} onConflict={() => setResolving(i)} onDiscard={() => setDiscarding(i)} />)}</ul>
          : <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Everything is uploaded" message="Changes you make offline appear here until the server confirms them." />}</Card>
      )}
      {tab === 'history' && (
        <Card>{done.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">{done.map((i) => <OutboxRow key={i.seq} item={i} onConflict={() => undefined} onDiscard={() => undefined} />)}</ul>
          : <EmptyState title="Nothing uploaded in the last 7 days" />}</Card>
      )}
      {tab === 'server' && (
        <Card>
          <CardHeader title="Conflicts recorded by the server" subtitle="Yours from every device, and those in units where you oversee synchronisation. Resolve your own from the device that made the change." />
          {!online ? <CardBody className="text-sm text-slate-500">Needs a connection.</CardBody> : !serverConflicts.data?.results.length ? <EmptyState title="No conflicts" /> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {serverConflicts.data.results.map((c) => (
                <li key={c.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{ENTITY_LABEL[c.entity] || c.entity}: {c.label}</span><StatusBadge status={c.status === 'open' ? 'open' : 'resolved'} /></div>
                  <p className="text-xs text-slate-500">{c.user_name}{c.org_unit_name ? ` · ${c.org_unit_name}` : ''} · {dateTime(c.created_at)}{c.device_id === me ? ' · this device' : ''}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{c.reason}{c.resolution ? ` Resolved: ${c.resolution === 'keep_server' ? 'kept the server version' : 're-applied the device version'}${c.resolved_by_name ? ` by ${c.resolved_by_name}` : ''}.` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'devices' && (
        <Card>
          <CardHeader title="Devices that synchronised with your account" subtitle="If you do not recognise a device, change your password; that signs out every device." />
          {!status.data?.devices.length ? <EmptyState title="No devices yet" /> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {status.data.devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span><span className="font-medium">{d.label || d.user_agent.split(') ')[0].replace(/^Mozilla\/5\.0 \(/, '') || 'Browser'}</span>{d.device_id === me && <Badge tone="green" className="ml-2">this device</Badge>}<span className="block text-xs text-slate-500">First seen {dateTime(d.first_seen)}</span></span>
                  <span className="text-xs text-slate-500">Last synchronised {d.last_sync_at ? relative(d.last_sync_at) : 'never'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {resolving && <ConflictDialog item={resolving} onClose={() => setResolving(null)} />}
      <ConfirmDialog open={!!discarding} tone="danger" title="Discard this change?" confirmLabel="Discard"
        message={discarding ? `"${discarding.label}" will be deleted from this device and never uploaded. This cannot be undone.` : ''}
        onConfirm={async () => { if (discarding) await discardChange(discarding.seq!); setDiscarding(null); toast.info('Change discarded.'); }} onClose={() => setDiscarding(null)} />
    </div>
  );
}
