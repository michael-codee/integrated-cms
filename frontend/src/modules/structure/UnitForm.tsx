import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { OrgUnit } from '@/app/types';
import { Button, Field, FormError, FormGrid, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { useLevelLabels, useOrgUnits, useStructureLevels } from '@/lib/queries';
import type { StructureLevel } from '@/app/types';

const NO_LEVELS: StructureLevel[] = [];

/** The active level directly below ``code`` (e.g. district → branch), if any. */
export function childLevel(levels: StructureLevel[], code: string): StructureLevel | undefined {
  const rank = levels.find((l) => l.code === code)?.rank;
  if (rank === undefined) return undefined;
  return levels.filter((l) => l.is_active && l.rank > rank).sort((a, b) => a.rank - b.rank)[0];
}

type FormState = Partial<Record<keyof OrgUnit, string>>;

export function UnitForm({ open, onClose, unit, parent }: { open: boolean; onClose: () => void; unit?: OrgUnit | null; parent?: OrgUnit | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: units = [] } = useOrgUnits();
  const levels = useStructureLevels().data || NO_LEVELS;
  const UNIT_LABELS = useLevelLabels();
  const rank = (code?: string) => levels.find((l) => l.code === code)?.rank ?? 999;
  const [form, setForm] = useState<FormState>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (unit) {
      setForm(Object.fromEntries(Object.entries(unit).map(([k, v]) => [k, v == null ? '' : String(v)])) as FormState);
    } else {
      setForm({
        unit_type: (parent && childLevel(levels, parent.unit_type)?.code) || 'branch',
        parent: parent?.id || '',
        status: 'active',
        country: parent?.country || 'Sierra Leone',
        province: parent?.province || '',
        civil_district: parent?.civil_district || '',
      });
    }
  }, [open, unit, parent, levels]);

  const set = (k: keyof OrgUnit) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const possibleParents = units.filter((u) => rank(u.unit_type) < rank(form.unit_type || 'branch') && (!unit || !u.path.startsWith(unit.path)));

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unit ? api<OrgUnit>(`/org-units/${unit.id}/`, { method: 'PATCH', body }) : api<OrgUnit>('/org-units/', { method: 'POST', body }),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['org-units'] });
      toast.success(unit ? `${saved.name} updated.` : `${saved.name} created with code ${saved.code}.`);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: err.message });
      else toast.error('Could not save. Structure changes require an internet connection.');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name?.trim()) errs.name = 'Name is required.';
    if (form.unit_type !== 'headquarters' && !form.parent) errs.parent = 'Choose the unit this one belongs to.';
    const lat = form.latitude ? Number(form.latitude) : null;
    const lng = form.longitude ? Number(form.longitude) : null;
    if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) errs.latitude = 'Latitude must be between -90 and 90.';
    if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) errs.longitude = 'Longitude must be between -180 and 180.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) errs.email = 'Enter a valid email address.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body: Record<string, unknown> = {};
    for (const k of ['name', 'code', 'unit_type', 'parent', 'status', 'established_on', 'country', 'province', 'civil_district', 'chiefdom', 'town', 'address', 'latitude', 'longitude', 'phone', 'email', 'notes'] as const) {
      const v = form[k];
      body[k] = v === '' || v === undefined ? (['established_on', 'latitude', 'longitude', 'parent'].includes(k) ? null : '') : v;
    }
    if (lat !== null) body.latitude = lat.toFixed(6);
    if (lng !== null) body.longitude = lng.toFixed(6);
    mutation.mutate(body);
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={unit ? `Edit ${unit.name}` : 'Add church unit'}
      subtitle={unit ? `${UNIT_LABELS[unit.unit_type]} · ${unit.code}` : 'Branches and other units can be added at any time. The levels themselves are set under Structure levels.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={mutation.isPending}>{unit ? 'Save changes' : 'Create unit'}</Button></>}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <FormError message={errors.form && !Object.keys(errors).some((k) => k !== 'form') ? errors.form : null} />
        <FormGrid>
          <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input value={form.name || ''} onChange={set('name')} placeholder="e.g. Makeni Branch" /></Field>
          <Field label="Type" required error={errors.unit_type}>
            <Select value={form.unit_type || ''} onChange={set('unit_type')} disabled={!!unit}>
              {levels.filter((l) => (l.is_active && l.code !== 'headquarters') || l.code === unit?.unit_type).map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Code" error={errors.code} hint={unit ? undefined : 'Leave blank to generate automatically.'}><Input value={form.code || ''} onChange={set('code')} placeholder="BR-MAK-001" /></Field>
          {form.unit_type !== 'headquarters' && (
            <Field label="Belongs to" required error={errors.parent} className="sm:col-span-2">
              <Select value={form.parent || ''} onChange={set('parent')}>
                <option value="">Select…</option>
                {possibleParents.map((u) => <option key={u.id} value={u.id}>{'— '.repeat(u.depth)}{u.name} ({UNIT_LABELS[u.unit_type]})</option>)}
              </Select>
            </Field>
          )}
          <Field label="Status" error={errors.status}>
            <Select value={form.status || 'active'} onChange={set('status')}>
              <option value="active">Active</option><option value="inactive">Inactive</option><option value="planned">Planned / expansion</option>
            </Select>
          </Field>
          <Field label="Date established" error={errors.established_on}><Input type="date" value={form.established_on || ''} onChange={set('established_on')} /></Field>
        </FormGrid>
        <fieldset>
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Location</legend>
          <FormGrid cols={3}>
            <Field label="Country"><Input value={form.country || ''} onChange={set('country')} /></Field>
            <Field label="Province"><Input value={form.province || ''} onChange={set('province')} /></Field>
            <Field label="District (civil)"><Input value={form.civil_district || ''} onChange={set('civil_district')} /></Field>
            <Field label="Chiefdom / area"><Input value={form.chiefdom || ''} onChange={set('chiefdom')} /></Field>
            <Field label="Town / city"><Input value={form.town || ''} onChange={set('town')} /></Field>
            <Field label="Physical address"><Input value={form.address || ''} onChange={set('address')} /></Field>
            <Field label="Latitude" error={errors.latitude} hint="Optional, for the branch map"><Input inputMode="decimal" value={form.latitude || ''} onChange={set('latitude')} placeholder="8.6439" /></Field>
            <Field label="Longitude" error={errors.longitude}><Input inputMode="decimal" value={form.longitude || ''} onChange={set('longitude')} placeholder="-10.9711" /></Field>
          </FormGrid>
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</legend>
          <FormGrid>
            <Field label="Phone"><Input value={form.phone || ''} onChange={set('phone')} /></Field>
            <Field label="Email" error={errors.email}><Input type="email" value={form.email || ''} onChange={set('email')} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={form.notes || ''} onChange={set('notes')} /></Field>
          </FormGrid>
        </fieldset>
      </form>
    </Modal>
  );
}
