import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, HeartHandshake, Plus, Sparkles, UserPlus, Users } from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, DataTable, Field, Input, PageHeader, PageLoader, Select, StatCard, Tabs, Toolbar, type Column } from '@/components/ui';
import { BarsChart, ChartCard, DonutChart, TrendChart } from '@/components/charts';
import { ExportMenu } from '@/components/ExportMenu';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { date, num } from '@/lib/format';
import { AttendanceForm } from './AttendanceForm';
import { GENDERS, MINISTRIES, type AttendanceRecord, type AttendanceStats } from './types';

const weekLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function AttendanceFigures({ s }: { s: AttendanceStats }) {
  const weekly = s.weekly.map((w) => ({ ...w, label: weekLabel(w.week) }));
  const weeklyServices = s.by_weekly_service || [];
  const serviceName = (key: string, fallback: string) => weeklyServices.find((w) => w.key === key)?.name || fallback;
  const weeklySeries = (['sunday', 'tuesday', 'friday'] as const)
    .map((key) => ({ key, label: serviceName(key, key[0].toUpperCase() + key.slice(1)) }))
    .filter((x) => weekly.some((w) => w[x.key]));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Average Sunday attendance" value={num(s.average_sunday)} hint={`${num(s.gatherings)} gatherings recorded`} icon={<Users className="h-5 w-5" />} to="/attendance?tab=analysis" />
        <StatCard label="Total attendance" value={num(s.total_attendance)} hint={`${num(s.visitors)} visitors`} icon={<CalendarCheck className="h-5 w-5" />} tone="slate" />
        <StatCard label="First-time guests" value={num(s.first_timers)} icon={<UserPlus className="h-5 w-5" />} tone="gold" />
        <StatCard label="New converts" value={num(s.new_converts)} icon={<Sparkles className="h-5 w-5" />} tone="green" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Weekly services by week" subtitle="Sunday Divine Service, Tuesday Bible Studies and Friday Prayer and Deliverance Service in the selected units"
            table={{ columns: ['Week of', ...weeklySeries.map((x) => x.label)], rows: weekly.map((w) => [w.label, ...weeklySeries.map((x) => w[x.key] ?? 0)]) }}>
            <TrendChart data={weekly} x="label" series={weeklySeries.length ? weeklySeries : [{ key: 'sunday', label: 'Sunday attendance' }]} area={weeklySeries.length < 2} />
          </ChartCard>
        </div>
        <ChartCard title="Who attends on Sundays" subtitle="By ministry" table={{ columns: ['Ministry', 'Attendances'], rows: s.composition.map((c) => [c.label, c.count]) }}>
          <DonutChart data={s.composition.filter((c) => c.count > 0)} />
        </ChartCard>
        {weeklyServices.some((w) => w.gatherings > 0) && (
          <div className="lg:col-span-3">
            <ChartCard title="Weekly services by ministry and gender" subtitle="Total attendance over the period; the table also shows the average per service"
              height={Math.max(220, weeklyServices.length * 70)}
              table={{
                columns: ['Service', 'Held', 'Average', ...MINISTRIES.map(([, l]) => l), ...GENDERS.map(([, l]) => l)],
                rows: weeklyServices.map((w) => [w.name, w.gatherings, w.average, ...MINISTRIES.map(([k]) => w.ministry[k]), ...GENDERS.map(([k]) => w.gender[k])]),
              }}>
              <BarsChart data={weeklyServices.map((w) => ({ name: w.name, ...w.ministry }))} x="name" series={MINISTRIES.map(([key, label]) => ({ key, label }))} horizontal stacked />
            </ChartCard>
          </div>
        )}
        {(s.gender || []).some((g) => g.count > 0) && (
          <ChartCard title="Sunday attendance by gender" table={{ columns: ['Gender', 'Attendances'], rows: s.gender.map((g) => [g.label, g.count]) }}>
            <DonutChart data={s.gender.filter((g) => g.count > 0)} />
          </ChartCard>
        )}
        <ChartCard title="Average by service type" table={{ columns: ['Service', 'Average', 'Gatherings'], rows: s.by_service_type.map((t) => [t.name, t.average, t.gatherings]) }} height={Math.max(220, s.by_service_type.length * 34)}>
          <BarsChart data={s.by_service_type} x="name" series={[{ key: 'average', label: 'Average attendance' }]} horizontal />
        </ChartCard>
        {s.by_branch.length > 1 && (
          <div className="lg:col-span-2">
            <ChartCard title="Branch comparison" subtitle="Average Sunday attendance; the table shows attendance as a share of active members"
              height={Math.max(240, s.by_branch.length * 28)}
              table={{ columns: ['Branch', 'Average Sunday', 'Sundays', 'Members', 'Attendance %'], rows: s.by_branch.map((b) => [b.name, b.average, b.sundays, b.members, b.ratio == null ? '—' : `${b.ratio}%`]) }}>
              <BarsChart data={s.by_branch} x="name" series={[{ key: 'average', label: 'Average Sunday' }]} horizontal />
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AttendancePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'analysis' ? 'analysis' : 'records';
  const [unit, setUnit] = useState('');
  const [service, setService] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AttendanceRecord | true | null>(() => (params.get('new') === '1' ? true : null));
  const services = useLookup('service-types');
  const query = { org_unit: unit || undefined, service_type: service || undefined, date_from: from || undefined, date_to: to || undefined, ordering: '-date' };
  const list = useQuery({ queryKey: ['attendance', 'list', query, page], queryFn: () => api<Page<AttendanceRecord>>('/attendance/', { params: { ...query, page } }), placeholderData: keepPreviousData, enabled: tab === 'records' });
  const stats = useQuery({ queryKey: ['attendance', 'stats', unit, from, to], queryFn: () => api<AttendanceStats>('/attendance/stats/', { params: { org_unit: unit || undefined, from: from || undefined, to: to || undefined } }), enabled: tab === 'analysis' });
  const cols: Column<AttendanceRecord>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="whitespace-nowrap">{date(r.date)}</span> },
    { key: 'what', header: 'Gathering', render: (r) => <div><p className="font-medium">{r.program_title || r.service_type_name} {r.is_demo && <Badge>demo</Badge>}</p><p className="text-xs text-slate-500">{[r.program_title && r.service_type_name, r.department_name, r.is_individual && 'register'].filter(Boolean).join(' · ')}</p></div> },
    { key: 'unit', header: 'Unit', hideOnMobile: true, render: (r) => r.org_unit_name },
    { key: 'mw', header: 'Men · Women', align: 'right', hideOnMobile: true, render: (r) => `${r.men} · ${r.women}` },
    { key: 'yya', header: 'Youth · Young adults', align: 'right', hideOnMobile: true, render: (r) => `${r.youth} · ${r.young_adults}` },
    { key: 'ch', header: 'Children', align: 'right', hideOnMobile: true, render: (r) => r.children },
    { key: 'mf', header: 'Male · Female', align: 'right', hideOnMobile: true, render: (r) => `${r.male} · ${r.female}` },
    { key: 'new', header: 'First-timers', align: 'right', hideOnMobile: true, render: (r) => r.first_timers },
    { key: 'total', header: 'Total', align: 'right', render: (r) => <strong className="tabular-nums">{r.total.toLocaleString()}</strong> },
  ];
  const reset = () => setPage(1);
  return (
    <div>
      <PageHeader title="Attendance" subtitle="Service, program and departmental meeting attendance across your jurisdiction."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Attendance' }]}
        actions={can('attendance.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(true)}>Record attendance</Button>} />
      <Tabs value={tab} onChange={(t) => setParams(t === 'analysis' ? { tab: t } : {})} tabs={[{ value: 'records', label: 'Records' }, { value: 'analysis', label: 'Analysis' }]} />
      <Card className={tab === 'analysis' ? 'mb-4' : undefined}>
        <Toolbar>
          <UnitSelect value={unit} onChange={(v) => { setUnit(v); reset(); }} className="sm:w-56" placeholder="Whole jurisdiction" />
          {tab === 'records' && <Select value={service} onChange={(e) => { setService(e.target.value); reset(); }} className="sm:w-48" aria-label="Service type"><option value="">Any service</option>{(services.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
          <Field><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} aria-label="From" className="sm:w-40" /></Field>
          <Field><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} aria-label="To" className="sm:w-40" /></Field>
          {tab === 'records' && <div className="sm:ml-auto"><ExportMenu path="/attendance/export/" params={query} module="attendance" name="attendance" /></div>}
        </Toolbar>
        {tab === 'records' && (
          <DataTable columns={cols} rows={list.data?.results} loading={list.isFetching} total={list.data?.count} page={page} onPage={setPage}
            onRowClick={can('attendance.edit') ? (r) => setEditing(r) : undefined} emptyTitle="No attendance recorded" emptyMessage="Record Sunday, Tuesday and Friday head counts to see trends." />
        )}
      </Card>
      {tab === 'analysis' && (stats.isLoading ? <PageLoader /> : stats.data && (stats.data.gatherings ? <AttendanceFigures s={stats.data} /> : <Card className="p-10 text-center text-sm text-slate-500"><HeartHandshake className="mx-auto mb-2 h-6 w-6" />No attendance recorded for this selection.</Card>))}
      {editing && <AttendanceForm record={editing === true ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
