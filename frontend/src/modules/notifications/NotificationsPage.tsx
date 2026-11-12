import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Bell, CheckCheck } from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { Button, Card, EmptyState, PageHeader, PageLoader, Tabs } from '@/components/ui';
import { dateTime, relative } from '@/lib/format';
import type { Notification } from './types';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['notifications', 'list', filter, page], placeholderData: keepPreviousData, queryFn: () => api<Page<Notification>>('/notifications/', { params: { unread: filter === 'unread' ? true : undefined, page } }) });
  const open = (n: Notification) => {
    if (!n.read_at) api(`/notifications/${n.id}/read/`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
    if (n.link) navigate(n.link);
  };
  const readAll = async () => { await api('/notifications/read-all/', { method: 'POST' }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  const pages = q.data ? Math.ceil(q.data.count / 25) : 1;
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Approvals, decisions and announcements that concern you." crumbs={[{ label: 'Home', to: '/' }, { label: 'Notifications' }]}
        actions={<Button variant="secondary" icon={<CheckCheck className="h-4 w-4" />} onClick={readAll}>Mark all read</Button>} />
      <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={[{ value: 'unread', label: 'Unread' }, { value: 'all', label: 'All' }]} />
      <Card>
        {q.isLoading ? <PageLoader /> : !q.data?.results.length ? <EmptyState icon={<Bell className="h-6 w-6" />} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} /> : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {q.data.results.map((n) => (
              <li key={n.id}>
                <button onClick={() => open(n)} className={clsx('flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60', !n.read_at && 'bg-royal-50/40 dark:bg-royal-900/20')}>
                  <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-royal-600')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{n.title}</span>
                    {n.body && <span className="block text-sm text-slate-600 dark:text-slate-400">{n.body}</span>}
                    <span className="mt-0.5 block text-xs text-slate-400" title={dateTime(n.created_at)}>{n.actor_name ? `${n.actor_name} · ` : ''}{relative(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3 text-sm dark:border-slate-800">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>{page} / {pages}</span><Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>}
      </Card>
    </div>
  );
}
