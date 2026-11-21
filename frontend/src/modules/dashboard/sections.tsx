/**
 * Dashboard sections rendered from /api/dashboard/. Each later module adds a
 * section component here (finance, assets, programs, reports…). A section
 * renders only when the API returned data for it (i.e. the user has access).
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Boxes, Building2, CalendarCheck, CalendarDays, FileBarChart, Landmark, CheckCircle2, Church, Droplets, Globe2, HeartHandshake, Megaphone, Pin, Sparkles, TrendingUp, UserPlus, Users } from 'lucide-react';
import { Card, CardBody, CardHeader, PageLoader, SectionTitle, StatCard } from '@/components/ui';
import { BarsChart, ChartCard, DonutChart, TrendChart, monthLabel } from '@/components/charts';
import { dateTime, num } from '@/lib/format';
import { StatusBadge } from '@/components/ui';
import type { AttendanceStats } from '@/modules/attendance/types';
import { programStatusLabel } from '@/modules/programs/types';
import type { DashboardData } from './types';
import type { FinanceSummary } from '@/modules/finance/types';
import type { AssetSummary } from '@/modules/assets/types';

const BranchMap = lazy(() => import('@/components/BranchMap'));
const FinanceFigures = lazy(() => import('@/modules/finance/FinanceOverviewPage').then((m) => ({ default: m.FinanceFigures })));
const AttendanceFigures = lazy(() => import('@/modules/attendance/AttendancePage').then((m) => ({ default: m.AttendanceFigures })));
const AssetFigures = lazy(() => import('@/modules/assets/AssetsPage').then((m) => ({ default: m.AssetFigures })));

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
      <StatCard label="Regions" value={num(s.regions)} icon={<Globe2 className="h-5 w-5" />} to="/structure" tone="river" />
      <StatCard label="Districts" value={num(s.districts)} icon={<Building2 className="h-5 w-5" />} to="/structure" tone="royal" />
      <StatCard label="Operational branches" value={num(s.branches)} hint={s.inactive_branches ? `${s.inactive_branches} inactive` : s.planned ? `${s.planned} planned` : undefined} icon={<Church className="h-5 w-5" />} to="/structure" tone="gold" />
      <StatCard label="Congregations" value={num(s.congregations)} icon={<Users className="h-5 w-5" />} to="/structure" tone="purple" />
    </div>
  );
}

function MembershipSection({ data }: { data: DashboardData }) {
  const m = data.membership;
  if (!m) return null;
  const growth = m.growth.map((g) => ({ ...g, label: monthLabel(g.month) }));
  return (
    <section className="space-y-4">
      <SectionTitle icon={<Users />}>Membership</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total members" value={num(m.total)} hint={`${num(m.active)} active · ${num(m.inactive)} inactive`} icon={<Users className="h-5 w-5" />} to="/members" />
        <StatCard label="New this month" value={num(m.new_this_month)} hint={`${num(m.new_this_year)} this year`} icon={<UserPlus className="h-5 w-5" />} tone="green" to="/members?tab=analytics" />
        <StatCard label="Baptized" value={num(m.baptized)} icon={<Droplets className="h-5 w-5" />} tone="purple" />
        <StatCard label="Transfers this year" value={num(m.transfers_this_year)} icon={<ArrowRight className="h-5 w-5" />} tone="gold" to="/members/transfers" />
        <StatCard label="12-month growth" value={m.growth_rate_year == null ? '—' : `${m.growth_rate_year > 0 ? '+' : ''}${m.growth_rate_year}%`} icon={<TrendingUp className="h-5 w-5" />} tone="river" />
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

function FinanceSection({ data }: { data: DashboardData }) {
  const f = data.finance as FinanceSummary | undefined;
  if (!f) return null;
  return (
    <section className="space-y-4">
      <SectionTitle icon={<Landmark />} tone="gold">Finance{f.financial_year ? `, ${f.financial_year}` : ''}</SectionTitle>
      <Suspense fallback={<PageLoader />}><FinanceFigures data={f} /></Suspense>
    </section>
  );
}

function AssetsSection({ data }: { data: DashboardData }) {
  const a = data.assets as AssetSummary | undefined;
  if (!a) return null;
  return (
    <section className="space-y-4">
      <SectionTitle icon={<Boxes />} tone="slate">Assets &amp; property</SectionTitle>
      <Suspense fallback={<PageLoader />}><AssetFigures s={a} /></Suspense>
    </section>
  );
}

interface ProgramsData { upcoming: { id: string; title: string; starts_at: string; org_unit_name: string; category_name: string; status: string; venue: string }[]; this_year: number; completed: number; salvations: number; baptisms: number }

function ProgramsSection({ data }: { data: DashboardData }) {
  const p = data.programs as ProgramsData | undefined;
  if (!p) return null;
  return (
    <section className="space-y-4">
      <SectionTitle icon={<CalendarDays />} tone="purple">Programs &amp; events</SectionTitle>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Programs this year" value={num(p.this_year)} hint={`${num(p.completed)} held`} icon={<CalendarDays className="h-5 w-5" />} to="/programs" />
          <StatCard label="Decisions for Christ" value={num(p.salvations)} hint="Reported this year" icon={<Sparkles className="h-5 w-5" />} tone="green" />
          <StatCard label="Baptisms" value={num(p.baptisms)} hint="At programs this year" icon={<Droplets className="h-5 w-5" />} tone="purple" />
          <StatCard label="Coming up" value={num(p.upcoming.length)} hint="Next scheduled" icon={<HeartHandshake className="h-5 w-5" />} tone="gold" to="/programs" />
        </div>
        <Card className="lg:col-span-2">
          <CardHeader title="Upcoming programs" actions={<Link to="/programs" className="text-xs font-medium text-royal-700 hover:underline dark:text-royal-300">Calendar</Link>} />
          {p.upcoming.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {p.upcoming.map((u) => (
                <li key={u.id}><Link to={`/programs/${u.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <span className="min-w-0"><span className="block truncate font-medium">{u.title}</span><span className="block truncate text-xs text-slate-500">{dateTime(u.starts_at)} · {u.org_unit_name}{u.venue ? ` · ${u.venue}` : ''}</span></span>
                  <StatusBadge status={u.status} label={programStatusLabel(u.status)} />
                </Link></li>
              ))}
            </ul>
          ) : <p className="px-5 py-6 text-sm text-slate-500">Nothing scheduled yet.</p>}
        </Card>
      </div>
    </section>
  );
}

function AttendanceSection({ data }: { data: DashboardData }) {
  const a = data.attendance as AttendanceStats | undefined;
  if (!a || !a.gatherings) return null;
  return (
    <section className="space-y-4">
      <SectionTitle icon={<CalendarCheck />} tone="green">Attendance</SectionTitle>
      <Suspense fallback={<PageLoader />}><AttendanceFigures s={a} /></Suspense>
    </section>
  );
}

interface AnnouncementsData { items: { id: string; title: string; body: string; priority: string; org_unit_name: string; publish_at: string; is_pinned: boolean }[] }

export function AnnouncementsSection({ data }: { data: DashboardData }) {
  const a = data.announcements as AnnouncementsData | undefined;
  if (!a?.items.length) return null;
  return (
    <Card>
      <CardHeader title="Announcements" icon={<Megaphone className="h-4 w-4" />} actions={<Link to="/announcements" className="text-xs font-medium text-royal-700 hover:underline dark:text-royal-300">All</Link>} />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {a.items.slice(0, 3).map((i) => (
          <li key={i.id} className="px-5 py-3">
            <p className="flex items-center gap-2 text-sm font-medium">{i.is_pinned && <Pin className="h-3 w-3 text-gold-600" aria-label="Pinned" />}{i.title}{i.priority !== 'normal' && <StatusBadge status={i.priority} label={i.priority} />}</p>
            <p className="line-clamp-2 text-xs text-slate-600 dark:text-slate-400">{i.body}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{i.org_unit_name}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface ReportsData { compliance: { template: { id: string; name: string }; period: { label: string; due: string }; expected: number; rate: number | null; on_time_rate: number | null; overdue_count: number; overdue: { org_unit_name: string; parent_name: string; submission: string | null }[] }[] }

function ReportsSection({ data }: { data: DashboardData }) {
  const r = data.reports as ReportsData | undefined;
  if (!r?.compliance.length) return null;
  return (
    <section className="space-y-4">
      <SectionTitle icon={<FileBarChart />} tone="river">Reporting compliance</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {r.compliance.map((c) => (
          <Card key={c.template.id}>
            <CardHeader title={c.template.name} subtitle={`${c.period.label} · ${c.expected} expected`} actions={<Link to="/reports?tab=compliance" className="text-xs font-medium text-royal-700 hover:underline dark:text-royal-300">Details</Link>} />
            <CardBody>
              <div className="flex items-baseline gap-2"><span className="font-display text-3xl font-semibold text-ink-900 dark:text-white">{c.rate ?? 0}%</span><span className="text-sm text-slate-500">submitted · {c.on_time_rate ?? 0}% on time</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-royal-600 to-river-500" style={{ width: `${c.rate ?? 0}%` }} /></div>
              {c.overdue_count > 0 && <p className="mt-3 text-xs text-red-700 dark:text-red-300">Overdue: {c.overdue.slice(0, 4).map((o) => o.org_unit_name).join(', ')}{c.overdue_count > 4 ? ` and ${c.overdue_count - 4} more` : ''}</p>}
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** Ordered list of sections; later phases insert theirs. */
export const DASHBOARD_SECTIONS: { key: string; component: SectionComponent }[] = [
  { key: 'structure', component: StructureKpis },
  { key: 'membership', component: MembershipSection },
  { key: 'finance', component: FinanceSection },
  { key: 'reports', component: ReportsSection },
  { key: 'attendance', component: AttendanceSection },
  { key: 'programs', component: ProgramsSection },
  { key: 'assets', component: AssetsSection },
  { key: 'map', component: MapSection },
];

export { AttentionSection };
