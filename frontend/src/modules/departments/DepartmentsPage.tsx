import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, Checkbox, DataTable, Field, FormError, FormGrid, Input, Modal, PageHeader, SearchInput, Select, Textarea, Toolbar, useToast, type Column } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { DEPARTMENT_KINDS, type Department } from '@/modules/programs/types';

export const kindLabel = (k: string) => DEPARTMENT_KINDS.find(([v]) => v === k)?.[1] || k;

export function DepartmentForm({ dept, onClose, onSaved }: { dept?: Department | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ org_unit: dept?.org_unit || '', name: dept?.name || '', kind: dept?.kind || 'other', leader_name: dept?.leader_name || '', meeting_schedule: dept?.meeting_schedule || '', description: dept?.description || '', is_active: dept?.is_active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.org_unit) e.org_unit = 'Choose the unit.';
    if (!f.name.trim()) e.name = 'Name the department.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ...f };
      if (dept) delete body.org_unit;
      const r = await api<Department>(dept ? `/departments/${dept.id}/` : '/departments/', { method: dept ? 'PATCH' : 'POST', body });
      toast.success(dept ? 'Department updated.' : 'Department created.');
      qc.invalidateQueries({ queryKey: ['departments'] });
      onSaved?.(r.id); onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={dept ? `Edit ${dept.name}` : 'New ministry or department'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{dept ? 'Save changes' : 'Create'}</Button></>}>
      <FormError message={errors.form} />
      <FormGrid>
        {!dept && <Field label="Unit" required error={errors.org_unit}><UnitSelect value={f.org_unit} onChange={(v) => setF({ ...f, org_unit: v })} placeholder="Choose unit" invalid={!!errors.org_unit} /></Field>}
        <Field label="Name" required error={errors.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Youth Fellowship" /></Field>
        <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{DEPARTMENT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Leader" hint="Give the leader a user account with a department-limited role to let them manage it."><Input value={f.leader_name} onChange={(e) => setF({ ...f, leader_name: e.target.value })} /></Field>
        <Field label="Meets"><Input value={f.meeting_schedule} onChange={(e) => setF({ ...f, meeting_schedule: e.target.value })} placeholder="e.g. Saturdays 4pm" /></Field>
        {dept && <div className="flex items-end pb-2"><Checkbox label="Active" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /></div>}
      </FormGrid>
      <Field label="Purpose" className="mt-4"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    </Modal>
  );
}

export default function DepartmentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [unit, setUnit] = useState('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const query = { org_unit: unit || undefined, kind: kind || undefined, search: search || undefined };
  const list = useQuery({ queryKey: ['departments', 'list', query, page], queryFn: () => api<Page<Department>>('/departments/', { params: { ...query, page } }), placeholderData: keepPreviousData });
  const cols: Column<Department>[] = [
    { key: 'name', header: 'Ministry / department', render: (d) => <div><p className="font-medium">{d.name} {!d.is_active && <Badge>inactive</Badge>}</p><p className="text-xs text-slate-500">{kindLabel(d.kind)}</p></div> },
    { key: 'unit', header: 'Unit', render: (d) => d.org_unit_name },
    { key: 'leader', header: 'Leader', hideOnMobile: true, render: (d) => d.leader_display || '—' },
    { key: 'meets', header: 'Meets', hideOnMobile: true, render: (d) => d.meeting_schedule || '—' },
    { key: 'members', header: 'Members', align: 'right', render: (d) => d.member_count.toLocaleString() },
  ];
  return (
    <div>
      <PageHeader title="Ministries & departments" subtitle="Youth, women, men, children, choir, evangelism and other ministries."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Ministries' }]}
        actions={can('departments.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New department</Button>} />
      <Card>
        <Toolbar>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Name or leader" className="sm:w-56" />
          <UnitSelect value={unit} onChange={(v) => { setUnit(v); setPage(1); }} className="sm:w-56" />
          <Select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} className="sm:w-52" aria-label="Type"><option value="">Any type</option>{DEPARTMENT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Toolbar>
        <DataTable columns={cols} rows={list.data?.results} loading={list.isFetching} total={list.data?.count} page={page} onPage={setPage} onRowClick={(d) => navigate(`/departments/${d.id}`)}
          emptyTitle="No departments yet" emptyMessage="Create the ministries that run in each branch." />
      </Card>
      {creating && <DepartmentForm onClose={() => setCreating(false)} onSaved={(id) => navigate(`/departments/${id}`)} />}
    </div>
  );
}
