import { useQuery } from '@tanstack/react-query';
import { api, type Page } from './api';
import type { Lookup, OrgUnit } from '@/app/types';

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

export const UNIT_LABELS: Record<string, string> = {
  headquarters: 'Headquarters', region: 'Region', district: 'District', branch: 'Branch', congregation: 'Congregation',
};
