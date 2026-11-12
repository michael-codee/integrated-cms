import type { LucideIcon } from 'lucide-react';
import { ArrowRightLeft, Building2, KeyRound, LayoutDashboard, ScrollText, Settings, UserRoundCheck, Users } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: string | string[]; // any of
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Church',
    items: [
      { to: '/structure', label: 'Church structure', icon: Building2, perm: 'org.view' },
      { to: '/members', label: 'Membership', icon: UserRoundCheck, perm: 'members.view' },
      { to: '/members/transfers', label: 'Member transfers', icon: ArrowRightLeft, perm: 'members.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/admin/users', label: 'Users', icon: Users, perm: 'users.view' },
      { to: '/admin/roles', label: 'Roles & permissions', icon: KeyRound, perm: 'roles.edit' },
      { to: '/admin/settings', label: 'System settings', icon: Settings, perm: 'settings.edit' },
      { to: '/admin/audit', label: 'Audit trail', icon: ScrollText, perm: 'audit.view' },
    ],
  },
];
