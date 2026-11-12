import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Save } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, Field, FormError, FormGrid, Input, Modal, PageHeader, PageLoader, Textarea, useToast } from '@/components/ui';
import type { Role } from './types';

interface Perm { code: string; module: string; action: string; description: string }
const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'export', 'print', 'submit'];

export default function RolesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { level } = useAuth();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Page<Role>>('/roles/', { params: { page_size: 100 } }).then((p) => p.results) });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => api<Perm[]>('/permissions/') });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ code: '', name: '', level: '6', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const role = roles.data?.find((r) => r.id === selected) || roles.data?.[0];
  useEffect(() => { if (role) setDraft(new Set(role.permissions)); }, [role]);
  const modules = useMemo(() => {
    const m = new Map<string, Perm[]>();
    perms.data?.forEach((p) => m.set(p.module, [...(m.get(p.module) || []), p]));
    return [...m.entries()];
  }, [perms.data]);
  const editable = role && role.level >= level && role.code !== 'system_admin';
  const dirty = role && (draft.size !== role.permissions.length || role.permissions.some((p) => !draft.has(p)));

  const save = useMutation({
    mutationFn: () => api<Role>(`/roles/${role!.id}/`, { method: 'PATCH', body: { permissions: [...draft] } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast.success('Permissions saved. Users get the change at their next sign-in or page refresh.'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const create = useMutation({
    mutationFn: () => api<Role>('/roles/', { method: 'POST', body: { ...newRole, level: Number(newRole.level), permissions: [] } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['roles'] }); setSelected(r.id); setCreating(false); toast.success(`Role "${r.name}" created. Now choose its permissions.`); },
    onError: (e) => e instanceof ApiError && setErrors({ ...e.fieldErrors, form: e.message }),
  });
  const toggle = (code: string) => setDraft((d) => { const n = new Set(d); n.has(code) ? n.delete(code) : n.add(code); return n; });

  if (roles.isLoading || perms.isLoading) return <PageLoader />;
  return (
    <div>
      <PageHeader title="Roles & permissions" subtitle="Each role's permissions apply only within the unit where it is assigned."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Roles' }]}
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New role</Button>} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="self-start">
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {roles.data?.map((r) => (
              <li key={r.id}>
                <button onClick={() => setSelected(r.id)} className={clsx('flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm', role?.id === r.id ? 'bg-royal-50 dark:bg-royal-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
                  <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="text-xs text-slate-500">Level {r.level} · {r.assignment_count} user(s)</span></span>
                  {!r.is_active && <Badge>inactive</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {role && (
          <Card>
            <CardHeader title={role.name} subtitle={role.description || `Level ${role.level}`}
              actions={editable && <Button icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save permissions</Button>} />
            <CardBody className="p-0">
              {!editable && <p className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500 dark:border-slate-800">{role.code === 'system_admin' ? 'The System Administrator role always has every permission.' : 'You cannot edit a role more senior than your own.'}</p>}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Module</th>
                      {ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center text-xs font-semibold uppercase text-slate-500">{a}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {modules.map(([module, list]) => (
                      <tr key={module}>
                        <td className="whitespace-nowrap px-4 py-2 font-medium capitalize">{list[0]?.description.split('— ')[1] || module}</td>
                        {ACTIONS.map((a) => {
                          const code = `${module}.${a}`;
                          return (
                            <td key={a} className="px-2 py-2 text-center">
                              <input type="checkbox" aria-label={code} className="h-4 w-4 rounded border-slate-300 text-royal-600 focus:ring-royal-500 disabled:opacity-50"
                                checked={draft.has(code)} disabled={!editable} onChange={() => toggle(code)} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="New role"
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Create role</Button></>}>
        <div className="space-y-4">
          <FormError message={errors.form} />
          <FormGrid>
            <Field label="Name" required error={errors.name}><Input value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value, code: newRole.code || '' })} /></Field>
            <Field label="Code" required error={errors.code} hint="Short identifier, e.g. ushering_leader"><Input value={newRole.code} onChange={(e) => setNewRole({ ...newRole, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} /></Field>
            <Field label="Seniority level" error={errors.level} hint="1 most senior … 6 departmental"><Input type="number" min={Math.max(level, 1)} max={9} value={newRole.level} onChange={(e) => setNewRole({ ...newRole, level: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} /></Field>
          </FormGrid>
        </div>
      </Modal>
    </div>
  );
}
