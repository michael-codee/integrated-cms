import { Building2, Church, Globe2, Users } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui';
import { useOrgUnits } from '@/lib/queries';

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: units = [] } = useOrgUnits();
  const count = (t: string) => units.filter((u) => u.unit_type === t && u.status === 'active').length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <div>
      <PageHeader title={`${greeting}, ${user?.title ? user.title + ' ' : ''}${user?.full_name?.split(' ')[0] || ''}`}
        subtitle={user?.assignments.map((a) => `${a.role_name} · ${a.org_unit_name}`).join(' | ')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Regions" value={count('region')} icon={<Globe2 className="h-5 w-5" />} to="/structure" />
        <StatCard label="Districts" value={count('district')} icon={<Building2 className="h-5 w-5" />} to="/structure" tone="purple" />
        <StatCard label="Branches" value={count('branch')} icon={<Church className="h-5 w-5" />} to="/structure" tone="gold" />
        <StatCard label="Congregations" value={count('congregation')} icon={<Users className="h-5 w-5" />} to="/structure" tone="green" />
      </div>
      <Card className="mt-6">
        <CardHeader title="Welcome to the RLWM Church Management Information System" />
        <CardBody className="font-serif text-sm italic text-slate-600 dark:text-slate-300">
          “Let all things be done decently and in order.” — 1 Corinthians 14:40
        </CardBody>
      </Card>
    </div>
  );
}
