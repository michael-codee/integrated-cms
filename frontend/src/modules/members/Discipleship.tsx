import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Award } from 'lucide-react';
import clsx from 'clsx';
import { ApiError } from '@/lib/api';
import { submitChange } from '@/offline/repository';
import { uuid } from '@/lib/device';
import { date, today } from '@/lib/format';
import { Button, Field, FormError, FormGrid, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { DISCIPLESHIP_CLASSES, type DiscipleshipCourse } from './types';

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
