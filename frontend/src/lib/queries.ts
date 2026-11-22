import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Page } from './api';
import type { Lookup, OrgUnit, StructureLevel } from '@/app/types';

export type LookupName = 'membership-categories' | 'finance-categories' | 'asset-categories' | 'program-categories' | 'service-types' | 'document-categories';

export function useLookup(name: LookupName, params?: Record<string, string>) {
  return useQuery({
    queryKey: ['lookup', name, params],
    queryFn: () => api<Lookup[]>(`/lookups/${name}/`, { params }),
    staleTime: 10 * 60 * 1000,
  });
}

/** Org units visible to the user (their jurisdiction). */
export function useOrgUnits(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['org-units', 'all', params],
    queryFn: () => api<Page<OrgUnit>>('/org-units/', { params: { page_size: 200, ...params } }).then((p) => p.results),
    staleTime: 5 * 60 * 1000,
  });
}

export function useBranches() {
  return useOrgUnits({ unit_type: 'branch' });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: () => api<{ ministry_name: string; alternate_name: string; default_currency: string; logo: string | null; allow_individual_attendance?: boolean }>('/settings/public/'),
    staleTime: 30 * 60 * 1000,
  });
}

/** Labels for the default levels; used until the administrator's levels have loaded. */
export const UNIT_LABELS: Record<string, string> = {
  headquarters: 'Headquarters', region: 'Region', district: 'District', branch: 'Branch', congregation: 'Congregation',
};

/** The levels of the church hierarchy, as defined by the administrator (ordered top to bottom). */
export function useStructureLevels() {
  return useQuery({
    queryKey: ['structure-levels'],
    queryFn: () => api<StructureLevel[]>('/structure-levels/'),
    staleTime: 10 * 60 * 1000,
  });
}

/** Level code → display name, including any levels the administrator added. */
export function useLevelLabels(): Record<string, string> {
  const { data } = useStructureLevels();
  return useMemo(() => ({ ...UNIT_LABELS, ...Object.fromEntries((data || []).map((l) => [l.code, l.name])) }), [data]);
}

/** Codes of the levels where members are registered (branches, congregations…). */
export function useMemberLevels(): string[] {
  const { data } = useStructureLevels();
  return useMemo(() => (data ? data.filter((l) => l.holds_members).map((l) => l.code) : ['branch', 'congregation']), [data]);
}
