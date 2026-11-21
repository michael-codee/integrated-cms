import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Inbox } from 'lucide-react';
import clsx from 'clsx';
import { IconBadge, type IconTone } from './Card';

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
          <h1 className="text-2xl font-semibold text-ink-900 dark:text-white sm:text-[1.75rem]">{title}</h1>
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
      <IconBadge size="lg" tone="river" className="mb-3">{icon || <Inbox />}</IconBadge>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'royal', to }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: IconTone; to?: string;
}) {
  const body = (
    <div className={clsx('group flex h-full items-start gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card dark:border-slate-700/70 dark:bg-slate-900',
      to && 'transition duration-150 hover:-translate-y-0.5 hover:border-royal-300 hover:shadow-lift active:translate-y-0 active:scale-[0.99] dark:hover:border-royal-500')}>
      {icon && <IconBadge tone={tone}>{icon}</IconBadge>}
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-0.5 truncate font-display text-[1.65rem] font-semibold leading-tight text-ink-900 dark:text-white">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400">{body}</Link> : body;
}

/** Heading for a block of the page, e.g. "Membership" on the dashboard. */
export function SectionTitle({ icon, children, actions, tone = 'royal' }: { icon?: ReactNode; children: ReactNode; actions?: ReactNode; tone?: IconTone }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 font-display text-lg font-semibold text-ink-900 dark:text-white">
        {icon && <IconBadge size="sm" tone={tone}>{icon}</IconBadge>}
        {children}
      </h2>
      {actions}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 max-w-full overflow-x-auto">
      <div className="inline-flex gap-1 rounded-xl bg-slate-200/60 p-1 dark:bg-slate-800/80" role="tablist">
        {tabs.map((t) => {
          const on = value === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.value)}
              className={clsx('relative whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 active:scale-[0.96]',
                on ? 'animate-pop bg-white text-royal-800 shadow-sm ring-1 ring-slate-900/5 dark:bg-royal-600 dark:text-white dark:ring-white/10'
                  : 'text-slate-600 hover:bg-white/60 hover:text-ink-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-white')}
            >
              {t.label}
              {on && <span aria-hidden className="absolute inset-x-3 -bottom-[3px] h-[3px] rounded-full bg-gold-400" />}
            </button>
          );
        })}
      </div>
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
