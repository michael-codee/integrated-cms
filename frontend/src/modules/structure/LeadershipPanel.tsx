import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserMinus } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import type { OrgUnit } from '@/app/types';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, FormError, FormGrid, Input, Modal, PageLoader, Select, Textarea, useToast } from '@/components/ui';
import { date, today } from '@/lib/format';

interface Position { id: string; code: string; title: string; unit_type: string; grants_role_name: string | null; is_head: boolean; is_active: boolean }
interface Appointment { id: string; position: string; position_title: string; is_head: boolean; person_name: string; user: string | null; user_name: string | null; starts_on: string; ends_on: string | null; status: string; appointed_by: string; end_reason: string }
interface UserLite { id: string; full_name: string; username: string }

export function LeadershipPanel({ unit }: { unit: OrgUnit }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<Appointment | null>(null);
  const [reason, setReason] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['appointments', unit.id], queryFn: () => api<Page<Appointment>>('/appointments/', { params: { org_unit: unit.id, page_size: 100 } }) });
  if (isLoading) return <PageLoader />;
  const active = data?.results.filter((a) => a.status === 'active') || [];
  const past = data?.results.filter((a) => a.status !== 'active') || [];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Current leadership</h4>
        {can('leadership.create') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Appoint</Button>}
      </div>
      {active.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {active.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gold-700 dark:text-gold-300">{a.position_title}</p>
                <p className="font-medium text-slate-900 dark:text-white">{a.person_name}</p>
                <p className="text-xs text-slate-500">Since {date(a.starts_on)}{a.appointed_by ? ` · appointed by ${a.appointed_by}` : ''}</p>
                {a.user_name && <Badge tone="blue" className="mt-1">system access granted</Badge>}
              </div>
              {can('leadership.edit') && <Button size="sm" variant="ghost" icon={<UserMinus className="h-4 w-4" />} onClick={() => setEnding(a)}>End</Button>}
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No leaders recorded" message="Record the Pastor-in-Charge and other officers for this unit." />}
      {past.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Leadership history</h4>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {past.map((a) => <li key={a.id} className="py-2"><b>{a.position_title}</b>: {a.person_name} · {date(a.starts_on)} – {date(a.ends_on)}{a.end_reason ? ` · ${a.end_reason}` : ''}</li>)}
          </ul>
        </div>
      )}
      {adding && <AppointModal unit={unit} current={active} onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!ending} onClose={() => setEnding(null)} title={`End ${ending?.person_name}'s appointment?`} tone="danger" confirmLabel="End appointment"
        message="Any system access granted by this appointment is revoked. The record is kept in the leadership history."
        onConfirm={async () => {
          try { await api(`/appointments/${ending!.id}/end/`, { method: 'POST', body: { reason } }); qc.invalidateQueries({ queryKey: ['appointments'] }); toast.success('Appointment ended.'); } catch (e) { toast.error((e as Error).message); }
          setEnding(null); setReason('');
        }}>
        <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}

function AppointModal({ unit, current, onClose }: { unit: OrgUnit; current: Appointment[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const positions = useQuery({ queryKey: ['positions'], queryFn: () => api<Position[]>('/leadership-positions/') });
  const users = useQuery({ queryKey: ['users', 'lite'], queryFn: () => api<Page<UserLite>>('/users/', { params: { page_size: 200, status: 'active' } }).then((p) => p.results).catch(() => []) });
  const [form, setForm] = useState({ position: '', person_name: '', user: '', starts_on: today(), appointed_by: '', notes: '', replace_current: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = positions.data?.filter((p) => p.is_active && (!p.unit_type || p.unit_type === unit.unit_type)) || [];
  const selected = options.find((p) => p.id === form.position);
  const holder = selected?.is_head ? current.find((a) => a.position === selected.id) : undefined;
  const save = async () => {
    if (!form.position) return setError('Choose the office.');
    if (!form.person_name && !form.user) return setError("Enter the appointee's name or choose their user account.");
    setBusy(true);
    try {
      await api('/appointments/', { method: 'POST', body: { ...form, user: form.user || null, org_unit: unit.id } });
      toast.success('Appointment recorded.');
      qc.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save (an internet connection is required).'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Appoint a leader — ${unit.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{holder ? 'Replace and appoint' : 'Appoint'}</Button></>}>
      <div className="space-y-4">
        <FormError message={error} />
        <FormGrid>
          <Field label="Office" required className="sm:col-span-2">
            <Select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
              <option value="">Select…</option>{options.map((p) => <option key={p.id} value={p.id}>{p.title}{p.grants_role_name ? ` (grants ${p.grants_role_name} access)` : ''}</option>)}
            </Select>
          </Field>
          <Field label="User account (optional)" hint={selected?.grants_role_name ? `Grants ${selected.grants_role_name} access to ${unit.name}.` : 'Link if the appointee uses the system.'}>
            <Select value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })}>
              <option value="">—</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>)}
            </Select>
          </Field>
          <Field label="Appointee name" hint="As on the appointment letter"><Input value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} /></Field>
          <Field label="Start date"><Input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></Field>
          <Field label="Appointed / authorised by"><Input value={form.appointed_by} onChange={(e) => setForm({ ...form, appointed_by: e.target.value })} placeholder="General Overseer" /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </FormGrid>
        {holder && (
          <div className="rounded-lg bg-gold-50 p-3 text-sm text-gold-900 dark:bg-gold-900/30 dark:text-gold-100">
            {holder.person_name} currently holds this office.
            <div className="mt-2"><Checkbox label="End their appointment and transfer the responsibility" checked={form.replace_current} onChange={(e) => setForm({ ...form, replace_current: e.target.checked })} /></div>
          </div>
        )}
      </div>
    </Modal>
  );
}
