import { forwardRef, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'success';
type Size = 'sm' | 'md' | 'lg';

// Blue means "do something"; gold is kept for what is selected or most important on the page.
const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-royal-600 to-royal-700 text-white shadow-btn hover:from-royal-500 hover:to-royal-700 focus-visible:ring-royal-500',
  secondary:
    'bg-white text-royal-800 ring-1 ring-inset ring-slate-300 shadow-sm hover:bg-royal-50 hover:ring-royal-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600 dark:hover:bg-slate-700',
  ghost: 'text-slate-600 hover:bg-royal-50 hover:text-royal-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
  danger: 'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm hover:from-red-500 hover:to-red-700 focus-visible:ring-red-500',
  gold: 'bg-gradient-to-b from-gold-300 to-gold-400 text-ink-950 shadow-btn-gold hover:from-gold-200 hover:to-gold-400 focus-visible:ring-gold-500',
  success: 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-sm hover:to-emerald-700 focus-visible:ring-emerald-500',
};
// A toggle button (aria-pressed) shows its "on" state in gold, whatever its variant.
const pressedOn = 'aria-pressed:bg-none aria-pressed:bg-gold-100 aria-pressed:text-ink-950 aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-gold-400 dark:aria-pressed:bg-gold-400/20 dark:aria-pressed:text-gold-100';
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

interface Ripple { id: number; x: number; y: number; size: number }

/** Press feedback: the button dips slightly and a ripple spreads from where it was touched. */
export function useRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const id = performance.now();
    setRipples((list) => [...list, { id, x: e.clientX - r.left - size / 2, y: e.clientY - r.top - size / 2, size }]);
    window.setTimeout(() => setRipples((list) => list.filter((x) => x.id !== id)), 600);
  };
  const layer = (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      {ripples.map((r) => (
        <span key={r.id} className="absolute animate-ripple rounded-full bg-current opacity-30" style={{ left: r.x, top: r.y, width: r.size, height: r.size }} />
      ))}
    </span>
  );
  return { onPointerDown, layer };
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', onPointerDown, ...rest },
  ref,
) {
  const ripple = useRipple();
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      onPointerDown={(e) => { if (!disabled && !loading) ripple.onPointerDown(e); onPointerDown?.(e); }}
      className={clsx(
        'relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-[transform,background-color,box-shadow,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none dark:focus-visible:ring-offset-slate-900 [&_svg]:shrink-0',
        variants[variant],
        pressedOn,
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
      {ripple.layer}
    </button>
  );
});
