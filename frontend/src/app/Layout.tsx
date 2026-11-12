import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { CloudOff, KeyRound, LogOut, Menu, Moon, Sun, UserRound, Wifi, X } from 'lucide-react';
import { useAuth } from './AuthContext';
import { NAV } from './nav';
import { useTheme } from '@/lib/theme';
import { useOnline } from '@/lib/useOnline';
import { ConfirmDialog, useToast } from '@/components/ui';
import { HeaderExtras } from './HeaderExtras';

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/logo.webp" alt="Rivers of Living Water Ministries logo" className="h-10 w-10 shrink-0 rounded-full bg-white object-contain ring-2 ring-gold-400/70" />
      {!compact && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-white">Rivers of Living Water</p>
          <p className="truncate text-[11px] font-medium uppercase tracking-wider text-gold-300">Holy Ghost Bible Church</p>
        </div>
      )}
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, canAny } = useAuth();
  const allowed = (perm?: string | string[]) => !perm || (Array.isArray(perm) ? canAny(...perm) : can(perm));
  const { pathname } = useLocation();
  // Only the most specific matching entry is highlighted (e.g. /members/transfers is not also "Membership").
  const matches = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/'));
  const activeTo = NAV.flatMap((g) => g.items.map((i) => i.to)).filter(matches).sort((a, b) => b.length - a.length)[0];
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-royal-900 via-royal-900 to-royal-950">
      <div className="flex h-16 items-center px-4"><Brand /></div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
        {NAV.map((group) => {
          const items = group.items.filter((i) => allowed(i.perm));
          if (!items.length) return null;
          return (
            <div key={group.label}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-royal-300/80">{group.label}</p>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onNavigate}
                      className={() => { const isActive = item.to === activeTo; return (
                        clsx('group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                          isActive ? 'bg-white/10 text-white shadow-inner ring-1 ring-white/10' : 'text-royal-100/80 hover:bg-white/5 hover:text-white')); }
                      }
                      aria-current={item.to === activeTo ? 'page' : undefined}
                    >
                      {() => (
                        <>
                          <item.icon className={clsx('h-4 w-4 shrink-0', item.to === activeTo ? 'text-gold-300' : 'text-royal-300 group-hover:text-gold-200')} />
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-4 py-4">
        <p className="font-serif text-[11px] italic leading-snug text-royal-200/80">
          “Let all things be done decently and in order.”
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-wider text-gold-300/80">1 Corinthians 14:40</p>
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
  const [theme, toggleTheme] = useTheme();
  const online = useOnline();
  const { offlineSession } = useAuth();
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><Sidebar /></aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <button className="absolute right-2 top-4 z-10 rounded-md p-1.5 text-white/80 hover:bg-white/10" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
          <button className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <span className={clsx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex',
            online && !offlineSession ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200')}>
            {online && !offlineSession ? <Wifi className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {online && !offlineSession ? 'Online' : 'Offline – saving on this device'}
          </span>
          <HeaderExtras />
          <button onClick={toggleTheme} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Toggle dark mode">
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
