import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Clock, Scale } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardHeader, Input, PageHeader, PageLoader, Select, StatCard } from '@/components/ui';
import { BarsChart, ChartCard, monthLabel } from '@/components/charts';
import { ExportMenu } from '@/components/ExportMenu';
import { UnitSelect } from '@/components/UnitSelect';
import { compact, date, money, moneyShort } from '@/lib/format';
import type { FinanceSummary } from './types';

interface FY { id: string; name: string }

/** Statement of income and expenditure for the chosen unit and period. */
export function FinanceFigures({ data }: { data: FinanceSummary }) {
  const months = data.by_month.map((m) => ({ label: monthLabel(`${m.month}-01`), income: Number(m.income), expense: Number(m.expense) }));
  const income = data.by_category.filter((c) => c.kind === 'income');
  const expense = data.by_category.filter((c) => c.kind === 'expense');
  const net = Number(data.totals.net);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Income" value={moneyShort(data.totals.income)} hint={money(data.totals.income)} icon={<ArrowDownLeft className="h-5 w-5" />} tone="green" to="/finance/transactions?kind=income" />
        <StatCard label="Expenditure" value={moneyShort(data.totals.expense)} hint={money(data.totals.expense)} icon={<ArrowUpRight className="h-5 w-5" />} tone="royal" to="/finance/transactions?kind=expense" />
        <StatCard label={net >= 0 ? 'Surplus' : 'Deficit'} value={moneyShort(Math.abs(net))} hint={money(Math.abs(net))} icon={<Scale className="h-5 w-5" />} tone={net >= 0 ? 'green' : 'red'} />
        <StatCard label="Awaiting approval" value={data.pending.count.toLocaleString()} hint={money(data.pending.amount)} icon={<Clock className="h-5 w-5" />} tone="gold" to="/finance/transactions?status=submitted" />
      </div>
      <ChartCard title="Income and expenditure by month" subtitle="Approved entries only" table={{ columns: ['Month', 'Income', 'Expenditure'], rows: months.map((m) => [m.label, m.income, m.expense]) }}>
        <BarsChart data={months} x="label" series={[{ key: 'income', label: 'Income' }, { key: 'expense', label: 'Expenditure' }]} valueFormat={(v) => compact(v)} />
      </ChartCard>
      <div className="grid gap-6 lg:grid-cols-2">
        {[['Income by category', income], ['Expenditure by category', expense]].map(([title, rows]) => (
          <Card key={title as string}>
            <CardHeader title={title as string} />
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(rows as FinanceSummary['by_category']).map((r) => {
                  const total = Number(title === 'Income by category' ? data.totals.income : data.totals.expense) || 1;
                  return (
                    <tr key={r.category__name}>
                      <td className="px-5 py-2.5">{r.category__name}</td>
                      <td className="w-32 px-2"><div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-1.5 rounded-full bg-royal-600" style={{ width: `${Math.max(2, (Number(r.total) / total) * 100)}%` }} /></div></td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{money(r.total)}</td>
                    </tr>
                  );
                })}
                {!(rows as unknown[]).length && <tr><td className="px-5 py-6 text-center text-xs text-slate-500">No approved entries in this period</td></tr>}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {data.by_unit.length > 0 && (
          <Card>
            <CardHeader title="By unit" subtitle="Income, expenditure and net per unit below the selection" />
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="px-5 py-2 text-left">Unit</th><th className="px-3 py-2 text-right">Income</th><th className="px-3 py-2 text-right">Expenditure</th><th className="px-5 py-2 text-right">Net</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.by_unit.map((u) => <tr key={u.id}><td className="px-5 py-2.5">{u.name}</td><td className="px-3 text-right tabular-nums">{compact(u.income)}</td><td className="px-3 text-right tabular-nums">{compact(u.expense)}</td><td className={`px-5 text-right font-medium tabular-nums ${Number(u.net) < 0 ? 'text-red-700' : ''}`}>{compact(u.net)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {data.accounts.length > 0 && (
          <Card>
            <CardHeader title="Account balances" subtitle="Today, approved entries only" actions={<Link to="/finance/accounts" className="text-xs text-royal-700 hover:underline">All accounts</Link>} />
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.accounts.map((a) => <tr key={a.id}><td className="px-5 py-2.5"><p>{a.name}</p><p className="text-xs text-slate-500">{a.org_unit_name}</p></td><td className="px-5 text-right font-medium tabular-nums">{money(a.balance, a.currency)}</td></tr>)}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function FinanceOverviewPage() {
  const [unit, setUnit] = useState('');
  const [fy, setFy] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const fys = useQuery({ queryKey: ['financial-years'], queryFn: () => api<FY[]>('/financial-years/') });
  const params = { org_unit: unit || undefined, financial_year: fy || undefined, from: from || undefined, to: to || undefined };
  const { data, isLoading, error } = useQuery({ queryKey: ['finance', 'summary', params], queryFn: () => api<FinanceSummary>('/finance/summary/', { params }) });
  return (
    <div>
      <PageHeader title="Finance" subtitle={data ? `Statement of income and expenditure · ${data.financial_year || `${date(data.period.from)} – ${date(data.period.to)}`}` : 'Statement of income and expenditure'}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Finance' }]}
        actions={<ExportMenu path="/finance/transactions/export/" params={{ org_unit: unit || undefined, financial_year: fy || undefined, date_from: from || undefined, date_to: to || undefined, status: ['approved', 'reversed'] }} module="finance" name="finance-statement" />} />
      <div className="mb-6 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:flex-wrap sm:items-center">
        <UnitSelect value={unit} onChange={setUnit} className="sm:w-64" placeholder="Whole jurisdiction" />
        <Select value={fy} onChange={(e) => { setFy(e.target.value); setFrom(''); setTo(''); }} className="sm:w-52" aria-label="Financial year">
          <option value="">Current financial year</option>{fys.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setFy(''); }} className="sm:w-40" aria-label="From" />
          <span className="text-xs text-slate-400">to</span>
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setFy(''); }} className="sm:w-40" aria-label="To" />
        </div>
      </div>
      {isLoading ? <PageLoader /> : error ? <p className="text-sm text-red-700">{(error as Error).message}</p> : data && <FinanceFigures data={data} />}
    </div>
  );
}
