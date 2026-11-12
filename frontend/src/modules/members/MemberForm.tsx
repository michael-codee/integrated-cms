import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { uuid } from '@/lib/device';
import { submitChange } from '@/offline/repository';
import { Button, Checkbox, Field, FormError, FormGrid, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { today } from '@/lib/format';
import { useAuth } from '@/app/AuthContext';
import type { Member } from './types';

const FIELDS = ['first_name', 'middle_name', 'last_name', 'gender', 'date_of_birth', 'phone', 'email', 'address', 'org_unit', 'joined_on',
  'previous_affiliation', 'category', 'baptism_status', 'baptism_date', 'baptism_location', 'marital_status', 'occupation',
  'emergency_contact_name', 'emergency_contact_phone', 'photo_consent', 'notes'] as const;
type F = Record<(typeof FIELDS)[number], string | boolean>;

export function MemberForm({ open, onClose, member, onSaved }: { open: boolean; onClose: () => void; member?: Member | null; onSaved?: (m: Record<string, unknown>) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { data: categories = [] } = useLookup('membership-categories');
  const [form, setForm] = useState<F>({} as F);
  const [photo, setPhoto] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<{ matches: Member[]; outside_jurisdiction: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({}); setDups(null); setPhoto(null);
    const defaultUnit = user?.assignments.find((a) => ['branch', 'congregation'].includes(a.org_unit_type))?.org_unit || '';
    const init = Object.fromEntries(FIELDS.map((k) => [k, ''])) as F;
    setForm(member ? { ...init, ...Object.fromEntries(FIELDS.map((k) => [k, member[k as keyof Member] ?? ''])) } as F
      : { ...init, gender: '', org_unit: defaultUnit, joined_on: today(), baptism_status: 'not_baptized', photo_consent: false });
  }, [open, member, user]);

  const set = (k: keyof F) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!String(form.first_name).trim()) e.first_name = 'First name is required.';
    if (!String(form.last_name).trim()) e.last_name = 'Last name is required.';
    if (!form.gender) e.gender = 'Select gender.';
    if (!form.org_unit) e.org_unit = 'Select the branch.';
    if (form.date_of_birth && String(form.date_of_birth) > today()) e.date_of_birth = 'Date of birth cannot be in the future.';
    if (form.joined_on && String(form.joined_on) > today()) e.joined_on = 'Date joined cannot be in the future.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(String(form.email))) e.email = 'Enter a valid email address.';
    if (form.phone && !/^[+\d][\d\s-]{5,}$/.test(String(form.phone))) e.phone = 'Enter a valid phone number.';
    if (!member && form.baptism_status === 'baptized' && !form.baptism_date) e.baptism_date = 'Enter the baptism date.';
    if (photo && !form.photo_consent) e.photo = 'Record the member’s consent before adding a photograph.';
    if (photo && photo.size > 3 * 1024 * 1024) e.photo = 'Photographs must be smaller than 3 MB.';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async (skipDupCheck = false) => {
    if (!validate()) return;
    if (!member && !skipDupCheck && navigator.onLine) {
      try {
        const res = await api<{ matches: Member[]; outside_jurisdiction: number }>('/members/check-duplicates/', {
          params: { first_name: String(form.first_name), last_name: String(form.last_name), date_of_birth: String(form.date_of_birth || ''), phone: String(form.phone || '') },
        });
        if (res.matches.length || res.outside_jurisdiction) { setDups(res); return; }
      } catch { /* offline or unavailable: continue */ }
    }
    setBusy(true);
    const body: Record<string, unknown> = {};
    FIELDS.forEach((k) => {
      const v = form[k];
      body[k] = v === '' ? (['date_of_birth', 'baptism_date', 'category'].includes(k) ? null : '') : v;
    });
    if (member) delete body.org_unit;
    try {
      let result: Record<string, unknown>;
      if (photo) {
        const fd = new FormData();
        Object.entries(body).forEach(([k, v]) => v !== null && fd.append(k, String(v)));
        fd.append('photo', photo);
        result = member ? await api(`/members/${member.id}/`, { method: 'PATCH', body: fd }) : await api('/members/', { method: 'POST', body: fd });
        toast.success('Member saved.');
      } else {
        const id = member?.id || uuid();
        const res = await submitChange({
          entity: 'members', op: member ? 'update' : 'create', method: member ? 'PATCH' : 'POST',
          url: member ? `/members/${id}/` : '/members/', body: member ? body : { ...body, id, client_created_at: new Date().toISOString() },
          recordId: id, baseVersion: member?.version, label: `${member ? 'Update' : 'Register'} member ${body.first_name} ${body.last_name}`,
        });
        result = res.data as Record<string, unknown>;
        if (res.state === 'queued') toast.offline('Saved on this device. It will be sent to the server when you are back online.');
        else toast.success(member ? 'Member updated.' : `Member registered: ${result.membership_no}.`);
      }
      qc.invalidateQueries({ queryKey: ['members'] });
      onSaved?.(result);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); save(); };

  return (
    <Modal open={open} onClose={onClose} size="xl" title={member ? `Edit ${member.full_name}` : 'Register new member'}
      subtitle={member ? member.membership_no || 'Membership number pending' : 'A membership number is assigned automatically.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => save()}>{member ? 'Save changes' : 'Register member'}</Button></>}>
      <form onSubmit={submit} className="space-y-6" noValidate>
        <FormError message={errors.form} />
        {dups && (
          <div className="rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm text-gold-900 dark:border-gold-700 dark:bg-gold-900/30 dark:text-gold-100">
            <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Possible duplicate</p>
            <ul className="mt-1 list-disc pl-5">
              {dups.matches.map((m) => <li key={m.id}>{m.full_name} · {m.membership_no} · {m.org_unit_name}</li>)}
              {dups.outside_jurisdiction > 0 && <li>{dups.outside_jurisdiction} matching record(s) in another jurisdiction — consider a transfer instead.</li>}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDups(null)}>Go back</Button>
              <Button size="sm" variant="gold" onClick={() => { setDups(null); save(true); }}>This is a different person — register</Button>
            </div>
          </div>
        )}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Personal details</h3>
          <FormGrid cols={3}>
            <Field label="First name" required error={errors.first_name}><Input value={String(form.first_name)} onChange={set('first_name')} /></Field>
            <Field label="Middle name"><Input value={String(form.middle_name)} onChange={set('middle_name')} /></Field>
            <Field label="Last name" required error={errors.last_name}><Input value={String(form.last_name)} onChange={set('last_name')} /></Field>
            <Field label="Gender" required error={errors.gender}>
              <Select value={String(form.gender)} onChange={set('gender')}><option value="">Select…</option><option value="male">Male</option><option value="female">Female</option></Select>
            </Field>
            <Field label="Date of birth" error={errors.date_of_birth}><Input type="date" max={today()} value={String(form.date_of_birth)} onChange={set('date_of_birth')} /></Field>
            <Field label="Marital status">
              <Select value={String(form.marital_status)} onChange={set('marital_status')}><option value="">—</option><option value="single">Single</option><option value="married">Married</option><option value="widowed">Widowed</option><option value="divorced">Divorced / separated</option></Select>
            </Field>
            <Field label="Phone" error={errors.phone}><Input inputMode="tel" value={String(form.phone)} onChange={set('phone')} placeholder="+232 76 000000" /></Field>
            <Field label="Email" error={errors.email}><Input type="email" value={String(form.email)} onChange={set('email')} /></Field>
            <Field label="Occupation"><Input value={String(form.occupation)} onChange={set('occupation')} /></Field>
            <Field label="Residential address" className="sm:col-span-2 lg:col-span-3"><Input value={String(form.address)} onChange={set('address')} /></Field>
          </FormGrid>
        </section>
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Church membership</h3>
          <FormGrid cols={3}>
            <Field label="Branch" required error={errors.org_unit} hint={member ? 'Use “Transfer” to move to another branch.' : undefined}>
              {member ? <Input value={member.org_unit_name} disabled /> : <UnitSelect value={String(form.org_unit)} onChange={(v) => setForm({ ...form, org_unit: v })} types={['branch', 'congregation']} placeholder="Select branch…" invalid={!!errors.org_unit} />}
            </Field>
            <Field label="Date joined" error={errors.joined_on}><Input type="date" max={today()} value={String(form.joined_on)} onChange={set('joined_on')} /></Field>
            <Field label="Membership category" error={errors.category}>
              <Select value={String(form.category || '')} onChange={set('category')}><option value="">—</option>{categories.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </Field>
            {!member && (
              <>
                <Field label="Baptism status">
                  <Select value={String(form.baptism_status)} onChange={set('baptism_status')}><option value="not_baptized">Not baptized</option><option value="baptized">Baptized</option></Select>
                </Field>
                {form.baptism_status === 'baptized' && (
                  <>
                    <Field label="Baptism date" required error={errors.baptism_date}><Input type="date" max={today()} value={String(form.baptism_date)} onChange={set('baptism_date')} /></Field>
                    <Field label="Baptism location"><Input value={String(form.baptism_location)} onChange={set('baptism_location')} /></Field>
                  </>
                )}
              </>
            )}
            <Field label="Previous religious affiliation" hint="Only if voluntarily provided" className="sm:col-span-2"><Input value={String(form.previous_affiliation)} onChange={set('previous_affiliation')} /></Field>
          </FormGrid>
        </section>
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Emergency contact & photograph</h3>
          <FormGrid cols={3}>
            <Field label="Emergency contact name"><Input value={String(form.emergency_contact_name)} onChange={set('emergency_contact_name')} /></Field>
            <Field label="Emergency contact phone"><Input value={String(form.emergency_contact_phone)} onChange={set('emergency_contact_phone')} /></Field>
            <Field label="Photograph" error={errors.photo} hint="Requires consent; uploading needs internet.">
              <Input type="file" accept="image/png,image/jpeg,image/webp" className="pt-1.5" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3"><Checkbox label="The member consents to their photograph being stored" checked={!!form.photo_consent} onChange={(e) => setForm({ ...form, photo_consent: e.target.checked })} /></div>
            <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><Textarea value={String(form.notes)} onChange={set('notes')} rows={2} /></Field>
          </FormGrid>
        </section>
      </form>
    </Modal>
  );
}
