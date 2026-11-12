import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { CalendarDays, ChevronLeft, ChevronRight, Globe2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, DataTable, PageHeader, SearchInput, Select, StatusBadge, Tabs, Toolbar, type Column } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { dateTime } from '@/lib/format';
import { ProgramForm } from './ProgramForm';
import { PROGRAM_STATUSES, programStatusLabel, type Program } from './types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const DOT: Record<string, string> = {
  planned: 'bg-royal-500', pending_approval: 'bg-gold-500', approved: 'bg-emerald-500', completed: 'bg-slate-400', postponed: 'bg-orange-500', cancelled: 'bg-slate-300',
};

function MonthCalendar({ month, programs, onPick, onDay }: { month: Date; programs: Program[]; onPick: (p: Program) => void; onDay?: (d: Date) => void }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const days = Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - offset + i));
  const weeks = days[35].getMonth() !== month.getMonth() ? 5 : 6;
  const byDay = useMemo(() => {
    const m = new Map<string, Program[]>();
    programs.forEach((p) => {
      const s = new Date(p.starts_at); const e = new Date(p.ends_at);
      for (let d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d <= e; d.setDate(d.getDate() + 1)) {
        const k = dayKey(d); m.set(k, [...(m.get(k) || []), p]);
        if (m.size > 400) break;
      }
    });
    return m;
  }, [programs]);
  const todayKey = dayKey(new Date());
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-7 border-l border-t border-slate-200 dark:border-slate-800">
        {WEEKDAYS.map((w) => <div key={w} className="border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900">{w}</div>)}
        {days.slice(0, weeks * 7).map((d) => {
          const list = byDay.get(dayKey(d)) || [];
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div key={d.toISOString()} className={clsx('group min-h-[6.5rem] border-b border-r border-slate-200 p-1.5 dark:border-slate-800', !inMonth && 'bg-slate-50/60 dark:bg-slate-900/40')}>
              <div className="flex items-center justify-between">
                <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-xs', dayKey(d) === todayKey ? 'bg-royal-700 font-semibold text-white' : inMonth ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400')}>{d.getDate()}</span>
                {onDay && inMonth && <button onClick={() => onDay(d)} className="rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-royal-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-slate-800" aria-label={`Plan a program on ${d.toDateString()}`}><Plus className="h-3.5 w-3.5" /></button>}
              </div>
              <ul className="mt-1 space-y-0.5">
                {list.slice(0, 3).map((p) => (
                  <li key={p.id}>
                    <button onClick={() => onPick(p)} title={`${p.title} · ${p.org_unit_name} · ${programStatusLabel(p.status)}`}
                      className={clsx('flex w-full items-center gap-1.5 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-royal-50 dark:hover:bg-royal-900/40', p.status === 'cancelled' && 'line-through opacity-60')}>
                      <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[p.status])} />
                      <span className="truncate"><span className="tabular-nums text-slate-500">{timeOf(p.starts_at)}</span> {p.title}</span>
                    </button>
                  </li>
                ))}
                {list.length > 3 && <li className="px-1 text-[11px] text-slate-500">+{list.length - 3} more</li>}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-3 text-xs text-slate-500">
        {PROGRAM_STATUSES.map(([v, l]) => <span key={v} className="inline-flex items-center gap-1.5"><span className={clsx('h-2 w-2 rounded-full', DOT[v])} />{l}</span>)}
      </div>
    </div>
  );
}

export default function ProgramsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('view') === 'list' || params.get('status') ? 'list' : 'calendar';
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(params.get('status') || '');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState<Date | true | null>(null);
  const cats = useLookup('program-categories');
  const rangeStart = new Date(month.getFullYear(), month.getMonth(), -6);
  const rangeEnd = new Date(month.getFullYear(), month.getMonth() + 1, 7);
  const common = { org_unit: unit || undefined, category: category || undefined, search: search || undefined };
  const calendar = useQuery({
    queryKey: ['programs', 'calendar', month.toISOString(), common], enabled: tab === 'calendar', placeholderData: keepPreviousData,
    queryFn: () => api<Program[]>('/programs/', { params: { ...common, start: rangeStart.toISOString(), end: rangeEnd.toISOString() } }),
  });
  const listQuery = { ...common, status: status || undefined, ordering: status === 'pending_approval' ? 'starts_at' : '-starts_at' };
  const list = useQuery({ queryKey: ['programs', 'list', listQuery], enabled: tab === 'list', placeholderData: keepPreviousData, queryFn: () => api<Program[]>('/programs/', { params: listQuery }) });
  const cols: Column<Program>[] = [
    { key: 'when', header: 'When', render: (p) => <span className="whitespace-nowrap text-sm">{dateTime(p.starts_at)}</span> },
    { key: 'title', header: 'Program', render: (p) => <div><p className="font-medium">{p.title} {p.is_public && <Badge tone="purple"><Globe2 className="h-3 w-3" />all units</Badge>}</p><p className="text-xs text-slate-500">{p.category_name}{p.department_name ? ` · ${p.department_name}` : ''}</p></div> },
    { key: 'unit', header: 'Organised by', hideOnMobile: true, render: (p) => p.org_unit_name },
    { key: 'venue', header: 'Venue', hideOnMobile: true, render: (p) => p.venue || '—' },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} label={programStatusLabel(p.status)} /> },
    { key: 'att', header: 'Attendance', align: 'right', hideOnMobile: true, render: (p) => p.attendance_total ? p.attendance_total.toLocaleString() : '—' },
  ];
  const title = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <div>
      <PageHeader title="Programs & events" subtitle="Plan, approve and report on services, crusades, conferences and outreach."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Programs' }]}
        actions={can('programs.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Plan a program</Button>} />
      <Tabs value={tab} onChange={(t) => setParams(t === 'list' ? { view: 'list' } : {})} tabs={[{ value: 'calendar', label: 'Calendar' }, { value: 'list', label: 'List' }]} />
      <Card>
        <Toolbar>
          {tab === 'calendar' ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
              <h2 className="min-w-[9rem] text-center text-sm font-semibold">{title}</h2>
              <Button variant="ghost" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}><CalendarDays className="h-4 w-4" /> Today</Button>
            </div>
          ) : (
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setParams(e.target.value ? { view: 'list', status: e.target.value } : { view: 'list' }); }} className="sm:w-48" aria-label="Status">
              <option value="">Any status</option>{PROGRAM_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          )}
          <SearchInput value={search} onChange={setSearch} placeholder="Title, venue, speaker…" className="sm:w-56" />
          <UnitSelect value={unit} onChange={setUnit} className="sm:w-52" />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-44" aria-label="Category"><option value="">Any category</option>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          {tab === 'list' && <div className="sm:ml-auto"><ExportMenu path="/programs/export/" params={listQuery} module="programs" name="programs" /></div>}
        </Toolbar>
        {tab === 'calendar' ? (
          <div className="p-3 sm:p-4">
            <MonthCalendar month={month} programs={calendar.data || []} onPick={(p) => navigate(`/programs/${p.id}`)} onDay={can('programs.create') ? (d) => setCreating(d) : undefined} />
          </div>
        ) : (
          <DataTable columns={cols} rows={list.data} loading={list.isFetching} onRowClick={(p) => navigate(`/programs/${p.id}`)}
            emptyTitle="No programs" emptyMessage={<>Nothing matches. <Link to="/programs" className="text-royal-700">Open the calendar</Link>.</>} />
        )}
      </Card>
      {creating && <ProgramForm initialStart={creating === true ? undefined : creating} onClose={() => setCreating(null)} onSaved={(id) => navigate(`/programs/${id}`)} />}
    </div>
  );
}
