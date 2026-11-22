import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Check, Copy, Dices, Eye, EyeOff, KeyRound, Lock, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import type { Assignment } from '@/app/types';
import { Badge, Button, ConfirmDialog, Field, FormError, FormGrid, Input, Modal, Select, Spinner, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { useLevelLabels, useOrgUnits } from '@/lib/queries';
import { date, relative } from '@/lib/format';
import { passwordProblems } from '../auth/password';
import type { Role, UserRow } from './types';

type Tab = 'account' | 'details' | 'roles' | 'access';
interface Perm { code: string; module: string; action: string; description: string }
interface Access { assignments: { assignment: string; role: string; role_code: string; org_unit: string; org_unit_type: string; permissions: string[] }[]; permissions: string[] }
const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'export', 'print', 'submit'];

export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api<Page<Role>>('/roles/', { params: { page_size: 100 } }).then((p) => p.results) });
}

/** A readable random password that passes the server's rules: e.g. "Koidu-Harvest-4821". */
function generatePassword() {
  const words = ['River', 'Living', 'Water', 'Grace', 'Faith', 'Harvest', 'Koidu', 'Kono', 'Shepherd', 'Psalm', 'Mercy', 'Light', 'Cedar', 'Jordan', 'Bethel', 'Zion'];
  const rnd = new Uint32Array(3);
  crypto.getRandomValues(rnd);
  return `${words[rnd[0] % words.length]}-${words[rnd[1] % words.length]}-${1000 + (rnd[2] % 9000)}`;
}

export default function UserDetailModal({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('account');
  useEffect(() => { if (user) setTab('account'); }, [user?.id]);
  if (!user) return null;
  return (
    <Modal open={!!user} onClose={onClose} size="xl" title={`${user.title ? user.title + ' ' : ''}${user.full_name}`} subtitle={`${user.username} · ${user.email}`}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={user.status} />
          {user.is_locked && <Badge tone="red"><Lock className="h-3 w-3" /> locked</Badge>}
          {user.must_change_password && <Badge tone="yellow">must change password</Badge>}
          <span className="text-xs text-slate-500">Last sign-in {relative(user.last_login)} · created {date(user.created_at)}</span>
        </div>
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { value: 'account', label: 'Account & password' },
          { value: 'details', label: 'Details' },
          { value: 'roles', label: 'Roles & jurisdiction' },
          { value: 'access', label: 'Access review' },
        ]} />
        {tab === 'account' && <AccountTab user={user} onClose={onClose} />}
        {tab === 'details' && <DetailsTab user={user} />}
        {tab === 'roles' && <RolesTab user={user} />}
        {tab === 'access' && <AccessTab user={user} />}
      </div>
    </Modal>
  );
}

function useRun() {
  const qc = useQueryClient();
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    try {
      await fn();
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ['users'] });
      return true;
    } catch (e) {
      setErr(e instanceof ApiError && Object.keys(e.fieldErrors).length ? Object.values(e.fieldErrors).join(' ') : (e as Error).message);
      return false;
    }
  };
  return { err, setErr, run };
}

function AccountTab({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const toast = useToast();
  const { user: me, can } = useAuth();
  const { err, run } = useRun();
  const [statusAction, setStatusAction] = useState<'active' | 'suspended' | 'deactivated' | null>(null);
  const [reason, setReason] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (me?.id === user.id) return <p className="text-sm text-slate-600">This is your own account. Change your password from your profile menu; another administrator manages your access.</p>;
  if (!can('users.edit')) return <p className="text-sm text-slate-600">You can view this account but not change it.</p>;
  const problem = password ? passwordProblems(password)[0] : null;
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success('Copied.'));
  return (
    <div className="space-y-6">
      <FormError message={err} />
      <section className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-royal-600" /> Reset password</h4>
        <p className="text-sm text-slate-600 dark:text-slate-400">Give the user a temporary password. Their open sessions end at once, and they must choose their own password the next time they sign in.</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Field label="Temporary password" error={problem ?? undefined} hint="At least 10 characters. Tell the user in person or by phone, never by group chat.">
            <div className="relative">
              <Input type={show ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setDone(null); }} autoComplete="new-password" className="pr-10 font-mono" />
              <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Button variant="secondary" className="sm:mt-6" icon={<Dices className="h-4 w-4" />} onClick={() => { setPassword(generatePassword()); setShow(true); setDone(null); }}>Generate</Button>
          <Button className="sm:mt-6" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!password || !!problem}
            onClick={async () => {
              setSaving(true);
              if (await run(() => api(`/users/${user.id}/set-password/`, { method: 'POST', body: { password } }), 'Temporary password set.')) setDone(password);
              setSaving(false);
            }}>Set password</Button>
        </div>
        {done && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950">
            <Check className="h-4 w-4 text-emerald-600" />
            <span className="flex-1">Done. {user.full_name} signs in with <code className="font-mono font-semibold">{done}</code> and then picks a new password.</span>
            <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(done)}>Copy</Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span>Or send a one-time link instead:</span>
          <Button size="sm" variant="ghost" onClick={() => run(async () => setLink((await api<{ link: string }>(`/users/${user.id}/reset-link/`, { method: 'POST' })).link), 'One-time reset link created.')}>Issue reset link</Button>
        </div>
        {link && (
          <div className="rounded-lg border border-royal-200 bg-royal-50 p-3 text-sm dark:border-royal-800 dark:bg-royal-950">
            <p className="mb-1 font-medium">Give this one-time link to the user privately (it expires soon):</p>
            <div className="flex items-center gap-2">
              <code className="block flex-1 truncate text-xs">{link}</code>
              <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(link)}>Copy</Button>
            </div>
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Account status</h4>
        {user.status_reason && <p className="text-sm text-slate-600">Reason: {user.status_reason}</p>}
        <div className="flex flex-wrap gap-2">
          {user.status !== 'active' && <Button size="sm" variant="success" onClick={() => setStatusAction('active')}>Reactivate</Button>}
          {user.status === 'active' && <Button size="sm" variant="secondary" onClick={() => setStatusAction('suspended')}>Suspend</Button>}
          {user.status !== 'deactivated' && <Button size="sm" variant="danger" onClick={() => setStatusAction('deactivated')}>Deactivate</Button>}
          {user.is_locked && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/users/${user.id}/unlock/`, { method: 'POST' }), 'Account unlocked.')}>Unlock</Button>}
        </div>
      </section>
      <ConfirmDialog open={!!statusAction} onClose={() => setStatusAction(null)} tone={statusAction === 'active' ? 'success' : 'danger'}
        title={statusAction === 'active' ? 'Reactivate account?' : statusAction === 'suspended' ? 'Suspend account?' : 'Deactivate account?'}
        confirmLabel="Confirm" message={statusAction === 'active' ? 'The user will be able to sign in again.' : 'The user is signed out and cannot sign in. Their records and history are kept.'}
        onConfirm={async () => { await run(() => api(`/users/${user.id}/status/`, { method: 'POST', body: { status: statusAction, reason } }), 'Account status updated.'); setStatusAction(null); setReason(''); onClose(); }}>
        {statusAction !== 'active' && <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>}
      </ConfirmDialog>
    </div>
  );
}

function DetailsTab({ user }: { user: UserRow }) {
  const { user: me, can } = useAuth();
  const { err, run } = useRun();
  const initial = { full_name: user.full_name, title: user.title, email: user.email, phone: user.phone, username: user.username };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm({ full_name: user.full_name, title: user.title, email: user.email, phone: user.phone, username: user.username }), [user]);
  const editable = can('users.edit') && me?.id !== user.id;
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);
  const set = (k: keyof typeof initial) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <FormError message={err} />
      <FormGrid>
        <Field label="Full name" required><Input value={form.full_name} onChange={set('full_name')} disabled={!editable} /></Field>
        <Field label="Title" hint="Rev., Pastor, Deacon…"><Input value={form.title} onChange={set('title')} disabled={!editable} /></Field>
        <Field label="Username" required hint="Used to sign in."><Input value={form.username} onChange={set('username')} disabled={!editable} autoComplete="off" /></Field>
        <Field label="Email" required hint="Needed for self-service password reset."><Input type="email" value={form.email} onChange={set('email')} disabled={!editable} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} disabled={!editable} /></Field>
      </FormGrid>
      {editable && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={!dirty} onClick={() => setForm(initial)}>Undo changes</Button>
          <Button icon={<Save className="h-4 w-4" />} disabled={!dirty || !form.full_name.trim()} loading={saving}
            onClick={async () => { setSaving(true); await run(() => api(`/users/${user.id}/`, { method: 'PATCH', body: form }), 'Details saved.'); setSaving(false); }}>Save details</Button>
        </div>
      )}
    </div>
  );
}

function unitOptions(units: ReturnType<typeof useOrgUnits>['data'], UNIT_LABELS: Record<string, string>) {
  return (units || []).map((u) => <option key={u.id} value={u.id}>{'— '.repeat(u.depth)}{u.name} ({UNIT_LABELS[u.unit_type]})</option>);
}

function AssignmentRow({ a, user, editable }: { a: Assignment; user: UserRow; editable: boolean }) {
  const UNIT_LABELS = useLevelLabels();
  const { data: roles = [] } = useRoles();
  const { data: units } = useOrgUnits();
  const { level } = useAuth();
  const { err, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ role: a.role, org_unit: a.org_unit, reason: '' });
  const [ending, setEnding] = useState(false);
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{a.role_name} <span className="font-normal text-slate-500">at</span> {a.org_unit_name}</p>
          <p className="text-xs text-slate-500">From {date(a.starts_on)}{a.ends_on ? ` to ${date(a.ends_on)}` : ''}{!a.is_active && ' · ended'} · covers {a.org_unit_name} and every unit under it</p>
        </div>
        {a.is_active && editable && !editing && (
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setEditing(true)}>Change</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setEnding(true)}>End</Button>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
          <FormError message={err} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Role">
              <Select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
                {roles.filter((r) => r.is_active && (r.level >= level || r.id === a.role)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Jurisdiction (where the role applies)">
              <Select value={draft.org_unit} onChange={(e) => setDraft({ ...draft, org_unit: e.target.value })}>{unitOptions(units, UNIT_LABELS)}</Select>
            </Field>
          </div>
          <Field label="Reason" hint="Kept in the audit trail, e.g. “Transferred to Kenema Branch”."><Input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">The current assignment ends today and the new one starts today, so the history stays visible.</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => { setEditing(false); setDraft({ role: a.role, org_unit: a.org_unit, reason: '' }); }}>Cancel</Button>
            <Button size="sm" icon={<Check className="h-4 w-4" />} disabled={draft.role === a.role && draft.org_unit === a.org_unit}
              onClick={async () => {
                const body: Record<string, string> = { reason: draft.reason };
                if (draft.role !== a.role) body.role = draft.role;
                if (draft.org_unit !== a.org_unit) body.org_unit = draft.org_unit;
                if (await run(() => api(`/role-assignments/${a.id}/change/`, { method: 'POST', body }), `${user.full_name}'s role was changed.`)) setEditing(false);
              }}>Save change</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={ending} onClose={() => setEnding(false)} tone="danger" title="End this role?" confirmLabel="End role"
        message={`${user.full_name} loses ${a.role_name} access at ${a.org_unit_name} and the units under it today. The history is kept.`}
        onConfirm={async () => { await run(() => api(`/role-assignments/${a.id}/`, { method: 'DELETE' }), 'Role assignment ended.'); setEnding(false); }} />
    </li>
  );
}

function RolesTab({ user }: { user: UserRow }) {
  const UNIT_LABELS = useLevelLabels();
  const { data: roles = [] } = useRoles();
  const { data: units } = useOrgUnits();
  const { level, user: me, can } = useAuth();
  const { err, run } = useRun();
  const [grant, setGrant] = useState({ role: '', org_unit: '' });
  const [showEnded, setShowEnded] = useState(false);
  const editable = can('users.edit') && me?.id !== user.id;
  const active = user.assignments.filter((a) => a.is_active);
  const ended = user.assignments.filter((a) => !a.is_active);
  return (
    <div className="space-y-4">
      {me?.id === user.id && <p className="text-sm text-slate-600">You cannot change your own roles. Another administrator must do it.</p>}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {active.map((a) => <AssignmentRow key={a.id} a={a} user={user} editable={editable} />)}
        {active.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No active roles. This person can sign in but cannot see any church records.</li>}
      </ul>
      {editable && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Add another role</h4>
          <FormError message={err} />
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Select value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value })} aria-label="Role">
              <option value="">Role…</option>
              {roles.filter((r) => r.is_active && r.level >= level).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Select value={grant.org_unit} onChange={(e) => setGrant({ ...grant, org_unit: e.target.value })} aria-label="Unit">
              <option value="">at unit…</option>
              {unitOptions(units, UNIT_LABELS)}
            </Select>
            <Button icon={<Plus className="h-4 w-4" />} disabled={!grant.role || !grant.org_unit}
              onClick={async () => { if (await run(() => api('/role-assignments/', { method: 'POST', body: { user: user.id, ...grant } }), 'Role granted.')) setGrant({ role: '', org_unit: '' }); }}>Grant</Button>
          </div>
        </div>
      )}
      {ended.length > 0 && (
        <div>
          <button type="button" className="text-sm font-medium text-royal-700 hover:underline dark:text-royal-300" onClick={() => setShowEnded(!showEnded)}>
            {showEnded ? 'Hide' : 'Show'} past roles ({ended.length})
          </button>
          {showEnded && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 opacity-80 dark:divide-slate-800 dark:border-slate-700">
              {ended.map((a) => <AssignmentRow key={a.id} a={a} user={user} editable={false} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AccessTab({ user }: { user: UserRow }) {
  const UNIT_LABELS = useLevelLabels();
  const access = useQuery({ queryKey: ['users', user.id, 'access', user.assignments.map((a) => a.id + a.is_active).join()], queryFn: () => api<Access>(`/users/${user.id}/access/`) });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => api<Perm[]>('/permissions/') });
  const modules = useMemo(() => {
    const m = new Map<string, Perm[]>();
    perms.data?.forEach((p) => m.set(p.module, [...(m.get(p.module) || []), p]));
    return [...m.entries()];
  }, [perms.data]);
  if (access.isLoading || perms.isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (access.error) return <FormError message={(access.error as Error).message} />;
  const granted = new Set(access.data?.permissions);
  const where = (code: string) => access.data?.assignments.filter((a) => a.permissions.includes(code)).map((a) => `${a.role} at ${a.org_unit}`).join('; ');
  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-royal-600" /> What {user.full_name} can do today</h4>
        {access.data?.assignments.length ? (
          <ul className="list-inside list-disc text-sm text-slate-600 dark:text-slate-400">
            {access.data.assignments.map((a) => <li key={a.assignment}><span className="font-medium text-slate-800 dark:text-slate-200">{a.role}</span> at {a.org_unit} ({UNIT_LABELS[a.org_unit_type] ?? a.org_unit_type}) and every unit under it</li>)}
          </ul>
        ) : <p className="text-sm text-slate-500">No current roles, so no access to church records.</p>}
        <p className="mt-1 text-xs text-slate-500">To change what a role allows for everyone who holds it, use <span className="font-medium">Administration → Roles & permissions</span>. To change this person's access only, use the Roles & jurisdiction tab.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Module</th>
              {ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center text-xs font-semibold uppercase text-slate-500">{a}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {modules.map(([module, list]) => (
              <tr key={module}>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium capitalize">{list[0]?.description.split('— ')[1] || module}</td>
                {ACTIONS.map((a) => {
                  const code = `${module}.${a}`;
                  const exists = list.some((p) => p.action === a);
                  return (
                    <td key={a} className="px-2 py-1.5 text-center" title={granted.has(code) ? where(code) : undefined}>
                      {!exists ? <span className="text-slate-300 dark:text-slate-600">·</span>
                        : granted.has(code) ? <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label={`${code}: allowed`} />
                          : <X className="mx-auto h-3.5 w-3.5 text-slate-300 dark:text-slate-600" aria-label={`${code}: not allowed`} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Hover over a tick to see which role gives that permission.</p>
    </div>
  );
}
