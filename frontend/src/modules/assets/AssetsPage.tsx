import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Boxes, Plus, ShieldAlert, Wallet, Wrench } from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, CardHeader, DataTable, PageHeader, PageLoader, SearchInput, Select, StatCard, StatusBadge, Tabs, Toolbar, type Column } from '@/components/ui';
import { BarsChart, ChartCard, DonutChart } from '@/components/charts';
import { ExportMenu } from '@/components/ExportMenu';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { compact, date, money, moneyShort } from '@/lib/format';
import { Link } from 'react-router-dom';
import { AssetForm } from './AssetForm';
import { CONDITIONS, STATUSES, statusLabel, type AssetListItem, type AssetSummary } from './types';

export function AssetFigures({ s }: { s: AssetSummary }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Assets on register" value={s.count.toLocaleString()} hint={s.disposed ? `${s.disposed} disposed` : undefined} icon={<Boxes className="h-5 w-5" />} to="/assets" />
        <StatCard label="Book value" value={moneyShort(s.book_value)} hint={`${money(s.book_value)} · cost ${moneyShort(s.total_cost)}`} icon={<Wallet className="h-5 w-5" />} tone="gold" />
        <StatCard label="Poor or unserviceable" value={s.needs_attention.toLocaleString()} icon={<AlertTriangle className="h-5 w-5" />} tone={s.needs_attention ? 'red' : 'slate'} to="/assets?condition=poor" />
        <StatCard label="Maintenance due (30 days)" value={s.maintenance_due.length.toLocaleString()} hint={s.insurance_expiring ? `${s.insurance_expiring} insurance renewals due` : undefined} icon={<Wrench className="h-5 w-5" />} tone={s.maintenance_due.some((m) => m.overdue) ? 'red' : 'slate'} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Value by category" subtitle="Current book value after depreciation" height={Math.max(240, s.by_category.length * 30)}
            table={{ columns: ['Category', 'Assets', 'Cost', 'Book value'], rows: s.by_category.map((c) => [c.category, c.count, Number(c.cost), Number(c.book_value)]) }}>
            <BarsChart data={s.by_category.map((c) => ({ name: c.category, value: Number(c.book_value) }))} x="name" series={[{ key: 'value', label: 'Book value' }]} horizontal valueFormat={(v) => compact(v)} />
          </ChartCard>
        </div>
        <ChartCard title="Condition" table={{ columns: ['Condition', 'Assets'], rows: s.by_condition.map((c) => [c.label, c.count]) }}>
          <DonutChart data={s.by_condition.filter((c) => c.count > 0).map((c) => ({ label: c.label, count: c.count }))} />
        </ChartCard>
      </div>
      {s.maintenance_due.length > 0 && (
        <Card>
          <CardHeader title="Maintenance due" icon={<ShieldAlert className="h-4 w-4" />} />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {s.maintenance_due.map((m) => (
              <li key={m.asset}><Link to={`/assets/${m.asset}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <span>{m.name} <span className="text-xs text-slate-500">{m.asset_no}</span></span>
                <span className={m.overdue ? 'font-medium text-red-700' : 'text-slate-500'}>{m.overdue ? 'Overdue since ' : 'Due '}{date(m.due)}</span>
              </Link></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function AssetsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'analytics' ? 'analytics' : 'register';
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState(params.get('condition') || '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const cats = useLookup('asset-categories');
  const query = { search: search || undefined, org_unit: unit || undefined, category: category || undefined, condition: condition || undefined, status: status || undefined, on_register: status ? undefined : true };
  const list = useQuery({ queryKey: ['assets', 'list', query, page], queryFn: () => api<Page<AssetListItem>>('/assets/', { params: { ...query, page } }), placeholderData: keepPreviousData, enabled: tab === 'register' });
  const summary = useQuery({ queryKey: ['assets', 'summary', unit], queryFn: () => api<AssetSummary>('/assets/summary/', { params: { org_unit: unit || undefined } }), enabled: tab === 'analytics' });
  const reset = () => setPage(1);
  const cols: Column<AssetListItem>[] = [
    { key: 'asset', header: 'Asset', render: (a) => <div><p className="font-medium">{a.name} {a.is_demo && <Badge>demo</Badge>}</p><p className="font-mono text-xs text-slate-500">{a.asset_no || 'Pending number'}</p></div> },
    { key: 'cat', header: 'Category', hideOnMobile: true, render: (a) => a.category_name },
    { key: 'unit', header: 'Unit · location', render: (a) => <div className="text-sm"><p>{a.org_unit_name}</p><p className="text-xs text-slate-500">{a.location}</p></div> },
    { key: 'cond', header: 'Condition', render: (a) => <StatusBadge status={a.condition} label={CONDITIONS.find(([v]) => v === a.condition)?.[1]} /> },
    { key: 'status', header: 'Status', hideOnMobile: true, render: (a) => <StatusBadge status={a.status} label={statusLabel(a.status)} /> },
    { key: 'value', header: 'Book value', align: 'right', render: (a) => money(a.book_value, a.currency) },
  ];
  return (
    <div>
      <PageHeader title="Assets & property" subtitle="Church buildings, land, vehicles, equipment and instruments."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Assets' }]}
        actions={can('assets.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Register asset</Button>} />
      <Tabs value={tab} onChange={(t) => setParams(t === 'analytics' ? { tab: t } : {})} tabs={[{ value: 'register', label: 'Register' }, { value: 'analytics', label: 'Analysis' }]} />
      {tab === 'register' ? (
        <Card>
          <Toolbar>
            <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder="Name, number, serial, location…" className="sm:w-64" />
            <UnitSelect value={unit} onChange={(v) => { setUnit(v); reset(); }} className="sm:w-56" />
            <Select value={category} onChange={(e) => { setCategory(e.target.value); reset(); }} className="sm:w-48" aria-label="Category"><option value="">Any category</option>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select value={condition} onChange={(e) => { setCondition(e.target.value); reset(); }} className="sm:w-40" aria-label="Condition"><option value="">Any condition</option>{CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} className="sm:w-48" aria-label="Status"><option value="">On the register</option>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <div className="sm:ml-auto"><ExportMenu path="/assets/export/" params={query} module="assets" name="asset-register" /></div>
          </Toolbar>
          <DataTable columns={cols} rows={list.data?.results} loading={list.isFetching} total={list.data?.count} page={page} onPage={setPage} onRowClick={(a) => navigate(`/assets/${a.id}`)} emptyTitle="No assets" emptyMessage="Registered church property appears here." />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end"><UnitSelect value={unit} onChange={setUnit} className="sm:w-64" placeholder="Whole jurisdiction" /></div>
          {summary.isLoading ? <PageLoader /> : summary.data && <AssetFigures s={summary.data} />}
        </div>
      )}
      {creating && <AssetForm onClose={() => setCreating(false)} onSaved={(id) => navigate(`/assets/${id}`)} />}
    </div>
  );
}
