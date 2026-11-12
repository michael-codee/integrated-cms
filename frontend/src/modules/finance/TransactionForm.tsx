import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '@/lib/api';
import { uuid } from '@/lib/device';
import { submitChange } from '@/offline/repository';
import { useOnline } from '@/lib/useOnline';
import { Button, Field, FormError, FormGrid, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { today } from '@/lib/format';
import { METHODS, type Account, type Txn, type TxnKind } from './types';

interface Props { open: boolean; onClose: () => void; kind: TxnKind; txn?: Txn | null; onSaved?: (id: string, submitted: boolean) => void }

export function TransactionForm({ open, onClose, kind, txn, onSaved }: Props) {
  const online = useOnline();
  const toast = useToast();
  const qc = useQueryClient();
  const [unit, setUnit] = useState('');
  const [f, setF] = useState({ account: '', category: '', amount: '', transaction_date: today(), method: 'cash', party: '', member: '', program_ref: '', description: '', external_ref: '' });
  const [memberQuery, setMemberQuery] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (txn) {
      setUnit(txn.org_unit);
      setF({ account: txn.account, category: txn.category, amount: txn.amount, transaction_date: txn.transaction_date, method: txn.method, party: txn.party, member: txn.member || '', program_ref: txn.program_ref, description: txn.description, external_ref: txn.external_ref });
    } else {
      setF((p) => ({ ...p, category: '', amount: '', party: '', member: '', description: '', external_ref: '', program_ref: '', transaction_date: today() }));
    }
  }, [open, txn]);
  const accounts = useQuery({ queryKey: ['finance-accounts', 'active'], queryFn: () => api<Page<Account>>('/finance/accounts/', { params: { is_active: true, page_size: 200 } }).then((p) => p.results), enabled: open });
  const unitAccounts = useMemo(() => (accounts.data || []).filter((a) => !unit || a.org_unit === unit), [accounts.data, unit]);
  useEffect(() => {
    if (!txn && unitAccounts.length && !unitAccounts.some((a) => a.id === f.account)) setF((p) => ({ ...p, account: unitAccounts[0].id }));
  }, [unitAccounts, txn, f.account]);
  const cats = useLookup('finance-categories');
  const categories = (cats.data || []).filter((c) => c.kind === kind && c.is_active);
  const members = useQuery({
    queryKey: ['member-pick', unit, memberQuery], enabled: open && kind === 'income' && memberQuery.length >= 2 && online,
    queryFn: () => api<Page<{ id: string; full_name: string; membership_no: string }>>('/members/', { params: { search: memberQuery, org_unit: unit || undefined, page_size: 8 } }).then((p) => p.results),
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const account = unitAccounts.find((a) => a.id === f.account);

  const save = async (andSubmit: boolean) => {
    setErrors({});
    if (!f.account) return setErrors({ account: 'Choose an account. Accounts are set up under Finance → Accounts.' });
    if (!f.category) return setErrors({ category: 'Choose a category.' });
    if (!(Number(f.amount) > 0)) return setErrors({ amount: 'Enter an amount greater than zero.' });
    setBusy(andSubmit ? 'submit' : 'draft');
    const body: Record<string, unknown> = { ...f, kind, member: f.member || null };
    try {
      const id = txn?.id || uuid();
      const res = await submitChange<Txn>({
        entity: 'finance-transactions', op: txn ? 'update' : 'create', method: txn ? 'PATCH' : 'POST',
        url: txn ? `/finance/transactions/${id}/` : '/finance/transactions/', body: txn ? body : { ...body, id, client_created_at: new Date().toISOString() },
        recordId: id, baseVersion: txn?.version, label: `${kind === 'income' ? 'Income' : 'Expenditure'} ${f.amount} — draft`,
      });
      if (res.state === 'queued') {
        toast.offline('Saved on this device as a draft. It will upload when you are back online; submit it for approval then.');
      } else if (andSubmit) {
        await api(`/finance/transactions/${res.data.id}/submit/`, { method: 'POST' });
        toast.success('Submitted for approval.');
      } else {
        toast.success('Draft saved.');
      }
      qc.invalidateQueries({ queryKey: ['finance'] });
      onSaved?.(res.state === 'synced' ? res.data.id : id, andSubmit && res.state === 'synced');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(''); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={`${txn ? 'Edit' : 'Record'} ${kind === 'income' ? 'income' : 'expenditure'}`}
      subtitle={kind === 'income' ? 'Tithes, offerings, donations and other receipts' : 'Payments made from a church account'}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" loading={busy === 'draft'} disabled={!!busy} onClick={() => save(false)}>Save draft</Button>
        {online && <Button loading={busy === 'submit'} disabled={!!busy} onClick={() => save(true)}>Save &amp; submit for approval</Button>}
      </>}>
      <FormError message={errors.form} />
      {!online && <p className="mb-3 rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-900 dark:bg-gold-900/30 dark:text-gold-100">You are offline. The entry is saved as a draft on this device and needs approval after it uploads. Reference numbers are issued by the server.</p>}
      <FormGrid>
        {!txn && <Field label="Unit" required error={errors.org_unit}><UnitSelect value={unit} onChange={(v) => { setUnit(v); set('account', ''); }} placeholder="Choose unit" /></Field>}
        <Field label="Account" required error={errors.account}>
          <Select value={f.account} onChange={(e) => set('account', e.target.value)} invalid={!!errors.account}>
            <option value="">Choose account</option>
            {unitAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.org_unit_name} ({a.currency})</option>)}
          </Select>
        </Field>
        <Field label="Category" required error={errors.category}>
          <Select value={f.category} onChange={(e) => set('category', e.target.value)} invalid={!!errors.category}>
            <option value="">Choose category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={`Amount${account ? ` (${account.currency})` : ''}`} required error={errors.amount}>
          <Input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} invalid={!!errors.amount} />
        </Field>
        <Field label="Date" required error={errors.transaction_date}><Input type="date" max={today()} value={f.transaction_date} onChange={(e) => set('transaction_date', e.target.value)} /></Field>
        <Field label="Payment method"><Select value={f.method} onChange={(e) => set('method', e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label={kind === 'income' ? 'Received from' : 'Paid to'} error={errors.party}><Input value={f.party} onChange={(e) => set('party', e.target.value)} placeholder={kind === 'income' ? 'e.g. Sunday congregation' : 'Supplier or person'} /></Field>
        <Field label="Reference (cheque, bank, mobile money, invoice)"><Input value={f.external_ref} onChange={(e) => set('external_ref', e.target.value)} /></Field>
        {kind === 'income' && (
          <Field label="Contributing member (optional)" hint={online ? 'Type at least two letters of a name or membership number' : 'Member search needs a connection'} error={errors.member}>
            <div className="space-y-1">
              <Input value={memberQuery} onChange={(e) => { setMemberQuery(e.target.value); set('member', ''); }} placeholder="Search members" disabled={!online} />
              {f.member && <p className="text-xs text-emerald-700">Linked to {txn?.member === f.member ? txn?.member_name : members.data?.find((m) => m.id === f.member)?.full_name}</p>}
              {!f.member && members.data && members.data.length > 0 && (
                <ul className="max-h-36 overflow-auto rounded-lg border border-slate-200 text-sm dark:border-slate-700">
                  {members.data.map((m) => <li key={m.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => { set('member', m.id); setMemberQuery(`${m.full_name} (${m.membership_no})`); }}>{m.full_name} <span className="text-xs text-slate-500">{m.membership_no}</span></button></li>)}
                </ul>
              )}
            </div>
          </Field>
        )}
        <Field label="Program / project (optional)"><Input value={f.program_ref} onChange={(e) => set('program_ref', e.target.value)} /></Field>
      </FormGrid>
      <Field label="Description" className="mt-4" error={errors.description}><Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
    </Modal>
  );
}
