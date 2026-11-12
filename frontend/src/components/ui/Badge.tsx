import type { ReactNode } from 'react';
import clsx from 'clsx';

export type Tone = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange';

const tones: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
  blue: 'bg-royal-50 text-royal-700 ring-royal-600/20 dark:bg-royal-900/50 dark:text-royal-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-900/40 dark:text-emerald-300',
  yellow: 'bg-gold-50 text-gold-800 ring-gold-600/30 dark:bg-gold-900/30 dark:text-gold-200',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-900/40 dark:text-red-300',
  purple: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-900/40 dark:text-violet-300',
  orange: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-900/40 dark:text-orange-300',
};

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  active: 'green', approved: 'green', paid: 'green', completed: 'green', synced: 'green', submitted: 'blue', good: 'green', new: 'blue',
  pending: 'yellow', planned: 'blue', draft: 'gray', under_review: 'purple', ongoing: 'purple', returned: 'orange', fair: 'yellow',
  inactive: 'gray', suspended: 'orange', deactivated: 'red', rejected: 'red', cancelled: 'gray', failed: 'red', conflict: 'red',
  deceased: 'gray', transferred: 'purple', withdrawn: 'gray', poor: 'orange', damaged: 'red', lost: 'red', disposed: 'gray',
  under_maintenance: 'orange', maintenance: 'orange', idle: 'gray', unserviceable: 'red', overdue: 'red', local: 'yellow', open: 'yellow', resolved: 'green', reversed: 'gray',
  pending_approval: 'yellow', postponed: 'orange', urgent: 'red', important: 'yellow', normal: 'gray',
};

export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return null;
  return <Badge tone={STATUS_TONES[status] || 'gray'}>{label || status.replace(/_/g, ' ')}</Badge>;
}
