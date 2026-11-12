import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { uuid } from '@/lib/device';
import { submitChange } from '@/offline/repository';
import { Button, Checkbox, Field, FormError, FormGrid, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { useDepartments } from '@/modules/departments/useDepartments';
import type { Program } from './types';

/** ISO string → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const FIELDS = ['title', 'category', 'org_unit', 'department', 'description', 'venue', 'starts_at', 'ends_at', 'coordinator', 'speakers', 'expected_attendance', 'budget_amount'] as const;
type F = Record<(typeof FIELDS)[number], string> & { is_public: boolean };

export function ProgramForm({ program, initialStart, onClose, onSaved }: { program?: Program | null; initialStart?: Date; onClose: () => void; onSaved?: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const cats = useLookup('program-categories');
  const start = initialStart ? new Date(initialStart) : null;
  if (start && start.getHours() === 0) start.setHours(10);
  const [f, setF] = useState<F>(() => program ? {
    ...(Object.fromEntries(FIELDS.map((k) => [k, program[k as keyof Program] == null ? '' : String(program[k as keyof Program])])) as Record<(typeof FIELDS)[number], string>),
    starts_at: toLocalInput(program.starts_at), ends_at: toLocalInput(program.ends_at), is_public: program.is_public,
  } : {
    ...(Object.fromEntries(FIELDS.map((k) => [k, ''])) as Record<(typeof FIELDS)[number], string>),
    budget_amount: '0', is_public: false,
    starts_at: start ? toLocalInput(start.toISOString()) : '', ends_at: start ? toLocalInput(new Date(start.getTime() + 3 * 3600e3).toISOString()) : '',
  });
  const depts = useDepartments(f.org_unit, !!f.org_unit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof F, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = 'Give the program a title.';
    if (!f.category) e.category = 'Choose a category.';
    if (!f.org_unit) e.org_unit = 'Choose the organising unit.';
    if (!f.starts_at) e.starts_at = 'When does it start?';
    if (!f.ends_at) e.ends_at = 'When does it end?';
    if (f.starts_at && f.ends_at && f.ends_at < f.starts_at) e.ends_at = 'The end must be after the start.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      ...f, department: f.department || null, expected_attendance: f.expected_attendance === '' ? null : Number(f.expected_attendance),
      starts_at: new Date(f.starts_at).toISOString(), ends_at: new Date(f.ends_at).toISOString(), budget_amount: f.budget_amount || '0',
    };
    if (program) delete body.org_unit;
    const id = program?.id || uuid();
    try {
      const res = await submitChange<Program>({
        entity: 'programs', op: program ? 'update' : 'create', method: program ? 'PATCH' : 'POST', url: program ? `/programs/${id}/` : '/programs/',
        body: program ? body : { ...body, id, client_created_at: new Date().toISOString() }, recordId: id, baseVersion: program?.version,
        label: `${program ? 'Update' : 'Plan'} program ${f.title}`,
      });
      if (res.state === 'queued') toast.offline('Saved on this device. It will upload when you are back online.');
      else toast.success(program ? 'Program updated.' : 'Program added to the calendar.');
      qc.invalidateQueries({ queryKey: ['programs'] });
      onSaved?.(id);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={program ? `Edit ${program.title}` : 'Plan a program or event'} subtitle="Services, crusades, conferences, revivals, outreach and fellowship meetings"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{program ? 'Save changes' : 'Add to calendar'}</Button></>}>
      <FormError message={errors.form} />
      <FormGrid cols={2}>
        <Field label="Title" required error={errors.title}><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Easter crusade" /></Field>
        <Field label="Category" required error={errors.category}>
          <Select value={f.category} onChange={(e) => set('category', e.target.value)} invalid={!!errors.category}>
            <option value="">Choose category</option>{(cats.data || []).filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {!program && <Field label="Organising unit" required error={errors.org_unit}><UnitSelect value={f.org_unit} onChange={(v) => { set('org_unit', v); set('department', ''); }} placeholder="Choose unit" invalid={!!errors.org_unit} /></Field>}
        <Field label="Ministry / department" hint="Leave blank for a whole-church program" error={errors.department}>
          <Select value={f.department} onChange={(e) => set('department', e.target.value)} disabled={!f.org_unit}>
            <option value="">Whole church</option>{(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Starts" required error={errors.starts_at}><Input type="datetime-local" value={f.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></Field>
        <Field label="Ends" required error={errors.ends_at}><Input type="datetime-local" value={f.ends_at} min={f.starts_at} onChange={(e) => set('ends_at', e.target.value)} /></Field>
        <Field label="Venue"><Input value={f.venue} onChange={(e) => set('venue', e.target.value)} /></Field>
        <Field label="Coordinator"><Input value={f.coordinator} onChange={(e) => set('coordinator', e.target.value)} /></Field>
        <Field label="Speakers / ministers"><Input value={f.speakers} onChange={(e) => set('speakers', e.target.value)} /></Field>
        <Field label="Expected attendance" error={errors.expected_attendance}><Input type="number" min="0" value={f.expected_attendance} onChange={(e) => set('expected_attendance', e.target.value)} /></Field>
        <Field label="Budget (SLE)" error={errors.budget_amount}><Input type="number" min="0" step="0.01" value={f.budget_amount} onChange={(e) => set('budget_amount', e.target.value)} /></Field>
        <div className="flex items-end pb-2"><Checkbox label="Open to every unit (e.g. national convention)" checked={f.is_public} onChange={(e) => set('is_public', e.target.checked)} /></div>
      </FormGrid>
      <Field label="Description" className="mt-4"><Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
    </Modal>
  );
}
