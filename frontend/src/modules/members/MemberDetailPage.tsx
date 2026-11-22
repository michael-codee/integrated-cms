import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRightLeft, Award, CheckCircle2, Circle, Droplets, GraduationCap, Pencil, Trash2, UserCog } from 'lucide-react';
import { api, ApiError, OfflineError } from '@/lib/api';
import { db } from '@/offline/db';
import { submitChange } from '@/offline/repository';
import { useAuth } from '@/app/AuthContext';
import { uuid } from '@/lib/device';
import { Badge, Button, Card, CardBody, ConfirmDialog, DescriptionList, EmptyState, Field, FormError, FormGrid, Input, Modal, PageHeader, PageLoader, Select, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { SyncBadge } from '@/components/SyncBadge';
import { date, dateTime, titleCase, today } from '@/lib/format';
import { MemberForm } from './MemberForm';
import { ClassCompletionModal, DiscipleshipBadge } from './Discipleship';
import { DISCIPLESHIP_CLASSES, type DiscipleshipCompletion, type DiscipleshipCourse, type Member, type Transfer } from './types';

interface HistoryRow { id: string; event: string; changes: Record<string, unknown>; effective_date: string; org_unit_name: string; note: string; by: string | null; created_at: string }
interface Baptism { id: string; date: string; location: string; officiated_by: string; certificate_no: string; org_unit_name: string }

async function loadMember(id: string): Promise<Member> {
  try {
    return await api<Member>(`/members/${id}/`);
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    const rec = await db.records.get(['members', id]);
    if (!rec) throw new ApiError(404, null, 'This member is not stored on this device.');
    const m = rec.data as unknown as Member;
    return { ...m, full_name: m.full_name || [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' '), _sync: rec.syncState };
  }
}

function BaptismModal({ member, open, onClose }: { member: Member; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ date: today(), location: '', officiated_by: '', certificate_no: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!form.date) return setErrors({ date: 'Date is required.' });
    if (form.date > today()) return setErrors({ date: 'Date cannot be in the future.' });
    setBusy(true);
    try {
      const res = await submitChange({ entity: 'baptisms', op: 'action', method: 'POST', url: `/members/${member.id}/baptize/`, body: { ...form, id: uuid() }, recordId: member.id, label: `Baptism of ${member.full_name}` });
      res.state === 'queued' ? toast.offline('Baptism saved on this device; it will sync later.') : toast.success('Baptism recorded.');
      qc.invalidateQueries({ queryKey: ['members'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors({ ...e.fieldErrors, form: e.message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Record baptism — ${member.full_name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <FormError message={errors.form} />
        <FormGrid>
          <Field label="Date" required error={errors.date}><Input type="date" max={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Officiated by"><Input value={form.officiated_by} onChange={(e) => setForm({ ...form, officiated_by: e.target.value })} /></Field>
          <Field label="Certificate no."><Input value={form.certificate_no} onChange={(e) => setForm({ ...form, certificate_no: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </FormGrid>
      </div>
    </Modal>
  );
}

function TransferModal({ member, open, onClose }: { member: Member; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ to_unit: '', reason: '', effective_date: today() });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!form.to_unit) return setError('Choose the receiving branch.');
    if (form.to_unit === member.org_unit) return setError('The member already belongs to that branch.');
    setBusy(true);
    try {
      const res = await api<Transfer>('/member-transfers/', { method: 'POST', body: { member: member.id, ...form } });
      toast.success(res.status === 'completed' ? `Transferred to ${res.to_unit_name}.` : `Transfer requested. ${res.to_unit_name} must approve it.`);
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['transfers'] });
      onClose();
    } catch (e) {
      setError(e instanceof OfflineError ? 'Transfers need an internet connection, because the receiving branch must confirm them.' : (e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Transfer ${member.full_name}`} subtitle={`Currently at ${member.org_unit_name}. The membership record moves; no duplicate is created.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Request transfer</Button></>}>
      <div className="space-y-4">
        <FormError message={error} />
        <Field label="Receiving branch" required hint="Branches outside your jurisdiction are listed by the receiving officers' approval.">
          <ReceivingBranchSelect value={form.to_unit} onChange={(v) => setForm({ ...form, to_unit: v })} exclude={member.org_unit} />
        </Field>
        <Field label="Effective date"><Input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} /></Field>
        <Field label="Reason"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/** Any active branch may receive a member, so this lists all branches (names only). */
function ReceivingBranchSelect({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude: string }) {
  const { data } = useQuery({ queryKey: ['branch-directory'], queryFn: () => api<{ id: string; name: string; district: string }[]>('/org-units/directory/') });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select branch…</option>
      {data?.filter((b) => b.id !== exclude).map((b) => <option key={b.id} value={b.id}>{b.name}{b.district ? ` — ${b.district}` : ''}</option>)}
    </Select>
  );
}

function StatusModal({ member, open, onClose }: { member: Member; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ status: member.status === 'active' ? 'inactive' : 'active', reason: '', effective_date: today() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (['withdrawn', 'deceased'].includes(form.status) && !form.reason.trim()) return setError('Give a reason for the exit.');
    setBusy(true);
    try {
      const res = await submitChange({ entity: 'members', op: 'action', method: 'POST', url: `/members/${member.id}/status/`, body: form, recordId: member.id, label: `Status of ${member.full_name} → ${form.status}` });
      res.state === 'queued' ? toast.offline('Status change saved on this device.') : toast.success('Membership status updated.');
      qc.invalidateQueries({ queryKey: ['members'] });
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change membership status" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <FormError message={error} />
        <Field label="New status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="withdrawn">Withdrawn / exited</option><option value="deceased">Deceased</option>
          </Select>
        </Field>
        <Field label="Effective date"><Input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} /></Field>
        <Field label="Reason / notes"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function DiscipleshipTab({ member, editable, onRecord }: { member: Member; editable: boolean; onRecord: (c: DiscipleshipCourse) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [removing, setRemoving] = useState<DiscipleshipCompletion | null>(null);
  const [reason, setReason] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['discipleship', 'member', member.id],
    queryFn: () => api<{ results: DiscipleshipCompletion[] }>('/discipleship-completions/', { params: { member: member.id } }),
  });
  if (isLoading) return <PageLoader />;
  const byCourse = new Map((data?.results ?? []).map((c) => [c.course, c]));
  const remove = async () => {
    if (!removing) return;
    try {
      await api(`/discipleship-completions/${removing.id}/remove/`, { method: 'POST', body: { reason } });
      toast.success(`${removing.course_name} removed.`);
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['discipleship'] });
    } catch (e) { toast.error((e as Error).message); }
    setRemoving(null); setReason('');
  };
  return (
    <div className="space-y-4">
      {member.discipleship_badge_on ? (
        <div className="flex items-center gap-3 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-sm text-gold-900 dark:border-gold-700 dark:bg-gold-900/30 dark:text-gold-100">
          <Award className="h-8 w-8 shrink-0 text-gold-600 dark:text-gold-300" />
          <div><p className="font-semibold">Badge of discipleship</p><p className="text-xs">Awarded {date(member.discipleship_badge_on)} for completing all three classes.</p></div>
        </div>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">{byCourse.size} of 3 classes completed. The badge of discipleship is awarded automatically when all three are recorded.</p>
      )}
      <ol className="grid gap-3 sm:grid-cols-3">
        {DISCIPLESHIP_CLASSES.map((c, i) => {
          const done = byCourse.get(c.value);
          return (
            <li key={c.value} className={`rounded-xl border p-4 ${done ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
              <p className="flex items-center gap-2 text-sm font-semibold">
                {done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                <span className="text-xs font-normal text-slate-500">{i + 1}.</span> {c.label}
              </p>
              {done ? (
                <div className="mt-2 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                  <p>Completed <b>{date(done.completed_on)}</b> · {done.org_unit_name}</p>
                  {done.facilitator && <p>Facilitator: {done.facilitator}</p>}
                  {done.certificate_no && <p>Certificate: {done.certificate_no}</p>}
                  {done.notes && <p className="italic">{done.notes}</p>}
                  {done.recorded_by && <p>Recorded by {done.recorded_by}</p>}
                  {editable && <Button size="sm" variant="ghost" className="mt-1 -ml-2" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setRemoving(done)}>Remove</Button>}
                </div>
              ) : (
                <div className="mt-2">
                  <p className="text-xs text-slate-500">Not yet completed.</p>
                  {editable && <Button size="sm" variant="secondary" className="mt-2" onClick={() => onRecord(c.value)}>Record completion</Button>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} tone="danger" confirmLabel="Remove"
        title={`Remove ${removing?.course_name ?? 'class'}?`}
        message={member.discipleship_badge_on ? 'Use this only to correct a mistake. The badge of discipleship will be withdrawn until the class is recorded again.' : 'Use this only to correct a mistake.'}>
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
      </ConfirmDialog>
    </div>
  );
}

export default function MemberDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'profile');
  const [modal, setModal] = useState<'edit' | 'baptism' | 'transfer' | 'status' | 'discipleship' | null>(null);
  const [course, setCourse] = useState<DiscipleshipCourse | undefined>();
  const [cancelling, setCancelling] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const { data: m, isLoading, error } = useQuery({ queryKey: ['members', id], queryFn: () => loadMember(id) });
  const history = useQuery({ queryKey: ['members', id, 'history'], queryFn: () => api<HistoryRow[]>(`/members/${id}/history/`), enabled: tab === 'history' });
  const baptisms = useQuery({ queryKey: ['members', id, 'baptisms'], queryFn: () => api<{ results: Baptism[] }>('/baptisms/', { params: { member: id } }), enabled: tab === 'baptisms' });
  const transfers = useQuery({ queryKey: ['transfers', 'member', id], queryFn: () => api<{ results: Transfer[] }>('/member-transfers/', { params: { member: id } }), enabled: tab === 'transfers' });

  if (isLoading) return <PageLoader />;
  if (error || !m) return <EmptyState title="Member not found" message={(error as Error)?.message || 'The record is outside your jurisdiction or does not exist.'} action={<Link className="text-royal-700" to="/members">Back to membership</Link>} />;
  const editable = can('members.edit') && m.status !== 'deceased';

  return (
    <div>
      <PageHeader crumbs={[{ label: 'Home', to: '/' }, { label: 'Membership', to: '/members' }, { label: m.full_name }]}
        title={<span className="flex items-center gap-3">
          {m.photo ? <img src={m.photo} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-gold-400" /> : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-royal-700 text-base font-semibold text-white ring-2 ring-gold-400">{m.first_name?.[0]}{m.last_name?.[0]}</span>}
          <span>{m.full_name}</span>
        </span>}
        subtitle={<span className="flex flex-wrap items-center gap-2">{m.membership_no || 'Membership number assigned on sync'} · {m.org_unit_name} <StatusBadge status={m.status} /> <DiscipleshipBadge on={m.discipleship_badge_on} /> {m.is_demo && <Badge>demo record</Badge>} <SyncBadge state={m._sync} /></span>}
        actions={editable && <>
          <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setModal('edit')}>Edit</Button>
          {m.baptism_status !== 'baptized' && <Button variant="secondary" icon={<Droplets className="h-4 w-4" />} onClick={() => setModal('baptism')}>Record baptism</Button>}
          {!m.discipleship_badge_on && <Button variant="secondary" icon={<GraduationCap className="h-4 w-4" />} onClick={() => { setCourse(undefined); setModal('discipleship'); }}>Record class</Button>}
          {m.status === 'active' && !m.pending_transfer && <Button variant="secondary" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setModal('transfer')}>Transfer</Button>}
          <Button variant="secondary" icon={<UserCog className="h-4 w-4" />} onClick={() => setModal('status')}>Status</Button>
        </>} />
      {m.pending_transfer && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
          <span>Transfer to <b>{m.pending_transfer.to_unit_name}</b> is awaiting approval by the receiving branch.</span>
          {editable && <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>Cancel transfer</Button>}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Profile' }, { value: 'history', label: 'Membership history' },  { value: 'baptisms', label: 'Baptism' }, { value: 'discipleship', label: 'Discipleship' }, { value: 'transfers', label: 'Transfers' }]} />
      <Card>
        <CardBody>
          {tab === 'profile' && (
            <DescriptionList items={[
              { label: 'Gender', value: titleCase(m.gender) },
              { label: 'Date of birth', value: m.date_of_birth ? `${date(m.date_of_birth)}${m.age != null ? ` (age ${m.age})` : ''}` : '—' },
              { label: 'Phone', value: m.phone || '—' },
              { label: 'Email', value: m.email || '—' },
              { label: 'Residential address', value: m.address || '—' },
              { label: 'Marital status', value: titleCase(m.marital_status) || '—' },
              { label: 'Occupation', value: m.occupation || '—' },
              { label: 'Branch', value: m.org_unit_name },
              { label: 'Date joined', value: date(m.joined_on) },
              { label: 'Category', value: m.category_name || '—' },
              { label: 'Baptism', value: m.baptism_status === 'baptized' ? `Baptized ${date(m.baptism_date)}${m.baptism_location ? `, ${m.baptism_location}` : ''}` : 'Not baptized' },
              { label: 'Discipleship', value: m.discipleship_badge_on ? <DiscipleshipBadge on={m.discipleship_badge_on} /> : 'Badge not yet earned' },
              { label: 'Previous affiliation', value: m.previous_affiliation || '—' },
              { label: 'Emergency contact', value: m.emergency_contact_name ? `${m.emergency_contact_name} ${m.emergency_contact_phone}` : '—' },
              { label: 'Photograph consent', value: m.photo_consent ? 'Given' : 'Not given' },
              ...(m.exit_date ? [{ label: 'Exit', value: `${date(m.exit_date)} — ${m.exit_reason}` }] : []),
              { label: 'Notes', value: m.notes || '—' },
            ]} />
          )}
          {tab === 'history' && (history.isLoading ? <PageLoader /> : (
            <ol className="relative space-y-5 border-l border-slate-200 pl-6 dark:border-slate-700">
              {history.data?.map((h) => (
                <li key={h.id}>
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-gold-500 dark:border-slate-900" />
                  <p className="text-sm font-medium">{titleCase(h.event)} <span className="font-normal text-slate-500">· {date(h.effective_date)} · {h.org_unit_name}</span></p>
                  <p className="text-xs text-slate-500">Recorded {dateTime(h.created_at)}{h.by ? ` by ${h.by}` : ''}</p>
                  {h.event !== 'registered' && Object.keys(h.changes).length > 0 && (
                    <ul className="mt-1 text-xs text-slate-600 dark:text-slate-400">{Object.entries(h.changes).map(([k, v]) => <li key={k}><b>{k.replace(/_id$/, '').replace(/_/g, ' ')}</b>: {Array.isArray(v) ? `${v[0] ?? '—'} → ${v[1] ?? '—'}` : String(v)}</li>)}</ul>
                  )}
                  {h.note && <p className="mt-1 text-xs italic text-slate-500">{h.note}</p>}
                </li>
              ))}
            </ol>
          ))}
          {tab === 'baptisms' && (baptisms.data?.results.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">{baptisms.data.results.map((b) => <li key={b.id} className="py-2 text-sm"><b>{date(b.date)}</b> · {b.location || b.org_unit_name}{b.officiated_by ? ` · officiated by ${b.officiated_by}` : ''}{b.certificate_no ? ` · cert. ${b.certificate_no}` : ''}</li>)}</ul>
          ) : <EmptyState title="No baptism recorded" />)}
          {tab === 'discipleship' && <DiscipleshipTab member={m} editable={editable} onRecord={(c) => { setCourse(c); setModal('discipleship'); }} />}
          {tab === 'transfers' && (transfers.data?.results.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">{transfers.data.results.map((t) => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{t.from_unit_name} → <b>{t.to_unit_name}</b> · {date(t.effective_date)}{t.reason ? ` · ${t.reason}` : ''}</span><StatusBadge status={t.status} /></li>)}</ul>
          ) : <EmptyState title="No transfers" />)}
        </CardBody>
      </Card>
      <MemberForm open={modal === 'edit'} onClose={() => setModal(null)} member={m} />
      {modal === 'baptism' && <BaptismModal open member={m} onClose={() => setModal(null)} />}
      {modal === 'discipleship' && <DiscipleshipModalLoader member={m} initial={course} onClose={() => setModal(null)} />}
      {modal === 'transfer' && <TransferModal open member={m} onClose={() => setModal(null)} />}
      {modal === 'status' && <StatusModal open member={m} onClose={() => setModal(null)} />}
      <ConfirmDialog open={cancelling} onClose={() => setCancelling(false)} title="Cancel this transfer?" message="The member stays at their current branch." tone="danger" confirmLabel="Cancel transfer"
        onConfirm={async () => { try { await api(`/member-transfers/${m.pending_transfer!.id}/cancel/`, { method: 'POST' }); qc.invalidateQueries({ queryKey: ['members'] }); toast.success('Transfer cancelled.'); } catch (e) { toast.error((e as Error).message); } setCancelling(false); }} />
    </div>
  );
}

/** Loads which classes are already recorded so the modal only offers the outstanding ones. */
function DiscipleshipModalLoader({ member, initial, onClose }: { member: Member; initial?: DiscipleshipCourse; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['discipleship', 'member', member.id],
    queryFn: () => api<{ results: DiscipleshipCompletion[] }>('/discipleship-completions/', { params: { member: member.id } }),
    retry: false,
  });
  if (isLoading) return null;
  // Offline: offer every class; the server rejects a duplicate when the change syncs.
  const done = isError ? [] : (data?.results ?? []).map((c) => c.course);
  return <ClassCompletionModal open member={member} initial={initial} done={done} onClose={onClose} />;
}
