import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Page } from '@/lib/api';
import { Card, CardHeader, DataTable, PageHeader, type Column } from '@/components/ui';
import { dateTime, money } from '@/lib/format';
import { DISPOSAL_METHODS, type Disposal, type Movement } from './types';

export default function AssetApprovalsPage() {
  const navigate = useNavigate();
  const moves = useQuery({ queryKey: ['assets', 'movements', 'incoming'], queryFn: () => api<Page<Movement>>('/asset-movements/', { params: { direction: 'incoming', status: 'pending' } }).then((p) => p.results.filter((m) => m.can_decide)) });
  const disposals = useQuery({ queryKey: ['assets', 'disposals', 'pending'], queryFn: () => api<Page<Disposal>>('/asset-disposals/', { params: { status: 'pending' } }).then((p) => p.results.filter((d) => d.can_decide)) });
  const mcols: Column<Movement>[] = [
    { key: 'a', header: 'Asset', render: (m) => <div><p className="font-medium">{m.asset_name}</p><p className="font-mono text-xs text-slate-500">{m.asset_no}</p></div> },
    { key: 'r', header: 'From → to', render: (m) => <span>{m.from_unit_name} → <b>{m.to_unit_name}</b></span> },
    { key: 'why', header: 'Reason', hideOnMobile: true, render: (m) => m.reason },
    { key: 'by', header: 'Requested', hideOnMobile: true, render: (m) => <span className="text-xs">{m.requested_by}<br />{dateTime(m.created_at)}</span> },
  ];
  const dcols: Column<Disposal>[] = [
    { key: 'a', header: 'Asset', render: (d) => <div><p className="font-medium">{d.asset_name}</p><p className="text-xs text-slate-500">{d.asset_no} · {d.org_unit_name}</p></div> },
    { key: 'm', header: 'Method', render: (d) => DISPOSAL_METHODS.find(([v]) => v === d.method)?.[1] },
    { key: 'v', header: 'Book value', align: 'right', render: (d) => money(d.book_value_at_request) },
    { key: 'why', header: 'Reason', hideOnMobile: true, render: (d) => d.reason },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Asset approvals" subtitle="Transfers into your units and disposals of property below you."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Assets', to: '/assets' }, { label: 'Approvals' }]} />
      <Card><CardHeader title="Incoming transfers" /><DataTable columns={mcols} rows={moves.data} loading={moves.isFetching} onRowClick={(m) => navigate(`/assets/${m.asset}`)} emptyTitle="No transfers awaiting you" /></Card>
      <Card><CardHeader title="Disposal requests" /><DataTable columns={dcols} rows={disposals.data} loading={disposals.isFetching} onRowClick={(d) => navigate(`/assets/${d.asset}`)} emptyTitle="No disposals awaiting you" /></Card>
    </div>
  );
}
