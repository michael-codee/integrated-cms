import type { ComponentType } from 'react';
import type { OrgUnit } from '@/app/types';

/** Extra tabs on a unit's profile contributed by other modules (leadership, membership…). */
export interface UnitPanel {
  key: string;
  label: string;
  perm?: string;
  component: ComponentType<{ unit: OrgUnit }>;
}

export const unitPanels: UnitPanel[] = [];
