import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Button, Card, DataTable, Input, PageHeader, SearchInput, Select, Tabs, Toolbar, type Column } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { date } from '@/lib/format';
import { TransactionForm } from './TransactionForm';
import { Amount, KindBadge, TxnStatus } from './shared';
import type { TxnKind, TxnListItem } from './types';

type Tab = 'all' | TxnKind;

export default function TransactionsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('kind') as Tab) || 'all';
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState(params.get('status') || '');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<TxnKind | null>(() => (['income', 'expense'].includes(params.get('new') || '') ? params.get('new') as TxnKind : null));
  const cats = useLookup('finance-categories');
  const query = { kind: tab === 'all' ? undefined : tab, search: search || undefined, org_unit: unit || undefined, status: status || undefined, category: category || undefined, date_from: from || undefined, date_to: to || undefined };
  const { data, isFetching } = useQuery({
    queryKey: ['finance', 'transactions', query, page],
    queryFn: () => api<Page<TxnListItem>>('/finance/transactions/', { params: { ...query, page } }),
    placeholderData: keepPreviousData,
  });
  const reset = () => setPage(1);
  const columns: Column<TxnListItem>[] = [
    { key: 'date', header: 'Date', render: (t) => <span className="whitespace-nowrap">{date(t.transaction_date)}</span> },
    { key: 'ref', header: 'Reference', render: (t) => <div><p className="font-mono text-xs">{t.reference || 'Draft'}</p><div className="mt-0.5"><KindBadge kind={t.kind} reversal={!!t.reversal_of} /></div></div> },
    { key: 'cat', header: 'Category', render: (t) => <div><p className="font-medium">{t.category_name}</p><p className="text-xs text-slate-500">{t.party || t.member_name || ''}</p></div> },
    { key: 'unit', header: 'Unit · account', hideOnMobile: true, render: (t) => <div className="text-xs"><p>{t.org_unit_name}</p><p className="text-slate-500">{t.account_name}</p></div> },
    { key: 'amount', header: 'Amount', align: 'right', render: (t) => <Amount value={t.amount} currency={t.currency} kind={t.kind} reversal={!!t.reversal_of} /> },
    { key: 'status', header: 'Status', render: (t) => <TxnStatus t={t} /> },
  ];
  return (
    <div>
      <PageHeader title="Transactions" subtitle="Income and expenditure. Approved entries are locked and corrected only by reversal."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Finance', to: '/finance' }, { label: 'Transactions' }]}
        actions={can('finance.create') && <>
          <Button variant="success" icon={<ArrowDownLeft className="h-4 w-4" />} onClick={() => setForm('income')}>Record income</Button>
          <Button icon={<ArrowUpRight className="h-4 w-4" />} onClick={() => setForm('expense')}>Record expense</Button>
        </>} />
      <Tabs value={tab} onChange={(k) => { setParams(k === 'all' ? {} : { kind: k }); setCategory(''); reset(); }}
        tabs={[{ value: 'all', label: 'All' }, { value: 'income', label: 'Income' }, { value: 'expense', label: 'Expenditure' }]} />
      <Card>
        <Toolbar>
          <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder="Reference, party, member…" className="sm:w-64" />
          <UnitSelect value={unit} onChange={(v) => { setUnit(v); reset(); }} className="sm:w-56" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} className="sm:w-44" aria-label="Status">
            <option value="">Any status</option><option value="draft">Draft</option><option value="submitted">Awaiting approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="reversed">Reversed</option>
          </Select>
          <Select value={category} onChange={(e) => { setCategory(e.target.value); reset(); }} className="sm:w-48" aria-label="Category">
            <option value="">Any category</option>
            {(cats.data || []).filter((c) => tab === 'all' || c.kind === tab).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} className="sm:w-40" aria-label="From" />
            <span className="text-xs text-slate-400">to</span>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} className="sm:w-40" aria-label="To" />
          </div>
          <div className="sm:ml-auto"><ExportMenu path="/finance/transactions/export/" params={query} module="finance" name="transactions" /></div>
        </Toolbar>
        <DataTable columns={columns} rows={data?.results} loading={isFetching} total={data?.count} page={page} onPage={setPage}
          onRowClick={(t) => navigate(`/finance/transactions/${t.id}`)} emptyTitle="No transactions" emptyMessage="Entries recorded for your units appear here." />
      </Card>
      {form && <TransactionForm open kind={form} onClose={() => setForm(null)} onSaved={(id, submitted) => submitted && navigate(`/finance/transactions/${id}`)} />}
    </div>
  );
}
