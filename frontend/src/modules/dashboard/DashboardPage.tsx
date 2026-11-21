import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarCheck, HandCoins, RefreshCw, UserPlus } from 'lucide-react';
import { api, OfflineError } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Button, EmptyState, PageLoader, useRipple } from '@/components/ui';
import { getMeta, setMeta } from '@/offline/db';
import { dateTime, num } from '@/lib/format';
import { DashboardFilters } from './DashboardFilters';
import { AnnouncementsSection, AttentionSection, DASHBOARD_SECTIONS } from './sections';
import type { DashboardData, DashboardFilters as F } from './types';

function QuickAction({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  const ripple = useRipple();
  return (
    <Link to={to} onPointerDown={ripple.onPointerDown}
      className="relative inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-b from-gold-300 to-gold-400 px-4 text-sm font-semibold text-ink-950 shadow-btn-gold transition-[transform,background-color] duration-150 hover:from-gold-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-[0.96] [&_svg]:h-4 [&_svg]:w-4">
      {icon}{children}{ripple.layer}
    </Link>
  );
}

function Figure({ label, value, to }: { label: string; value: string; to?: string }) {
  const body = (
    <>
      <span className="block font-display text-3xl font-semibold leading-none text-white">{value}</span>
      <span className="mt-1 block text-xs text-royal-100/80">{label}</span>
    </>
  );
  return to ? <Link to={to} className="rounded-lg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400">{body}</Link> : <div>{body}</div>;
}

const EMPTY: F = { region: '', district: '', branch: '', from: '', to: '', financial_year: '', department: '' };

async function loadDashboard(params: Record<string, string>): Promise<DashboardData & { _cached?: boolean }> {
  const key = `dashboard:${JSON.stringify(params)}`;
  try {
    const data = await api<DashboardData>('/dashboard/', { params });
    setMeta(key, data);
    return data;
  } catch (e) {
    if (e instanceof OfflineError) {
      const cached = await getMeta<DashboardData>(key);
      if (cached) return { ...cached, _cached: true };
    }
    throw e;
  }
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const [filters, setFilters] = useState<F>(EMPTY);
  const params = useMemo(() => ({
    org_unit: filters.branch || filters.district || filters.region, from: filters.from, to: filters.to,
    financial_year: filters.financial_year, department: filters.department,
  }), [filters]);
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['dashboard', params], queryFn: () => loadDashboard(params), enabled: can('dashboard.view') });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const attention = data?.attention?.items.reduce((n, i) => n + i.count, 0) ?? 0;
  const scopeLabel = data?.scope.filtered_unit?.name || data?.scope.jurisdiction.map((j) => j.name).join(', ');

  return (
    <div>
      <section className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-ink-900 via-royal-900 to-royal-800 px-5 py-6 text-white shadow-lift sm:px-8 sm:py-7">
        <div aria-hidden className="river-wave pointer-events-none absolute inset-x-0 bottom-0 h-28 opacity-90" />
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-gold-400/10 blur-2xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-gold-300">{today}</p>
            <h1 className="mt-1 text-[1.9rem] font-semibold leading-tight text-white sm:text-4xl">{greeting}, {user?.title ? user.title + ' ' : ''}{user?.full_name?.split(' ')[0] || ''}</h1>
            <p className="mt-1.5 max-w-xl text-sm text-royal-100/85">{scopeLabel ? `Here is how ${scopeLabel} is doing.` : 'Here is how the ministry is doing.'}</p>
            {data && (
              <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
                {data.membership && <Figure label="Members on the register" value={num(data.membership.total)} to="/members" />}
                {data.structure && <Figure label="Operational branches" value={num(data.structure.branches)} to="/structure" />}
                {data.attention && <Figure label={attention === 1 ? 'Item waiting for you' : 'Items waiting for you'} value={num(attention)} />}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can('members.create') && <QuickAction to="/members?new=1" icon={<UserPlus />}>Register member</QuickAction>}
            {can('attendance.create') && <QuickAction to="/attendance?new=1" icon={<CalendarCheck />}>Record attendance</QuickAction>}
            {can('finance.create') && <QuickAction to="/finance/transactions?new=income" icon={<HandCoins />}>Record income</QuickAction>}
            {can('dashboard.view') && (
              <Button variant="ghost" className="text-white ring-1 ring-inset ring-white/25 hover:bg-white/10 hover:text-white dark:text-white" icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />} onClick={() => refetch()}>Refresh</Button>
            )}
          </div>
        </div>
      </section>
      {!can('dashboard.view') ? (
        <EmptyState title="Welcome" message="Your role does not include the dashboard. Use the menu to reach your modules." />
      ) : (
        <>
          <DashboardFilters value={filters} onChange={setFilters} />
          {isLoading ? <PageLoader label="Gathering figures…" /> : error ? (
            <EmptyState title="The dashboard could not be loaded" message={(error as Error).message} action={<Button onClick={() => refetch()}>Try again</Button>} />
          ) : data && (
            <div className="space-y-6">
              {data._cached && <p className="rounded-lg bg-gold-50 px-4 py-2 text-xs text-gold-900 dark:bg-gold-900/30 dark:text-gold-100">Offline: showing figures from {dateTime(data.generated_at)}.</p>}
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">{DASHBOARD_SECTIONS.slice(0, 1).map((s) => <s.component key={s.key} data={data} />)}</div>
                <div className="space-y-6"><AttentionSection data={data} /><AnnouncementsSection data={data} /></div>
              </div>
              {DASHBOARD_SECTIONS.slice(1).map((s) => <s.component key={s.key} data={data} />)}
              <p className="text-right text-xs text-slate-400">Figures computed from live records at {dateTime(data.generated_at)}.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
