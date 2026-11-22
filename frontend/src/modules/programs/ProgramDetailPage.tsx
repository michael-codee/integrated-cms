import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Ban, CalendarClock, Check, CheckCircle2, ClipboardList, Globe2, Pencil, RotateCcw, Send, Undo2, Users } from 'lucide-react';
import { api, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, DescriptionList, Field, FormError, FormGrid, Input, Modal, PageHeader, PageLoader, StatusBadge, Textarea, useToast, type Column } from '@/components/ui';
import { date, dateTime, money } from '@/lib/format';
import { AttendanceForm } from '@/modules/attendance/AttendanceForm';
import type { AttendanceRecord } from '@/modules/attendance/types';
import { ProgramForm } from './ProgramForm';
import { programStatusLabel, type Program } from './types';

type Pending = { kind: 'approve' | 'return' | 'postponed' | 'cancelled' | 'completed' | 'planned'; title: string; needsReason: boolean; confirm: string } | null;

function ReportForm({ program, onClose }: { program: Program; onClose: () => void }) {
  const [f, setF] = useState({ report_summary: program.report_summary, salvations: program.salvations?.toString() || '', baptisms: program.baptisms?.toString() || '', follow_up_notes: program.follow_up_notes });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api(`/programs/${program.id}/`, { method: 'PATCH', body: { ...f, salvations: f.salvations === '' ? null : Number(f.salvations), baptisms: f.baptisms === '' ? null : Number(f.baptisms) } });
      toast.success('Outcome report saved.'); qc.invalidateQueries({ queryKey: ['programs'] }); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Outcome report" subtitle={program.title}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.report_summary.trim()} onClick={save}>Save report</Button></>}>
      <FormError message={err} />
      <Field label="What happened" required><Textarea rows={4} value={f.report_summary} onChange={(e) => setF({ ...f, report_summary: e.target.value })} placeholder="Summary of the program, testimonies, challenges" /></Field>
      <FormGrid>
        <Field label="Decisions for Christ" className="mt-4"><Input type="number" min="0" value={f.salvations} onChange={(e) => setF({ ...f, salvations: e.target.value })} /></Field>
        <Field label="Baptisms" className="mt-4"><Input type="number" min="0" value={f.baptisms} onChange={(e) => setF({ ...f, baptisms: e.target.value })} /></Field>
      </FormGrid>
      <Field label="Follow-up plan" className="mt-4"><Textarea rows={2} value={f.follow_up_notes} onChange={(e) => setF({ ...f, follow_up_notes: e.target.value })} /></Field>
    </Modal>
  );
}

export default function ProgramDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [recording, setRecording] = useState<AttendanceRecord | true | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const q = useQuery({ queryKey: ['programs', 'detail', id], queryFn: () => api<Program>(`/programs/${id}/`) });
  const att = useQuery({ queryKey: ['attendance', 'program', id], queryFn: () => api<Page<AttendanceRecord>>('/attendance/', { params: { program: id, ordering: 'date' } }), enabled: can('attendance.view') });
  if (q.isLoading || !q.data) return <PageLoader />;
  const p = q.data;
  const editable = can('programs.edit') && !['cancelled'].includes(p.status);
  const started = new Date(p.starts_at) <= new Date();
  const act = async () => {
    if (!pending) return;
    setBusy(true); setErr('');
    try {
      if (pending.kind === 'approve' || pending.kind === 'return') await api(`/programs/${p.id}/decide/`, { method: 'POST', body: { approve: pending.kind === 'approve', comment: reason } });
      else await api(`/programs/${p.id}/status/`, { method: 'POST', body: { status: pending.kind, comment: reason } });
      toast.success('Done.'); qc.invalidateQueries({ queryKey: ['programs'] }); setPending(null); setReason('');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const submit = async () => {
    try { await api(`/programs/${p.id}/submit/`, { method: 'POST' }); toast.success('Sent for approval.'); qc.invalidateQueries({ queryKey: ['programs'] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  const ask = (kind: NonNullable<Pending>['kind'], title: string, confirm: string, needsReason = false) => { setErr(''); setReason(''); setPending({ kind, title, confirm, needsReason }); };
  const cols: Column<AttendanceRecord>[] = [
    { key: 'date', header: 'Date', render: (r) => date(r.date) },
    { key: 'unit', header: 'Unit', render: (r) => r.org_unit_name },
    { key: 'gender', header: 'Male · Female', align: 'right', render: (r) => `${r.male.toLocaleString()} · ${r.female.toLocaleString()}` },
    { key: 'children', header: 'Children', align: 'right', render: (r) => r.children.toLocaleString() },
    { key: 'conv', header: 'Converts', align: 'right', hideOnMobile: true, render: (r) => r.new_converts },
    { key: 'total', header: 'Total', align: 'right', render: (r) => <strong>{r.total.toLocaleString()}</strong> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{p.title} <StatusBadge status={p.status} label={programStatusLabel(p.status)} />{p.is_public && <Badge tone="purple"><Globe2 className="h-3 w-3" />all units</Badge>}</span>}
        subtitle={`${p.category_name} · ${p.org_unit_name}${p.department_name ? ` · ${p.department_name}` : ''}`}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Programs', to: '/programs' }, { label: p.title }]}
        actions={<div className="flex flex-wrap gap-2">
          {p.can_decide && <>
            <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => ask('approve', 'Approve this program', 'Approve')}>Approve</Button>
            <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => ask('return', 'Return for changes', 'Return', true)}>Return</Button>
          </>}
          {editable && p.status === 'planned' && <Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={submit}>Send for approval</Button>}
          {editable && p.status === 'postponed' && <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => ask('planned', 'Reschedule as planned', 'Mark as planned')}>Reinstate</Button>}
          {editable && started && ['planned', 'approved'].includes(p.status) && <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => ask('completed', 'Mark as held', 'Mark completed')}>Mark completed</Button>}
          {editable && p.status !== 'completed' && <Button variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          {editable && ['planned', 'approved', 'pending_approval'].includes(p.status) && <Button variant="ghost" icon={<CalendarClock className="h-4 w-4" />} onClick={() => ask('postponed', 'Postpone this program', 'Postpone', true)}>Postpone</Button>}
          {editable && p.status !== 'completed' && <Button variant="ghost" className="text-red-600" icon={<Ban className="h-4 w-4" />} onClick={() => ask('cancelled', 'Cancel this program', 'Cancel program', true)}>Cancel</Button>}
        </div>} />
      {p.decision_comment && <p className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200"><strong>{p.status === 'cancelled' ? 'Reason for cancelling' : p.status === 'postponed' ? 'Reason for postponing' : 'Comment'}:</strong> {p.decision_comment}{p.decided_by_name ? ` (${p.decided_by_name})` : ''}</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList items={[
              { label: 'Starts', value: dateTime(p.starts_at) }, { label: 'Ends', value: dateTime(p.ends_at) },
              { label: 'Venue', value: p.venue || '—' }, { label: 'Coordinator', value: p.coordinator || '—' },
              { label: 'Speakers', value: p.speakers || '—' }, { label: 'Expected attendance', value: p.expected_attendance?.toLocaleString() || '—' },
              { label: 'Budget', value: Number(p.budget_amount) ? money(p.budget_amount) : '—' }, { label: 'Planned by', value: p.created_by_name || '—' },
              ...(p.decided_at ? [{ label: p.status === 'approved' || p.status === 'completed' ? 'Approved by' : 'Decided by', value: `${p.decided_by_name} · ${dateTime(p.decided_at)}` }] : []),
            ]} />
            {p.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{p.description}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Outcome" icon={<ClipboardList className="h-4 w-4" />} actions={editable && started && <Button size="sm" variant="secondary" onClick={() => setReporting(true)}>{p.report_summary ? 'Edit report' : 'Write report'}</Button>} />
          <CardBody>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><p className="text-2xl font-semibold tabular-nums">{p.attendance_total ? p.attendance_total.toLocaleString() : "—"}</p><p className="text-xs text-slate-500">Attended</p></div>
              <div><p className="text-2xl font-semibold tabular-nums">{p.salvations ?? '—'}</p><p className="text-xs text-slate-500">Decisions</p></div>
              <div><p className="text-2xl font-semibold tabular-nums">{p.baptisms ?? '—'}</p><p className="text-xs text-slate-500">Baptisms</p></div>
            </div>
            {p.report_summary ? <p className="mt-4 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{p.report_summary}</p>
              : <p className="mt-4 text-sm text-slate-500">{started ? 'No outcome report yet.' : 'The report can be written once the program has started.'}</p>}
            {p.follow_up_notes && <p className="mt-3 text-sm"><strong>Follow-up:</strong> {p.follow_up_notes}</p>}
          </CardBody>
        </Card>
      </div>
      {can('attendance.view') && (
        <Card>
          <CardHeader title="Attendance" icon={<Users className="h-4 w-4" />} subtitle="One record per day of the program"
            actions={can('attendance.create') && started && p.status !== 'cancelled' && <Button size="sm" onClick={() => setRecording(true)}>Record attendance</Button>} />
          <DataTable columns={cols} rows={att.data?.results} loading={att.isLoading} onRowClick={can('attendance.edit') ? (r) => setRecording(r) : undefined} emptyTitle="No attendance yet" emptyMessage={started ? 'Record the head count for each day of the program.' : 'Attendance can be recorded once the program starts.'} />
        </Card>
      )}
      {editing && <ProgramForm program={p} onClose={() => setEditing(false)} />}
      {reporting && <ReportForm program={p} onClose={() => setReporting(false)} />}
      {recording && <AttendanceForm record={recording === true ? null : recording} preset={{ org_unit: p.org_unit, program: p.id, program_title: p.title, department: p.department, date: new Date() > new Date(p.ends_at) ? p.ends_at.slice(0, 10) : undefined }} onClose={() => setRecording(null)} />}
      {pending && (
        <Modal open onClose={() => setPending(null)} title={pending.title} subtitle={p.title}
          footer={<><Button variant="ghost" onClick={() => setPending(null)}>Back</Button><Button variant={pending.kind === 'cancelled' ? 'danger' : 'primary'} loading={busy} disabled={pending.needsReason && !reason.trim()} onClick={act}>{pending.confirm}</Button></>}>
          <FormError message={err} />
          <Field label={pending.needsReason ? 'Reason' : 'Comment (optional)'} required={pending.needsReason}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}
