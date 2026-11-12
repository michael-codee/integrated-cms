import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Field, FormError, FormGrid, Input, Modal, PageHeader, PageLoader, Select, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { dateTime } from '@/lib/format';
import { toLocalInput } from '@/modules/programs/ProgramForm';
import type { Announcement } from './types';

function AnnouncementForm({ item, onClose }: { item?: Announcement | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ org_unit: item?.org_unit || '', title: item?.title || '', body: item?.body || '', priority: item?.priority || 'normal', publish_at: toLocalInput(item?.publish_at || new Date().toISOString()), expires_at: toLocalInput(item?.expires_at), is_pinned: item?.is_pinned || false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.org_unit) e.org_unit = 'Choose who should see it.';
    if (!f.title.trim()) e.title = 'Add a title.';
    if (!f.body.trim()) e.body = 'Write the announcement.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = { ...f, publish_at: new Date(f.publish_at).toISOString(), expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : null };
      await api(item ? `/announcements/${item.id}/` : '/announcements/', { method: item ? 'PATCH' : 'POST', body });
      toast.success(item ? 'Announcement updated.' : 'Announcement published.');
      qc.invalidateQueries({ queryKey: ['announcements'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={item ? 'Edit announcement' : 'New announcement'} subtitle="Shown to the chosen unit and every unit under it"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{item ? 'Save' : 'Publish'}</Button></>}>
      <FormError message={errors.form} />
      <FormGrid>
        <Field label="Audience" required error={errors.org_unit}><UnitSelect value={f.org_unit} onChange={(v) => setF({ ...f, org_unit: v })} placeholder="Choose unit" invalid={!!errors.org_unit} /></Field>
        <Field label="Priority" hint="Important and urgent announcements also send a notification."><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Announcement['priority'] })}><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></Select></Field>
      </FormGrid>
      <Field label="Title" required error={errors.title} className="mt-4"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Message" required error={errors.body} className="mt-4"><Textarea rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      <FormGrid>
        <Field label="Publish from" className="mt-4" error={errors.publish_at}><Input type="datetime-local" value={f.publish_at} onChange={(e) => setF({ ...f, publish_at: e.target.value })} /></Field>
        <Field label="Remove after (optional)" className="mt-4" error={errors.expires_at}><Input type="datetime-local" min={f.publish_at} value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></Field>
      </FormGrid>
      <div className="mt-4"><Checkbox label="Pin to the top" checked={f.is_pinned} onChange={(e) => setF({ ...f, is_pinned: e.target.checked })} /></div>
    </Modal>
  );
}

export function AnnouncementCard({ a, actions }: { a: Announcement; actions?: React.ReactNode }) {
  return (
    <article className={clsx('rounded-xl p-4 ring-1', a.priority === 'urgent' ? 'bg-red-50/60 ring-red-200 dark:bg-red-950/30 dark:ring-red-900' : a.priority === 'important' ? 'bg-gold-50/60 ring-gold-200 dark:bg-gold-900/20 dark:ring-gold-800' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-800')}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">{a.is_pinned && <Pin className="h-3.5 w-3.5 text-gold-600" aria-label="Pinned" />}{a.title}</h3>
        <div className="flex items-center gap-1">{a.priority !== 'normal' && <StatusBadge status={a.priority} label={a.priority} />}{actions}</div>
      </header>
      <p className="mt-2 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{a.body}</p>
      <p className="mt-3 text-xs text-slate-500">{a.org_unit_name} · {dateTime(a.publish_at)}{a.author ? ` · ${a.author}` : ''}{a.expires_at ? ` · until ${dateTime(a.expires_at)}` : ''}</p>
    </article>
  );
}

export default function AnnouncementsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canPublish = can('notifications.create');
  const [tab, setTab] = useState<'current' | 'manage'>('current');
  const [editing, setEditing] = useState<Announcement | true | null>(null);
  const [removing, setRemoving] = useState<Announcement | null>(null);
  const q = useQuery({ queryKey: ['announcements', tab], queryFn: () => api<Page<Announcement>>('/announcements/', { params: { manage: tab === 'manage' ? true : undefined, page_size: 100, ordering: '-publish_at' } }) });
  const remove = async () => {
    if (!removing) return;
    try { await api(`/announcements/${removing.id}/`, { method: 'DELETE' }); toast.success('Announcement withdrawn.'); qc.invalidateQueries({ queryKey: ['announcements'] }); }
    catch (e) { toast.error((e as Error).message); } finally { setRemoving(null); }
  };
  const now = new Date();
  const items = (q.data?.results || []).slice().sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.publish_at.localeCompare(a.publish_at));
  return (
    <div>
      <PageHeader title="Announcements" subtitle="Messages from headquarters, regions, districts and your branch." crumbs={[{ label: 'Home', to: '/' }, { label: 'Announcements' }]}
        actions={canPublish && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(true)}>New announcement</Button>} />
      {canPublish && <Tabs value={tab} onChange={setTab} tabs={[{ value: 'current', label: 'For me' }, { value: 'manage', label: 'Published by my units' }]} />}
      {q.isLoading ? <PageLoader /> : !items.length ? <Card><EmptyState icon={<Megaphone className="h-6 w-6" />} title="No announcements" message={tab === 'manage' ? 'Announcements you publish appear here.' : 'There are no current announcements for you.'} /></Card> : (
        <div className="space-y-3">
          {items.map((a) => (
            <AnnouncementCard key={a.id} a={a} actions={tab === 'manage' && <>
              {new Date(a.publish_at) > now && <Badge tone="blue">scheduled</Badge>}
              {a.expires_at && new Date(a.expires_at) < now && <Badge>expired</Badge>}
              <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setRemoving(a)} aria-label="Withdraw"><Trash2 className="h-3.5 w-3.5" /></Button>
            </>} />
          ))}
        </div>
      )}
      {editing && <AnnouncementForm item={editing === true ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} title="Withdraw announcement" message="It will no longer be shown to anyone." confirmLabel="Withdraw" tone="danger" onConfirm={remove} onClose={() => setRemoving(null)} />
    </div>
  );
}
