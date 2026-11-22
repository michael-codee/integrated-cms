import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Award, BookOpen, CheckCircle2, Circle, GraduationCap, Plus, Users } from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, DataTable, PageHeader, SearchInput, Select, StatCard, Toolbar, type Column } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { ExportMenu } from '@/components/ExportMenu';
import { date } from '@/lib/format';
import { ClassCompletionModal, DiscipleshipBadge } from './Discipleship';
import { DISCIPLESHIP_CLASSES, type DiscipleshipCourse, type DiscipleshipRow, type DiscipleshipSummary } from './types';

const FILTER_KEYS = ['search', 'org_unit', 'progress', 'missing', 'status'] as const;

function ClassCell({ on }: { on: string | null }) {
  return on
    ? <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{date(on)}</span>
    : <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><Circle className="h-4 w-4" />not yet</span>;
}

export default function DiscipleshipPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const [recording, setRecording] = useState<DiscipleshipRow | null>(null);
  const page = Number(params.get('page') || 1);
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])), [params]);
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (params.get('search') || '')) setFilter('search', search); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = useQuery({
    queryKey: ['discipleship', 'register', filters, page],
    queryFn: () => api<Page<DiscipleshipRow>>('/discipleship-register/', { params: { ...filters, page } }),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: ['discipleship', 'summary', filters.org_unit, filters.status],
    queryFn: () => api<DiscipleshipSummary>('/discipleship-register/summary/', { params: { org_unit: filters.org_unit, status: filters.status } }),
  });
  const s = summary.data;
  const editable = can('members.edit');

  const columns: Column<DiscipleshipRow>[] = [
    { key: 'name', header: 'Member', render: (m) => (
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate font-medium text-slate-900 dark:text-white">{m.full_name} <DiscipleshipBadge on={m.discipleship_badge_on} compact /></p>
        <p className="flex items-center gap-1.5 text-xs text-slate-500">{m.membership_no || 'number pending'} {m.is_demo && <Badge>demo</Badge>}</p>
      </div>
    ) },
    { key: 'branch', header: 'Branch', hideOnMobile: true, render: (m) => m.org_unit_name },
    ...DISCIPLESHIP_CLASSES.map((c): Column<DiscipleshipRow> => ({ key: c.value, header: c.label, hideOnMobile: true, render: (m) => <ClassCell on={m[c.field]} /> })),
    { key: 'badge', header: 'Badge', render: (m) => m.discipleship_badge_on
      ? <DiscipleshipBadge on={m.discipleship_badge_on} />
      : <span className="text-xs text-slate-500">{m.classes_completed} of 3 classes</span> },
    { key: 'actions', header: '', align: 'right', render: (m) => editable && m.classes_completed < 3 && m.status === 'active' ? (
      <div onClick={(e) => e.stopPropagation()}><Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRecording(m)}>Record class</Button></div>
    ) : null },
  ];

  return (
    <div>
      <PageHeader title="Discipleship register"
        subtitle="Members who have gone through Foundation, Discipleship and Spiritual Growth classes. Completing all three earns the badge of discipleship."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Membership', to: '/members' }, { label: 'Discipleship' }]}
        actions={<ExportMenu path="/discipleship-register/export/" params={filters} module="members" name="discipleship-register" />} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Members" value={s ? s.members.toLocaleString() : '…'} icon={<Users className="h-5 w-5" />} />
        {DISCIPLESHIP_CLASSES.map((c, i) => (
          <StatCard key={c.value} label={c.label} value={s ? (s.by_class.find((b) => b.value === c.value)?.count ?? 0).toLocaleString() : '…'}
            hint="completed" icon={i === 0 ? <BookOpen className="h-5 w-5" /> : <GraduationCap className="h-5 w-5" />} tone={i === 2 ? 'purple' : 'river'} />
        ))}
        <StatCard label="Badge of discipleship" value={s ? s.badges.toLocaleString() : '…'} hint={s && s.members ? `${Math.round((s.badges / s.members) * 100)}% of members` : undefined}
          icon={<Award className="h-5 w-5" />} tone="gold" />
      </div>
      <Card>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Name or membership no." className="sm:w-64" />
          <UnitSelect value={filters.org_unit} onChange={(v) => setFilter('org_unit', v)} placeholder="All branches" className="sm:w-56" />
          <Select value={filters.progress} onChange={(e) => setFilter('progress', e.target.value)} className="sm:w-48" aria-label="Progress">
            <option value="">Any progress</option><option value="badge">Badge earned</option><option value="in_progress">In progress</option><option value="not_started">Not started</option>
          </Select>
          <Select value={filters.missing} onChange={(e) => setFilter('missing', e.target.value)} className="sm:w-56" aria-label="Still needs">
            <option value="">Still needs: any</option>{DISCIPLESHIP_CLASSES.map((c) => <option key={c.value} value={c.value}>Still needs {c.label}</option>)}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="sm:w-36" aria-label="Status">
            <option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="withdrawn">Withdrawn</option><option value="deceased">Deceased</option>
          </Select>
        </Toolbar>
        <DataTable columns={columns} rows={query.data?.results} loading={query.isFetching} total={query.data?.count} page={page}
          onPage={(p) => setFilter('page', String(p))} onRowClick={(m) => navigate(`/members/${m.id}?tab=discipleship`)}
          emptyTitle="No members match these filters" />
      </Card>
      {recording && (
        <ClassCompletionModal open member={recording} onClose={() => setRecording(null)}
          done={DISCIPLESHIP_CLASSES.filter((c) => recording[c.field]).map((c) => c.value as DiscipleshipCourse)} />
      )}
    </div>
  );
}
