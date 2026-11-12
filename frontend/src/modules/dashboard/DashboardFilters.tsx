import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Input, Select } from '@/components/ui';
import { useOrgUnits } from '@/lib/queries';
import type { DashboardFilters as F } from './types';

interface FY { id: string; name: string }

export function DashboardFilters({ value, onChange }: { value: F; onChange: (f: F) => void }) {
  const { data: units = [] } = useOrgUnits();
  const fys = useQuery({ queryKey: ['financial-years'], queryFn: () => api<FY[]>('/financial-years/') });
  const regions = units.filter((u) => u.unit_type === 'region');
  const districts = units.filter((u) => u.unit_type === 'district' && (!value.region || u.parent === value.region));
  const branches = units.filter((u) => u.unit_type === 'branch' && (!value.district ? !value.region || u.lineage?.some((l) => l.id === value.region) : u.parent === value.district));
  const set = (patch: Partial<F>) => onChange({ ...value, ...patch });
  const dirty = Object.values(value).some(Boolean);
  return (
    <div className="no-print mb-6 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:flex-wrap sm:items-center">
      {regions.length > 1 && (
        <Select value={value.region} onChange={(e) => set({ region: e.target.value, district: '', branch: '' })} className="sm:w-44" aria-label="Region">
          <option value="">All regions</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      )}
      {districts.length > 1 && (
        <Select value={value.district} onChange={(e) => set({ district: e.target.value, branch: '' })} className="sm:w-44" aria-label="District">
          <option value="">All districts</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      )}
      {branches.length > 1 && (
        <Select value={value.branch} onChange={(e) => set({ branch: e.target.value })} className="sm:w-52" aria-label="Branch">
          <option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      )}
      <Select value={value.financial_year} onChange={(e) => set({ financial_year: e.target.value, from: '', to: '' })} className="sm:w-52" aria-label="Financial year">
        <option value="">Current financial year</option>{fys.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </Select>
      <div className="flex items-center gap-2">
        <Input type="date" value={value.from} onChange={(e) => set({ from: e.target.value, financial_year: '' })} className="sm:w-40" aria-label="From date" />
        <span className="text-xs text-slate-400">to</span>
        <Input type="date" value={value.to} onChange={(e) => set({ to: e.target.value, financial_year: '' })} className="sm:w-40" aria-label="To date" />
      </div>
      {dirty && <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => onChange({ region: '', district: '', branch: '', from: '', to: '', financial_year: '', department: '' })}>Reset</Button>}
    </div>
  );
}
