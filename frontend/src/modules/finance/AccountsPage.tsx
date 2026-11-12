import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Landmark, Plus, Scale, Smartphone } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, FormError, FormGrid, Input, Modal, PageHeader, Select, Textarea, Toolbar, useToast, type Column } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { date, money, today } from '@/lib/format';
import { ACCOUNT_KINDS, type Account, type Reconciliation } from './types';

const ICONS = { cash: Banknote, bank: Landmark, mobile_money: Smartphone };

function AccountForm({ account, onClose }: { account: Account | null | 'new'; onClose: () => void }) {
  const editing = account && account !== 'new' ? account : null;
  const [f, setF] = useState({ org_unit: editing?.org_unit || '', name: editing?.name || '', kind: editing?.kind || 'cash', institution: editing?.institution || '', account_number: editing?.account_number || '', currency: editing?.currency || 'SLE', opening_balance: editing?.opening_balance || '0', opening_date: editing?.opening_date || today(), is_active: editing?.is_active ?? true, notes: editing?.notes || '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const currencies = useQuery({ queryKey: ['currencies'], queryFn: () => api<{ code: string; name: string }[]>('/currencies/') });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await api(editing ? `/finance/accounts/${editing.id}/` : '/finance/accounts/', { method: editing ? 'PATCH' : 'POST', body: f });
      toast.success('Account saved.');
      qc.invalidateQueries({ queryKey: ['finance-accounts'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors({ ...e.fieldErrors, form: e.message });
      else setErrors({ form: (e as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New account'} subtitle="A cash box, bank account or mobile-money wallet held by a unit"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <FormError message={errors.form} />
      <FormGrid>
        <Field label="Unit" required error={errors.org_unit}><UnitSelect value={f.org_unit} onChange={(v) => set('org_unit', v)} placeholder="Choose unit" /></Field>
        <Field label="Account name" required error={errors.name}><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Main cash box" /></Field>
        <Field label="Type"><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>{ACCOUNT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Currency" error={errors.currency}><Select value={f.currency} onChange={(e) => set('currency', e.target.value)}>{(currencies.data || [{ code: 'SLE', name: 'Leone' }]).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</Select></Field>
        <Field label="Bank / provider"><Input value={f.institution} onChange={(e) => set('institution', e.target.value)} /></Field>
        <Field label="Account number"><Input value={f.account_number} onChange={(e) => set('account_number', e.target.value)} /></Field>
        <Field label="Opening balance" error={errors.opening_balance}><Input type="number" step="0.01" value={f.opening_balance} onChange={(e) => set('opening_balance', e.target.value)} /></Field>
        <Field label="Opening date" error={errors.opening_date}><Input type="date" value={f.opening_date} onChange={(e) => set('opening_date', e.target.value)} /></Field>
      </FormGrid>
      <Field label="Notes" className="mt-4"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      {editing && <div className="mt-3"><Checkbox checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} label="Account is in use" /></div>}
    </Modal>
  );
}

function ReconcileForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const [asOf, setAsOf] = useState(today());
  const [balance, setBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ['finance', 'reconciliations', account.id], queryFn: () => api<Page<Reconciliation>>('/finance/reconciliations/', { params: { account: account.id } }) });
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<Reconciliation>('/finance/reconciliations/', { method: 'POST', body: { account: account.id, as_of: asOf, statement_balance: balance, notes } });
      Number(r.difference) === 0 ? toast.success('Balanced: the statement agrees with the books.') : toast.info(`Recorded. Difference of ${money(r.difference, account.currency)} to investigate.`);
      qc.invalidateQueries({ queryKey: ['finance', 'reconciliations', account.id] });
      setBalance(''); setNotes('');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Reconcile ${account.name}`} subtitle={`Compare the bank statement or cash count with the books (${account.org_unit_name})`}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={busy} disabled={!balance} onClick={save}>Record reconciliation</Button></>}>
      <FormError message={err} />
      <FormGrid>
        <Field label="As of date"><Input type="date" max={today()} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <Field label={`Statement / counted balance (${account.currency})`} required><Input type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} /></Field>
      </FormGrid>
      <Field label="Notes" className="mt-4"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <h4 className="mb-2 mt-6 text-sm font-semibold">Previous reconciliations</h4>
      <div className="max-h-60 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-right">Statement</th><th className="px-3 py-2 text-right">Books</th><th className="px-3 py-2 text-right">Difference</th><th className="px-3 py-2 text-left">By</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {(history.data?.results || []).map((r) => (
              <tr key={r.id}><td className="px-3 py-2">{date(r.as_of)}</td><td className="px-3 py-2 text-right tabular-nums">{money(r.statement_balance, account.currency)}</td><td className="px-3 py-2 text-right tabular-nums">{money(r.book_balance, account.currency)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${Number(r.difference) ? 'text-red-700' : 'text-emerald-700'}`}>{money(r.difference, account.currency)}</td><td className="px-3 py-2 text-xs">{r.by}</td></tr>
            ))}
            {!history.data?.results.length && <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-500">None yet</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export default function AccountsPage() {
  const { can } = useAuth();
  const [unit, setUnit] = useState('');
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [reconciling, setReconciling] = useState<Account | null>(null);
  const { data, isFetching } = useQuery({ queryKey: ['finance-accounts', unit], queryFn: () => api<Page<Account>>('/finance/accounts/', { params: { org_unit: unit || undefined, page_size: 200 } }) });
  const cols: Column<Account>[] = [
    { key: 'name', header: 'Account', render: (a) => { const I = ICONS[a.kind]; return <div className="flex items-center gap-3"><I className="h-4 w-4 text-slate-400" /><div><p className="font-medium">{a.name} {!a.is_active && <Badge>closed</Badge>}</p><p className="text-xs text-slate-500">{[a.institution, a.account_number].filter(Boolean).join(' · ') || ACCOUNT_KINDS.find(([v]) => v === a.kind)?.[1]}</p></div></div>; } },
    { key: 'unit', header: 'Unit', render: (a) => a.org_unit_name },
    { key: 'bal', header: 'Balance', align: 'right', render: (a) => <span className="font-semibold">{money(a.balance, a.currency)}</span> },
    { key: 'act', header: '', align: 'right', render: (a) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {can('finance.edit') && <Button size="sm" variant="ghost" icon={<Scale className="h-3.5 w-3.5" />} onClick={() => setReconciling(a)}>Reconcile</Button>}
        {can('finance.edit') && <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>}
      </div>
    ) },
  ];
  return (
    <div>
      <PageHeader title="Accounts" subtitle="Balances include approved entries only."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Finance', to: '/finance' }, { label: 'Accounts' }]}
        actions={can('finance.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New account</Button>} />
      <Card>
        <CardHeader title="Cash, bank and mobile-money accounts" />
        <Toolbar><UnitSelect value={unit} onChange={setUnit} className="sm:w-64" /></Toolbar>
        <DataTable columns={cols} rows={data?.results} loading={isFetching} emptyTitle="No accounts yet" emptyMessage="Create an account for each cash box, bank account or mobile-money wallet before recording transactions." />
      </Card>
      {editing && <AccountForm account={editing} onClose={() => setEditing(null)} />}
      {reconciling && <ReconcileForm account={reconciling} onClose={() => setReconciling(null)} />}
    </div>
  );
}
