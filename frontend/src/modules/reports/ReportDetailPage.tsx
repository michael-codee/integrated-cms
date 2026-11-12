import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Check, Download, Save, Send, Undo2 } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { submitChange } from '@/offline/repository';
import { Button, Card, CardBody, CardHeader, Field, FormError, Modal, PageHeader, PageLoader, StatusBadge, Textarea, useToast } from '@/components/ui';
import { date, dateTime, money, num } from '@/lib/format';
import { REPORT_STATUS, type Figures, type Report, type ReportTemplate } from './types';

function FigureGrid({ f }: { f: Figures }) {
  const groups: { title: string; items: [string, string][] }[] = [];
  if (f.membership) groups.push({ title: 'Membership', items: [['Active members', num(f.membership.active_members)], ['New members', num(f.membership.new_members)], ['Baptisms', num(f.membership.baptisms)]] });
  if (f.attendance) groups.push({ title: 'Attendance', items: [['Average Sunday', num(f.attendance.average_sunday)], ['Sundays recorded', num(f.attendance.sundays_recorded)], ['First-time guests', num(f.attendance.first_timers)], ['New converts', num(f.attendance.new_converts)]] });
  if (f.finance) groups.push({ title: 'Finance (approved)', items: [['Income', money(f.finance.income)], ['Expenditure', money(f.finance.expenditure)], ['Surplus / deficit', money(f.finance.net)]] });
  if (f.programs) groups.push({ title: 'Programs', items: [['Programs held', num(f.programs.held)], ['Decisions for Christ', num(f.programs.salvations)], ['Baptisms at programs', num(f.programs.baptisms)]] });
  if (f.sub_units) groups.push({ title: 'Units below', items: [['Expected to report', num(f.sub_units.expected)], ['Reported', num(f.sub_units.reported)]] });
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => (
        <div key={g.title} className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-800">
          <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800">{g.title}</p>
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            {g.items.map(([l, v]) => <div key={l} className="flex justify-between px-4 py-1.5 text-sm"><dt className="text-slate-600 dark:text-slate-400">{l}</dt><dd className="font-medium tabular-nums">{v}</dd></div>)}
          </dl>
        </div>
      ))}
    </div>
  );
}

export default function ReportDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reports', 'detail', id], queryFn: () => api<Report>(`/reports/${id}/`) });
  const templates = useQuery({ queryKey: ['reports', 'templates'], queryFn: () => api<ReportTemplate[]>('/report-templates/'), staleTime: 10 * 60 * 1000 });
  const r = q.data;
  const editable = !!r && ['draft', 'returned'].includes(r.status) && can('reports.edit');
  const live = useQuery({ queryKey: ['reports', 'figures', id], enabled: !!r && ['draft', 'returned'].includes(r.status), queryFn: () => api<{ live: boolean; figures: Figures }>(`/reports/${id}/figures/`) });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [reviewing, setReviewing] = useState<'accept' | 'return' | null>(null);
  const [comment, setComment] = useState('');
  useEffect(() => { if (r && !dirty) setAnswers(r.answers || {}); }, [r, dirty]);
  if (q.isLoading || !r) return <PageLoader />;
  const template = templates.data?.find((t) => t.id === r.template);
  const questions = template?.questions || Object.keys(r.answers).map((k) => ({ key: k, label: k }));
  const refresh = () => { qc.invalidateQueries({ queryKey: ['reports'] }); setDirty(false); };
  const save = async () => {
    setBusy('save'); setErr('');
    try {
      const res = await submitChange({ entity: 'reports', op: 'update', method: 'PATCH', url: `/reports/${r.id}/`, body: { answers }, recordId: r.id, baseVersion: r.version, label: `Report ${r.template_name} · ${r.org_unit_name} · ${r.period_label}` });
      if (res.state === 'queued') toast.offline('Saved on this device. It will upload when you are back online.'); else toast.success('Draft saved.');
      refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const submit = async () => {
    setBusy('submit'); setErr('');
    try {
      if (dirty) await api(`/reports/${r.id}/`, { method: 'PATCH', body: { answers }, ifMatch: r.version });
      await api(`/reports/${r.id}/submit/`, { method: 'POST' });
      toast.success('Report submitted for review.'); refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const review = async () => {
    setBusy('review'); setErr('');
    try {
      await api(`/reports/${r.id}/review/`, { method: 'POST', body: { accept: reviewing === 'accept', comment } });
      toast.success(reviewing === 'accept' ? 'Report accepted.' : 'Report returned for correction.'); setReviewing(null); refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const figures = r.status === 'submitted' || r.status === 'approved' ? r.figures : live.data?.figures;
  return (
    <div className="space-y-6">
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{r.template_name} <StatusBadge status={r.status} label={REPORT_STATUS[r.status]} /></span>}
        subtitle={`${r.org_unit_name} · ${r.period_label} · due ${date(r.due_date)}`}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Reports', to: '/reports' }, { label: `${r.org_unit_name} · ${r.period_label}` }]}
        actions={<div className="flex flex-wrap gap-2">
          {r.can_review && <><Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => { setComment(''); setReviewing('accept'); }}>Accept</Button><Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => { setComment(''); setReviewing('return'); }}>Return</Button></>}
          {editable && <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={busy === 'save'} disabled={!dirty} onClick={save}>Save draft</Button>}
          {editable && can('reports.submit') && <Button icon={<Send className="h-4 w-4" />} loading={busy === 'submit'} onClick={submit}>Submit</Button>}
          {can('reports.print') && <Button variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => download(`/reports/${r.id}/pdf/`, undefined, 'report.pdf').catch((e) => toast.error((e as Error).message))}>PDF</Button>}
        </div>} />
      <FormError message={err} />
      {r.review_comment && <p className="rounded-lg bg-slate-100 px-4 py-2 text-sm dark:bg-slate-800"><strong>{r.status === 'returned' ? 'Returned' : 'Reviewer'}:</strong> {r.review_comment}{r.reviewed_by_name ? ` (${r.reviewed_by_name}, ${dateTime(r.reviewed_at)})` : ''}</p>}
      <Card>
        <CardHeader title="Figures" subtitle={r.status === 'submitted' || r.status === 'approved' ? `Frozen when submitted on ${dateTime(r.submitted_at)}` : 'Calculated from the records for this period. They are frozen when you submit, so correct any records first.'} />
        <CardBody>{figures ? <FigureGrid f={figures} /> : <PageLoader />}</CardBody>
      </Card>
      <Card>
        <CardHeader title="Report" subtitle={editable ? 'Answer each question. Required ones are marked.' : undefined} />
        <CardBody className="space-y-5">
          {questions.map((qq) => (
            editable ? (
              <Field key={qq.key} label={qq.label} required={'required' in qq && !!qq.required}>
                <Textarea rows={4} value={answers[qq.key] || ''} onChange={(e) => { setAnswers({ ...answers, [qq.key]: e.target.value }); setDirty(true); }} />
              </Field>
            ) : (
              <div key={qq.key}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{qq.label}</p><p className="mt-1 whitespace-pre-line text-sm text-slate-800 dark:text-slate-200">{(r.answers[qq.key] || '').trim() || <span className="italic text-slate-400">No answer</span>}</p></div>
            )
          ))}
          {r.submitted_at && <p className="text-xs text-slate-500">Submitted by {r.submitted_by_name} on {dateTime(r.submitted_at)}.</p>}
        </CardBody>
      </Card>
      {reviewing && (
        <Modal open onClose={() => setReviewing(null)} title={reviewing === 'accept' ? 'Accept this report' : 'Return for correction'} subtitle={`${r.org_unit_name} · ${r.period_label}`}
          footer={<><Button variant="ghost" onClick={() => setReviewing(null)}>Back</Button><Button loading={busy === 'review'} disabled={reviewing === 'return' && !comment.trim()} onClick={review}>{reviewing === 'accept' ? 'Accept' : 'Return'}</Button></>}>
          <Field label={reviewing === 'accept' ? 'Comment (optional)' : 'What needs correcting'} required={reviewing === 'return'}><Textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}
