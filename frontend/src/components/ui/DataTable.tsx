import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Spinner } from './Spinner';
import { EmptyState } from './Misc';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T extends { id?: string | number }>({
  columns, rows, loading, emptyTitle = 'No records found', emptyMessage, onRowClick, page, pageSize = 25, total, onPage, rowKey, rowClassName,
}: {
  columns: Column<T>[]; rows: T[] | undefined; loading?: boolean; emptyTitle?: string; emptyMessage?: ReactNode; onRowClick?: (row: T) => void;
  page?: number; pageSize?: number; total?: number; onPage?: (p: number) => void; rowKey?: (row: T) => string; rowClassName?: (row: T) => string | undefined;
}) {
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
          <thead className="bg-mist dark:bg-slate-800/60">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={clsx('px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-300',
                  c.hideOnMobile && 'hidden md:table-cell', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading && (!rows || rows.length === 0) ? (
              <tr><td colSpan={columns.length} className="py-12"><div className="flex justify-center text-slate-400"><Spinner /></div></td></tr>
            ) : rows && rows.length > 0 ? (
              rows.map((row, i) => (
                <tr key={rowKey ? rowKey(row) : String(row.id ?? i)} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={clsx(onRowClick && 'cursor-pointer transition-colors hover:bg-royal-50/70 active:bg-gold-50 dark:hover:bg-slate-800/60 dark:active:bg-gold-400/10', rowClassName?.(row))}>
                  {columns.map((c) => (
                    <td key={c.key} className={clsx('px-4 py-3 align-middle text-slate-700 dark:text-slate-200', c.hideOnMobile && 'hidden md:table-cell',
                      c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center', c.className)}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr><td colSpan={columns.length}><EmptyState title={emptyTitle} message={emptyMessage} /></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {onPage && total !== undefined && total > pageSize && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800">
          <span>{total.toLocaleString()} records · page {page} of {pages}</span>
          <div className="flex gap-1">
            <button className="rounded-lg p-1.5 ring-1 ring-inset ring-slate-200 transition hover:bg-royal-50 hover:text-royal-800 enabled:active:scale-90 disabled:opacity-40 dark:ring-slate-700 dark:hover:bg-slate-800" disabled={(page || 1) <= 1} onClick={() => onPage((page || 1) - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <button className="rounded-lg p-1.5 ring-1 ring-inset ring-slate-200 transition hover:bg-royal-50 hover:text-royal-800 enabled:active:scale-90 disabled:opacity-40 dark:ring-slate-700 dark:hover:bg-slate-800" disabled={(page || 1) >= pages} onClick={() => onPage((page || 1) + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search"
        className="block h-10 w-full rounded-lg border-0 bg-white pl-9 pr-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-royal-600 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600" />
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-b border-slate-100 p-3 dark:border-slate-800 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}
