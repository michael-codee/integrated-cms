import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Building, ChevronDown, ChevronRight, MapPin, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { OrgUnit, StructureLevel } from '@/app/types';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, EmptyState, Field, PageHeader, PageLoader, SearchInput, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { useLevelLabels, useMemberLevels, useOrgUnits, useStructureLevels } from '@/lib/queries';
import { date, dateTime, titleCase } from '@/lib/format';
import { childLevel, UnitForm } from './UnitForm';
import { LevelsPanel } from './LevelsPanel';
import { LEVEL_ICONS, type LevelIcon } from './icons';
import { RemoveUnitDialog } from './RemoveUnitDialog';
import { unitPanels } from './panels';

const BranchMap = lazy(() => import('@/components/BranchMap'));

const DEFAULT_ICON: Record<string, LevelIcon> = { headquarters: 'landmark', region: 'globe', district: 'building2', branch: 'church', congregation: 'building' };

function useIconFor() {
  const { data: levels } = useStructureLevels();
  return (code: string) => {
    const name = (levels?.find((l) => l.code === code)?.icon || DEFAULT_ICON[code] || 'building') as LevelIcon;
    return LEVEL_ICONS[name] || Building;
  };
}

interface TreeNode extends OrgUnit { children: TreeNode[] }

function buildTree(units: OrgUnit[]): TreeNode[] {
  const map = new Map<string, TreeNode>(units.map((u) => [u.id, { ...u, children: [] }]));
  const roots: TreeNode[] = [];
  map.forEach((n) => {
    if (n.parent && map.has(n.parent)) map.get(n.parent)!.children.push(n);
    else roots.push(n);
  });
  const sort = (ns: TreeNode[]) => { ns.sort((a, b) => a.name.localeCompare(b.name)); ns.forEach((n) => sort(n.children)); };
  sort(roots);
  return roots;
}

function TreeItem({ node, selected, onSelect, filter }: { node: TreeNode; selected?: string; onSelect: (id: string) => void; filter: string }) {
  const [open, setOpen] = useState(node.depth < 2);
  const Icon = useIconFor()(node.unit_type);
  const matches = (n: TreeNode): boolean => !filter || n.name.toLowerCase().includes(filter) || n.code.toLowerCase().includes(filter) || n.children.some(matches);
  if (!matches(node)) return null;
  const expanded = open || !!filter;
  return (
    <li>
      <div className={clsx('group flex items-center gap-1 rounded-md pr-2 text-sm', selected === node.id ? 'bg-royal-50 text-royal-900 dark:bg-royal-900/40 dark:text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
        <button className={clsx('p-1 text-slate-400', !node.children.length && 'invisible')} onClick={() => setOpen(!open)} aria-label={expanded ? 'Collapse' : 'Expand'}>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button onClick={() => onSelect(node.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
          <Icon className={clsx('h-4 w-4 shrink-0', node.unit_type === 'headquarters' ? 'text-gold-600' : 'text-royal-600 dark:text-royal-300')} />
          <span className={clsx('truncate', node.status !== 'active' && 'text-slate-400')}>{node.name}</span>
          {node.status === 'planned' && <Badge tone="blue" className="ml-auto">planned</Badge>}
          {node.status === 'inactive' && <Badge className="ml-auto">inactive</Badge>}
        </button>
      </div>
      {expanded && node.children.length > 0 && (
        <ul className="ml-4 border-l border-slate-200 pl-1 dark:border-slate-700">
          {node.children.map((c) => <TreeItem key={c.id} node={c} selected={selected} onSelect={onSelect} filter={filter} />)}
        </ul>
      )}
    </li>
  );
}

function UnitDetail({ unit, units }: { unit: OrgUnit; units: OrgUnit[] }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState('profile');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: levels = [] } = useStructureLevels();
  const UNIT_LABELS = useLevelLabels();
  const next = childLevel(levels, unit.unit_type);
  const activeChildren = units.filter((u) => u.parent === unit.id && u.status === 'active').length;
  const history = useQuery({ queryKey: ['org-units', unit.id, 'history'], queryFn: () => api<{ id: string; event: string; changes: Record<string, unknown>; note: string; by: string | null; created_at: string }[]>(`/org-units/${unit.id}/history/`), enabled: tab === 'history' });
  const children = units.filter((u) => u.parent === unit.id);
  const Icon = useIconFor()(unit.unit_type);
  const extraPanels = unitPanels.filter((p) => !p.perm || can(p.perm));

  const toggleStatus = async () => {
    setBusy(true);
    try {
      await api(`/org-units/${unit.id}/status/`, { method: 'POST', body: { status: unit.status === 'active' ? 'inactive' : 'active', note } });
      qc.invalidateQueries({ queryKey: ['org-units'] });
      toast.success(`${unit.name} is now ${unit.status === 'active' ? 'closed (inactive)' : 'active'}.`);
      setNote('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setToggling(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5 dark:border-slate-800">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-royal-50 p-3 text-royal-700 dark:bg-royal-900/40 dark:text-royal-200"><Icon className="h-6 w-6" /></div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500">{unit.lineage?.map((l) => l.name).join(' › ') || 'Top level'}</p>
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-white">{unit.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone="blue">{UNIT_LABELS[unit.unit_type]}</Badge>
              <span className="font-mono text-xs text-slate-500">{unit.code}</span>
              <StatusBadge status={unit.status} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('org.create') && next && (
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add {next.name.toLowerCase()}</Button>
          )}
          {can('org.edit') && <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          {can('org.edit') && unit.unit_type !== 'headquarters' && (
            <Button size="sm" variant={unit.status === 'active' ? 'ghost' : 'success'} icon={<Power className="h-4 w-4" />} onClick={() => setToggling(true)}>
              {unit.status === 'active' ? 'Close' : 'Reopen'}
            </Button>
          )}
          {can('org.delete') && unit.unit_type !== 'headquarters' && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setRemoving(true)}>Remove</Button>
          )}
        </div>
      </div>
      <CardBody>
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'profile', label: 'Profile' },
          ...extraPanels.map((p) => ({ value: p.key, label: p.label })),
          { value: 'children', label: `Units below (${children.length})` },
          { value: 'history', label: 'History' },
        ]} />
        {tab === 'profile' && (
          <DescriptionList items={[
            { label: 'Date established', value: date(unit.established_on) },
            { label: 'Town / city', value: unit.town || '—' },
            { label: 'Chiefdom / area', value: unit.chiefdom || '—' },
            { label: 'District (civil)', value: unit.civil_district || '—' },
            { label: 'Province', value: unit.province || '—' },
            { label: 'Country', value: unit.country },
            { label: 'Address', value: unit.address || '—' },
            { label: 'Coordinates', value: unit.latitude && unit.longitude ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{unit.latitude}, {unit.longitude}</span> : '—' },
            { label: 'Phone', value: unit.phone || '—' },
            { label: 'Email', value: unit.email || '—' },
            { label: 'Notes', value: unit.notes || '—' },
          ]} />
        )}
        {extraPanels.map((p) => tab === p.key && <p.component key={p.key} unit={unit} />)}
        {tab === 'children' && (children.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {children.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span>{c.name} <span className="ml-2 font-mono text-xs text-slate-400">{c.code}</span></span>
                <StatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No units below this one" />)}
        {tab === 'history' && (history.isLoading ? <PageLoader /> : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5 dark:border-slate-700">
            {history.data?.map((h) => (
              <li key={h.id}>
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-royal-500 dark:border-slate-900" />
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{titleCase(h.event)}</p>
                <p className="text-xs text-slate-500">{dateTime(h.created_at)}{h.by ? ` · ${h.by}` : ''}</p>
                {Object.keys(h.changes || {}).length > 0 && h.event !== 'created' && (
                  <ul className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {Object.entries(h.changes).map(([k, v]) => <li key={k}><b>{k.replace(/_/g, ' ')}</b>: {Array.isArray(v) ? `${v[0] ?? '—'} → ${v[1] ?? '—'}` : String(v)}</li>)}
                  </ul>
                )}
                {h.note && <p className="mt-1 text-xs italic text-slate-500">{h.note}</p>}
              </li>
            ))}
          </ol>
        ))}
      </CardBody>
      <UnitForm open={editing} onClose={() => setEditing(false)} unit={unit} />
      <UnitForm open={adding} onClose={() => setAdding(false)} parent={unit} />
      <ConfirmDialog open={toggling} onClose={() => setToggling(false)} onConfirm={toggleStatus} loading={busy}
        title={unit.status === 'active' ? `Close ${unit.name}?` : `Reopen ${unit.name}?`}
        tone={unit.status === 'active' ? 'danger' : 'success'} confirmLabel={unit.status === 'active' ? 'Close unit' : 'Reopen'}
        message={unit.status === 'active'
          ? 'The unit is marked inactive. Its members, finances and records are kept and stay in reports, but it can no longer receive new members. You can reopen it later.'
          : 'The unit becomes active again.'}>
        {unit.status === 'active' && activeChildren > 0 && (
          <p className="rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{activeChildren} active unit(s) below this one stay open. Close or move them separately.</p>
        )}
        <Field label="Reason (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Merged with Tankoro branch" /></Field>
      </ConfirmDialog>
      <RemoveUnitDialog open={removing} unit={unit} onClose={() => setRemoving(false)} onCloseInstead={() => { setRemoving(false); setToggling(true); }} />
    </Card>
  );
}

export default function StructurePage() {
  const { data: units, isLoading } = useOrgUnits();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const tree = useMemo(() => buildTree(units || []), [units]);
  const view = (['map', 'levels'] as const).find((v) => v === params.get('view')) || 'tree';
  const { data: levels = [] } = useStructureLevels();
  const memberLevels = useMemberLevels();
  const shownLevels: StructureLevel[] = levels.filter((l) => l.code !== 'headquarters' && (l.is_active || l.unit_count > 0));
  const selectedId = params.get('unit') || tree[0]?.id;
  const selected = units?.find((u) => u.id === selectedId);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (units || []).forEach((u) => { if (u.status === 'active') c[u.unit_type] = (c[u.unit_type] || 0) + 1; });
    return c;
  }, [units]);

  return (
    <div>
      <PageHeader title="Church structure" subtitle={levels.length ? levels.map((l) => l.plural_name || l.name).join(', ') : 'Headquarters, regions, districts, branches and congregations'}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Church structure' }]}
        actions={can('org.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add unit</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {shownLevels.map((l) => {
          const Icon = LEVEL_ICONS[l.icon as LevelIcon] || Building;
          return (
            <div key={l.code} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
              <Icon className="h-5 w-5 shrink-0 text-royal-600 dark:text-royal-300" />
              <div className="min-w-0"><p className="text-lg font-semibold text-slate-900 dark:text-white">{counts[l.code] || 0}</p><p className="truncate text-xs text-slate-500">Active {(l.plural_name || l.name).toLowerCase()}</p></div>
            </div>
          );
        })}
      </div>
      <Tabs value={view} onChange={(v) => { const n = new URLSearchParams(params); if (v !== 'tree') n.set('view', v); else n.delete('view'); setParams(n); }}
        tabs={[{ value: 'tree', label: 'Organisation' }, { value: 'map', label: 'Branch map' }, { value: 'levels', label: 'Structure levels' }]} />
      {view === 'levels' ? <LevelsPanel /> : view === 'map' ? (
        <Card>
          <CardBody>
            <Suspense fallback={<PageLoader />}>
              <BranchMap height={520} branches={(units || []).filter((u) => memberLevels.includes(u.unit_type)).map((u) => ({ ...u, latitude: u.latitude ? Number(u.latitude) : null, longitude: u.longitude ? Number(u.longitude) : null }))} />
            </Suspense>
            <p className="mt-3 text-xs text-slate-500">
              {(units || []).filter((u) => memberLevels.includes(u.unit_type) && !u.latitude).length} branch(es) without coordinates are not shown — add latitude/longitude on the branch profile.
            </p>
          </CardBody>
        </Card>
      ) : isLoading ? <PageLoader /> : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="self-start">
            <CardHeader title="Organisation tree" />
            <div className="p-3">
              <SearchInput value={filter} onChange={setFilter} placeholder="Find a unit…" />
              <ul className="mt-3 max-h-[65vh] overflow-y-auto">
                {tree.map((n) => <TreeItem key={n.id} node={n} selected={selectedId} onSelect={(id) => setParams({ unit: id })} filter={filter.toLowerCase()} />)}
              </ul>
            </div>
          </Card>
          {selected ? <UnitDetail key={selected.id} unit={selected} units={units || []} /> : <Card><EmptyState title="No units in your jurisdiction" /></Card>}
        </div>
      )}
      <UnitForm open={creating} onClose={() => setCreating(false)} parent={selected} />
    </div>
  );
}
