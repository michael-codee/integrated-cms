import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

const base =
  'block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-royal-600 disabled:bg-slate-50 disabled:text-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600 dark:placeholder:text-slate-500 dark:focus:ring-royal-400';
const invalid = 'ring-red-400 focus:ring-red-500 dark:ring-red-500';

/** Element types that take an ``id`` and can be labelled by ``Field`` automatically. */
const LABELLABLE = new Set<unknown>();
export function labellable<T>(component: T): T {
  LABELLABLE.add(component);
  return component;
}

export function Field({ label, error, hint, required, children, className, htmlFor }: {
  label?: ReactNode; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string; htmlFor?: string;
}) {
  const auto = useId();
  let control = children;
  let id = htmlFor;
  const describedBy = error || hint ? `${auto}-desc` : undefined;
  if (!id && isValidElement(children) && (typeof children.type === 'string' || LABELLABLE.has(children.type))) {
    const el = children as ReactElement<{ id?: string; 'aria-describedby'?: string }>;
    id = el.props.id || auto;
    control = cloneElement(el, { id, 'aria-describedby': el.props['aria-describedby'] || describedBy });
  }
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {control}
      {error ? (
        <p id={describedBy} className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>
      ) : hint ? (
        <p id={describedBy} className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = labellable(forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid: bad, ...rest }, ref) {
    return <input ref={ref} className={clsx(base, 'h-10', bad && invalid, className)} aria-invalid={bad || undefined} {...rest} />;
  },
));

export const Select = labellable(forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid: bad, children, ...rest }, ref) {
    return (
      <select ref={ref} className={clsx(base, 'h-10 pr-8', bad && invalid, className)} aria-invalid={bad || undefined} {...rest}>
        {children}
      </select>
    );
  },
));

export const Textarea = labellable(forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid: bad, rows = 3, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} className={clsx(base, bad && invalid, className)} aria-invalid={bad || undefined} {...rest} />;
  },
));

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-royal-600 focus:ring-royal-500" {...rest} />
      {label}
    </label>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return (
    <div className={clsx('grid grid-cols-1 gap-4', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3')}>
      {children}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300" role="alert">
      {message}
    </div>
  );
}
