import type { MemberStats } from '@/modules/members/types';
import type { MapBranch } from '@/components/BranchMap';

export interface AttentionItem { key: string; label: string; count: number; link: string; severity: 'info' | 'warning' | 'critical' }

export interface DashboardData {
  generated_at: string;
  scope: { filtered_unit: { id: string; name: string; unit_type: string } | null; jurisdiction: { id: string; name: string; unit_type: string }[] };
  structure?: { regions: number; districts: number; branches: number; congregations: number; inactive_branches: number; planned: number; branch_list: MapBranch[] };
  membership?: MemberStats;
  attention?: { items: AttentionItem[] };
  [section: string]: unknown;
}

export interface DashboardFilters { region: string; district: string; branch: string; from: string; to: string; financial_year: string; department: string }
