import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Inbox } from 'lucide-react';
import clsx from 'clsx';

export interface Crumb { label: string; to?: string }

export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: Crumb[] }) {
  return (
    <div className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {c.to ? <Link className="hover:text-royal-700 dark:hover:text-royal-300" to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, message, action, icon }: { title: string; message?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-royal-50 p-3 text-royal-600 dark:bg-royal-900/40 dark:text-royal-300">{icon || <Inbox className="h-6 w-6" />}</div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'royal', to }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'royal' | 'gold' | 'green' | 'red' | 'slate' | 'purple'; to?: string;
}) {
  const tones = {
    royal: 'bg-royal-50 text-royal-700 dark:bg-royal-900/40 dark:text-royal-200',
    gold: 'bg-gold-50 text-gold-700 dark:bg-gold-900/30 dark:text-gold-200',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    purple: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  };
  const body = (
    <div className={clsx('flex h-full items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-700/70 dark:bg-slate-900', to && 'transition hover:border-royal-300 hover:shadow-md')}>
      {icon && <div className={clsx('rounded-lg p-2.5', tones[tone])}>{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1 truncate text-2xl font-semibold text-slate-900 dark:text-white">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
            value === t.value ? 'border-royal-600 text-royal-700 dark:border-gold-400 dark:text-gold-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900 dark:text-slate-100">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
