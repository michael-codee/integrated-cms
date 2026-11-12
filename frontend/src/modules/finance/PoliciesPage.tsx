import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, FormError, FormGrid, Input, Modal, PageHeader, PageLoader, Select, Textarea, useToast } from '@/components/ui';
import { UNIT_LABELS } from '@/lib/queries';
import { money } from '@/lib/format';
import { LEVELS, type Policy, type Step } from './types';

const APPLIES: Record<Policy['applies_to'], string> = { income: 'Income', expense: 'Expenditure', reversal: 'Reversals' };

function PolicyForm({ policy, onClose }: { policy: Policy | null; onClose: () => void }) {
  const [f, setF] = useState<Omit<Policy, 'id'>>(policy || { name: '', applies_to: 'expense', unit_type: '', min_amount: '0', max_amount: null, currency: 'SLE', priority: 100, is_active: true, description: '', steps: [{ order: 1, level: 'unit', label: '' }] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const setStep = (i: number, patch: Partial<Step>) => set('steps', f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      const body = { ...f, max_amount: f.max_amount === '' ? null : f.max_amount, steps: f.steps.map((s, i) => ({ ...s, order: i + 1 })) };
      await api(policy ? `/finance/approval-policies/${policy.id}/` : '/finance/approval-policies/', { method: policy ? 'PUT' : 'POST', body });
      toast.success('Approval rule saved. It applies to entries submitted from now on.');
      qc.invalidateQueries({ queryKey: ['finance', 'policies'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors({ ...e.fieldErrors, form: e.message });
      else setErrors({ form: (e as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={policy ? 'Edit approval rule' : 'New approval rule'} subtitle="Entries already submitted keep the steps they were given."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <FormError message={errors.form || errors.steps} />
      <FormGrid>
        <Field label="Name" required error={errors.name}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Applies to"><Select value={f.applies_to} onChange={(e) => set('applies_to', e.target.value as Policy['applies_to'])}>{Object.entries(APPLIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="From amount (SLE)" error={errors.min_amount}><Input type="number" min="0" value={f.min_amount} onChange={(e) => set('min_amount', e.target.value)} /></Field>
        <Field label="Up to (not including)" hint="Leave blank for no upper limit" error={errors.max_amount}><Input type="number" min="0" value={f.max_amount ?? ''} onChange={(e) => set('max_amount', e.target.value || null)} /></Field>
        <Field label="Only for units of type" hint="Blank = any unit"><Select value={f.unit_type} onChange={(e) => set('unit_type', e.target.value)}><option value="">Any unit</option>{Object.entries(UNIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Priority" hint="Lower numbers are checked first"><Input type="number" min="1" value={f.priority} onChange={(e) => set('priority', Number(e.target.value))} /></Field>
      </FormGrid>
      <h4 className="mb-2 mt-5 text-sm font-semibold">Approval steps, in order</h4>
      <div className="space-y-2">
        {f.steps.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-6 text-sm text-slate-500">{i + 1}.</span>
            <Select value={s.level} onChange={(e) => setStep(i, { level: e.target.value })} className="flex-1" aria-label="Level">{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <Input value={s.label} onChange={(e) => setStep(i, { label: e.target.value })} placeholder="Label, e.g. District Overseer" className="flex-1" aria-label="Label" />
            {f.steps.length > 1 && <Button variant="ghost" size="sm" aria-label="Remove step" onClick={() => set('steps', f.steps.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        ))}
      </div>
      {f.steps.length < 5 && <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('steps', [...f.steps, { order: f.steps.length + 1, level: 'district', label: '' }])}>Add step</Button>}
      <Field label="Description" className="mt-4"><Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <div className="mt-3"><Checkbox checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} label="Rule is active" /></div>
    </Modal>
  );
}

export default function PoliciesPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Policy | null | 'new'>(null);
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'policies'], queryFn: () => api<Policy[]>('/finance/approval-policies/') });
  const editable = can('settings.edit');
  return (
    <div>
      <PageHeader title="Approval rules" subtitle="How many approvals an entry needs, and at which level, by amount. The recorder or submitter can never approve their own entry."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Finance', to: '/finance' }, { label: 'Approval rules' }]}
        actions={editable && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New rule</Button>} />
      {isLoading ? <PageLoader /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {(data || []).map((p) => (
            <Card key={p.id} className={p.is_active ? '' : 'opacity-60'}>
              <CardHeader title={p.name} subtitle={`${APPLIES[p.applies_to]} · ${money(p.min_amount, p.currency)}${p.max_amount ? ` up to ${money(p.max_amount, p.currency)}` : ' and above'}${p.unit_type ? ` · ${UNIT_LABELS[p.unit_type]} only` : ''}`}
                actions={<>{!p.is_active && <Badge>inactive</Badge>}{editable && <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>}</>} />
              <CardBody>
                <ol className="space-y-1.5 text-sm">
                  {p.steps.map((s) => <li key={s.order} className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-royal-100 text-xs font-semibold text-royal-800 dark:bg-royal-900/50 dark:text-royal-200">{s.order}</span>{s.label || LEVELS.find(([v]) => v === s.level)?.[1]}<span className="text-xs text-slate-500">({LEVELS.find(([v]) => v === s.level)?.[1].split(' (')[0]})</span></li>)}
                </ol>
                {p.description && <p className="mt-3 text-xs text-slate-500">{p.description}</p>}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      {editing && <PolicyForm policy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
