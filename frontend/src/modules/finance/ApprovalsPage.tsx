import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Card, CardHeader, DataTable, PageHeader, StatusBadge, type Column } from '@/components/ui';
import { date, money } from '@/lib/format';
import { Amount, KindBadge } from './shared';
import type { Budget, TxnListItem } from './types';

export default function ApprovalsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const txns = useQuery({ queryKey: ['finance', 'awaiting'], queryFn: () => api<TxnListItem[]>('/finance/transactions/awaiting/'), enabled: can('finance.approve') });
  const budgets = useQuery({
    queryKey: ['finance', 'budgets', 'submitted'], enabled: can('budgets.view'),
    queryFn: () => api<Page<Budget>>('/finance/budgets/', { params: { status: 'submitted', page_size: 100 } }).then((p) => p.results.filter((b) => b.can_decide)),
  });
  const cols: Column<TxnListItem>[] = [
    { key: 'ref', header: 'Reference', render: (t) => <div><p className="font-mono text-xs">{t.reference}</p><KindBadge kind={t.kind} reversal={!!t.reversal_of} /></div> },
    { key: 'cat', header: 'Category', render: (t) => <div><p className="font-medium">{t.category_name}</p><p className="text-xs text-slate-500">{t.org_unit_name} · {date(t.transaction_date)}</p></div> },
    { key: 'step', header: 'Your step', hideOnMobile: true, render: (t) => <span className="text-sm">{t.required_steps[t.current_step]?.label} <span className="text-xs text-slate-500">({t.current_step + 1}/{t.required_steps.length})</span></span> },
    { key: 'amt', header: 'Amount', align: 'right', render: (t) => <Amount value={t.amount} currency={t.currency} kind={t.kind} reversal={!!t.reversal_of} /> },
  ];
  const bcols: Column<Budget>[] = [
    { key: 'name', header: 'Budget', render: (b) => <div><p className="font-medium">{b.name}</p><p className="text-xs text-slate-500">{b.org_unit_name} · {b.financial_year_name}</p></div> },
    { key: 'inc', header: 'Income', align: 'right', render: (b) => money(b.total_income, b.currency) },
    { key: 'exp', header: 'Expenditure', align: 'right', render: (b) => money(b.total_expense, b.currency) },
    { key: 'by', header: 'Submitted by', hideOnMobile: true, render: (b) => b.submitted_by_name || '—' },
    { key: 's', header: '', render: (b) => <StatusBadge status={b.status} label="Awaiting approval" /> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Finance approvals" subtitle="Entries and budgets waiting for your decision. You never see items you recorded or already approved."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Finance', to: '/finance' }, { label: 'Approvals' }]} />
      {can('finance.approve') && (
        <Card>
          <CardHeader title="Transactions" subtitle={txns.data ? `${txns.data.length} awaiting your approval` : undefined} />
          <DataTable columns={cols} rows={txns.data} loading={txns.isFetching} onRowClick={(t) => navigate(`/finance/transactions/${t.id}`)} emptyTitle="Nothing to approve" emptyMessage="All financial entries in your jurisdiction are up to date." />
        </Card>
      )}
      {can('budgets.view') && (
        <Card>
          <CardHeader title="Budgets" />
          <DataTable columns={bcols} rows={budgets.data} loading={budgets.isFetching} onRowClick={(b) => navigate(`/finance/budgets?open=${b.id}`)} emptyTitle="No budgets awaiting you" />
        </Card>
      )}
    </div>
  );
}
