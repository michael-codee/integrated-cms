import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Check, Plus, Send, Trash2, X } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Button, Card, DataTable, Field, FormError, FormGrid, Input, Modal, PageHeader, Select, StatusBadge, Textarea, Toolbar, useToast, type Column } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { dateTime, money } from '@/lib/format';
import type { Budget, BudgetLine, BudgetPerformance } from './types';

interface FY { id: string; name: string; is_closed: boolean }
const STATUS: Record<string, string> = { draft: 'Draft', submitted: 'Awaiting approval', approved: 'Approved', rejected: 'Returned' };

function BudgetEditor({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const fys = useQuery({ queryKey: ['financial-years'], queryFn: () => api<FY[]>('/financial-years/') });
  const cats = useLookup('finance-categories');
  const [unit, setUnit] = useState(budget?.org_unit || '');
  const [fy, setFy] = useState(budget?.financial_year || '');
  const [name, setName] = useState(budget?.name || 'Annual operating budget');
  const [notes, setNotes] = useState(budget?.notes || '');
  const [lines, setLines] = useState<BudgetLine[]>(budget?.lines || []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => { if (!fy && fys.data?.length) setFy(fys.data.find((f) => !f.is_closed)?.id || ''); }, [fys.data, fy]);
  const used = new Set(lines.map((l) => l.category));
  const addLine = (kind: 'income' | 'expense') => {
    const next = (cats.data || []).find((c) => c.kind === kind && c.is_active && !used.has(c.id));
    if (next) setLines([...lines, { category: next.id, amount: '' }]);
  };
  const total = (kind: string) => lines.filter((l) => cats.data?.find((c) => c.id === l.category)?.kind === kind).reduce((s, l) => s + Number(l.amount || 0), 0);
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      const body = { org_unit: unit, financial_year: fy, name, notes, lines: lines.filter((l) => l.amount !== '').map((l) => ({ category: l.category, amount: l.amount, notes: l.notes || '' })) };
      await api(budget ? `/finance/budgets/${budget.id}/` : '/finance/budgets/', { method: budget ? 'PATCH' : 'POST', body });
      toast.success('Budget saved as a draft.');
      qc.invalidateQueries({ queryKey: ['finance', 'budgets'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors({ ...e.fieldErrors, form: e.message });
      else setErrors({ form: (e as Error).message });
    } finally { setBusy(false); }
  };
  const section = (kind: 'income' | 'expense', title: string) => (
    <div>
      <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold">{title}</h4><span className="text-sm tabular-nums text-slate-500">Total {money(total(kind))}</span></div>
      <div className="space-y-2">
        {lines.map((l, i) => {
          const cat = cats.data?.find((c) => c.id === l.category);
          if (cat?.kind !== kind) return null;
          return (
            <div key={i} className="flex gap-2">
              <Select value={l.category} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} className="flex-1" aria-label="Category">
                {(cats.data || []).filter((c) => c.kind === kind && (c.id === l.category || !used.has(c.id))).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Input type="number" min="0" step="0.01" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className="w-40" aria-label="Amount" placeholder="Amount" />
              <Button variant="ghost" size="sm" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          );
        })}
      </div>
      <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addLine(kind)}>Add {kind === 'income' ? 'income' : 'expenditure'} line</Button>
    </div>
  );
  return (
    <Modal open onClose={onClose} size="lg" title={budget ? `Edit ${budget.name}` : 'New budget'} subtitle="Planned income and expenditure by category for one financial year"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save draft</Button></>}>
      <FormError message={errors.form || errors.lines} />
      <FormGrid>
        {!budget && <Field label="Unit" required error={errors.org_unit}><UnitSelect value={unit} onChange={setUnit} placeholder="Choose unit" /></Field>}
        <Field label="Financial year" required error={errors.financial_year}><Select value={fy} onChange={(e) => setFy(e.target.value)}>{(fys.data || []).map((f) => <option key={f.id} value={f.id} disabled={f.is_closed}>{f.name}{f.is_closed ? ' (closed)' : ''}</option>)}</Select></Field>
        <Field label="Budget name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </FormGrid>
      <div className="mt-5 grid gap-6 md:grid-cols-2">{section('income', 'Expected income')}{section('expense', 'Planned expenditure')}</div>
      <Field label="Notes" className="mt-4"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}

function BudgetDetail({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (b: Budget) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const b = useQuery({ queryKey: ['finance', 'budgets', 'one', id], queryFn: () => api<Budget>(`/finance/budgets/${id}/`) });
  const perf = useQuery({ queryKey: ['finance', 'budgets', 'perf', id], queryFn: () => api<BudgetPerformance[]>(`/finance/budgets/${id}/performance/`) });
  const act = async (path: string, body?: Record<string, unknown>, ok = 'Done.') => {
    setBusy(true);
    try { await api(`/finance/budgets/${id}/${path}/`, { method: 'POST', body }); toast.success(ok); qc.invalidateQueries({ queryKey: ['finance', 'budgets'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const d = b.data;
  return (
    <Modal open onClose={onClose} size="xl" title={d ? d.name : 'Budget'} subtitle={d ? `${d.org_unit_name} · ${d.financial_year_name}` : undefined}
      footer={d && <>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {(d.status === 'draft' || d.status === 'rejected') && can('budgets.edit') && <Button variant="secondary" onClick={() => onEdit(d)}>Edit</Button>}
        {(d.status === 'draft' || d.status === 'rejected') && can('budgets.submit') && <Button icon={<Send className="h-4 w-4" />} loading={busy} onClick={() => act('submit', undefined, 'Submitted for approval.')}>Submit for approval</Button>}
        {d.can_decide && <>
          <Button variant="secondary" icon={<X className="h-4 w-4" />} loading={busy} onClick={() => act('decide', { decision: 'reject', comment }, 'Budget returned.')}>Return</Button>
          <Button variant="success" icon={<Check className="h-4 w-4" />} loading={busy} onClick={() => act('decide', { decision: 'approve', comment }, 'Budget approved.')}>Approve</Button>
        </>}
      </>}>
      {d && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={d.status} label={STATUS[d.status]} />
            {d.submitted_by_name && <span className="text-slate-500">Submitted by {d.submitted_by_name} · {dateTime(d.submitted_at)}</span>}
            {d.decided_by_name && <span className="text-slate-500">Decided by {d.decided_by_name} · {dateTime(d.decided_at)}</span>}
          </div>
          {d.decision_comment && <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:bg-orange-900/30 dark:text-orange-100">{d.decision_comment}</p>}
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Budget</th><th className="px-3 py-2 text-right">Actual (approved)</th><th className="px-3 py-2 text-left">Progress</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(perf.data || []).map((r) => {
                  const pct = Math.min(r.percent ?? 0, 100);
                  const over = r.kind === 'expense' && (r.percent ?? 0) > 100;
                  return (
                    <tr key={r.category}>
                      <td className="px-3 py-2"><p className="font-medium">{r.category_name}</p><p className="text-xs text-slate-500">{r.kind === 'income' ? 'Income' : 'Expenditure'}</p></td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.budget, d.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.actual, d.currency)}</td>
                      <td className="w-56 px-3 py-2">
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-2 rounded-full ${over ? 'bg-red-600' : 'bg-royal-600'}`} style={{ width: `${pct}%` }} /></div>
                        <p className={`mt-1 text-xs ${over ? 'font-medium text-red-700' : 'text-slate-500'}`}>{r.percent == null ? '—' : `${Math.round(r.percent)}%${over ? ' — over budget' : ''}`}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d.can_decide && <Field label="Comment (required when returning)"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>}
        </div>
      )}
    </Modal>
  );
}

export default function BudgetsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState(params.get('status') || '');
  const [editing, setEditing] = useState<Budget | null | 'new'>(null);
  const openId = params.get('open');
  const { data, isFetching } = useQuery({ queryKey: ['finance', 'budgets', unit, status], queryFn: () => api<Page<Budget>>('/finance/budgets/', { params: { org_unit: unit || undefined, status: status || undefined, page_size: 100 } }) });
  const cols: Column<Budget>[] = [
    { key: 'name', header: 'Budget', render: (b) => <div><p className="font-medium">{b.name}</p><p className="text-xs text-slate-500">{b.org_unit_name}</p></div> },
    { key: 'fy', header: 'Year', render: (b) => b.financial_year_name },
    { key: 'inc', header: 'Income', align: 'right', hideOnMobile: true, render: (b) => money(b.total_income, b.currency) },
    { key: 'exp', header: 'Expenditure', align: 'right', render: (b) => money(b.total_expense, b.currency) },
    { key: 'st', header: 'Status', render: (b) => <StatusBadge status={b.status} label={STATUS[b.status]} /> },
  ];
  return (
    <div>
      <PageHeader title="Budgets" subtitle="Branch budgets are approved by the district; district budgets by the region; and so on up to headquarters."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Finance', to: '/finance' }, { label: 'Budgets' }]}
        actions={can('budgets.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New budget</Button>} />
      <Card>
        <Toolbar>
          <UnitSelect value={unit} onChange={setUnit} className="sm:w-64" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48" aria-label="Status">
            <option value="">Any status</option>{Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Toolbar>
        <DataTable columns={cols} rows={data?.results} loading={isFetching} onRowClick={(b) => setParams({ open: b.id })} emptyTitle="No budgets" />
      </Card>
      {editing && <BudgetEditor budget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {openId && <BudgetDetail id={openId} onClose={() => setParams({})} onEdit={(b) => { setParams({}); setEditing(b); }} />}
    </div>
  );
}
