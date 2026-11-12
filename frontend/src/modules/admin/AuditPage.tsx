import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Page } from '@/lib/api';
import { Badge, Card, DataTable, Field, Input, Modal, PageHeader, SearchInput, Select, Toolbar, type Column } from '@/components/ui';
import { dateTime, titleCase } from '@/lib/format';

interface Entry { id: string; at: string; actor_name: string; action: string; entity: string; entity_id: string; entity_label: string; changes: Record<string, [unknown, unknown]>; message: string; ip_address: string | null; device_id: string; user_agent: string }

const ACTIONS = ['create', 'update', 'delete', 'approve', 'reject', 'return', 'submit', 'pay', 'reverse', 'transfer', 'login', 'login_failed', 'logout', 'export', 'status_change', 'password_reset'];

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Entry | null>(null);
  const { data, isFetching } = useQuery({
    queryKey: ['audit', search, action, from, to, page],
    queryFn: () => api<Page<Entry>>('/audit-logs/', { params: { search, action, from, to, page } }),
    placeholderData: keepPreviousData,
  });
  const columns: Column<Entry>[] = [
    { key: 'at', header: 'When', render: (e) => <span className="whitespace-nowrap text-xs">{dateTime(e.at)}</span> },
    { key: 'who', header: 'Who', render: (e) => e.actor_name || <span className="text-slate-400">system / anonymous</span> },
    { key: 'action', header: 'Action', render: (e) => <Badge tone={e.action.includes('fail') || e.action === 'delete' || e.action === 'reject' ? 'red' : e.action === 'approve' ? 'green' : 'blue'}>{titleCase(e.action)}</Badge> },
    { key: 'what', header: 'Record', render: (e) => (<div><p className="text-sm">{e.entity_label || e.entity_id}</p><p className="text-xs text-slate-500">{e.entity}</p></div>) },
    { key: 'changes', header: 'Changes', hideOnMobile: true, render: (e) => <span className="text-xs text-slate-500">{Object.keys(e.changes || {}).slice(0, 4).join(', ') || e.message}</span> },
  ];
  return (
    <div>
      <PageHeader title="Audit trail" subtitle="Every create, edit, approval, rejection, sign-in and export, with who, when and what changed. Entries cannot be altered."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Administration' }, { label: 'Audit trail' }]} />
      <Card>
        <Toolbar>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search person, record or message" className="sm:w-72" />
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="sm:w-44" aria-label="Action">
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="sm:w-40" aria-label="From" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="sm:w-40" aria-label="To" />
        </Toolbar>
        <DataTable columns={columns} rows={data?.results} loading={isFetching} total={data?.count} page={page} onPage={setPage} onRowClick={setOpen} />
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${titleCase(open.action)} · ${open.entity_label || open.entity}` : ''} subtitle={open ? `${dateTime(open.at)} by ${open.actor_name || 'system'}` : ''} size="lg">
        {open && (
          <div className="space-y-4 text-sm">
            {open.message && <p>{open.message}</p>}
            {Object.keys(open.changes || {}).length > 0 && (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2">Field</th><th className="py-1 pr-2">Before</th><th className="py-1">After</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {Object.entries(open.changes).map(([k, v]) => (
                    <tr key={k}><td className="py-1 pr-2 font-medium">{k}</td><td className="py-1 pr-2 text-red-700 dark:text-red-300">{String(Array.isArray(v) ? v[0] ?? '—' : '—')}</td><td className="py-1 text-emerald-700 dark:text-emerald-300">{String(Array.isArray(v) ? v[1] ?? '—' : v)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="IP address"><p>{open.ip_address || '—'}</p></Field>
              <Field label="Device"><p className="truncate">{open.device_id || '—'}</p></Field>
            </div>
            <p className="break-all text-xs text-slate-400">{open.user_agent}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
