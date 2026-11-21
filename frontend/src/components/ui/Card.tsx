import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-card dark:border-slate-700/70 dark:bg-slate-900', className)}
      {...rest}
    />
  );
}

export function CardHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <IconBadge size="sm">{icon}</IconBadge>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-slate-100">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('p-5', className)} {...rest} />;
}

export type IconTone = 'royal' | 'gold' | 'green' | 'red' | 'slate' | 'purple' | 'river';

const iconTones: Record<IconTone, string> = {
  royal: 'from-royal-500 to-royal-700 text-white shadow-[0_3px_8px_-3px_rgba(29,63,166,.7)]',
  river: 'from-river-400 to-river-600 text-white shadow-[0_3px_8px_-3px_rgba(42,139,216,.7)]',
  gold: 'from-gold-300 to-gold-500 text-ink-950 shadow-[0_3px_8px_-3px_rgba(214,128,2,.7)]',
  green: 'from-emerald-400 to-emerald-600 text-white shadow-[0_3px_8px_-3px_rgba(5,150,105,.7)]',
  red: 'from-red-400 to-red-600 text-white shadow-[0_3px_8px_-3px_rgba(220,38,38,.7)]',
  purple: 'from-violet-400 to-violet-600 text-white shadow-[0_3px_8px_-3px_rgba(124,58,237,.7)]',
  slate: 'from-slate-500 to-slate-700 text-white shadow-[0_3px_8px_-3px_rgba(51,65,85,.7)]',
};

/** A filled, softly lit square that makes an icon stand out from the text around it. */
export function IconBadge({ children, tone = 'royal', size = 'md', className }: { children: ReactNode; tone?: IconTone; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span className={clsx('inline-flex shrink-0 items-center justify-center bg-gradient-to-br ring-1 ring-inset ring-white/20 [&_svg]:h-[1.1em] [&_svg]:w-[1.1em]', iconTones[tone],
      { sm: 'h-7 w-7 rounded-lg text-sm', md: 'h-10 w-10 rounded-xl text-lg', lg: 'h-12 w-12 rounded-2xl text-xl' }[size], className)}>
      {children}
    </span>
  );
}
