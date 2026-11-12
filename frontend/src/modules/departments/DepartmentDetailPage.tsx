import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, LogOut, Pencil, UserPlus } from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, DescriptionList, Field, FormError, Input, Modal, PageHeader, PageLoader, Select, StatusBadge, useToast, type Column } from '@/components/ui';
import { date, dateTime } from '@/lib/format';
import { programStatusLabel, type Department, type Program } from '@/modules/programs/types';
import { DepartmentForm, kindLabel } from './DepartmentsPage';

interface Membership { id: string; department: string; member: string; member_name: string; membership_no: string; gender: string; role: string; joined_on: string; left_on: string | null }
const ROLES: [string, string][] = [['member', 'Member'], ['leader', 'Leader'], ['assistant', 'Assistant leader'], ['secretary', 'Secretary'], ['treasurer', 'Treasurer']];

function AddMember({ dept, onClose }: { dept: Department; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('member');
  const [err, setErr] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const found = useQuery({ queryKey: ['member-pick', dept.org_unit, q], enabled: q.length >= 2, queryFn: () => api<Page<{ id: string; full_name: string; membership_no: string }>>('/members/', { params: { search: q, org_unit: dept.org_unit, status: 'active', page_size: 10 } }).then((p) => p.results) });
  const add = async (member: string, name: string) => {
    setErr('');
    try { await api('/department-members/', { method: 'POST', body: { department: dept.id, member, role } }); toast.success(`${name} added.`); qc.invalidateQueries({ queryKey: ['departments'] }); setQ(''); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal open onClose={onClose} title="Add members" subtitle={dept.name} footer={<Button onClick={onClose}>Done</Button>}>
      <FormError message={err} />
      <div className="flex gap-3">
        <Field label="Find a member" className="flex-1" hint="Type at least two letters of a name or membership number"><Input value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></Field>
        <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      </div>
      <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {(found.data || []).map((m) => (
          <li key={m.id} className="flex items-center justify-between py-2 text-sm"><span>{m.full_name} <span className="font-mono text-xs text-slate-500">{m.membership_no}</span></span><Button size="sm" variant="secondary" onClick={() => add(m.id, m.full_name)}>Add</Button></li>
        ))}
        {q.length >= 2 && found.data?.length === 0 && <li className="py-2 text-sm text-slate-500">No active member of {dept.org_unit_name} matches.</li>}
      </ul>
    </Modal>
  );
}

export default function DepartmentDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState<Membership | null>(null);
  const d = useQuery({ queryKey: ['departments', 'detail', id], queryFn: () => api<Department>(`/departments/${id}/`) });
  const members = useQuery({ queryKey: ['departments', 'members', id], queryFn: () => api<Page<Membership>>('/department-members/', { params: { department: id, page_size: 200 } }) });
  const programs = useQuery({ queryKey: ['programs', 'department', id], enabled: can('programs.view'), queryFn: () => api<Program[]>('/programs/', { params: { department: id, start: new Date(Date.now() - 90 * 864e5).toISOString() } }) });
  if (d.isLoading || !d.data) return <PageLoader />;
  const dept = d.data;
  const editable = can('departments.edit');
  const setRole = async (m: Membership, role: string) => {
    try { await api(`/department-members/${m.id}/`, { method: 'PATCH', body: { role } }); qc.invalidateQueries({ queryKey: ['departments'] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  const leave = async () => {
    if (!leaving) return;
    try { await api(`/department-members/${leaving.id}/leave/`, { method: 'POST' }); toast.success(`${leaving.member_name} has left ${dept.name}.`); qc.invalidateQueries({ queryKey: ['departments'] }); }
    catch (e) { toast.error((e as Error).message); } finally { setLeaving(null); }
  };
  const cols: Column<Membership>[] = [
    { key: 'name', header: 'Member', render: (m) => <Link to={`/members/${m.member}`} className="font-medium text-royal-700 hover:underline dark:text-royal-300" onClick={(e) => e.stopPropagation()}>{m.member_name}</Link> },
    { key: 'no', header: 'Number', hideOnMobile: true, render: (m) => <span className="font-mono text-xs">{m.membership_no}</span> },
    { key: 'role', header: 'Role', render: (m) => editable ? <Select value={m.role} onChange={(e) => setRole(m, e.target.value)} className="h-8 w-40 py-0 text-xs" aria-label="Role">{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select> : ROLES.find(([v]) => v === m.role)?.[1] },
    { key: 'joined', header: 'Joined', hideOnMobile: true, render: (m) => date(m.joined_on) },
    ...(editable ? [{ key: 'act', header: '', align: 'right' as const, render: (m: Membership) => <Button size="sm" variant="ghost" icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => setLeaving(m)}>Remove</Button> }] : []),
  ];
  const upcoming = (programs.data || []).slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <div className="space-y-6">
      <PageHeader title={dept.name} subtitle={`${kindLabel(dept.kind)} · ${dept.org_unit_name}`}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Ministries', to: '/departments' }, { label: dept.name }]}
        actions={editable && <div className="flex gap-2"><Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button><Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add members</Button></div>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`Members (${dept.member_count})`} />
          <DataTable columns={cols} rows={members.data?.results} loading={members.isLoading} emptyTitle="No members yet" emptyMessage="Add members of this unit to the department." />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="About" />
            <CardBody>
              <DescriptionList items={[{ label: 'Leader', value: dept.leader_display || '—' }, { label: 'Meets', value: dept.meeting_schedule || '—' }, { label: 'Status', value: <StatusBadge status={dept.is_active ? 'active' : 'inactive'} /> }]} />
              {dept.description && <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">{dept.description}</p>}
            </CardBody>
          </Card>
          {can('programs.view') && (
            <Card>
              <CardHeader title="Programs" icon={<CalendarDays className="h-4 w-4" />} />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {upcoming.length ? upcoming.slice(0, 8).map((p) => (
                  <li key={p.id}><Link to={`/programs/${p.id}`} className="block px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <span className="flex items-center justify-between gap-2"><span className="font-medium">{p.title}</span><StatusBadge status={p.status} label={programStatusLabel(p.status)} /></span>
                    <span className="text-xs text-slate-500">{dateTime(p.starts_at)}</span>
                  </Link></li>
                )) : <li className="px-5 py-4 text-sm text-slate-500">No programs in the last three months or ahead.</li>}
              </ul>
            </Card>
          )}
        </div>
      </div>
      {editing && <DepartmentForm dept={dept} onClose={() => setEditing(false)} />}
      {adding && <AddMember dept={dept} onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!leaving} title="Remove from department" message={leaving ? `${leaving.member_name} will be recorded as having left ${dept.name} today. Their history is kept.` : ''} confirmLabel="Remove" tone="danger" onConfirm={leave} onClose={() => setLeaving(null)} />
    </div>
  );
}
