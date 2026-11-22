import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { StructureLevel } from '@/app/types';
import { useAuth } from '@/app/AuthContext';
import { useStructureLevels } from '@/lib/queries';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, Field, FormError, FormGrid, Input, Modal, PageLoader, Select, Textarea, useToast } from '@/components/ui';
import { LEVEL_ICONS, type LevelIcon } from './icons';

const ICON_LABELS: Record<LevelIcon, string> = {
  landmark: 'Headquarters', globe: 'Globe', building2: 'Office building', church: 'Church', building: 'Building',
  map: 'Map', network: 'Network', home: 'House', users: 'People',
};

/** Rank for a level placed directly below ``above`` (keeps gaps so levels can be inserted later). */
function rankBelow(levels: StructureLevel[], above: StructureLevel, self?: StructureLevel): number | null {
  const next = levels.filter((l) => l.rank > above.rank && l.id !== self?.id).sort((a, b) => a.rank - b.rank)[0];
  if (!next) return above.rank + 10;
  if (next.rank - above.rank < 2) return null;
  return Math.floor((above.rank + next.rank) / 2);
}

function LevelForm({ open, onClose, level, levels }: { open: boolean; onClose: () => void; level: StructureLevel | null; levels: StructureLevel[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isRoot = level?.code === 'headquarters';
  const others = levels.filter((l) => l.id !== level?.id);
  const currentAbove = level ? [...others].filter((l) => l.rank < level.rank).sort((a, b) => b.rank - a.rank)[0] : undefined;
  const [f, setF] = useState({ code: '', name: '', plural_name: '', code_prefix: '', holds_members: false, icon: 'building', description: '', is_active: true, above: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(level
      ? { code: level.code, name: level.name, plural_name: level.plural_name, code_prefix: level.code_prefix, holds_members: level.holds_members, icon: level.icon || 'building', description: level.description, is_active: level.is_active, above: currentAbove?.id || '' }
      : { code: '', name: '', plural_name: '', code_prefix: '', holds_members: false, icon: 'building', description: '', is_active: true, above: '' });
  }, [open, level]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const onName = (name: string) => setF((p) => ({
    ...p, name,
    ...(level ? {} : {
      code: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 20),
      code_prefix: name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2),
    }),
  }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = 'Name is required.';
    if (!level && !f.code) errs.code = 'Code is required.';
    if (!f.code_prefix.trim()) errs.code_prefix = 'Enter a short prefix such as ZN.';
    let rank = level?.rank ?? 0;
    if (!isRoot) {
      const above = levels.find((l) => l.id === f.above);
      if (!above) errs.above = 'Choose where this level sits.';
      else if (!level || above.id !== currentAbove?.id) {
        const r = rankBelow(levels, above, level || undefined);
        if (r === null) errs.above = 'There is no room at that position. Move a neighbouring level first.';
        else rank = r;
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { code: f.code, name: f.name.trim(), plural_name: f.plural_name.trim(), code_prefix: f.code_prefix, holds_members: f.holds_members, icon: f.icon, description: f.description, is_active: f.is_active, rank };
    try {
      if (level) await api(`/structure-levels/${level.id}/`, { method: 'PATCH', body });
      else await api('/structure-levels/', { method: 'POST', body });
      qc.invalidateQueries({ queryKey: ['structure-levels'] });
      qc.invalidateQueries({ queryKey: ['org-units'] });
      toast.success(level ? `${body.name} updated.` : `${body.name} level added.`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, above: err.fieldErrors.rank, form: err.message });
      else toast.error('Could not save. Changing the structure needs an internet connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={level ? `Edit ${level.name} level` : 'Add a structure level'}
      subtitle="Levels describe how the church is organised, for example Headquarters › Region › District › Branch."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>{level ? 'Save changes' : 'Add level'}</Button></>}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <FormError message={errors.form && !Object.keys(errors).some((k) => k !== 'form') ? errors.form : null} />
        <FormGrid>
          <Field label="Name" required error={errors.name}><Input value={f.name} onChange={(e) => onName(e.target.value)} placeholder="e.g. Zone" /></Field>
          <Field label="Plural name" hint="Shown on counts, e.g. Zones"><Input value={f.plural_name} onChange={(e) => set('plural_name', e.target.value)} /></Field>
          <Field label="Code" required error={errors.code} hint={level ? 'Fixed once created.' : 'Used internally; letters, digits and _.'}>
            <Input value={f.code} disabled={!!level} onChange={(e) => set('code', e.target.value.toLowerCase())} />
          </Field>
          <Field label="Unit code prefix" required error={errors.code_prefix} hint="New units get codes like ZN-KOI-001">
            <Input value={f.code_prefix} maxLength={4} onChange={(e) => set('code_prefix', e.target.value.toUpperCase())} />
          </Field>
          {!isRoot && (
            <Field label="Sits directly below" required error={errors.above} className="sm:col-span-2" hint="Units at this level can only be placed under units of a higher level.">
              <Select value={f.above} onChange={(e) => set('above', e.target.value)}>
                <option value="">Select…</option>
                {others.sort((a, b) => a.rank - b.rank).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Icon">
            <Select value={f.icon} onChange={(e) => set('icon', e.target.value)}>
              {Object.entries(ICON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <div className="space-y-2 pt-6">
            <Checkbox label="Members are registered at this level" checked={f.holds_members} onChange={(e) => set('holds_members', e.target.checked)} />
            {!level?.is_system && <Checkbox label="In use (new units can be added)" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />}
          </div>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Who leads units at this level, what they oversee…" /></Field>
        </FormGrid>
      </form>
    </Modal>
  );
}

export function LevelsPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: levels = [], isLoading } = useStructureLevels();
  const [editing, setEditing] = useState<StructureLevel | null | 'new'>(null);
  const [deleting, setDeleting] = useState<StructureLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = can('settings.edit');
  const ordered = [...levels].sort((a, b) => a.rank - b.rank);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/structure-levels/${deleting.id}/`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['structure-levels'] });
      toast.success(`${deleting.name} level removed.`);
      setDeleting(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <PageLoader />;
  return (
    <Card>
      <CardHeader title="Structure levels" subtitle="How the ministry is organised, from the top down. Each unit in the organisation tree belongs to one of these levels."
        actions={editable && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add level</Button>} />
      <CardBody>
        <ol className="space-y-2">
          {ordered.map((l, i) => {
            const Icon = LEVEL_ICONS[l.icon as LevelIcon] || Building;
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700" style={{ marginLeft: `${Math.min(i, 5) * 12}px` }}>
                <Icon className="h-5 w-5 shrink-0 text-royal-600 dark:text-royal-300" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900 dark:text-white">
                    {l.name}
                    {l.is_system && <Badge><Lock className="h-3 w-3" />system</Badge>}
                    {l.holds_members && <Badge tone="green">members</Badge>}
                    {!l.is_active && <Badge tone="orange">not in use</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {l.unit_count} unit{l.unit_count === 1 ? '' : 's'} · codes {l.code_prefix}-… {l.description && `· ${l.description}`}
                  </p>
                </div>
                {editable && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(l)}>Edit</Button>
                    {!l.is_system && l.unit_count === 0 && (
                      <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(l)}>Remove</Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {!editable && <p className="mt-4 text-xs text-slate-500">Only administrators can change the structure levels.</p>}
        {editable && (
          <p className="mt-4 text-xs text-slate-500">
            Headquarters and Branch are system levels: they can be renamed but not removed. A level with units cannot be removed; untick “In use” to stop new units being added at it.
          </p>
        )}
      </CardBody>
      <LevelForm open={!!editing} onClose={() => setEditing(null)} level={editing === 'new' ? null : editing} levels={levels} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} loading={busy} tone="danger" confirmLabel="Remove level"
        title={`Remove the ${deleting?.name} level?`} message="No units use this level, so removing it changes nothing else." />
    </Card>
  );
}
