import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError, type Page } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { submitChange } from '@/offline/repository';
import { uuid } from '@/lib/device';
import { date, today } from '@/lib/format';
import { Button, Checkbox, Field, FormError, FormGrid, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { DISCIPLESHIP_CLASSES, type DiscipleshipCourse, type DiscipleshipRow } from './types';

/** The badge of discipleship: earned by completing Foundation, Discipleship and Spiritual Growth classes. */
export function DiscipleshipBadge({ on, compact = false, className }: { on: string | null | undefined; compact?: boolean; className?: string }) {
  if (!on) return null;
  const title = `Badge of discipleship, earned ${date(on)}`;
  if (compact) {
    return <span title={title} role="img" aria-label={title} className={clsx('inline-flex shrink-0 text-gold-600 dark:text-gold-400', className)}><Award className="h-4 w-4" /></span>;
  }
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gold-100 px-2.5 py-0.5 text-xs font-semibold text-gold-900 ring-1 ring-inset ring-gold-500/40 dark:bg-gold-900/40 dark:text-gold-100', className)}>
      <Award className="h-3.5 w-3.5" /> Badge of discipleship
    </span>
  );
}

interface Target { id: string; full_name: string }

/** Record that a member completed one of the three classes. Works offline (queued like baptisms). */
export function ClassCompletionModal({ member, done, initial, open, onClose }: {
  member: Target; done: DiscipleshipCourse[]; initial?: DiscipleshipCourse; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const remaining = DISCIPLESHIP_CLASSES.filter((c) => !done.includes(c.value));
  const [form, setForm] = useState({ course: initial && !done.includes(initial) ? initial : (remaining[0]?.value ?? ''), completed_on: today(), facilitator: '', certificate_no: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!form.course) return setErrors({ course: 'Choose the class.' });
    if (!form.completed_on) return setErrors({ completed_on: 'Date is required.' });
    if (form.completed_on > today()) return setErrors({ completed_on: 'Date cannot be in the future.' });
    setBusy(true);
    const label = DISCIPLESHIP_CLASSES.find((c) => c.value === form.course)?.label ?? 'Class';
    try {
      const res = await submitChange({ entity: 'discipleship', op: 'action', method: 'POST', url: `/members/${member.id}/discipleship/`, body: { ...form, id: uuid() }, recordId: member.id, label: `${label}: ${member.full_name}` });
      const earnsBadge = remaining.length === 1;
      if (res.state === 'queued') toast.offline(`${label} saved on this device; it will sync later.`);
      else toast.success(earnsBadge ? `${label} recorded. ${member.full_name} has earned the badge of discipleship!` : `${label} recorded.`);
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['discipleship'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors({ ...e.fieldErrors, form: e.message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Record class completion — ${member.full_name}`}
      subtitle="Completing all three classes awards the badge of discipleship automatically."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={!remaining.length}>Save</Button></>}>
      <div className="space-y-4">
        <FormError message={errors.form} />
        {!remaining.length ? <p className="text-sm">All three classes are already recorded.</p> : (
          <FormGrid>
            <Field label="Class" required error={errors.course}>
              <Select value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value as DiscipleshipCourse })}>
                {remaining.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Date completed" required error={errors.completed_on}><Input type="date" max={today()} value={form.completed_on} onChange={(e) => setForm({ ...form, completed_on: e.target.value })} /></Field>
            <Field label="Facilitator / teacher"><Input value={form.facilitator} onChange={(e) => setForm({ ...form, facilitator: e.target.value })} /></Field>
            <Field label="Certificate no."><Input value={form.certificate_no} onChange={(e) => setForm({ ...form, certificate_no: e.target.value })} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </FormGrid>
        )}
      </div>
    </Modal>
  );
}

/** Register a disciple: pick a member, tick the class or classes they completed, and give each a date. */
export function RegisterDiscipleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const [member, setMember] = useState<DiscipleshipRow | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [dates, setDates] = useState<Partial<Record<DiscipleshipCourse, string>>>({});
  const [extra, setExtra] = useState({ facilitator: '', certificate_no: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const matches = useQuery({
    queryKey: ['discipleship', 'pick', memberQuery], enabled: open && !member && memberQuery.trim().length >= 2 && online,
    queryFn: () => api<Page<DiscipleshipRow>>('/discipleship-register/', { params: { search: memberQuery.trim(), status: 'active' } }),
  });
  const done = (c: (typeof DISCIPLESHIP_CLASSES)[number]) => member?.[c.field] ?? null;
  const ticked = DISCIPLESHIP_CLASSES.filter((c) => dates[c.value] !== undefined);
  const outstanding = member ? DISCIPLESHIP_CLASSES.filter((c) => !done(c)) : [];
  const toggle = (c: DiscipleshipCourse, on: boolean) => setDates((d) => {
    const next = { ...d };
    if (on) next[c] = today(); else delete next[c];
    return next;
  });
  const pick = (m: DiscipleshipRow) => { setMember(m); setMemberQuery(`${m.full_name}${m.membership_no ? ` (${m.membership_no})` : ''}`); setDates({}); setErrors({}); };

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!member) errs.member = 'Choose the member.';
    if (!ticked.length) errs.classes = 'Tick at least one class completed.';
    for (const c of ticked) {
      const d = dates[c.value];
      if (!d) errs[c.value] = 'Enter the date.';
      else if (d > today()) errs[c.value] = 'Date cannot be in the future.';
    }
    setErrors(errs);
    if (Object.keys(errs).length || !member) return;
    setBusy(true);
    try {
      const body = { member: member.id, classes: ticked.map((c) => ({ course: c.value, completed_on: dates[c.value], id: uuid() })), ...extra };
      const res = await submitChange({ entity: 'discipleship', op: 'action', method: 'POST', url: '/discipleship-register/register/', body, recordId: member.id, label: `Register disciple: ${member.full_name}` });
      const earnsBadge = ticked.length === outstanding.length;
      if (res.state === 'queued') toast.offline('Saved on this device; it will sync later.');
      else toast.success(earnsBadge ? `${member.full_name} is registered and has earned the badge of discipleship!` : `${member.full_name} is registered in the discipleship register.`);
      qc.invalidateQueries({ queryKey: ['discipleship'] });
      qc.invalidateQueries({ queryKey: ['members'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors({ ...e.fieldErrors, form: e.message });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Register disciple"
      subtitle="Choose the member and tick the class or classes they have completed. The badge of discipleship is awarded when all three are recorded."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={!!member && !outstanding.length}>Register</Button></>}>
      <div className="space-y-5">
        <FormError message={errors.form} />
        <Field label="Member" required error={errors.member} hint={online ? 'Type at least two letters of a name or membership number' : 'Member search needs a connection'}>
          <div className="space-y-1">
            <Input value={memberQuery} onChange={(e) => { setMemberQuery(e.target.value); setMember(null); }} placeholder="Search members" disabled={!online} invalid={!!errors.member} autoFocus />
            {member && <p className="text-xs text-emerald-700 dark:text-emerald-400">{member.full_name} · {member.org_unit_name}</p>}
            {!member && matches.data && matches.data.results.length > 0 && (
              <ul className="max-h-48 overflow-auto rounded-lg border border-slate-200 text-sm dark:border-slate-700">
                {matches.data.results.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => pick(m)}>
                      <span>{m.full_name} <span className="text-xs text-slate-500">{m.membership_no} · {m.org_unit_name}</span></span>
                      <span className="text-xs text-slate-500">{m.discipleship_badge_on ? 'badge earned' : `${m.classes_completed} of 3`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!member && matches.data && matches.data.results.length === 0 && memberQuery.trim().length >= 2 && <p className="text-xs text-slate-500">No active member found in your units.</p>}
          </div>
        </Field>

        <fieldset disabled={!member} className="space-y-2 disabled:opacity-60">
          <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Classes completed <span className="text-red-600">*</span></legend>
          {DISCIPLESHIP_CLASSES.map((c) => {
            const already = done(c);
            const on = dates[c.value] !== undefined;
            return (
              <div key={c.value} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="min-w-[13rem] flex-1">
                  {already
                    ? <span className="text-sm text-emerald-700 dark:text-emerald-400">✓ {c.label} <span className="text-xs text-slate-500">already recorded {date(already)}</span></span>
                    : <Checkbox label={c.label} checked={on} onChange={(e) => toggle(c.value, e.target.checked)} />}
                </div>
                {on && !already && (
                  <div className="w-44">
                    <Input type="date" aria-label={`${c.label} date completed`} max={today()} value={dates[c.value] ?? ''} invalid={!!errors[c.value]}
                      onChange={(e) => setDates((d) => ({ ...d, [c.value]: e.target.value }))} />
                    {errors[c.value] && <p className="mt-1 text-xs text-red-600">{errors[c.value]}</p>}
                  </div>
                )}
              </div>
            );
          })}
          {errors.classes && <p className="text-xs text-red-600">{errors.classes}</p>}
          {member && !outstanding.length && <p className="text-sm text-gold-800 dark:text-gold-200">This member has already completed all three classes.</p>}
          {member && outstanding.length > 0 && ticked.length === outstanding.length && <DiscipleshipBadge on={today()} className="mt-1" />}
        </fieldset>

        <FormGrid>
          <Field label="Facilitator / teacher"><Input value={extra.facilitator} onChange={(e) => setExtra({ ...extra, facilitator: e.target.value })} /></Field>
          <Field label="Certificate no."><Input value={extra.certificate_no} onChange={(e) => setExtra({ ...extra, certificate_no: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={extra.notes} onChange={(e) => setExtra({ ...extra, notes: e.target.value })} /></Field>
        </FormGrid>
      </div>
    </Modal>
  );
}
