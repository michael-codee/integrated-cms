import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { CloudOff, KeyRound, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, UserRound, Wifi, X } from 'lucide-react';
import { useAuth } from './AuthContext';
import { NAV } from './nav';
import { useTheme } from '@/lib/theme';
import { useOnline } from '@/lib/useOnline';
import { ConfirmDialog, useToast } from '@/components/ui';
import { HeaderExtras } from './HeaderExtras';

const SIDEBAR_KEY = 'cmis-sidebar';

/** Desktop sidebar: full width or a slim icon rail, remembered on this device. */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open'); } catch { /* storage unavailable */ }
  }, [collapsed]);
  return [collapsed, () => setCollapsed((c) => !c)];
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={clsx('flex items-center gap-3', compact && 'justify-center')}>
      <img src="/logo.webp" alt="Rivers of Living Water Ministries logo" className="h-10 w-10 shrink-0 rounded-full bg-white object-contain ring-2 ring-gold-400/80 shadow-[0_0_0_4px_rgba(242,168,7,.12)]" />
      {!compact && (
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-[15px] font-semibold text-white">Rivers of Living Water</p>
          <p className="truncate text-[11px] font-medium text-gold-300">Holy Ghost Bible Church</p>
        </div>
      )}
    </div>
  );
}

function Sidebar({ onNavigate, collapsed = false, onToggle }: { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const { can, canAny } = useAuth();
  const allowed = (perm?: string | string[]) => !perm || (Array.isArray(perm) ? canAny(...perm) : can(perm));
  const { pathname } = useLocation();
  // Only the most specific matching entry is highlighted (e.g. /members/transfers is not also "Membership").
  const matches = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/'));
  const activeTo = NAV.flatMap((g) => g.items.map((i) => i.to)).filter(matches).sort((a, b) => b.length - a.length)[0];
  // In the slim rail the labels show as a tooltip beside the icon (fixed, so the scrolling list cannot clip it).
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTip = (el: HTMLElement, label: string) => {
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 12 });
  };
  useEffect(() => setTip(null), [collapsed, pathname]);
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-ink-900 via-ink-900 to-ink-950">
      <div className={clsx('flex h-16 shrink-0 items-center', collapsed ? 'justify-center px-2' : 'px-4')}><Brand compact={collapsed} /></div>
      <nav className={clsx('relative z-10 flex-1 overflow-y-auto overflow-x-hidden py-3', collapsed ? 'space-y-3 px-2' : 'space-y-5 px-3')} aria-label="Main">
        {NAV.map((group, gi) => {
          const items = group.items.filter((i) => allowed(i.perm));
          if (!items.length) return null;
          return (
            <div key={group.label}>
              {collapsed
                ? gi > 0 && <div aria-hidden className="mx-auto mb-3 h-px w-8 bg-white/10" />
                : <p className="mb-1.5 px-3 text-[11px] font-semibold text-river-300/80">{group.label}</p>}
              <ul className="space-y-1">
                {items.map((item) => {
                  const active = item.to === activeTo;
                  return (
                    <li key={item.to} className="relative">
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={onNavigate}
                        onMouseEnter={collapsed ? (e) => showTip(e.currentTarget, item.label) : undefined}
                        onFocus={collapsed ? (e) => showTip(e.currentTarget, item.label) : undefined}
                        onMouseLeave={() => setTip(null)}
                        onBlur={() => setTip(null)}
                        aria-label={collapsed ? item.label : undefined}
                        aria-current={active ? 'page' : undefined}
                        className={clsx('group relative flex items-center rounded-xl text-sm font-medium transition-[background-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 active:scale-[0.97]',
                          collapsed ? 'justify-center p-1.5' : 'gap-3 px-2 py-1.5',
                          active ? 'bg-white/[0.09] text-white' : 'text-royal-100/80 hover:bg-white/[0.06] hover:text-white')}
                      >
                        {active && <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-1 origin-center animate-rail-in rounded-r-full bg-gold-400 shadow-[0_0_10px_rgba(242,168,7,.7)]" />}
                        <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
                          active ? 'bg-gradient-to-br from-gold-300 to-gold-500 text-ink-950 shadow-[0_3px_10px_-3px_rgba(242,168,7,.8)]'
                            : 'bg-white/[0.06] text-river-300 ring-1 ring-inset ring-white/[0.06] group-hover:bg-white/10 group-hover:text-gold-200')}>
                          <item.icon className="h-[17px] w-[17px]" strokeWidth={active ? 2.25 : 2} />
                        </span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      {collapsed && tip && (
        <span style={{ top: tip.top, left: tip.left }} className="pointer-events-none fixed z-50 -translate-y-1/2">
          <span role="tooltip" className="block animate-pop whitespace-nowrap rounded-lg bg-ink-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-lift ring-1 ring-gold-400/40">{tip.label}</span>
        </span>
      )}
      <div aria-hidden className="river-wave pointer-events-none absolute inset-x-0 bottom-0 h-40" />
      <div className={clsx('relative z-10 shrink-0 border-t border-white/10', collapsed ? 'px-2 py-3' : 'px-4 py-3')}>
        {!collapsed && (
          <div className="mb-3">
            <p className="font-serif text-[12px] italic leading-snug text-royal-100/85">“Let all things be done decently and in order.”</p>
            <p className="mt-1 text-[11px] text-gold-300/90">1 Corinthians 14:40</p>
          </div>
        )}
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={clsx('flex items-center gap-2 rounded-lg text-xs font-medium text-royal-100/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 active:scale-95',
              collapsed ? 'mx-auto h-9 w-9 justify-center' : 'h-8 w-full px-2')}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse sidebar</>}
          </button>
        )}
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const primary = user?.assignments[0];
  const initials = (user?.full_name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const doLogout = async (force = false) => {
    const res = await logout(force);
    if (res && 'pending' in res) setPending(res.pending);
    else {
      toast.info('You have signed out. Local data was cleared from this device.');
      navigate('/login');
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-slate-100 dark:hover:bg-slate-800" aria-haspopup="menu" aria-expanded={open}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-royal-700 text-xs font-semibold text-white ring-2 ring-gold-400">{initials}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[10rem] truncate text-sm font-medium text-slate-800 dark:text-slate-100">{user?.full_name}</span>
          <span className="block max-w-[10rem] truncate text-[11px] text-slate-500">{primary ? `${primary.role_name}` : 'No role assigned'}</span>
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900" role="menu">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{user?.title} {user?.full_name}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
              {user?.assignments.map((a) => (
                <p key={a.id} className="mt-1 truncate text-[11px] text-royal-700 dark:text-royal-300">{a.role_name} · {a.org_unit_name}</p>
              ))}
            </div>
            <button className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => { setOpen(false); navigate('/profile'); }} role="menuitem">
              <UserRound className="h-4 w-4" /> My profile
            </button>
            <button className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => { setOpen(false); navigate('/profile?tab=password'); }} role="menuitem">
              <KeyRound className="h-4 w-4" /> Change password
            </button>
            <button className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:border-slate-800 dark:hover:bg-red-950/40" onClick={() => { setOpen(false); doLogout(); }} role="menuitem">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={pending > 0}
        title="Unsynchronised changes on this device"
        tone="danger"
        confirmLabel="Sign out and discard"
        message={<>There {pending === 1 ? 'is 1 change' : `are ${pending} changes`} saved on this device that have not reached the server yet. Signing out deletes them. Open the Sync Centre and synchronise first if possible.</>}
        onConfirm={() => { setPending(0); doLogout(true); }}
        onClose={() => setPending(0)}
      />
    </div>
  );
}

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [theme, toggleTheme] = useTheme();
  const online = useOnline();
  const { offlineSession } = useAuth();
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-mist dark:bg-slate-950">
      <aside className={clsx('fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 ease-out lg:block', collapsed ? 'w-[76px]' : 'w-64')}>
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <button className="absolute right-2 top-4 z-10 rounded-md p-1.5 text-white/80 hover:bg-white/10" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className={clsx('app-main transition-[padding] duration-200 ease-out', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
          <button className="rounded-lg p-2 text-slate-600 transition hover:bg-royal-50 hover:text-royal-800 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <button className="hidden rounded-lg p-2 text-slate-500 transition hover:bg-royal-50 hover:text-royal-800 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800 lg:inline-flex" onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
          <div className="flex-1" />
          <span className={clsx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex',
            online && !offlineSession ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200')}>
            {online && !offlineSession ? <Wifi className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {online && !offlineSession ? 'Online' : 'Offline – saving on this device'}
          </span>
          <HeaderExtras />
          <button onClick={toggleTheme} className="rounded-lg p-2 text-slate-500 transition hover:bg-royal-50 hover:text-royal-800 active:scale-90 dark:text-gold-300 dark:hover:bg-slate-800" aria-label="Toggle dark mode">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <UserMenu />
        </header>
        {(!online || offlineSession) && (
          <div className="flex items-center gap-2 border-b border-gold-200 bg-gold-50 px-4 py-2 text-xs text-gold-900 dark:border-gold-800 dark:bg-gold-900/30 dark:text-gold-100 sm:hidden">
            <CloudOff className="h-3.5 w-3.5" /> Offline – records are saved on this device and synchronised later.
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
