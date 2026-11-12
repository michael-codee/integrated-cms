/**
 * Dashboard sections rendered from /api/dashboard/. Each later module adds a
 * section component here (finance, assets, programs, reports…). A section
 * renders only when the API returned data for it (i.e. the user has access).
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Building2, CheckCircle2, Church, Droplets, Globe2, TrendingUp, UserPlus, Users } from 'lucide-react';
import { Card, CardBody, CardHeader, PageLoader, StatCard } from '@/components/ui';
import { BarsChart, ChartCard, DonutChart, TrendChart, monthLabel } from '@/components/charts';
import { num } from '@/lib/format';
import type { DashboardData } from './types';

const BranchMap = lazy(() => import('@/components/BranchMap'));

export type SectionComponent = (props: { data: DashboardData }) => ReactNode;

function AttentionSection({ data }: { data: DashboardData }) {
  const items = data.attention?.items || [];
  return (
    <Card>
      <CardHeader title="Requires your attention" icon={<AlertCircle className="h-4 w-4" />} />
      <CardBody className="p-0">
        {items.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((i) => (
              <li key={i.key}>
                <Link to={i.link} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <span className="flex items-center gap-3">
                    <span className={`flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-2 text-xs font-semibold ${i.severity === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : i.severity === 'warning' ? 'bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200' : 'bg-royal-100 text-royal-700 dark:bg-royal-900/40 dark:text-royal-200'}`}>{i.count}</span>
                    {i.label}
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Nothing is waiting for you. All is in order.</p>
        )}
      </CardBody>
    </Card>
  );
}

function StructureKpis({ data }: { data: DashboardData }) {
  const s = data.structure;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 gap-4">
      <StatCard label="Regions" value={num(s.regions)} icon={<Globe2 className="h-5 w-5" />} to="/structure" tone="slate" />
      <StatCard label="Districts" value={num(s.districts)} icon={<Building2 className="h-5 w-5" />} to="/structure" tone="slate" />
      <StatCard label="Operational branches" value={num(s.branches)} hint={s.inactive_branches ? `${s.inactive_branches} inactive` : s.planned ? `${s.planned} planned` : undefined} icon={<Church className="h-5 w-5" />} to="/structure" tone="gold" />
      <StatCard label="Congregations" value={num(s.congregations)} icon={<Users className="h-5 w-5" />} to="/structure" tone="slate" />
    </div>
  );
}

function MembershipSection({ data }: { data: DashboardData }) {
  const m = data.membership;
  if (!m) return null;
  const growth = m.growth.map((g) => ({ ...g, label: monthLabel(g.month) }));
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Membership</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total members" value={num(m.total)} hint={`${num(m.active)} active · ${num(m.inactive)} inactive`} icon={<Users className="h-5 w-5" />} to="/members" />
        <StatCard label="New this month" value={num(m.new_this_month)} hint={`${num(m.new_this_year)} this year`} icon={<UserPlus className="h-5 w-5" />} tone="green" to="/members?tab=analytics" />
        <StatCard label="Baptized" value={num(m.baptized)} icon={<Droplets className="h-5 w-5" />} tone="purple" />
        <StatCard label="Transfers this year" value={num(m.transfers_this_year)} icon={<ArrowRight className="h-5 w-5" />} tone="gold" to="/members/transfers" />
        <StatCard label="12-month growth" value={m.growth_rate_year == null ? '—' : `${m.growth_rate_year > 0 ? '+' : ''}${m.growth_rate_year}%`} icon={<TrendingUp className="h-5 w-5" />} tone="slate" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Membership growth" subtitle="Members on the register, last 12 months" table={{ columns: ['Month', 'New', 'Total'], rows: growth.map((g) => [g.label, g.new, g.total]) }}>
            <TrendChart data={growth} x="label" series={[{ key: 'total', label: 'Members' }]} area />
          </ChartCard>
        </div>
        <ChartCard title="Members by gender" table={{ columns: ['Gender', 'Members'], rows: m.by_gender.map((g) => [g.label, g.count]) }}>
          <DonutChart data={m.by_gender} />
        </ChartCard>
        <ChartCard title={m.by_region.length > 1 ? 'Distribution by region' : 'Distribution by district'} table={{ columns: ['Unit', 'Members'], rows: (m.by_region.length > 1 ? m.by_region : m.by_district).map((r) => [r.name, r.count]) }}>
          <BarsChart data={m.by_region.length > 1 ? m.by_region : m.by_district} x="name" series={[{ key: 'count', label: 'Members' }]} horizontal />
        </ChartCard>
        <div className="lg:col-span-2">
          <ChartCard title="Branch comparison" subtitle="Active members per branch" height={Math.max(260, m.by_branch.length * 28)} table={{ columns: ['Branch', 'Members'], rows: m.by_branch.map((r) => [r.name, r.count]) }}>
            <BarsChart data={m.by_branch} x="name" series={[{ key: 'count', label: 'Members' }]} horizontal />
          </ChartCard>
        </div>
        <ChartCard title="Age groups" table={{ columns: ['Age group', 'Members'], rows: m.by_age_group.map((g) => [g.label, g.count]) }}>
          <BarsChart data={m.by_age_group} x="label" series={[{ key: 'count', label: 'Members' }]} />
        </ChartCard>
      </div>
    </section>
  );
}

function MapSection({ data }: { data: DashboardData }) {
  const list = data.structure?.branch_list || [];
  if (!list.length) return null;
  return (
    <Card>
      <CardHeader title="Where our branches are" subtitle="Circle size reflects active membership" />
      <CardBody>
        <Suspense fallback={<PageLoader />}><BranchMap branches={list} height={380} /></Suspense>
      </CardBody>
    </Card>
  );
}

/** Ordered list of sections; later phases insert theirs. */
export const DASHBOARD_SECTIONS: { key: string; component: SectionComponent }[] = [
  { key: 'structure', component: StructureKpis },
  { key: 'membership', component: MembershipSection },
  { key: 'map', component: MapSection },
];

export { AttentionSection };
