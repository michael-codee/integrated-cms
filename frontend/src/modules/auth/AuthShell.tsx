import type { ReactNode } from 'react';

export function AuthShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex min-h-screen bg-white dark:bg-slate-950">
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-royal-800 via-royal-900 to-royal-950 lg:flex lg:flex-col lg:items-center lg:justify-center">
        <svg className="absolute inset-x-0 bottom-0 h-48 w-full text-royal-700/40" viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden="true">
          <path fill="currentColor" d="M0,224L60,213.3C120,203,240,181,360,186.7C480,192,600,224,720,234.7C840,245,960,235,1080,208C1200,181,1320,139,1380,117.3L1440,96L1440,320L0,320Z" />
        </svg>
        <svg className="absolute inset-x-0 bottom-0 h-32 w-full text-gold-400/10" viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden="true">
          <path fill="currentColor" d="M0,288L80,272C160,256,320,224,480,224C640,224,800,256,960,261.3C1120,267,1280,245,1360,234.7L1440,224L1440,320L0,320Z" />
        </svg>
        <div className="relative z-10 max-w-md px-10 text-center">
          <img src="/logo.webp" alt="Rivers of Living Water Ministries" className="mx-auto h-40 w-40 rounded-full bg-white object-contain shadow-2xl ring-4 ring-gold-400/80" />
          <h1 className="mt-8 text-3xl font-semibold tracking-tight text-white">Rivers of Living Water Ministries</h1>
          <p className="mt-1 text-sm font-medium uppercase tracking-[0.2em] text-gold-300">Holy Ghost Bible Church</p>
          <p className="mt-2 text-sm text-royal-200">Church Management Information System · Koidu City, Kono</p>
          <blockquote className="mt-10 border-l-2 border-gold-400 pl-4 text-left font-serif text-lg italic text-royal-50">
            “Let all things be done decently and in order.”
            <footer className="mt-2 font-sans text-xs not-italic uppercase tracking-widest text-gold-300">1 Corinthians 14:40</footer>
          </blockquote>
        </div>
      </div>
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src="/logo.webp" alt="" className="h-14 w-14 rounded-full object-contain ring-2 ring-gold-400" />
            <div>
              <p className="font-semibold text-royal-900 dark:text-white">Rivers of Living Water Ministries</p>
              <p className="text-xs uppercase tracking-wider text-gold-600">Holy Ghost Bible Church</p>
            </div>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
