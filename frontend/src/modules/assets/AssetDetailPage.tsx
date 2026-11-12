import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ArrowRightLeft, Check, Pencil, Trash2, Wrench, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, Field, FormError, FormGrid, Input, Modal, PageHeader, PageLoader, Select, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { date, dateTime, money, today } from '@/lib/format';
import { AssetForm } from './AssetForm';
import { ACQUISITION, CONDITIONS, DISPOSAL_METHODS, MAINT_KINDS, statusLabel, type Asset, type Disposal, type Maintenance, type Movement } from './types';

type Tab = 'details' | 'maintenance' | 'movements' | 'depreciation';
interface Schedule { rate: string; book_value: string; schedule: { year: number; period_end: string; opening: string; depreciation: string; closing: string }[] }

function MaintenanceForm({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [f, setF] = useState({ kind: 'routine', date: today(), description: '', provider: '', cost: '0', condition_after: '', next_due_date: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api('/asset-maintenance/', { method: 'POST', body: { ...f, asset: asset.id, next_due_date: f.next_due_date || null } });
      toast.success('Maintenance recorded.'); qc.invalidateQueries({ queryKey: ['assets'] }); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Record maintenance or inspection" subtitle={`${asset.asset_no} · ${asset.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.description.trim()} onClick={save}>Save</Button></>}>
      <FormError message={err} />
      <FormGrid>
        <Field label="Type"><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>{MAINT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" max={today()} value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Done by"><Input value={f.provider} onChange={(e) => set('provider', e.target.value)} /></Field>
        <Field label="Cost (SLE)" hint="Record the payment itself under Finance."><Input type="number" min="0" step="0.01" value={f.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
        <Field label="Condition afterwards"><Select value={f.condition_after} onChange={(e) => set('condition_after', e.target.value)}><option value="">Unchanged</option>{CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Next due"><Input type="date" min={f.date} value={f.next_due_date} onChange={(e) => set('next_due_date', e.target.value)} /></Field>
      </FormGrid>
      <Field label="What was done" required className="mt-4"><Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
    </Modal>
  );
}

function TransferForm({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [loc, setLoc] = useState('');
  const [cust, setCust] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const directory = useQuery({ queryKey: ['org-directory'], queryFn: () => api<{ id: string; name: string; code: string }[]>('/org-units/directory/') });
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api('/asset-movements/', { method: 'POST', body: { asset: asset.id, to_unit: to, reason, new_location: loc, new_custodian: cust } });
      toast.success('Transfer requested. The receiving unit must approve it.'); qc.invalidateQueries({ queryKey: ['assets'] }); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Transfer to another unit" subtitle="The asset moves only after the receiving unit approves."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!to || !reason.trim()} onClick={save}>Request transfer</Button></>}>
      <FormError message={err} />
      <Field label="Receiving unit" required>
        <Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose unit</option>{(directory.data || []).filter((u) => u.id !== asset.org_unit).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
      </Field>
      <FormGrid><Field label="New location" className="mt-4"><Input value={loc} onChange={(e) => setLoc(e.target.value)} /></Field><Field label="New custodian" className="mt-4"><Input value={cust} onChange={(e) => setCust(e.target.value)} /></Field></FormGrid>
      <Field label="Reason" required className="mt-4"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

function DisposalForm({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [f, setF] = useState({ method: 'scrap', reason: '', proposed_date: today(), proceeds: '0' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api('/asset-disposals/', { method: 'POST', body: { ...f, asset: asset.id } });
      toast.success('Disposal proposed. It needs approval from the level above this unit.'); qc.invalidateQueries({ queryKey: ['assets'] }); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Propose disposal or write-off" subtitle={`Current book value ${money(asset.book_value, asset.currency)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!f.reason.trim()} onClick={save}>Propose disposal</Button></>}>
      <FormError message={err} />
      <FormGrid>
        <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{DISPOSAL_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={f.proposed_date} onChange={(e) => setF({ ...f, proposed_date: e.target.value })} /></Field>
        {f.method === 'sale' && <Field label="Sale proceeds (SLE)" hint="Record the income under Finance once received."><Input type="number" min="0" value={f.proceeds} onChange={(e) => setF({ ...f, proceeds: e.target.value })} /></Field>}
      </FormGrid>
      <Field label="Reason" required className="mt-4"><Textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </Modal>
  );
}

export default function AssetDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('details');
  const [modal, setModal] = useState<null | 'edit' | 'maint' | 'transfer' | 'dispose'>(null);
  const [decide, setDecide] = useState<null | { kind: 'movement' | 'disposal'; id: string; approve: boolean }>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: a, isLoading, error } = useQuery({ queryKey: ['assets', 'one', id], queryFn: () => api<Asset>(`/assets/${id}/`) });
  const history = useQuery({ queryKey: ['assets', 'history', id], queryFn: () => api<{ movements: Movement[]; maintenance: Maintenance[]; disposals: Disposal[] }>(`/assets/${id}/history/`), enabled: !!a });
  const schedule = useQuery({ queryKey: ['assets', 'dep', id], queryFn: () => api<Schedule>(`/assets/${id}/depreciation/`), enabled: tab === 'depreciation' });
  if (isLoading) return <PageLoader />;
  if (error || !a) return <p className="py-10 text-center text-sm text-slate-500">{(error as Error)?.message || 'Asset not found.'}</p>;
  const open = a.status !== 'disposed' && a.status !== 'lost';
  const doDecide = async () => {
    if (!decide) return;
    setBusy(true);
    try {
      await api(`/${decide.kind === 'movement' ? 'asset-movements' : 'asset-disposals'}/${decide.id}/decide/`, { method: 'POST', body: { approve: decide.approve, comment } });
      toast.success(decide.approve ? 'Approved.' : 'Rejected.');
      qc.invalidateQueries({ queryKey: ['assets'] }); qc.invalidateQueries({ queryKey: ['dashboard'] });
      setDecide(null); setComment('');
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{a.name} <StatusBadge status={a.status} label={statusLabel(a.status)} />{a.is_demo && <Badge>demo record</Badge>}</span>}
        subtitle={`${a.asset_no} · ${a.category_name} · ${a.org_unit_name}`}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Assets', to: '/assets' }, { label: a.asset_no || a.name }]}
        actions={open && <>
          {can('assets.edit') && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setModal('edit')}>Edit</Button>}
          {can('assets.edit') && <Button variant="secondary" icon={<Wrench className="h-4 w-4" />} onClick={() => setModal('maint')}>Maintenance</Button>}
          {can('assets.edit') && !a.pending_movement && <Button variant="secondary" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setModal('transfer')}>Transfer</Button>}
          {can('assets.edit') && !a.pending_disposal && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setModal('dispose')}>Dispose</Button>}
        </>} />
      {a.pending_movement && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-royal-200 bg-royal-50 px-4 py-3 text-sm dark:border-royal-800 dark:bg-royal-900/30">
          <span>Transfer to <b>{a.pending_movement.to_unit_name}</b> awaiting approval — {a.pending_movement.reason}</span>
          {a.pending_movement.can_decide && <span className="flex gap-2"><Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setDecide({ kind: 'movement', id: a.pending_movement!.id, approve: true })}>Approve</Button><Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setDecide({ kind: 'movement', id: a.pending_movement!.id, approve: false })}>Reject</Button></span>}
        </div>
      )}
      {a.pending_disposal && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm dark:border-orange-800 dark:bg-orange-900/30">
          <span>Disposal proposed ({a.pending_disposal.method}) — {a.pending_disposal.reason}</span>
          {a.pending_disposal.can_decide && <span className="flex gap-2"><Button size="sm" variant="danger" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setDecide({ kind: 'disposal', id: a.pending_disposal!.id, approve: true })}>Approve disposal</Button><Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setDecide({ kind: 'disposal', id: a.pending_disposal!.id, approve: false })}>Reject</Button></span>}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'details', label: 'Details' }, { value: 'maintenance', label: `Maintenance (${history.data?.maintenance.length ?? 0})` }, { value: 'movements', label: 'Transfers & disposal' }, { value: 'depreciation', label: 'Depreciation' }]} />
      {tab === 'details' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2"><CardBody>
            <DescriptionList items={[
              { label: 'Location', value: a.location || '—' }, { label: 'Custodian', value: a.custodian || '—' },
              { label: 'Condition', value: <StatusBadge status={a.condition} label={CONDITIONS.find(([v]) => v === a.condition)?.[1]} /> },
              { label: 'Acquired', value: `${date(a.acquisition_date)} · ${ACQUISITION.find(([v]) => v === a.acquisition_method)?.[1]}` },
              { label: 'Funding source', value: a.funding_source || '—' }, { label: 'Supplier / donor', value: a.supplier || '—' },
              { label: 'Serial number', value: a.serial_number || '—' },
              ...(a.registration_no ? [{ label: 'Registration', value: a.registration_no }] : []),
              ...(a.title_document_no ? [{ label: 'Title / deed', value: `${a.title_document_no}${a.size_description ? ` · ${a.size_description}` : ''}` }] : []),
              { label: 'Warranty expires', value: date(a.warranty_expiry) }, { label: 'Insurance', value: a.insurance_expiry ? `${a.insurance_details || 'Insured'} · expires ${date(a.insurance_expiry)}` : '—' },
              { label: 'Last maintenance', value: a.last_maintenance ? `${a.last_maintenance.kind} · ${date(a.last_maintenance.date)}${a.last_maintenance.next_due_date ? ` · next ${date(a.last_maintenance.next_due_date)}` : ''}` : '—' },
              { label: 'Ownership document', value: a.document ? <a className="text-royal-700 underline" href={a.document} target="_blank" rel="noreferrer">Open</a> : '—' },
              { label: 'Description', value: a.description || '—' }, { label: 'Notes', value: a.notes || '—' },
              ...(a.disposed_on ? [{ label: 'Left the register', value: date(a.disposed_on) }] : []),
            ]} />
          </CardBody></Card>
          <div className="space-y-6">
            {a.photo && <Card><img src={a.photo} alt={a.name} className="h-56 w-full rounded-xl object-cover" /></Card>}
            <Card><CardBody>
              <p className="text-xs uppercase tracking-wide text-slate-500">Book value today</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{money(a.book_value, a.currency)}</p>
              <p className="mt-1 text-xs text-slate-500">Cost {money(a.cost, a.currency)} · {Number(a.effective_rate) ? `${a.effective_rate}% a year straight-line` : 'not depreciated'}</p>
            </CardBody></Card>
          </div>
        </div>
      )}
      {tab === 'maintenance' && (
        <Card>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(history.data?.maintenance || []).map((m) => (
              <li key={m.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{MAINT_KINDS.find(([v]) => v === m.kind)?.[1]} · {date(m.date)}</span><span className="tabular-nums text-slate-500">{money(m.cost)}</span></div>
                <p className="mt-1">{m.description}</p>
                <p className="mt-1 text-xs text-slate-500">{[m.provider, m.recorded_by && `recorded by ${m.recorded_by}`, m.next_due_date && `next due ${date(m.next_due_date)}`].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
            {!history.data?.maintenance.length && <li className="px-5 py-8 text-center text-sm text-slate-500">No maintenance recorded yet.</li>}
          </ul>
        </Card>
      )}
      {tab === 'movements' && (
        <Card>
          <CardHeader title="Transfers" />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(history.data?.movements || []).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>{m.from_unit_name} → <b>{m.to_unit_name}</b><span className="block text-xs text-slate-500">{m.reason} · requested by {m.requested_by} · {dateTime(m.created_at)}{m.decided_by_name ? ` · decided by ${m.decided_by_name}` : ''}</span></span>
                <StatusBadge status={m.status} />
              </li>
            ))}
            {!history.data?.movements.length && <li className="px-5 py-6 text-center text-sm text-slate-500">No transfers.</li>}
          </ul>
          <CardHeader title="Disposal requests" />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(history.data?.disposals || []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>{DISPOSAL_METHODS.find(([v]) => v === d.method)?.[1]} · {date(d.proposed_date)}<span className="block text-xs text-slate-500">{d.reason} · book value then {money(d.book_value_at_request)} · {d.requested_by}{d.comment ? ` · “${d.comment}”` : ''}</span></span>
                <StatusBadge status={d.status} />
              </li>
            ))}
            {!history.data?.disposals.length && <li className="px-5 py-6 text-center text-sm text-slate-500">None.</li>}
          </ul>
        </Card>
      )}
      {tab === 'depreciation' && (
        <Card>
          <CardHeader title="Straight-line depreciation schedule" subtitle={schedule.data ? `${schedule.data.rate}% a year from ${date(a.acquisition_date)}` : undefined} />
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="px-5 py-2 text-left">Year</th><th className="px-3 py-2 text-left">Ending</th><th className="px-3 py-2 text-right">Opening</th><th className="px-3 py-2 text-right">Depreciation</th><th className="px-5 py-2 text-right">Closing</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(schedule.data?.schedule || []).map((r) => <tr key={r.year}><td className="px-5 py-2">{r.year}</td><td className="px-3">{date(r.period_end)}</td><td className="px-3 text-right tabular-nums">{money(r.opening)}</td><td className="px-3 text-right tabular-nums">{money(r.depreciation)}</td><td className="px-5 text-right tabular-nums">{money(r.closing)}</td></tr>)}
                {schedule.data && !schedule.data.schedule.length && <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-500">This asset is not depreciated (or has no acquisition date).</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {modal === 'edit' && <AssetForm asset={a} onClose={() => setModal(null)} />}
      {modal === 'maint' && <MaintenanceForm asset={a} onClose={() => setModal(null)} />}
      {modal === 'transfer' && <TransferForm asset={a} onClose={() => setModal(null)} />}
      {modal === 'dispose' && <DisposalForm asset={a} onClose={() => setModal(null)} />}
      <ConfirmDialog open={!!decide} onClose={() => setDecide(null)} loading={busy} onConfirm={doDecide} tone={decide?.approve ? (decide.kind === 'disposal' ? 'danger' : 'success') : 'danger'}
        title={decide ? `${decide.approve ? 'Approve' : 'Reject'} ${decide.kind === 'movement' ? 'transfer' : 'disposal'}?` : ''} confirmLabel={decide?.approve ? 'Approve' : 'Reject'}
        message={decide?.kind === 'disposal' && decide.approve ? 'The asset leaves the register and can no longer be edited.' : ''}>
        <Field label={decide?.approve ? 'Comment (optional)' : 'Reason'} required={!decide?.approve}><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}
