import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '@/lib/api';
import { uuid } from '@/lib/device';
import { submitChange } from '@/offline/repository';
import { useOnline } from '@/lib/useOnline';
import { Button, Field, FormError, FormGrid, Input, Modal, Select, useToast } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { money, today } from '@/lib/format';
import { DUES_CATEGORY, duesPeriodLabel, METHODS, type Account, type DuesMember, type Txn } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill from the register: the member and the first unpaid month. */
  member?: DuesMember | null;
  month?: string;
  onSaved?: (id: string, submitted: boolean) => void;
}

const thisMonth = () => today().slice(0, 7);

/** Monthly membership dues: an income entry for one member, covering one or more months, that goes through the usual approval. */
export function DuesForm({ open, onClose, member: preset, month, onSaved }: Props) {
  const online = useOnline();
  const toast = useToast();
  const qc = useQueryClient();
  const [unit, setUnit] = useState('');
  const [member, setMember] = useState<DuesMember | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [f, setF] = useState({ account: '', first_month: thisMonth(), months: '1', monthly: '', transaction_date: today(), method: 'cash', external_ref: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setMember(preset || null);
    setMemberQuery(preset ? `${preset.full_name}${preset.membership_no ? ` (${preset.membership_no})` : ''}` : '');
    if (preset) setUnit(preset.org_unit);
    setF((p) => ({ ...p, first_month: month || thisMonth(), months: '1', transaction_date: today(), external_ref: '' }));
  }, [open, preset, month]);

  const accounts = useQuery({ queryKey: ['finance-accounts', 'active'], queryFn: () => api<Page<Account>>('/finance/accounts/', { params: { is_active: true, page_size: 200 } }).then((p) => p.results), enabled: open });
  const unitAccounts = useMemo(() => (accounts.data || []).filter((a) => !unit || a.org_unit === unit), [accounts.data, unit]);
  useEffect(() => {
    if (unitAccounts.length && !unitAccounts.some((a) => a.id === f.account)) setF((p) => ({ ...p, account: unitAccounts[0].id }));
  }, [unitAccounts, f.account]);
  const account = unitAccounts.find((a) => a.id === f.account);
  const cats = useLookup('finance-categories');
  const category = (cats.data || []).find((c) => c.code === DUES_CATEGORY);
  const members = useQuery({
    queryKey: ['dues-member-pick', unit, memberQuery], enabled: open && !member && memberQuery.length >= 2 && online,
    queryFn: () => api<DuesMember[]>('/finance/dues/members/', { params: { search: memberQuery, org_unit: unit || undefined } }),
  });

  const months = Math.min(12, Math.max(1, Number(f.months) || 1));
  const total = (Number(f.monthly) || 0) * months;
  const period = duesPeriodLabel(f.first_month ? `${f.first_month}-01` : null, months);

  const save = async (andSubmit: boolean) => {
    setErrors({});
    if (!member) return setErrors({ member: online ? 'Search for the member and choose them from the list.' : 'Choosing a member needs a connection. Open this from the register while online, or wait until you are back online.' });
    if (!f.account) return setErrors({ account: 'Choose an account. Accounts are set up under Finance → Accounts.' });
    if (!f.first_month) return setErrors({ first_month: 'Choose the first month paid for.' });
    if (!(Number(f.monthly) > 0)) return setErrors({ monthly: 'Enter the amount paid per month.' });
    if (!category) return setErrors({ form: 'The "Monthly membership dues" income category is missing. Ask an administrator to run the latest update.' });
    setBusy(andSubmit ? 'submit' : 'draft');
    const body: Record<string, unknown> = {
      kind: 'income', account: f.account, category: category.id, amount: total.toFixed(2), transaction_date: f.transaction_date,
      method: f.method, external_ref: f.external_ref, member: member.id, party: member.full_name,
      dues_month: `${f.first_month}-01`, dues_months: months, description: `Monthly dues: ${period}`,
    };
    try {
      const id = uuid();
      const res = await submitChange<Txn>({
        entity: 'finance-transactions', op: 'create', method: 'POST', url: '/finance/transactions/',
        body: { ...body, id, client_created_at: new Date().toISOString() }, recordId: id,
        label: `Dues ${member.full_name} — ${period} — draft`,
      });
      if (res.state === 'queued') {
        toast.offline('Saved on this device as a draft. It will upload when you are back online; submit it for approval then.');
      } else if (andSubmit) {
        await api(`/finance/transactions/${res.data.id}/submit/`, { method: 'POST' });
        toast.success('Dues submitted for approval.');
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
    <Modal open={open} onClose={onClose} size="lg" title="Record monthly dues"
      subtitle="A member's monthly membership dues. The entry goes through the same approval as other income."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" loading={busy === 'draft'} disabled={!!busy} onClick={() => save(false)}>Save draft</Button>
        {online && <Button loading={busy === 'submit'} disabled={!!busy} onClick={() => save(true)}>Save &amp; submit for approval</Button>}
      </>}>
      <FormError message={errors.form} />
      {!online && <p className="mb-3 rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-900 dark:bg-gold-900/30 dark:text-gold-100">You are offline. The entry is saved as a draft on this device and needs approval after it uploads.</p>}
      <FormGrid>
        <Field label="Unit" required error={errors.org_unit}>
          <UnitSelect value={unit} onChange={(v) => { setUnit(v); set('account', ''); if (member && v && member.org_unit !== v) { setMember(null); setMemberQuery(''); } }} placeholder="Choose unit" />
        </Field>
        <Field label="Member" required hint={online ? 'Type at least two letters of a name or membership number' : 'Member search needs a connection'} error={errors.member}>
          <div className="space-y-1">
            <Input value={memberQuery} onChange={(e) => { setMemberQuery(e.target.value); setMember(null); }} placeholder="Search members" disabled={!online && !member} invalid={!!errors.member} />
            {member && <p className="text-xs text-emerald-700 dark:text-emerald-400">{member.full_name} · {member.org_unit_name}</p>}
            {!member && members.data && members.data.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-lg border border-slate-200 text-sm dark:border-slate-700">
                {members.data.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                      onClick={() => { setMember(m); setMemberQuery(`${m.full_name}${m.membership_no ? ` (${m.membership_no})` : ''}`); if (!unit) setUnit(m.org_unit); }}>
                      {m.full_name} <span className="text-xs text-slate-500">{m.membership_no} · {m.org_unit_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!member && members.data && members.data.length === 0 && memberQuery.length >= 2 && <p className="text-xs text-slate-500">No member found in your units.</p>}
          </div>
        </Field>
        <Field label="First month paid for" required error={errors.first_month || errors.dues_month}>
          <Input type="month" value={f.first_month} onChange={(e) => set('first_month', e.target.value)} invalid={!!(errors.first_month || errors.dues_month)} />
        </Field>
        <Field label="Number of months" required error={errors.dues_months}>
          <Select value={f.months} onChange={(e) => set('months', e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} {i === 0 ? 'month' : 'months'}</option>)}
          </Select>
        </Field>
        <Field label={`Amount per month${account ? ` (${account.currency})` : ''}`} required error={errors.monthly}>
          <Input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.monthly} onChange={(e) => set('monthly', e.target.value)} invalid={!!errors.monthly} />
        </Field>
        <Field label="Account" required error={errors.account}>
          <Select value={f.account} onChange={(e) => set('account', e.target.value)} invalid={!!errors.account}>
            <option value="">Choose account</option>
            {unitAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.org_unit_name} ({a.currency})</option>)}
          </Select>
        </Field>
        <Field label="Date received" required error={errors.transaction_date}><Input type="date" max={today()} value={f.transaction_date} onChange={(e) => set('transaction_date', e.target.value)} /></Field>
        <Field label="Payment method"><Select value={f.method} onChange={(e) => set('method', e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Reference (bank, mobile money)"><Input value={f.external_ref} onChange={(e) => set('external_ref', e.target.value)} /></Field>
      </FormGrid>
      <div className="mt-4 rounded-lg bg-royal-50 px-3 py-2 text-sm text-royal-900 dark:bg-slate-800 dark:text-slate-100">
        {period || 'Choose a month'} · <span className="font-semibold tabular-nums">{money(total, account?.currency || 'SLE')}</span>
        {errors.amount && <span className="ml-2 text-red-600">{errors.amount}</span>}
      </div>
    </Modal>
  );
}
