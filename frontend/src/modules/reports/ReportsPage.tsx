import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, FilePlus2, Settings2 } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, Field, FormError, Input, Modal, PageHeader, PageLoader, Select, StatCard, StatusBadge, Tabs, Textarea, Toolbar, useToast, type Column } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { UnitSelect } from '@/components/UnitSelect';
import { date, dateTime } from '@/lib/format';
import { REPORT_STATUS, type Compliance, type ComplianceRow, type DueReport, type Question, type Report, type ReportTemplate } from './types';

type Tab = 'mine' | 'review' | 'all' | 'compliance' | 'templates';

function useTemplates() {
  return useQuery({ queryKey: ['reports', 'templates'], queryFn: () => api<ReportTemplate[]>('/report-templates/'), staleTime: 10 * 60 * 1000 });
}

function DueList() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const due = useQuery({ queryKey: ['reports', 'due'], queryFn: () => api<DueReport[]>('/reports/due/') });
  const [busy, setBusy] = useState<string | null>(null);
  const start = async (d: DueReport) => {
    if (d.submission) { navigate(`/reports/${d.submission}`); return; }
    setBusy(d.template + d.org_unit);
    try {
      const r = await api<Report>('/reports/', { method: 'POST', body: { template: d.template, org_unit: d.org_unit, period_start: d.period_start, answers: {} } });
      qc.invalidateQueries({ queryKey: ['reports'] });
      navigate(`/reports/${r.id}`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  if (due.isLoading) return <PageLoader />;
  if (!due.data?.length) return <Card><EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No reports outstanding" message="Every report your unit owes for the last period has been submitted." /></Card>;
  return (
    <Card>
      <CardHeader title="Reports your unit owes" subtitle="For the most recent period that has ended" />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {due.data.map((d) => (
          <li key={d.template + d.org_unit} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className={clsx('flex h-8 w-8 items-center justify-center rounded-full', d.overdue ? 'bg-red-50 text-red-600 dark:bg-red-950/40' : 'bg-gold-50 text-gold-700 dark:bg-gold-900/30')}>{d.overdue ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}</span>
            <span className="min-w-0 flex-1"><span className="block font-medium">{d.template_name} · {d.period_label}</span><span className="block text-xs text-slate-500">{d.org_unit_name} · due {date(d.due)}{d.overdue ? ' (overdue)' : ''}</span></span>
            {d.status !== 'missing' && <StatusBadge status={d.status} label={REPORT_STATUS[d.status]} />}
            <Button size="sm" loading={busy === d.template + d.org_unit} onClick={() => start(d)}>{d.submission ? 'Continue' : 'Start report'}</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReportList({ awaiting = false }: { awaiting?: boolean }) {
  const navigate = useNavigate();
  const templates = useTemplates();
  const [unit, setUnit] = useState('');
  const [template, setTemplate] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = { org_unit: unit || undefined, template: template || undefined, status: status || undefined, ordering: '-period_start' };
  const list = useQuery({ queryKey: ['reports', 'list', query, page], enabled: !awaiting, placeholderData: keepPreviousData, queryFn: () => api<Page<Report>>('/reports/', { params: { ...query, page } }) });
  const waiting = useQuery({ queryKey: ['reports', 'awaiting'], enabled: awaiting, queryFn: () => api<Report[]>('/reports/awaiting/') });
  const cols: Column<Report>[] = [
    { key: 'r', header: 'Report', render: (r) => <div><p className="font-medium">{r.template_name}</p><p className="text-xs text-slate-500">{r.period_label}</p></div> },
    { key: 'u', header: 'Unit', render: (r) => r.org_unit_name },
    { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} label={REPORT_STATUS[r.status]} /> },
    { key: 'by', header: 'Submitted', hideOnMobile: true, render: (r) => r.submitted_at ? <span className="text-sm">{dateTime(r.submitted_at)}<span className="block text-xs text-slate-500">{r.submitted_by_name}</span></span> : '—' },
    { key: 'rev', header: 'Reviewed', hideOnMobile: true, render: (r) => r.reviewed_at ? <span className="text-sm">{r.reviewed_by_name}<span className="block text-xs text-slate-500">{date(r.reviewed_at)}</span></span> : '—' },
  ];
  if (awaiting) return <Card><DataTable columns={cols} rows={waiting.data} loading={waiting.isLoading} onRowClick={(r) => navigate(`/reports/${r.id}`)} emptyTitle="Nothing to review" emptyMessage="Reports submitted by the units under you appear here." /></Card>;
  return (
    <Card>
      <Toolbar>
        <UnitSelect value={unit} onChange={(v) => { setUnit(v); setPage(1); }} className="sm:w-56" />
        <Select value={template} onChange={(e) => { setTemplate(e.target.value); setPage(1); }} className="sm:w-56" aria-label="Report"><option value="">Every report</option>{(templates.data || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-44" aria-label="Status"><option value="">Any status</option>{['draft', 'submitted', 'approved', 'returned'].map((s) => <option key={s} value={s}>{REPORT_STATUS[s]}</option>)}</Select>
        <div className="sm:ml-auto"><ExportMenu path="/reports/export/" params={query} module="reports" name="report-submissions" /></div>
      </Toolbar>
      <DataTable columns={cols} rows={list.data?.results} loading={list.isFetching} total={list.data?.count} page={page} onPage={setPage} onRowClick={(r) => navigate(`/reports/${r.id}`)} emptyTitle="No reports yet" />
    </Card>
  );
}

function ComplianceView() {
  const navigate = useNavigate();
  const templates = useTemplates();
  const [template, setTemplate] = useState('');
  const [period, setPeriod] = useState('');
  const tid = template || (templates.data?.find((t) => t.is_active && t.frequency === 'monthly') || templates.data?.find((t) => t.is_active))?.id || '';
  const q = useQuery({ queryKey: ['reports', 'compliance', tid, period], enabled: !!tid, placeholderData: keepPreviousData, queryFn: () => api<Compliance>('/reports/compliance/', { params: { template: tid, period_start: period || undefined } }) });
  const d = q.data;
  const cols: Column<ComplianceRow & { id: string }>[] = [
    { key: 'u', header: 'Unit', render: (r) => <div><p className="font-medium">{r.org_unit_name}</p><p className="text-xs text-slate-500">{r.parent_name}</p></div> },
    { key: 's', header: 'Status', render: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status === 'missing' ? (r.overdue ? 'overdue' : 'pending') : r.status} label={REPORT_STATUS[r.status]} />{r.overdue && r.status !== 'missing' && <Badge tone="red">overdue</Badge>}{r.submitted_late && <Badge tone="orange">late</Badge>}</span> },
    { key: 'at', header: 'Submitted', render: (r) => r.submitted_at ? dateTime(r.submitted_at) : '—' },
  ];
  return (
    <div className="space-y-4">
      <Card>
        <Toolbar>
          <Select value={tid} onChange={(e) => { setTemplate(e.target.value); setPeriod(''); }} className="sm:w-64" aria-label="Report">{(templates.data || []).filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          <Select value={period || d?.period.start || ''} onChange={(e) => setPeriod(e.target.value)} className="sm:w-48" aria-label="Period">{(d?.periods || []).map((p) => <option key={p.start} value={p.start}>{p.label}</option>)}</Select>
          {d && <span className="text-xs text-slate-500">Due {date(d.period.due)}</span>}
          <div className="sm:ml-auto"><ExportMenu path="/reports/compliance/" params={{ template: tid, period_start: period || undefined }} module="reports" name="reporting-compliance" /></div>
        </Toolbar>
      </Card>
      {!d ? <PageLoader /> : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Units expected" value={d.expected.toLocaleString()} icon={<ClipboardList className="h-5 w-5" />} tone="slate" />
            <StatCard label="Submitted" value={d.rate == null ? '—' : `${d.rate}%`} hint={`${(d.counts.submitted || 0) + (d.counts.approved || 0)} of ${d.expected}`} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
            <StatCard label="On time" value={d.on_time_rate == null ? '—' : `${d.on_time_rate}%`} icon={<Clock className="h-5 w-5" />} tone="gold" />
            <StatCard label="Overdue" value={d.rows.filter((r) => r.overdue).length.toLocaleString()} icon={<AlertTriangle className="h-5 w-5" />} tone={d.rows.some((r) => r.overdue) ? 'red' : 'slate'} />
          </div>
          {d.expected > 0 && (
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${d.counts.approved || 0} accepted, ${d.counts.submitted || 0} submitted, ${(d.counts.draft || 0) + (d.counts.returned || 0)} in progress, ${d.counts.missing || 0} not started`}>
              {[['approved', 'bg-emerald-500'], ['submitted', 'bg-royal-500'], ['draft', 'bg-gold-400'], ['returned', 'bg-orange-500']].map(([k, cls]) => (d.counts[k] ? <div key={k} className={clsx(cls, 'border-r-2 border-white last:border-0 dark:border-slate-900')} style={{ width: `${(d.counts[k] / d.expected) * 100}%` }} title={`${REPORT_STATUS[k]}: ${d.counts[k]}`} /> : null))}
            </div>
          )}
          <Card><DataTable columns={cols} rows={d.rows.map((x) => ({ ...x, id: x.org_unit }))} onRowClick={(r) => r.submission && navigate(`/reports/${r.submission}`)} emptyTitle="No units in your jurisdiction submit this report" /></Card>
        </>
      )}
    </div>
  );
}

function TemplateEditor({ t, onClose }: { t: ReportTemplate; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: t.name, description: t.description, due_days: String(t.due_days), is_active: t.is_active });
  const [qs, setQs] = useState<Question[]>(t.questions);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const questions = qs.filter((q) => q.label.trim()).map((q, i) => ({ ...q, key: q.key || `q${i + 1}-${Date.now() % 1000}` }));
      await api(`/report-templates/${t.id}/`, { method: 'PATCH', body: { ...f, due_days: Number(f.due_days), questions } });
      toast.success('Template saved.'); qc.invalidateQueries({ queryKey: ['reports'] }); onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Edit ${t.name}`} subtitle={`${t.frequency} · completed by ${t.unit_types.join(', ')}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <FormError message={err} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Due (days after period ends)"><Input type="number" min="0" max="120" value={f.due_days} onChange={(e) => setF({ ...f, due_days: e.target.value })} /></Field>
      </div>
      <Field label="Description" className="mt-4"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <p className="mb-2 mt-5 text-xs font-medium text-slate-600 dark:text-slate-300">Questions</p>
      <ul className="space-y-2">
        {qs.map((q, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <Input value={q.label} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="flex-1" aria-label={`Question ${i + 1}`} />
            <Checkbox label="Required" checked={!!q.required} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
            <Button size="sm" variant="ghost" onClick={() => setQs(qs.filter((_, j) => j !== i))}>Remove</Button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => setQs([...qs, { key: '', label: '' }])}>Add question</Button>
      <div className="mt-4"><Checkbox label="In use" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /></div>
    </Modal>
  );
}

function Templates() {
  const templates = useTemplates();
  const [editing, setEditing] = useState<ReportTemplate | null>(null);
  return (
    <Card>
      <CardHeader title="Report templates" subtitle="Who reports, how often, when it is due and which questions are asked." icon={<Settings2 className="h-4 w-4" />} />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {(templates.data || []).map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1"><span className="block font-medium">{t.name} {!t.is_active && <Badge>not in use</Badge>}</span><span className="block text-xs text-slate-500">{t.frequency} · {t.unit_types.join(', ')} · due {t.due_days} days after the period · {t.questions.length} questions</span></span>
            <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button>
          </li>
        ))}
      </ul>
      {editing && <TemplateEditor t={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

export default function ReportsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const canCreate = can('reports.create');
  const canReview = can('reports.approve');
  const tabs: { value: Tab; label: string }[] = [
    ...(canCreate ? [{ value: 'mine' as Tab, label: 'Due from my unit' }] : []),
    ...(canReview ? [{ value: 'review' as Tab, label: 'To review' }] : []),
    { value: 'all', label: 'All reports' },
    { value: 'compliance', label: 'Compliance' },
    ...(can('settings.edit') ? [{ value: 'templates' as Tab, label: 'Templates' }] : []),
  ];
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && tabs.some((t) => t.value === requested) ? requested : tabs[0].value;
  return (
    <div>
      <PageHeader title="Reports & accountability" subtitle="Periodic reports from every branch, district and region, reviewed by the level above."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Reports' }]}
        actions={canCreate && tab !== 'mine' && <Button variant="secondary" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setParams({ tab: 'mine' })}>Reports due</Button>} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} />
      {tab === 'mine' && <DueList />}
      {tab === 'review' && <ReportList awaiting />}
      {tab === 'all' && <ReportList />}
      {tab === 'compliance' && <ComplianceView />}
      {tab === 'templates' && <Templates />}
    </div>
  );
}
