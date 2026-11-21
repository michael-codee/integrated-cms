import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { api, OfflineError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, DataTable, PageHeader, SearchInput, Select, StatusBadge, Tabs, Toolbar, type Column } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { ExportMenu } from '@/components/ExportMenu';
import { SyncBadge } from '@/components/SyncBadge';
import { useLookup } from '@/lib/queries';
import { date } from '@/lib/format';
import { cacheRecords, localRecords } from '@/offline/repository';
import { MemberForm } from './MemberForm';
import { MemberAnalytics } from './MemberAnalytics';
import type { Member } from './types';

const FILTER_KEYS = ['search', 'org_unit', 'status', 'gender', 'category', 'baptism_status', 'age_group'] as const;

async function fetchMembers(params: Record<string, string | number>): Promise<Page<Member> & { offline?: boolean }> {
  try {
    const page = await api<Page<Member>>('/members/', { params });
    cacheRecords('members', page.results as unknown as Record<string, unknown>[]);
    return page;
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    // Offline: serve what this device has (previously viewed + locally registered).
    const search = String(params.search || '').toLowerCase();
    let rows = (await localRecords('members')).map((r) => ({ ...(r.data as unknown as Member), _sync: r.syncState }));
    rows = rows.map((m) => ({ ...m, full_name: m.full_name || [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' ') }));
    if (search) rows = rows.filter((m) => `${m.full_name} ${m.membership_no || ''} ${m.phone}`.toLowerCase().includes(search));
    for (const k of ['status', 'gender', 'baptism_status', 'category'] as const) if (params[k]) rows = rows.filter((m) => String(m[k]) === String(params[k]));
    rows.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
    return { count: rows.length, next: null, previous: null, results: rows, offline: true };
  }
}

export default function MembersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'analytics' ? 'analytics' : 'register';
  const [creating, setCreating] = useState(() => params.get('new') === '1');
  const [search, setSearch] = useState(params.get('search') || '');
  const page = Number(params.get('page') || 1);
  const { data: categories = [] } = useLookup('membership-categories');
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])), [params]);
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (params.get('search') || '')) setFilter('search', search); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = useQuery({
    queryKey: ['members', filters, page],
    queryFn: () => fetchMembers({ ...filters, page }),
    placeholderData: keepPreviousData,
    enabled: tab === 'register',
  });

  const columns: Column<Member>[] = [
    { key: 'name', header: 'Member', render: (m) => (
      <div className="flex items-center gap-3">
        {m.photo ? <img src={m.photo} alt="" className="h-9 w-9 rounded-full object-cover" /> : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-royal-50 text-xs font-semibold text-royal-700 dark:bg-royal-900/40 dark:text-royal-200">
            {(m.first_name?.[0] || '') + (m.last_name?.[0] || '')}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900 dark:text-white">{m.full_name}</p>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">{m.membership_no || 'number pending'} {m.is_demo && <Badge>demo</Badge>} <SyncBadge state={m._sync} /></p>
        </div>
      </div>
    ) },
    { key: 'branch', header: 'Branch', hideOnMobile: true, render: (m) => m.org_unit_name },
    { key: 'gender', header: 'Gender / age', hideOnMobile: true, render: (m) => <span className="capitalize">{m.gender}{m.age != null ? `, ${m.age}` : ''}</span> },
    { key: 'category', header: 'Category', hideOnMobile: true, render: (m) => m.category_name || '—' },
    { key: 'baptism', header: 'Baptism', hideOnMobile: true, render: (m) => m.baptism_status === 'baptized' ? <Badge tone="blue">baptized</Badge> : <span className="text-xs text-slate-400">not yet</span> },
    { key: 'joined', header: 'Joined', hideOnMobile: true, render: (m) => date(m.joined_on) },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Membership" subtitle="Register, search and analyse members across your jurisdiction."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Membership' }]}
        actions={<>
          {tab === 'register' && <ExportMenu path="/members/export/" params={filters} module="members" name="membership-register" />}
          {can('members.create') && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>Register member</Button>}
        </>} />
      <Tabs value={tab} onChange={(t) => setFilter('tab', t === 'register' ? '' : t)} tabs={[{ value: 'register', label: 'Register' }, { value: 'analytics', label: 'Analytics' }]} />
      {tab === 'analytics' ? <MemberAnalytics /> : (
        <Card>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Name, membership no. or phone" className="sm:w-72" />
            <UnitSelect value={filters.org_unit} onChange={(v) => setFilter('org_unit', v)} placeholder="All branches" className="sm:w-56" />
            <Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="sm:w-36" aria-label="Status">
              <option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="withdrawn">Withdrawn</option><option value="deceased">Deceased</option>
            </Select>
            <Select value={filters.gender} onChange={(e) => setFilter('gender', e.target.value)} className="sm:w-32" aria-label="Gender">
              <option value="">Any gender</option><option value="male">Male</option><option value="female">Female</option>
            </Select>
            <Select value={filters.category} onChange={(e) => setFilter('category', e.target.value)} className="sm:w-44" aria-label="Category">
              <option value="">Any category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={filters.baptism_status} onChange={(e) => setFilter('baptism_status', e.target.value)} className="sm:w-36" aria-label="Baptism">
              <option value="">Baptism: any</option><option value="baptized">Baptized</option><option value="not_baptized">Not baptized</option>
            </Select>
            <Select value={filters.age_group} onChange={(e) => setFilter('age_group', e.target.value)} className="sm:w-32" aria-label="Age group">
              <option value="">Any age</option>{['0-12', '13-17', '18-35', '36-59', '60+', 'unknown'].map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Toolbar>
          {query.data?.offline && <p className="border-b border-gold-200 bg-gold-50 px-4 py-2 text-xs text-gold-900 dark:border-gold-800 dark:bg-gold-900/20 dark:text-gold-100">Offline: showing members stored on this device.</p>}
          <DataTable columns={columns} rows={query.data?.results} loading={query.isFetching} total={query.data?.count} page={page}
            onPage={(p) => setFilter('page', String(p))} onRowClick={(m) => navigate(`/members/${m.id}`)}
            emptyTitle="No members match these filters" />
        </Card>
      )}
      <MemberForm open={creating} onClose={() => setCreating(false)} onSaved={(m) => m.membership_no && navigate(`/members/${m.id}`)} />
    </div>
  );
}
