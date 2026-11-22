import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, ApiError, type Page } from '@/lib/api';
import { uuid } from '@/lib/device';
import { submitChange } from '@/offline/repository';
import { useOnline } from '@/lib/useOnline';
import { Button, Field, FormError, FormGrid, Input, Modal, SearchInput, Select, Tabs, Textarea, useToast } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup, usePublicSettings } from '@/lib/queries';
import { today } from '@/lib/format';
import { useDepartments } from '@/modules/departments/useDepartments';
import { GENDERS, MINISTRIES, WEEKLY_SERVICES, type AttendanceRecord } from './types';

const COUNTS = [...MINISTRIES, ...GENDERS];
const EXTRA = [['visitors', 'Visitors (included above)'], ['first_timers', 'First-time guests'], ['new_converts', 'New converts']] as const;
type CountKey = (typeof COUNTS)[number][0] | (typeof EXTRA)[number][0];
const isHeadCount = (k: string) => COUNTS.some(([c]) => c === k);

/** The weekly service usually held on this date's weekday, if any. */
function weeklyServiceCode(iso: string) {
  const day = new Date(`${iso}T12:00:00`).getDay();
  return WEEKLY_SERVICES.find((w) => w.day === day)?.code;
}

export interface AttendancePreset { org_unit?: string; program?: string; program_title?: string; department?: string | null; date?: string }

interface Pick { id: string; full_name: string; membership_no: string; gender: string }

export function AttendanceForm({ record, preset, onClose }: { record?: AttendanceRecord | null; preset?: AttendancePreset; onClose: () => void }) {
  const online = useOnline();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = usePublicSettings();
  const services = useLookup('service-types');
  const [mode, setMode] = useState<'counts' | 'register'>(record?.is_individual ? 'register' : 'counts');
  const [f, setF] = useState(() => ({
    org_unit: record?.org_unit || preset?.org_unit || '', service_type: record?.service_type || '', date: record?.date || preset?.date || today(),
    department: record?.department || preset?.department || '', notes: record?.notes || '',
  }));
  const [counts, setCounts] = useState<Record<CountKey, string>>(() => Object.fromEntries([...COUNTS, ...EXTRA].map(([k]) => [k, record ? String(record.is_individual && isHeadCount(k) ? 0 : record[k]) : ''])) as Record<CountKey, string>);
  const [present, setPresent] = useState<Map<string, Pick>>(new Map());
  const [search, setSearch] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const depts = useDepartments(f.org_unit, !!f.org_unit);
  const program = record?.program || preset?.program || null;
  const individualAllowed = settings.data?.allow_individual_attendance !== false;
  const roster = useQuery({
    queryKey: ['attendance-roster', f.org_unit, search], enabled: mode === 'register' && !!f.org_unit && online,
    queryFn: () => api<Page<Pick>>('/members/', { params: { org_unit: f.org_unit, status: 'active', search: search || undefined, page_size: 200, ordering: 'last_name' } }).then((p) => p.results),
  });
  // When editing a register, load the members that were marked present.
  useQuery({
    queryKey: ['attendance-present', record?.id], enabled: !!record?.is_individual && online,
    queryFn: async () => {
      const full = await api<AttendanceRecord>(`/attendance/${record!.id}/`);
      const list = full.present_member_ids || [];
      setPresent(new Map(list.map((m) => [m.id, m])));
      return list.length;
    },
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const n = (k: CountKey) => Number(counts[k] || 0);
  const headTotal = MINISTRIES.reduce((s, [k]) => s + n(k), 0);
  const genderTotal = GENDERS.reduce((s, [k]) => s + n(k), 0);
  const total = mode === 'register' ? present.size + headTotal : headTotal;
  const activeServices = useMemo(() => {
    const weekly: string[] = WEEKLY_SERVICES.map((w) => w.code);
    const rank = (code: string) => (weekly.includes(code) ? weekly.indexOf(code) : weekly.length);
    return (services.data || []).filter((s) => s.is_active || s.id === f.service_type).sort((a, b) => rank(a.code) - rank(b.code));
  }, [services.data, f.service_type]);
  const weeklyIds = new Set(activeServices.filter((s) => WEEKLY_SERVICES.some((w) => w.code === s.code)).map((s) => s.id));
  // A new record defaults to the weekly service held on the chosen day (Tuesday, Friday or Sunday).
  const [serviceTouched, setServiceTouched] = useState(!!record);
  const suggested = activeServices.find((s) => s.code === weeklyServiceCode(f.date))?.id;
  const serviceType = !serviceTouched && !program && !f.service_type && suggested ? suggested : f.service_type;
  const toggle = (m: Pick) => setPresent((p) => { const next = new Map(p); if (next.has(m.id)) next.delete(m.id); else next.set(m.id, m); return next; });
  const allShown = useMemo(() => (roster.data || []).every((m) => present.has(m.id)), [roster.data, present]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.org_unit) e.org_unit = 'Choose the unit.';
    if (!serviceType) e.service_type = 'Choose the service or meeting type.';
    if (!f.date) e.date = 'Enter the date.';
    if (f.date > today()) e.date = 'Attendance cannot be recorded for a future date.';
    if (total === 0) e.form = mode === 'register' ? 'Mark at least one member present or enter visitor counts.' : 'Enter at least one count.';
    if (genderTotal !== headTotal) e.male = `Male + female (${genderTotal}) must equal the ministry total (${headTotal}).`;
    if (mode === 'counts' && n('visitors') > headTotal) e.visitors = 'Visitors are part of the totals above.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body: Record<string, unknown> = { ...f, service_type: serviceType, department: f.department || null, program, ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v || 0)])) };
    if (mode === 'register') body.present_members = [...present.keys()];
    const id = record?.id || uuid();
    try {
      if (mode === 'register') {
        await api(record ? `/attendance/${id}/` : '/attendance/', { method: record ? 'PATCH' : 'POST', body: record ? body : { ...body, id } });
        toast.success(`Attendance saved: ${total.toLocaleString()} present.`);
      } else {
        const res = await submitChange({
          entity: 'attendance', op: record ? 'update' : 'create', method: record ? 'PATCH' : 'POST', url: record ? `/attendance/${id}/` : '/attendance/',
          body: record ? body : { ...body, id, client_created_at: new Date().toISOString() }, recordId: id, baseVersion: record?.version,
          label: `Attendance ${f.date}: ${total} present`,
        });
        if (res.state === 'queued') toast.offline('Saved on this device. It will upload when you are back online.');
        else toast.success(`Attendance saved: ${total.toLocaleString()} present.`);
      }
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={record ? 'Correct attendance' : 'Record attendance'} subtitle={preset?.program_title || record?.program_title || 'Head counts for a service or meeting'}
      footer={<><span className="mr-auto text-sm text-slate-600 dark:text-slate-300">Total present: <strong className="tabular-nums">{total.toLocaleString()}</strong></span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save attendance</Button></>}>
      <FormError message={errors.form} />
      <FormGrid cols={2}>
        <Field label="Unit" required error={errors.org_unit}><UnitSelect value={f.org_unit} onChange={(v) => { set('org_unit', v); set('department', ''); setPresent(new Map()); }} placeholder="Choose unit" invalid={!!errors.org_unit} /></Field>
        <Field label="Service or meeting" required error={errors.service_type}>
          <Select value={serviceType} onChange={(e) => { setServiceTouched(true); set('service_type', e.target.value); }} invalid={!!errors.service_type}>
            <option value="">Choose</option>
            {weeklyIds.size > 0 && <optgroup label="Weekly services">{activeServices.filter((s) => weeklyIds.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
            <optgroup label={weeklyIds.size ? 'Other gatherings' : 'Services and meetings'}>{activeServices.filter((s) => !weeklyIds.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
          </Select>
        </Field>
        <Field label="Date" required error={errors.date}><Input type="date" max={today()} value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        {!program && <Field label="Department meeting" hint="Leave blank for a whole-church gathering" error={errors.department}>
          <Select value={f.department} onChange={(e) => set('department', e.target.value)} disabled={!f.org_unit}>
            <option value="">Whole church</option>{(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>}
      </FormGrid>
      {individualAllowed && (
        <div className="mt-5">
          <Tabs value={mode} onChange={setMode} tabs={[{ value: 'counts', label: 'Head count' }, { value: 'register', label: 'Member register' }]} />
        </div>
      )}
      {mode === 'register' && (
        online ? (
          <div className="mb-4 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-2 dark:border-slate-700">
              <SearchInput value={search} onChange={setSearch} placeholder="Find a member" className="sm:w-56" />
              <span className="text-xs text-slate-500">{present.size} marked present</span>
              {!!roster.data?.length && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPresent((p) => { const next = new Map(p); roster.data!.forEach((m) => (allShown ? next.delete(m.id) : next.set(m.id, m))); return next; })}>{allShown ? 'Clear shown' : 'Mark all shown'}</Button>}
            </div>
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {!f.org_unit ? <li className="p-3 text-sm text-slate-500">Choose the unit first.</li>
                : roster.isLoading ? <li className="p-3 text-sm text-slate-500">Loading members…</li>
                : !roster.data?.length ? <li className="p-3 text-sm text-slate-500">No active members found.</li>
                : roster.data.map((m) => (
                  <li key={m.id}>
                    <label className={clsx('flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60', present.has(m.id) && 'bg-emerald-50/60 dark:bg-emerald-900/20')}>
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-royal-600" checked={present.has(m.id)} onChange={() => toggle(m)} />
                      <span className="flex-1">{m.full_name}</span><span className="font-mono text-xs text-slate-500">{m.membership_no}</span>
                    </label>
                  </li>
                ))}
            </ul>
          </div>
        ) : <p className="mb-4 rounded-lg bg-gold-50 p-3 text-sm text-gold-900 dark:bg-gold-900/30 dark:text-gold-100">The member register needs a connection. Use the head count while offline.</p>
      )}
      {mode === 'register' && <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">Others present who are not on the register (visitors, children not registered). Members ticked above are counted under their ministry and gender automatically.</p>}
      <CountGroup title="By ministry" subtotal={headTotal}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {MINISTRIES.map(([k, l]) => <CountInput key={k} k={k} label={l} value={counts[k]} error={errors[k]} onChange={(v) => setCounts((c) => ({ ...c, [k]: v }))} />)}
        </div>
      </CountGroup>
      <CountGroup title="By gender" subtotal={genderTotal} mismatch={genderTotal !== headTotal && (genderTotal > 0 || headTotal > 0) ? `Should equal the ministry total of ${headTotal.toLocaleString()}` : undefined} error={errors.male}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {GENDERS.map(([k, l]) => <CountInput key={k} k={k} label={l} value={counts[k]} onChange={(v) => setCounts((c) => ({ ...c, [k]: v }))} />)}
        </div>
      </CountGroup>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {EXTRA.map(([k, l]) => <CountInput key={k} k={k} label={l} value={counts[k]} error={errors[k]} onChange={(v) => setCounts((c) => ({ ...c, [k]: v }))} />)}
      </div>
      <Field label="Notes" className="mt-3"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    </Modal>
  );
}

function CountInput({ k, label, value, error, onChange }: { k: string; label: string; value: string; error?: string; onChange: (v: string) => void }) {
  return <Field label={label} error={error}><Input name={k} type="number" inputMode="numeric" min="0" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" /></Field>;
}

function CountGroup({ title, subtotal, mismatch, error, children }: { title: string; subtotal: number; mismatch?: string; error?: string; children: ReactNode }) {
  return (
    <fieldset className="mb-3 rounded-lg p-3 ring-1 ring-slate-200 dark:ring-slate-700">
      <legend className="flex w-full items-baseline gap-2 px-1 text-xs font-medium text-slate-600 dark:text-slate-300">
        <span>{title}</span>
        <span className="ml-auto tabular-nums">Subtotal <strong>{subtotal.toLocaleString()}</strong></span>
      </legend>
      {children}
      {(error || mismatch) && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error || mismatch}</p>}
    </fieldset>
  );
}
