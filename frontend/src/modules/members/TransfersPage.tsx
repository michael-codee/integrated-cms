import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { Button, Card, ConfirmDialog, DataTable, Field, PageHeader, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast, type Column } from '@/components/ui';
import { date } from '@/lib/format';
import type { Transfer } from './types';

export default function TransfersPage() {
  const [params, setParams] = useSearchParams();
  const direction = params.get('direction') === 'incoming' ? 'incoming' : 'all';
  const [status, setStatus] = useState(direction === 'incoming' ? 'pending' : '');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ t: Transfer; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, isFetching } = useQuery({
    queryKey: ['transfers', direction, status, page],
    queryFn: () => api<Page<Transfer>>('/member-transfers/', { params: { direction: direction === 'incoming' ? 'incoming' : undefined, status, page } }),
    placeholderData: keepPreviousData,
  });
  const decide = async () => {
    if (!deciding) return;
    setBusy(true);
    try {
      await api(`/member-transfers/${deciding.t.id}/decide/`, { method: 'POST', body: { approve: deciding.approve, note } });
      toast.success(deciding.approve ? `${deciding.t.member_name} now belongs to ${deciding.t.to_unit_name}.` : 'Transfer rejected.');
      qc.invalidateQueries({ queryKey: ['transfers'] });
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setDeciding(null); setNote(''); }
  };
  const columns: Column<Transfer>[] = [
    { key: 'member', header: 'Member', render: (t) => <div><p className="font-medium">{t.member_name}</p><p className="text-xs text-slate-500">{t.membership_no}</p></div> },
    { key: 'route', header: 'From → to', render: (t) => <span className="text-sm">{t.from_unit_name} → <b>{t.to_unit_name}</b></span> },
    { key: 'date', header: 'Effective', hideOnMobile: true, render: (t) => date(t.effective_date) },
    { key: 'by', header: 'Requested by', hideOnMobile: true, render: (t) => t.requested_by || '—' },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
    { key: 'actions', header: '', align: 'right', render: (t) => t.can_decide ? (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setDeciding({ t, approve: true })}>Approve</Button>
        <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setDeciding({ t, approve: false })}>Reject</Button>
      </div>
    ) : null },
  ];
  return (
    <div>
      <PageHeader title="Member transfers" subtitle="Transfers move the existing membership record to the receiving branch once it is approved there."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Membership', to: '/members' }, { label: 'Transfers' }]} />
      <Tabs value={direction} onChange={(d) => { setParams(d === 'incoming' ? { direction: d } : {}); setStatus(d === 'incoming' ? 'pending' : ''); setPage(1); }}
        tabs={[{ value: 'incoming', label: 'Awaiting my approval' }, { value: 'all', label: 'All transfers' }]} />
      <Card>
        <Toolbar>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-48" aria-label="Status">
            <option value="">Any status</option><option value="pending">Pending</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
          </Select>
        </Toolbar>
        <DataTable columns={columns} rows={data?.results} loading={isFetching} total={data?.count} page={page} onPage={setPage} onRowClick={(t) => navigate(`/members/${t.member}`)} emptyTitle="No transfers" />
      </Card>
      <ConfirmDialog open={!!deciding} onClose={() => setDeciding(null)} loading={busy} onConfirm={decide}
        title={deciding?.approve ? 'Approve transfer?' : 'Reject transfer?'} tone={deciding?.approve ? 'success' : 'danger'} confirmLabel={deciding?.approve ? 'Approve' : 'Reject'}
        message={deciding ? `${deciding.t.member_name}: ${deciding.t.from_unit_name} → ${deciding.t.to_unit_name}` : ''}>
        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
      </ConfirmDialog>
    </div>
  );
}
