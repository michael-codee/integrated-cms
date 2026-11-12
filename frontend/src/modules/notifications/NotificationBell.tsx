import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { relative } from '@/lib/format';
import type { Notification } from './types';

export function NotificationBell() {
  const online = useOnline();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['notifications', 'summary'], enabled: online, refetchInterval: 60_000, refetchOnWindowFocus: true,
    queryFn: () => api<{ unread: number; latest: Notification[] }>('/notifications/summary/'),
  });
  const unread = q.data?.unread || 0;
  const openItem = async (n: Notification) => {
    setOpen(false);
    api(`/notifications/${n.id}/read/`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] })).catch(() => undefined);
    if (n.link) navigate(n.link);
  };
  const readAll = async () => { await api('/notifications/read-all/', { method: 'POST' }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-haspopup="menu" aria-expanded={open}>
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900" role="menu">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <p className="text-sm font-semibold">Notifications</p>
              {unread > 0 && <button onClick={readAll} className="inline-flex items-center gap-1 text-xs text-royal-700 hover:underline dark:text-royal-300"><CheckCheck className="h-3.5 w-3.5" /> Mark all read</button>}
            </div>
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {!online && <li className="px-4 py-3 text-xs text-slate-500">Notifications refresh when you are online.</li>}
              {q.data?.latest.length ? q.data.latest.map((n) => (
                <li key={n.id}>
                  <button onClick={() => openItem(n)} className={clsx('block w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800', !n.read_at && 'bg-royal-50/50 dark:bg-royal-900/20')} role="menuitem">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{n.title}</p>
                    {n.body && <p className="line-clamp-2 text-xs text-slate-600 dark:text-slate-400">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-slate-400">{n.actor_name ? `${n.actor_name} · ` : ''}{relative(n.created_at)}</p>
                  </button>
                </li>
              )) : online && <li className="px-4 py-6 text-center text-sm text-slate-500">You are all caught up.</li>}
            </ul>
            <button onClick={() => { setOpen(false); navigate('/notifications'); }} className="block w-full border-t border-slate-100 px-4 py-2.5 text-center text-xs font-medium text-royal-700 hover:bg-slate-50 dark:border-slate-800 dark:text-royal-300 dark:hover:bg-slate-800">See all notifications</button>
          </div>
        </>
      )}
    </div>
  );
}
