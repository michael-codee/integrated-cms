import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Droplets, TrendingUp, UserCheck, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { PageLoader, StatCard } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { BarsChart, ChartCard, DonutChart, TrendChart, monthLabel } from '@/components/charts';
import { num } from '@/lib/format';
import type { MemberStats } from './types';

export function MemberAnalytics() {
  const [unit, setUnit] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['members', 'stats', unit], queryFn: () => api<MemberStats>('/members/stats/', { params: { org_unit: unit } }) });
  if (isLoading || !data) return <PageLoader />;
  const growth = data.growth.map((g) => ({ ...g, label: monthLabel(g.month) }));
  return (
    <div className="space-y-6">
      <div className="flex justify-end"><UnitSelect value={unit} onChange={setUnit} placeholder="Whole jurisdiction" className="sm:w-72" /></div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Active members" value={num(data.active)} hint={`${num(data.total)} on register`} icon={<Users className="h-5 w-5" />} />
        <StatCard label="New this month" value={num(data.new_this_month)} hint={`${num(data.new_this_year)} this year`} icon={<UserPlus className="h-5 w-5" />} tone="green" />
        <StatCard label="Baptized" value={num(data.baptized)} hint={data.active ? `${Math.round((data.baptized / data.active) * 100)}% of active` : undefined} icon={<Droplets className="h-5 w-5" />} tone="purple" />
        <StatCard label="Transfers this year" value={num(data.transfers_this_year)} icon={<UserCheck className="h-5 w-5" />} tone="gold" />
        <StatCard label="12-month growth" value={data.growth_rate_year == null ? '—' : `${data.growth_rate_year > 0 ? '+' : ''}${data.growth_rate_year}%`} hint={data.growth_rate_month == null ? undefined : `${data.growth_rate_month}% last month`} icon={<TrendingUp className="h-5 w-5" />} tone="slate" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Membership growth" subtitle="Members on the register at each month end" table={{ columns: ['Month', 'New', 'Exits', 'Total'], rows: growth.map((g) => [g.label, g.new, g.exits, g.total]) }}>
          <TrendChart data={growth} x="label" series={[{ key: 'total', label: 'Members' }]} area />
        </ChartCard>
        <ChartCard title="New members per month" table={{ columns: ['Month', 'New members'], rows: growth.map((g) => [g.label, g.new]) }}>
          <BarsChart data={growth} x="label" series={[{ key: 'new', label: 'New members' }]} />
        </ChartCard>
        <ChartCard title="Gender (active members)" table={{ columns: ['Gender', 'Members'], rows: data.by_gender.map((g) => [g.label, g.count]) }}>
          <DonutChart data={data.by_gender} />
        </ChartCard>
        <ChartCard title="Age groups (active members)" table={{ columns: ['Age group', 'Members'], rows: data.by_age_group.map((g) => [g.label, g.count]) }}>
          <BarsChart data={data.by_age_group} x="label" series={[{ key: 'count', label: 'Members' }]} />
        </ChartCard>
        <ChartCard title="Members by region" table={{ columns: ['Region', 'Members'], rows: data.by_region.map((r) => [r.name, r.count]) }}>
          <BarsChart data={data.by_region} x="name" series={[{ key: 'count', label: 'Members' }]} horizontal />
        </ChartCard>
        <ChartCard title="Members by district" table={{ columns: ['District', 'Members'], rows: data.by_district.map((r) => [r.name, r.count]) }}>
          <BarsChart data={data.by_district} x="name" series={[{ key: 'count', label: 'Members' }]} horizontal />
        </ChartCard>
        <ChartCard title="Members by branch" height={Math.max(260, data.by_branch.length * 30)} table={{ columns: ['Branch', 'Members'], rows: data.by_branch.map((r) => [r.name, r.count]) }}>
          <BarsChart data={data.by_branch} x="name" series={[{ key: 'count', label: 'Members' }]} horizontal />
        </ChartCard>
        <ChartCard title="Baptisms per month" table={{ columns: ['Month', 'Baptisms'], rows: data.baptisms_by_month.map((b) => [monthLabel(b.month), b.count]) }}>
          <BarsChart data={data.baptisms_by_month.map((b) => ({ ...b, label: monthLabel(b.month) }))} x="label" series={[{ key: 'count', label: 'Baptisms' }]} />
        </ChartCard>
      </div>
    </div>
  );
}
