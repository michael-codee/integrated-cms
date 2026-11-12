import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '@/lib/api';
import type { Department } from '@/modules/programs/types';

/** Active departments of a unit (or of the whole jurisdiction when no unit is given). */
export function useDepartments(unit?: string, enabled = true) {
  return useQuery({
    queryKey: ['departments', 'pick', unit || 'all'],
    queryFn: () => api<Page<Department>>('/departments/', { params: { page_size: 200, is_active: true, org_unit: unit || undefined } }).then((p) => p.results),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
