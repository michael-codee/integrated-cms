import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, Field, FormError, FormGrid, Input, Modal, PageHeader, PageLoader, Select, Tabs, Textarea, useToast, type Column } from '@/components/ui';
import type { Lookup } from '@/app/types';
import { date } from '@/lib/format';
import type { LookupName } from '@/lib/queries';

interface Settings {
  ministry_name: string; alternate_name: string; short_name: string; motto: string; guiding_scripture: string; logo: string | null;
  hq_address: string; phone: string; email: string; website: string; default_currency: string; financial_year_start_month: number;
  membership_number_prefix: string; data_retention_years: number; audit_retention_years: number; allow_individual_attendance: boolean; require_income_approval: boolean;
}
interface Currency { code: string; name: string; symbol: string; is_active: boolean }
interface FinancialYear { id: string; name: string; start_date: string; end_date: string; is_closed: boolean }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ProfileTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings/') });
  const currencies = useQuery({ queryKey: ['currencies'], queryFn: () => api<Currency[]>('/currencies/') });
  const [form, setForm] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setForm(data); }, [data]);
  const save = useMutation({
    mutationFn: (body: Partial<Settings> | FormData) => api<Settings>('/settings/', { method: 'PATCH', body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Settings saved.'); setErrors({}); },
    onError: (e) => e instanceof ApiError && setErrors({ ...e.fieldErrors, form: e.message }),
  });
  if (!form) return <PageLoader />;
  const set = (k: keyof Settings) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.ministry_name.trim()) return setErrors({ ministry_name: 'Required.' });
    const { logo: _logo, ...rest } = form;
    void _logo;
    save.mutate(rest);
  };
  const uploadLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error('Logo must be smaller than 2 MB.');
    const fd = new FormData();
    fd.append('logo', file);
    save.mutate(fd);
  };
  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3" noValidate>
      <Card className="lg:col-span-2">
        <CardHeader title="Ministry profile" />
        <CardBody className="space-y-4">
          <FormError message={errors.form} />
          <FormGrid>
            <Field label="Ministry name" required error={errors.ministry_name}><Input value={form.ministry_name} onChange={set('ministry_name')} /></Field>
            <Field label="Also known as"><Input value={form.alternate_name} onChange={set('alternate_name')} /></Field>
            <Field label="Short name"><Input value={form.short_name} onChange={set('short_name')} /></Field>
            <Field label="Motto"><Input value={form.motto} onChange={set('motto')} /></Field>
            <Field label="Guiding scripture" className="sm:col-span-2"><Input value={form.guiding_scripture} onChange={set('guiding_scripture')} /></Field>
            <Field label="Headquarters address" className="sm:col-span-2"><Textarea value={form.hq_address} onChange={set('hq_address')} rows={2} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
            <Field label="Email" error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></Field>
            <Field label="Website" error={errors.website}><Input value={form.website} onChange={set('website')} placeholder="https://" /></Field>
          </FormGrid>
        </CardBody>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Logo" />
          <CardBody className="flex items-center gap-4">
            <img src={form.logo || '/logo.webp'} alt="Ministry logo" className="h-20 w-20 rounded-full object-contain ring-2 ring-gold-400" />
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-50 dark:ring-slate-600 dark:hover:bg-slate-800">
              <Upload className="h-4 w-4" /> Upload new
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </label>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Finance & records" />
          <CardBody className="space-y-4">
            <Field label="Default currency" error={errors.default_currency}>
              <Select value={form.default_currency} onChange={set('default_currency')}>
                {currencies.data?.filter((c) => c.is_active).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </Select>
            </Field>
            <Field label="Financial year starts in">
              <Select value={form.financial_year_start_month} onChange={(e) => setForm({ ...form, financial_year_start_month: Number(e.target.value) })}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Membership number prefix"><Input value={form.membership_number_prefix} onChange={set('membership_number_prefix')} /></Field>
            <Field label="Keep institutional records for (years)"><Input type="number" min={1} value={form.data_retention_years} onChange={set('data_retention_years')} /></Field>
            <Field label="Keep audit logs for (years)"><Input type="number" min={1} value={form.audit_retention_years} onChange={set('audit_retention_years')} /></Field>
            <Checkbox label="Income entries require approval" checked={form.require_income_approval} onChange={(e) => setForm({ ...form, require_income_approval: e.target.checked })} />
            <Checkbox label="Allow individual (roll-call) attendance" checked={form.allow_individual_attendance} onChange={(e) => setForm({ ...form, allow_individual_attendance: e.target.checked })} />
          </CardBody>
        </Card>
        <Button type="submit" className="w-full" loading={save.isPending}>Save settings</Button>
      </div>
    </form>
  );
}

function FinancialYearsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['financial-years'], queryFn: () => api<FinancialYear[]>('/financial-years/') });
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api('/financial-years/', { method: 'POST', body: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['financial-years'] }); setForm({ name: '', start_date: '', end_date: '' }); toast.success('Financial year added.'); setErrors({}); },
    onError: (e) => e instanceof ApiError && setErrors({ ...e.fieldErrors, form: e.message }),
  });
  const close = useMutation({
    mutationFn: (fy: FinancialYear) => api(`/financial-years/${fy.id}/`, { method: 'PATCH', body: { is_closed: !fy.is_closed } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financial-years'] }),
  });
  const columns: Column<FinancialYear>[] = [
    { key: 'name', header: 'Name', render: (f) => <span className="font-medium">{f.name}</span> },
    { key: 'start', header: 'Starts', render: (f) => date(f.start_date) },
    { key: 'end', header: 'Ends', render: (f) => date(f.end_date) },
    { key: 'status', header: 'Status', render: (f) => (f.is_closed ? <Badge>closed</Badge> : <Badge tone="green">open</Badge>) },
    { key: 'act', header: '', align: 'right', render: (f) => <Button size="sm" variant="ghost" onClick={() => close.mutate(f)}>{f.is_closed ? 'Reopen' : 'Close year'}</Button> },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card><DataTable columns={columns} rows={data} loading={isLoading} emptyTitle="No financial years yet" emptyMessage="They are also created automatically when the first transaction of a year is recorded." /></Card>
      <Card className="self-start">
        <CardHeader title="Add financial year" />
        <CardBody className="space-y-3">
          <FormError message={errors.form} />
          <Field label="Name" error={errors.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="FY 2027" /></Field>
          <Field label="Start date" error={errors.start_date}><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="End date" error={errors.end_date}><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          <Button className="w-full" loading={create.isPending} disabled={!form.name || !form.start_date || !form.end_date} onClick={() => create.mutate()}>Add</Button>
        </CardBody>
      </Card>
    </div>
  );
}

const LOOKUPS: { name: LookupName; label: string; extra?: 'kind' | 'depreciation' | 'requirements' }[] = [
  { name: 'membership-categories', label: 'Membership categories', extra: 'requirements' },
  { name: 'finance-categories', label: 'Finance categories', extra: 'kind' },
  { name: 'asset-categories', label: 'Asset categories', extra: 'depreciation' },
  { name: 'program-categories', label: 'Program categories' },
  { name: 'service-types', label: 'Service types' },
  { name: 'document-categories', label: 'Document categories' },
];

function LookupsTab() {
  const [current, setCurrent] = useState<LookupName>('membership-categories');
  const meta = LOOKUPS.find((l) => l.name === current)!;
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['lookup', current], queryFn: () => api<Lookup[]>(`/lookups/${current}/`) });
  const [editing, setEditing] = useState<Partial<Lookup> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (item: Partial<Lookup>) => item.id ? api(`/lookups/${current}/${item.id}/`, { method: 'PATCH', body: item }) : api(`/lookups/${current}/`, { method: 'POST', body: item }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lookup', current] }); setEditing(null); toast.success('Saved.'); },
    onError: (e) => e instanceof ApiError && setErrors({ ...e.fieldErrors, form: e.message }),
  });
  const columns: Column<Lookup>[] = [
    { key: 'name', header: 'Name', render: (l) => <span className="font-medium">{l.name}</span> },
    { key: 'code', header: 'Code', hideOnMobile: true, render: (l) => <code className="text-xs">{l.code}</code> },
    ...(meta.extra === 'kind' ? [{ key: 'kind', header: 'Kind', render: (l: Lookup) => <Badge tone={l.kind === 'income' ? 'green' : 'orange'}>{l.kind}</Badge> }] : []),
    ...(meta.extra === 'depreciation' ? [{ key: 'dep', header: 'Depreciation', render: (l: Lookup) => `${l.default_depreciation_rate}% / yr` }] : []),
    { key: 'active', header: 'Status', render: (l) => (l.is_active ? <Badge tone="green">active</Badge> : <Badge>hidden</Badge>) },
    { key: 'act', header: '', align: 'right', render: (l) => <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setErrors({}); setEditing(l); }}>Edit</Button> },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <Card className="self-start p-2">
        {LOOKUPS.map((l) => (
          <button key={l.name} onClick={() => setCurrent(l.name)} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${current === l.name ? 'bg-royal-50 font-medium text-royal-800 dark:bg-royal-900/40 dark:text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>{l.label}</button>
        ))}
      </Card>
      <Card>
        <CardHeader title={meta.label} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setErrors({}); setEditing({ is_active: true, sort_order: 100, kind: 'income' }); }}>Add</Button>} />
        <DataTable columns={columns} rows={data} loading={isLoading} />
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : `Add to ${meta.label.toLowerCase()}`}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => editing && save.mutate(editing)}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <FormError message={errors.form} />
            <FormGrid>
              <Field label="Name" required error={errors.name}><Input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value, code: editing.id ? editing.code : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} /></Field>
              <Field label="Code" required error={errors.code}><Input value={editing.code || ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
              {meta.extra === 'kind' && (
                <Field label="Kind"><Select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as 'income' | 'expense' })} disabled={!!editing.id}><option value="income">Income</option><option value="expense">Expenditure</option></Select></Field>
              )}
              {meta.extra === 'depreciation' && (
                <Field label="Depreciation % per year"><Input type="number" step="0.01" value={String(editing.default_depreciation_rate ?? 0)} onChange={(e) => setEditing({ ...editing, default_depreciation_rate: e.target.value })} /></Field>
              )}
              <Field label="Sort order"><Input type="number" value={editing.sort_order ?? 100} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} /></Field>
              <Field label="Description" className="sm:col-span-2"><Textarea value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
              {meta.extra === 'requirements' && <Field label="Requirements" className="sm:col-span-2"><Textarea value={String(editing.requirements ?? '')} onChange={(e) => setEditing({ ...editing, requirements: e.target.value })} /></Field>}
              <Checkbox label="Active (available for new records)" checked={!!editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
            </FormGrid>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<'profile' | 'years' | 'lookups'>('profile');
  return (
    <div>
      <PageHeader title="System settings" subtitle="Ministry profile, financial year, currency and the categories used across the system."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Settings' }]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Ministry profile' }, { value: 'years', label: 'Financial years' }, { value: 'lookups', label: 'Categories & lists' }]} />
      {tab === 'profile' && <ProfileTab />}
      {tab === 'years' && <FinancialYearsTab />}
      {tab === 'lookups' && <LookupsTab />}
    </div>
  );
}
