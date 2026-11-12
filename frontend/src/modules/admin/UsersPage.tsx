import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Lock, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, Field, FormError, FormGrid, Input, Modal, PageHeader, SearchInput, Select, StatusBadge, Textarea, Toolbar, useToast, type Column } from '@/components/ui';
import { useOrgUnits, UNIT_LABELS } from '@/lib/queries';
import { date, dateTime, relative } from '@/lib/format';
import type { Role, UserRow } from './types';
import { passwordProblems } from '../auth/password';

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api<Page<Role>>('/roles/', { params: { page_size: 100 } }).then((p) => p.results) });
}

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

function UserDetailModal({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: roles = [] } = useRoles();
  const { data: units = [] } = useOrgUnits();
  const { level, user: me } = useAuth();
  const [statusAction, setStatusAction] = useState<'active' | 'suspended' | 'deactivated' | null>(null);
  const [reason, setReason] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [grant, setGrant] = useState({ role: '', org_unit: '' });
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    try {
      await fn();
      toast.success(ok);
      refresh();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  };
  if (!user) return null;
  const isSelf = me?.id === user.id;
  return (
    <Modal open={!!user} onClose={onClose} size="lg" title={`${user.title ? user.title + ' ' : ''}${user.full_name}`} subtitle={`${user.username} · ${user.email}`}>
      <div className="space-y-6">
        <FormError message={err} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={user.status} />
          {user.is_locked && <Badge tone="red"><Lock className="h-3 w-3" /> locked</Badge>}
          {user.must_change_password && <Badge tone="yellow">must change password</Badge>}
          <span className="text-xs text-slate-500">Last sign-in {relative(user.last_login)} · created {date(user.created_at)}</span>
        </div>
        {user.status_reason && <p className="text-sm text-slate-600">Reason: {user.status_reason}</p>}
        {!isSelf && (
          <div className="flex flex-wrap gap-2">
            {user.status !== 'active' && <Button size="sm" variant="success" onClick={() => setStatusAction('active')}>Reactivate</Button>}
            {user.status === 'active' && <Button size="sm" variant="secondary" onClick={() => setStatusAction('suspended')}>Suspend</Button>}
            {user.status !== 'deactivated' && <Button size="sm" variant="danger" onClick={() => setStatusAction('deactivated')}>Deactivate</Button>}
            <Button size="sm" variant="secondary" icon={<KeyRound className="h-4 w-4" />} onClick={() => run(async () => setLink((await api<{ link: string }>(`/users/${user.id}/reset-link/`, { method: 'POST' })).link), 'One-time reset link created.')}>Issue reset link</Button>
            {user.is_locked && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/users/${user.id}/unlock/`, { method: 'POST' }), 'Account unlocked.')}>Unlock</Button>}
          </div>
        )}
        {link && (
          <div className="rounded-lg border border-royal-200 bg-royal-50 p-3 text-sm dark:border-royal-800 dark:bg-royal-950">
            <p className="mb-1 font-medium">Give this one-time link to the user privately (it expires soon):</p>
            <div className="flex items-center gap-2">
              <code className="block flex-1 truncate text-xs">{link}</code>
              <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success('Copied.'))}>Copy</Button>
            </div>
          </div>
        )}
        <div>
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-royal-600" /> Roles & jurisdictions</h4>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {user.assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{a.role_name} <span className="font-normal text-slate-500">at</span> {a.org_unit_name}</p>
                  <p className="text-xs text-slate-500">From {date(a.starts_on)}{a.ends_on ? ` to ${date(a.ends_on)}` : ''} {!a.is_active && '· ended'}</p>
                </div>
                {a.is_active && !isSelf && (
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => run(() => api(`/role-assignments/${a.id}/`, { method: 'DELETE' }), 'Role assignment ended.')}>End</Button>
                )}
              </li>
            ))}
            {user.assignments.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No roles assigned.</li>}
          </ul>
          {!isSelf && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Select value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value })} aria-label="Role">
                <option value="">Add role…</option>
                {roles.filter((r) => r.is_active && r.level >= level).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              <Select value={grant.org_unit} onChange={(e) => setGrant({ ...grant, org_unit: e.target.value })} aria-label="Unit">
                <option value="">at unit…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{'— '.repeat(u.depth)}{u.name}</option>)}
              </Select>
              <Button icon={<Plus className="h-4 w-4" />} disabled={!grant.role || !grant.org_unit}
                onClick={async () => { if (await run(() => api('/role-assignments/', { method: 'POST', body: { user: user.id, ...grant } }), 'Role granted.')) setGrant({ role: '', org_unit: '' }); }}>Grant</Button>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog open={!!statusAction} onClose={() => setStatusAction(null)} tone={statusAction === 'active' ? 'success' : 'danger'}
        title={statusAction === 'active' ? 'Reactivate account?' : statusAction === 'suspended' ? 'Suspend account?' : 'Deactivate account?'}
        confirmLabel="Confirm" message={statusAction === 'active' ? 'The user will be able to sign in again.' : 'The user is signed out and cannot sign in. Their records and history are kept.'}
        onConfirm={async () => { await run(() => api(`/users/${user.id}/status/`, { method: 'POST', body: { status: statusAction, reason } }), 'Account status updated.'); setStatusAction(null); setReason(''); onClose(); }}>
        {statusAction !== 'active' && <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>}
      </ConfirmDialog>
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
