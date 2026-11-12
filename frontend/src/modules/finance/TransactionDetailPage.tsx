import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, CheckCircle2, Circle, Clock, FileDown, Pencil, Send, Trash2, Undo2, X, XCircle } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, DescriptionList, Field, PageHeader, PageLoader, Textarea, useToast } from '@/components/ui';
import { date, dateTime, money } from '@/lib/format';
import { TransactionForm } from './TransactionForm';
import { KindBadge, TxnStatus } from './shared';
import { METHODS, type Txn } from './types';

type Dialog = null | 'approve' | 'reject' | 'reverse' | 'delete' | 'submit';

export default function TransactionDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [comment, setComment] = useState('');
  const [returnToDraft, setReturnToDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const { data: t, isLoading, error } = useQuery({ queryKey: ['finance', 'transaction', id], queryFn: () => api<Txn>(`/finance/transactions/${id}/`) });
  if (isLoading) return <PageLoader />;
  if (error || !t) return <p className="py-10 text-center text-sm text-slate-500">{(error as Error)?.message || 'Transaction not found.'}</p>;

  const refresh = () => { qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); refresh(); setDialog(null); setComment(''); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const post = (path: string, body?: Record<string, unknown>) => api<Txn>(`/finance/transactions/${t.id}/${path}/`, { method: 'POST', body });
  const isReversal = !!t.reversal_of;
  const steps = t.required_steps.length ? t.required_steps : [];
  const approvedSteps = new Set(t.approvals.filter((a) => a.decision === 'approved').map((a) => a.step));

  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{t.reference || 'Draft entry'} <KindBadge kind={t.kind} reversal={isReversal} /> <TxnStatus t={t} />{t.is_demo && <Badge>demo record</Badge>}</span>}
        subtitle={`${t.category_name} · ${t.org_unit_name}`}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Finance', to: '/finance' }, { label: 'Transactions', to: '/finance/transactions' }, { label: t.reference || 'Draft' }]}
        actions={<>
          {t.status === 'draft' && can('finance.edit') && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          {t.status === 'draft' && can('finance.delete') && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDialog('delete')}>Delete draft</Button>}
          {t.status === 'draft' && (can('finance.submit') || can('finance.create')) && <Button icon={<Send className="h-4 w-4" />} onClick={() => setDialog('submit')}>Submit for approval</Button>}
          {t.can_approve && <>
            <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setDialog('approve')}>Approve</Button>
            <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setDialog('reject')}>Return / reject</Button>
          </>}
          {t.status === 'approved' && t.kind === 'income' && !isReversal && can('finance.print') &&
            <Button variant="secondary" icon={<FileDown className="h-4 w-4" />} onClick={() => download(`/finance/transactions/${t.id}/receipt/`, undefined, `receipt-${t.reference}.pdf`).catch((e) => toast.error(e.message))}>Receipt</Button>}
          {t.status === 'approved' && !isReversal && !t.reversed_by && can('finance.create') &&
            <Button variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={() => setDialog('reverse')}>Reverse</Button>}
        </>} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody>
              <p className="text-xs uppercase tracking-wide text-slate-500">Amount</p>
              <p className={`mt-1 text-3xl font-semibold tabular-nums ${t.kind === 'income' && !isReversal ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>{money(t.amount, t.currency)}</p>
              {t.reversed_by && <p className="mt-2 text-sm text-orange-700">Reversed by <Link className="underline" to={`/finance/transactions/${t.reversed_by.id}`}>{t.reversed_by.reference}</Link> ({t.reversed_by.status})</p>}
              {isReversal && <p className="mt-2 text-sm text-orange-700">Reverses <Link className="underline" to={`/finance/transactions/${t.reversal_of}`}>{t.reversal_of_reference}</Link></p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList items={[
                { label: 'Date', value: date(t.transaction_date) },
                { label: 'Financial year', value: t.financial_year_name },
                { label: 'Account', value: t.account_name },
                { label: 'Payment method', value: METHODS.find(([v]) => v === t.method)?.[1] },
                { label: t.kind === 'income' ? 'Received from' : 'Paid to', value: t.party || '—' },
                { label: 'Member', value: t.member ? <Link className="text-royal-700 underline" to={`/members/${t.member}`}>{t.member_name} ({t.member_no})</Link> : '—' },
                { label: 'External reference', value: t.external_ref || '—' },
                { label: 'Program / project', value: t.program_ref || '—' },
                { label: 'Description', value: t.description || '—' },
                { label: 'Supporting document', value: t.attachment ? <a className="text-royal-700 underline" href={t.attachment} target="_blank" rel="noreferrer">Open</a> : '—' },
                { label: 'Recorded by', value: `${t.created_by_name || '—'} · ${dateTime(t.created_at)}` },
              ]} />
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Approval trail" subtitle={t.next_step ? `Waiting for ${t.next_step.label} (${t.next_step.unit_name})` : undefined} />
          <CardBody>
            {steps.length > 0 && (
              <ol className="mb-5 space-y-2">
                {steps.map((s, i) => {
                  const done = approvedSteps.has(i) && (t.status !== 'draft');
                  const current = t.status === 'submitted' && t.current_step === i;
                  return (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : current ? <Clock className="h-4 w-4 text-gold-600" /> : <Circle className="h-4 w-4 text-slate-300" />}
                      <span className={current ? 'font-medium' : ''}>{s.label}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            <ul className="space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
              {t.approvals.map((a) => (
                <li key={a.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1">{a.decision === 'approved' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : a.decision === 'submitted' ? <Send className="h-3.5 w-3.5 text-royal-600" /> : <XCircle className="h-3.5 w-3.5 text-red-600" />}</span>
                  <p><b>{a.by}</b> {a.decision === 'submitted' ? 'submitted' : a.decision === 'returned' ? 'returned for correction' : a.decision}{a.step_label && a.decision !== 'submitted' ? ` · ${a.step_label}` : ''}</p>
                  <p className="text-xs text-slate-500">{dateTime(a.created_at)}</p>
                  {a.comment && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs dark:bg-slate-800">{a.comment}</p>}
                </li>
              ))}
              {!t.approvals.length && <li className="text-sm text-slate-500">Not yet submitted.</li>}
            </ul>
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog open={dialog === 'submit'} onClose={() => setDialog(null)} loading={busy} title="Submit for approval?" confirmLabel="Submit"
        message="Once submitted the entry cannot be changed unless an approver returns it." onConfirm={() => run(() => post('submit'), 'Submitted for approval.')} />
      <ConfirmDialog open={dialog === 'approve'} onClose={() => setDialog(null)} loading={busy} tone="success" title={`Approve ${t.reference}?`} confirmLabel="Approve"
        message={`${money(t.amount, t.currency)} — ${t.category_name}. ${t.next_step && t.next_step.index + 1 < t.next_step.total ? 'It then goes to the next approval level.' : 'This is the final approval; the entry will be locked.'}`}
        onConfirm={() => run(() => post('approve', { comment }), 'Approved.')}>
        <Field label="Comment (optional)"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'reject'} onClose={() => setDialog(null)} loading={busy} tone="danger" title="Return or reject" confirmLabel={returnToDraft ? 'Return for correction' : 'Reject'}
        message="The officer who recorded the entry is notified with your reason." onConfirm={() => run(() => post('reject', { comment, return_to_draft: returnToDraft }), returnToDraft ? 'Returned for correction.' : 'Rejected.')}>
        <Field label="Reason" required><Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <Checkbox checked={returnToDraft} onChange={(e) => setReturnToDraft(e.target.checked)} label="Return to the officer for correction (instead of rejecting outright)" />
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'reverse'} onClose={() => setDialog(null)} loading={busy} tone="danger" title={`Reverse ${t.reference}?`} confirmLabel="Request reversal"
        message="A reversing entry dated today is created and sent for approval. The original stays on record and both are shown in reports."
        onConfirm={() => run(async () => { const r = await post('reverse', { reason: comment }); navigate(`/finance/transactions/${r.id}`); }, 'Reversal submitted for approval.')}>
        <Field label="Reason" required><Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'delete'} onClose={() => setDialog(null)} loading={busy} tone="danger" title="Delete this draft?" confirmLabel="Delete"
        message="Drafts that were never submitted can be removed. The deletion is recorded in the audit trail."
        onConfirm={() => run(async () => { await api(`/finance/transactions/${t.id}/`, { method: 'DELETE' }); navigate('/finance/transactions'); }, 'Draft deleted.')} />
      {editing && <TransactionForm open kind={t.kind} txn={t} onClose={() => { setEditing(false); refresh(); }} />}
    </div>
  );
}
