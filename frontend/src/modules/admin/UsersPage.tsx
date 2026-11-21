import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, DataTable, Field, FormError, FormGrid, Input, Modal, PageHeader, SearchInput, Select, StatusBadge, Toolbar, useToast, type Column } from '@/components/ui';
import { useOrgUnits, UNIT_LABELS } from '@/lib/queries';
import { dateTime, relative } from '@/lib/format';
import type { UserRow } from './types';
import { passwordProblems } from '../auth/password';
import UserDetailModal, { useRoles } from './UserDetailModal';

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: roles = [] } = useRoles();
  const { data: units = [] } = useOrgUnits();
  const { level } = useAuth();
  const empty = { username: '', email: '', full_name: '', title: '', phone: '', password: '', initial_role: '', initial_org_unit: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: () => api<UserRow>('/users/', { method: 'POST', body: form }),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(`Account created for ${u.full_name}. They must change the password at first sign-in.`);
      setForm(empty);
      onClose();
    },
    onError: (e) => e instanceof ApiError && setErrors({ ...e.fieldErrors, form: e.message }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^[\w.@+-]{3,}$/.test(form.username)) errs.username = 'At least 3 letters, digits or . _ - characters.';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) errs.email = 'Enter a valid email address.';
    if (!form.full_name.trim()) errs.full_name = 'Full name is required.';
    const p = passwordProblems(form.password)[0];
    if (p) errs.password = p;
    if (!form.initial_role) errs.initial_role = 'Choose a role.';
    if (!form.initial_org_unit) errs.initial_org_unit = 'Choose where the role applies.';
    setErrors(errs);
    if (!Object.keys(errs).length) m.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title="Create user account" size="lg" subtitle="The user will be asked to change this temporary password when they first sign in."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={m.isPending} icon={<UserPlus className="h-4 w-4" />}>Create account</Button></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={errors.form} />
        <FormGrid>
          <Field label="Full name" required error={errors.full_name}><Input value={form.full_name} onChange={set('full_name')} /></Field>
          <Field label="Title" hint="Rev., Pastor, Deacon…"><Input value={form.title} onChange={set('title')} /></Field>
          <Field label="Username" required error={errors.username}><Input value={form.username} onChange={set('username')} autoComplete="off" /></Field>
          <Field label="Email" required error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></Field>
          <Field label="Phone" error={errors.phone}><Input value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Temporary password" required error={errors.password} hint="At least 10 characters."><Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" /></Field>
          <Field label="Role" required error={errors.initial_role}>
            <Select value={form.initial_role} onChange={set('initial_role')}>
              <option value="">Select role…</option>
              {roles.filter((r) => r.is_active && r.level >= level).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Jurisdiction (where the role applies)" required error={errors.initial_org_unit}>
            <Select value={form.initial_org_unit} onChange={set('initial_org_unit')}>
              <option value="">Select unit…</option>
              {units.map((u) => <option key={u.id} value={u.id}>{'— '.repeat(u.depth)}{u.name} ({UNIT_LABELS[u.unit_type]})</option>)}
            </Select>
          </Field>
        </FormGrid>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isFetching } = useQuery({
    queryKey: ['users', search, status, page],
    queryFn: () => api<Page<UserRow>>('/users/', { params: { search, status, page } }),
    placeholderData: keepPreviousData,
  });
  const selectedUser = data?.results.find((u) => u.id === selected) || null;
  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Name', render: (u) => (<div><p className="font-medium text-slate-900 dark:text-white">{u.title} {u.full_name}</p><p className="text-xs text-slate-500">{u.username}</p></div>) },
    { key: 'roles', header: 'Roles', render: (u) => (<div className="space-y-0.5">{u.assignments.filter((a) => a.is_active).map((a) => <p key={a.id} className="text-xs"><span className="font-medium">{a.role_name}</span> · {a.org_unit_name}</p>)}</div>) },
    { key: 'email', header: 'Email', hideOnMobile: true, render: (u) => u.email },
    { key: 'status', header: 'Status', render: (u) => <div className="flex gap-1"><StatusBadge status={u.status} />{u.is_locked && <Badge tone="red">locked</Badge>}</div> },
    { key: 'login', header: 'Last sign-in', hideOnMobile: true, render: (u) => <span title={dateTime(u.last_login)}>{relative(u.last_login)}</span> },
  ];
  return (
    <div>
      <PageHeader title="User accounts" subtitle="Create, suspend and manage access for church officers within your jurisdiction."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Users' }]}
        actions={can('users.create') && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>New user</Button>} />
      <Card>
        <Toolbar>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, username, email, phone" className="sm:w-80" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-44" aria-label="Status">
            <option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deactivated">Deactivated</option>
          </Select>
        </Toolbar>
        <DataTable columns={columns} rows={data?.results} loading={isFetching} total={data?.count} page={page} onPage={setPage} onRowClick={(u) => setSelected(u.id)} />
      </Card>
      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      <UserDetailModal user={selectedUser} onClose={() => setSelected(null)} />
    </div>
  );
}
