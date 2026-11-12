import type { LucideIcon } from 'lucide-react';
import { ArrowRightLeft, Bell, RefreshCcw, Boxes, CalendarCheck, CalendarDays, HandHeart, Megaphone, Building2, ClipboardCheck, KeyRound, Landmark, LayoutDashboard, ListChecks, PiggyBank, Receipt, ScrollText, Settings, ShieldCheck, UserRoundCheck, Users } from 'lucide-react';

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
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/sync', label: 'Sync Centre', icon: RefreshCcw }],
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
    label: 'Ministry',
    items: [
      { to: '/programs', label: 'Programs & events', icon: CalendarDays, perm: 'programs.view' },
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck, perm: 'attendance.view' },
      { to: '/departments', label: 'Ministries & departments', icon: HandHeart, perm: 'departments.view' },
      { to: '/announcements', label: 'Announcements', icon: Megaphone },
      { to: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/finance', label: 'Finance overview', icon: Landmark, perm: 'finance.view' },
      { to: '/finance/transactions', label: 'Transactions', icon: Receipt, perm: 'finance.view' },
      { to: '/finance/approvals', label: 'Approvals', icon: ClipboardCheck, perm: ['finance.approve', 'budgets.approve'] },
      { to: '/finance/budgets', label: 'Budgets', icon: PiggyBank, perm: 'budgets.view' },
      { to: '/finance/accounts', label: 'Accounts', icon: ListChecks, perm: 'finance.view' },
      { to: '/finance/rules', label: 'Approval rules', icon: ShieldCheck, perm: 'finance.view' },
    ],
  },
  {
    label: 'Property',
    items: [
      { to: '/assets', label: 'Assets & property', icon: Boxes, perm: 'assets.view' },
      { to: '/assets/approvals', label: 'Asset approvals', icon: ClipboardCheck, perm: 'assets.approve' },
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
