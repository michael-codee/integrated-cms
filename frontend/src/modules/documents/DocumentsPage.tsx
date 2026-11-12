import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, FilePlus2, FileText, Lock, Pencil, Upload } from 'lucide-react';
import { api, ApiError, download, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { useOnline } from '@/lib/useOnline';
import { Badge, Button, Checkbox, Card, DataTable, Field, FormError, FormGrid, Input, Modal, PageHeader, SearchInput, Select, Textarea, Toolbar, useToast, type Column } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { date, dateTime } from '@/lib/format';

interface Version { id: string; number: number; original_name: string; size: number; sha256: string; notes: string; uploaded_by: string | null; created_at: string }
interface Doc { id: string; title: string; category: string; category_name: string; org_unit: string; org_unit_name: string; description: string; reference_no: string; document_date: string | null; access: 'internal' | 'restricted'; expires_on: string | null; is_archived: boolean; created_by_name: string | null; created_at: string; updated_at: string; latest: Version | null; version_count: number }

const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp';

function DocumentForm({ doc, onClose }: { doc?: Doc | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const cats = useLookup('document-categories');
  const [f, setF] = useState({ title: doc?.title || '', category: doc?.category || '', org_unit: doc?.org_unit || '', description: doc?.description || '', reference_no: doc?.reference_no || '', document_date: doc?.document_date || '', access: doc?.access || 'internal', expires_on: doc?.expires_on || '', is_archived: doc?.is_archived || false });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = 'Give the document a title.';
    if (!f.category) e.category = 'Choose a category.';
    if (!doc && !f.org_unit) e.org_unit = 'Choose the unit it belongs to.';
    if (!doc && !file) e.file = 'Attach the file.';
    if (file && file.size > 10 * 1024 * 1024) e.file = 'The file is larger than 10 MB.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (doc) {
        await api(`/documents/${doc.id}/`, { method: 'PATCH', body: { ...f, org_unit: undefined, document_date: f.document_date || null, expires_on: f.expires_on || null } });
      } else {
        const fd = new FormData();
        Object.entries(f).forEach(([k, v]) => { if (v !== '' && k !== 'is_archived') fd.append(k, String(v)); });
        fd.append('file', file!);
        await api('/documents/', { method: 'POST', body: fd });
      }
      toast.success(doc ? 'Document updated.' : 'Document filed.');
      qc.invalidateQueries({ queryKey: ['documents'] }); onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={doc ? `Edit ${doc.title}` : 'File a document'} subtitle="Minutes, constitutions, title deeds, certificates, letters and other records"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{doc ? 'Save' : 'Upload'}</Button></>}>
      <FormError message={errors.form} />
      <FormGrid>
        <Field label="Title" required error={errors.title}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Category" required error={errors.category}><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} invalid={!!errors.category}><option value="">Choose category</option>{(cats.data || []).filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        {!doc && <Field label="Belongs to" required error={errors.org_unit}><UnitSelect value={f.org_unit} onChange={(v) => setF({ ...f, org_unit: v })} placeholder="Choose unit" invalid={!!errors.org_unit} /></Field>}
        <Field label="Access" hint={f.access === 'restricted' ? 'Only people who may edit documents of this unit can open it.' : 'Anyone with access to this unit\'s documents.'}>
          <Select value={f.access} onChange={(e) => setF({ ...f, access: e.target.value as Doc['access'] })}><option value="internal">Internal</option><option value="restricted">Restricted</option></Select>
        </Field>
        <Field label="Reference number"><Input value={f.reference_no} onChange={(e) => setF({ ...f, reference_no: e.target.value })} /></Field>
        <Field label="Document date"><Input type="date" value={f.document_date} onChange={(e) => setF({ ...f, document_date: e.target.value })} /></Field>
        <Field label="Expires on" hint="Leases, certificates, licences"><Input type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} /></Field>
        {!doc && <Field label="File" required error={errors.file} hint="PDF, Word, Excel, CSV, text or image up to 10 MB"><Input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>}
      </FormGrid>
      <Field label="Description" className="mt-4"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      {doc && <div className="mt-4"><Checkbox label="Archived (kept, but no new versions)" checked={f.is_archived} onChange={(e) => setF({ ...f, is_archived: e.target.checked })} /></div>}
    </Modal>
  );
}

function DocumentDetail({ doc, onClose, onEdit }: { doc: Doc; onClose: () => void; onEdit: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const versions = useQuery({ queryKey: ['documents', 'versions', doc.id], queryFn: () => api<Version[]>(`/documents/${doc.id}/versions/`) });
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const upload = async () => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('notes', notes);
      await api(`/documents/${doc.id}/upload-version/`, { method: 'POST', body: fd });
      toast.success('New version uploaded.'); setFile(null); setNotes('');
      qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const get = (n?: number) => download(`/documents/${doc.id}/download/`, n ? { version: n } : undefined, 'document').catch((e) => toast.error((e as Error).message));
  return (
    <Modal open onClose={onClose} size="lg" title={<span className="flex items-center gap-2">{doc.title}{doc.access === 'restricted' && <Badge tone="orange"><Lock className="h-3 w-3" />restricted</Badge>}{doc.is_archived && <Badge>archived</Badge>}</span>}
      subtitle={`${doc.category_name} · ${doc.org_unit_name}${doc.reference_no ? ` · Ref. ${doc.reference_no}` : ''}`}
      footer={<>{can('documents.edit') && <Button variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>Edit details</Button>}<Button icon={<Download className="h-4 w-4" />} onClick={() => get()}>Download latest</Button></>}>
      {doc.description && <p className="mb-4 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{doc.description}</p>}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Versions</p>
      <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-800">
        {(versions.data || []).map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <span className="flex h-7 w-9 items-center justify-center rounded bg-slate-100 text-xs font-semibold dark:bg-slate-800">v{v.number}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{v.original_name}</span><span className="block text-xs text-slate-500">{size(v.size)} · {v.uploaded_by} · {dateTime(v.created_at)}{v.notes ? ` · ${v.notes}` : ''}</span></span>
            <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => get(v.number)} aria-label={`Download version ${v.number}`}>Download</Button>
          </li>
        ))}
      </ul>
      {can('documents.edit') && !doc.is_archived && (
        <div className="mt-5 rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
          <p className="mb-2 text-sm font-medium">Upload a new version</p>
          <FormError message={err} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="File" className="min-w-[14rem] flex-1"><Input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
            <Field label="What changed" className="min-w-[12rem] flex-1"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. signed copy" /></Field>
            <Button icon={<Upload className="h-4 w-4" />} loading={busy} disabled={!file} onClick={upload}>Upload</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Earlier versions are kept and can still be downloaded.</p>
        </div>
      )}
    </Modal>
  );
}

export default function DocumentsPage() {
  const { can } = useAuth();
  const online = useOnline();
  const cats = useLookup('document-categories');
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Doc | null>(null);
  const [editing, setEditing] = useState<Doc | null>(null);
  const query = { search: search || undefined, org_unit: unit || undefined, category: category || undefined, is_archived: archived };
  const list = useQuery({ queryKey: ['documents', 'list', query, page], placeholderData: keepPreviousData, enabled: online, queryFn: () => api<Page<Doc>>('/documents/', { params: { ...query, page } }) });
  const cols: Column<Doc>[] = [
    { key: 't', header: 'Document', render: (d) => <div className="flex items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><div><p className="font-medium">{d.title} {d.access === 'restricted' && <Lock className="inline h-3 w-3 text-orange-600" aria-label="Restricted" />}</p><p className="text-xs text-slate-500">{d.latest?.original_name}{d.version_count > 1 ? ` · ${d.version_count} versions` : ''}</p></div></div> },
    { key: 'c', header: 'Category', hideOnMobile: true, render: (d) => d.category_name },
    { key: 'u', header: 'Unit', render: (d) => d.org_unit_name },
    { key: 'd', header: 'Dated', hideOnMobile: true, render: (d) => d.document_date ? date(d.document_date) : '—' },
    { key: 'e', header: 'Expires', hideOnMobile: true, render: (d) => d.expires_on ? <span className={new Date(d.expires_on) < new Date() ? 'text-red-700' : ''}>{date(d.expires_on)}</span> : '—' },
    { key: 'up', header: 'Updated', hideOnMobile: true, render: (d) => date(d.updated_at) },
  ];
  return (
    <div>
      <PageHeader title="Documents & records" subtitle="Stored privately, every version kept, every download recorded."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Documents' }]}
        actions={can('documents.create') && <Button icon={<FilePlus2 className="h-4 w-4" />} disabled={!online} onClick={() => setCreating(true)}>File a document</Button>} />
      {!online && <p className="mb-4 rounded-lg bg-gold-50 px-4 py-3 text-sm text-gold-900 dark:bg-gold-900/30 dark:text-gold-100">Documents are not stored on devices. Connect to the internet to browse and download them.</p>}
      <Card>
        <Toolbar>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Title, reference, file name…" className="sm:w-64" />
          <UnitSelect value={unit} onChange={(v) => { setUnit(v); setPage(1); }} className="sm:w-56" />
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="sm:w-48" aria-label="Category"><option value="">Any category</option>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Button variant={archived ? 'secondary' : 'ghost'} size="sm" icon={<Archive className="h-4 w-4" />} onClick={() => { setArchived(!archived); setPage(1); }}>{archived ? 'Showing archive' : 'Archive'}</Button>
        </Toolbar>
        <DataTable columns={cols} rows={list.data?.results} loading={list.isFetching} total={list.data?.count} page={page} onPage={setPage} onRowClick={setOpen}
          emptyTitle={archived ? 'Nothing archived' : 'No documents yet'} emptyMessage="Filed documents appear here." />
      </Card>
      {creating && <DocumentForm onClose={() => setCreating(false)} />}
      {open && !editing && <DocumentDetail doc={open} onClose={() => setOpen(null)} onEdit={() => setEditing(open)} />}
      {editing && <DocumentForm doc={editing} onClose={() => { setEditing(null); setOpen(null); }} />}
    </div>
  );
}
