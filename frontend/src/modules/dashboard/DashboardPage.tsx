import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api, OfflineError } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Button, EmptyState, PageHeader, PageLoader } from '@/components/ui';
import { getMeta, setMeta } from '@/offline/db';
import { dateTime } from '@/lib/format';
import { DashboardFilters } from './DashboardFilters';
import { AnnouncementsSection, AttentionSection, DASHBOARD_SECTIONS } from './sections';
import type { DashboardData, DashboardFilters as F } from './types';

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
  const scopeLabel = data?.scope.filtered_unit?.name || data?.scope.jurisdiction.map((j) => j.name).join(', ');

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${user?.title ? user.title + ' ' : ''}${user?.full_name?.split(' ')[0] || ''}`}
        subtitle={scopeLabel ? `Overview of ${scopeLabel}` : 'Executive dashboard'}
        actions={can('dashboard.view') && <Button variant="secondary" size="sm" icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />} onClick={() => refetch()}>Refresh</Button>} />
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
