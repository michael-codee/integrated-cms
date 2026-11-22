import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, Clock, HandCoins, Users, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Button, Card, DataTable, PageHeader, SearchInput, Select, StatCard, Toolbar, type Column } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { money, num } from '@/lib/format';
import { DuesForm } from './DuesForm';
import { MONTHS, type DuesMember, type DuesRegister, type DuesRow } from './types';

const PAGE_SIZE = 50;

export default function DuesPage() {
  const { can } = useAuth();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [unit, setUnit] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ member?: DuesMember; month?: string } | null>(null);
  const query = { year, org_unit: unit || undefined, search: search || undefined, status, page, page_size: PAGE_SIZE };
  const { data, isFetching } = useQuery({
    queryKey: ['finance', 'dues-register', query],
    queryFn: () => api<DuesRegister>('/finance/dues/register/', { params: query }),
    placeholderData: keepPreviousData,
  });
  const canRecord = can('finance.create');
  const reset = () => setPage(1);
  const monthKey = (i: number) => `${year}-${String(i + 1).padStart(2, '0')}`;
  const currentMonth = year === thisYear ? new Date().getMonth() : year < thisYear ? 11 : -1;

  const cell = (row: DuesRow, i: number) => {
    const paid = Number(row.paid[i]);
    const pending = Number(row.pending[i]);
    if (paid > 0) return <span title={`Paid ${money(paid)}`} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"><Check className="h-3.5 w-3.5" aria-label="Paid" /></span>;
    if (pending > 0) return <span title={`Awaiting approval ${money(pending)}`} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200"><Clock className="h-3.5 w-3.5" aria-label="Awaiting approval" /></span>;
    // Months before the member joined are not counted as owing.
    const overdue = i <= currentMonth && monthKey(i) >= row.member.joined_on.slice(0, 7);
    if (!canRecord) return <span className={overdue ? 'text-red-400' : 'text-slate-300'} aria-label="Not paid">·</span>;
    return (
      <button type="button" title={`Record ${MONTHS[i]} ${year} for ${row.member.full_name}`} aria-label={`Record ${MONTHS[i]} ${year} for ${row.member.full_name}`}
        onClick={(e) => { e.stopPropagation(); setForm({ member: row.member, month: monthKey(i) }); }}
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-inset transition hover:bg-royal-50 hover:text-royal-800 dark:hover:bg-slate-800 ${overdue ? 'text-red-500 ring-red-200 dark:ring-red-900' : 'text-slate-300 ring-slate-200 dark:ring-slate-700'}`}>
        <span aria-hidden>+</span>
      </button>
    );
  };

  const columns: Column<DuesRow>[] = [
    { key: 'member', header: 'Member', render: (r) => <div className="min-w-[10rem]"><p className="font-medium">{r.member.full_name}</p><p className="text-xs text-slate-500">{r.member.membership_no || '—'} · {r.member.org_unit_name}</p></div> },
    ...MONTHS.map((m, i): Column<DuesRow> => ({ key: m, header: m, align: 'center', className: 'px-1.5', render: (r) => cell(r, i) })),
    { key: 'total', header: 'Paid', align: 'right', render: (r) => <div><p className="font-medium">{money(r.total_paid)}</p><p className="text-xs text-slate-500">{r.months_paid}/12 months{Number(r.total_pending) > 0 ? ` · ${money(r.total_pending)} pending` : ''}</p></div> },
  ];

  const t = data?.totals;
  const monthIndex = year === thisYear ? new Date().getMonth() : 11;
  return (
    <div>
      <PageHeader title="Monthly dues" subtitle="Members' monthly membership dues. Each payment is an income entry that needs the usual approval before it counts as paid."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Finance', to: '/finance' }, { label: 'Monthly dues' }]}
        actions={canRecord && <Button variant="success" icon={<HandCoins className="h-4 w-4" />} onClick={() => setForm({})}>Record dues</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={`Dues received in ${year}`} value={t ? money(t.paid) : '—'} hint="Approved payments" icon={<Wallet className="h-5 w-5" />} tone="green" />
        <StatCard label="Awaiting approval" value={t ? money(t.pending) : '—'} hint="Counted once approved" icon={<Clock className="h-5 w-5" />} tone="gold" to="/finance/approvals" />
        <StatCard label={`Members paid for ${MONTHS[monthIndex]}`} value={t ? `${num(t.members_paid_by_month[monthIndex])} of ${num(data?.count)}` : '—'} hint={status === 'active' ? 'Active members' : 'Members shown'} icon={<Users className="h-5 w-5" />} />
      </div>
      <Card>
        <Toolbar>
          <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder="Name or membership no." className="sm:w-64" />
          <UnitSelect value={unit} onChange={(v) => { setUnit(v); reset(); }} className="sm:w-56" />
          <Select value={year} onChange={(e) => { setYear(Number(e.target.value)); reset(); }} className="sm:w-28" aria-label="Year">
            {Array.from({ length: 6 }, (_, i) => thisYear + 1 - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} className="sm:w-40" aria-label="Member status">
            <option value="active">Active members</option><option value="inactive">Inactive members</option><option value="all">All members</option>
          </Select>
        </Toolbar>
        <DataTable columns={columns} rows={data?.results} loading={isFetching} total={data?.count} page={page} pageSize={PAGE_SIZE} onPage={setPage}
          rowKey={(r) => r.member.id}
          emptyTitle="No members" emptyMessage="Members of your units appear here with the months they have paid for." />
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
          <Check className="mr-1 inline h-3 w-3 text-emerald-600" />paid and approved · <Clock className="mx-1 inline h-3 w-3 text-gold-700" />awaiting approval · <span className="mx-1 text-red-500">+</span>not paid (past months in red){canRecord ? '. Select a month to record it.' : '.'}
        </p>
      </Card>
      {form && <DuesForm open member={form.member} month={form.month} onClose={() => setForm(null)} />}
    </div>
  );
}
