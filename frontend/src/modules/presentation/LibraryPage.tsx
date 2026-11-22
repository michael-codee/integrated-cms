import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Music, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Field, FormError, FormGrid, Input, Modal, PageHeader, SearchInput, Select, Tabs, Textarea, Toolbar, useToast, type Column } from '@/components/ui';
import { songSlides } from './slides';
import { SlideView } from './SlideView';
import type { MediaImage, Song, SongSummary } from './types';

const LYRICS_HINT = `[Verse 1]
Amazing grace, how sweet the sound
That saved a wretch like me

[Chorus]
…`;

export function SongForm({ songId, onClose, onSaved }: { songId?: string | null; onClose: () => void; onSaved?: (s: Song) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const existing = useQuery({ queryKey: ['media', 'song', songId], queryFn: () => api<Song>(`/media/songs/${songId}/`), enabled: !!songId });
  const [f, setF] = useState<Partial<Song> | null>(songId ? null : { title: '', alternate_title: '', author: '', language: 'English', song_key: '', tags: '', copyright: '', lyrics: '' });
  const form = f ?? existing.data ?? null;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: keyof Song, v: string) => setF({ ...(form || {}), [k]: v });
  const preview = useMemo(() => (form?.lyrics ? songSlides({ title: form.title || '', author: form.author || '', copyright: '', lyrics: form.lyrics }) : []), [form?.lyrics, form?.title, form?.author]);

  const save = async () => {
    if (!form) return;
    const e: Record<string, string> = {};
    if (!form.title?.trim()) e.title = 'Give the song a title.';
    if (!form.lyrics?.trim()) e.lyrics = 'Type or paste the words.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const { id: _id, updated_at: _u, ...body } = form as Song;
      const saved = await api<Song>(songId ? `/media/songs/${songId}/` : '/media/songs/', { method: songId ? 'PATCH' : 'POST', body });
      toast.success(songId ? 'Song updated.' : 'Song added to the library.');
      qc.invalidateQueries({ queryKey: ['media'] });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/media/songs/${songId}/`, { method: 'DELETE' });
      toast.success('Song removed from the library.');
      qc.invalidateQueries({ queryKey: ['media'] });
      onClose();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); setConfirmDelete(false); }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={songId ? `Edit ${form?.title || 'song'}` : 'Add a song'}
      subtitle="A blank line starts a new slide. A line such as [Chorus] or [Verse 2] names the slides after it."
      footer={<>
        {songId && can('media.delete') && <Button variant="ghost" className="mr-auto text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>Remove</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={!form} onClick={save}>{songId ? 'Save changes' : 'Add song'}</Button>
      </>}>
      {!form ? <p className="py-10 text-center text-sm text-slate-500">Loading…</p> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_17rem]">
          <div>
            <FormError message={errors.form} />
            <FormGrid>
              <Field label="Title" required error={errors.title}><Input value={form.title || ''} onChange={(e) => set('title', e.target.value)} /></Field>
              <Field label="Also known as" hint="First line or another name"><Input value={form.alternate_title || ''} onChange={(e) => set('alternate_title', e.target.value)} /></Field>
              <Field label="Writer"><Input value={form.author || ''} onChange={(e) => set('author', e.target.value)} /></Field>
              <Field label="Language">
                <Input list="song-languages" value={form.language || ''} onChange={(e) => set('language', e.target.value)} />
                <datalist id="song-languages"><option value="English" /><option value="Krio" /><option value="Mende" /><option value="Temne" /><option value="Kono" /><option value="Limba" /></datalist>
              </Field>
              <Field label="Key"><Input value={form.song_key || ''} onChange={(e) => set('song_key', e.target.value)} placeholder="e.g. G" /></Field>
              <Field label="Tags" hint="Comma-separated"><Input value={form.tags || ''} onChange={(e) => set('tags', e.target.value)} placeholder="praise, worship, offering" /></Field>
            </FormGrid>
            <Field label="Copyright" className="mt-4"><Input value={form.copyright || ''} onChange={(e) => set('copyright', e.target.value)} placeholder="e.g. Public domain" /></Field>
            <Field label="Words" required error={errors.lyrics} className="mt-4">
              <Textarea rows={14} value={form.lyrics || ''} onChange={(e) => set('lyrics', e.target.value)} placeholder={LYRICS_HINT} className="font-mono text-[13px]" />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{preview.length} slide{preview.length === 1 ? '' : 's'}</p>
            <div className="space-y-2 lg:max-h-[60vh] lg:overflow-y-auto lg:pr-1">
              {preview.map((s, i) => (
                <div key={i}>
                  {s.label && <p className="mb-0.5 text-[11px] font-medium text-slate-500">{s.label}</p>}
                  <SlideView slide={s} theme={{ preset: 'royal' }} className="rounded-md ring-1 ring-slate-200 dark:ring-slate-700" />
                </div>
              ))}
              {!preview.length && <p className="text-sm text-slate-500">The slides appear here as you type.</p>}
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirmDelete} title="Remove this song?" message="It leaves the library for every branch. Service plans that use it will show it as missing." confirmLabel="Remove" tone="danger" loading={busy} onConfirm={remove} onClose={() => setConfirmDelete(false)} />
    </Modal>
  );
}

function SongsTab() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const list = useQuery({ queryKey: ['media', 'songs', search, page], queryFn: () => api<Page<SongSummary>>('/media/songs/', { params: { search: search || undefined, page } }), placeholderData: keepPreviousData });
  const cols: Column<SongSummary>[] = [
    { key: 'title', header: 'Song', render: (s) => <div><p className="font-medium">{s.title}</p><p className="truncate text-xs text-slate-500">{s.first_line}</p></div> },
    { key: 'author', header: 'Writer', hideOnMobile: true, render: (s) => s.author || '—' },
    { key: 'language', header: 'Language', hideOnMobile: true, render: (s) => s.language || '—' },
    { key: 'tags', header: 'Tags', hideOnMobile: true, render: (s) => <div className="flex flex-wrap gap-1">{s.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <Badge key={t}>{t}</Badge>)}</div> },
  ];
  return (
    <Card>
      <Toolbar>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Title, words, writer or tag" className="sm:w-72" />
        {can('media.create') && <Button className="sm:ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Add song</Button>}
      </Toolbar>
      <DataTable columns={cols} rows={list.data?.results} loading={list.isFetching} total={list.data?.count} page={page} onPage={setPage}
        onRowClick={(s) => setEditing(s.id)} emptyTitle="No songs yet" emptyMessage="Add the songs your choir sings. Every branch shares this library." />
      {editing !== undefined && <SongForm songId={editing} onClose={() => setEditing(undefined)} />}
    </Card>
  );
}

function PicturesTab() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState('');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<{ title: string; kind: string; file: File | null }>({ title: '', kind: 'background', file: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<MediaImage | null>(null);
  const list = useQuery({ queryKey: ['media', 'images', kind], queryFn: () => api<Page<MediaImage>>('/media/images/', { params: { kind: kind || undefined, page_size: 200 } }) });
  const upload = async () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = 'Name the picture.';
    if (!f.file) e.image = 'Choose a picture (PNG, JPG or WebP, up to 4 MB).';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('title', f.title.trim());
      body.append('kind', f.kind);
      body.append('image', f.file!);
      await api('/media/images/', { method: 'POST', body });
      toast.success('Picture added.');
      qc.invalidateQueries({ queryKey: ['media', 'images'] });
      setAdding(false);
      setF({ title: '', kind: 'background', file: null });
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? '' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/media/images/${removing.id}/`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['media', 'images'] });
      toast.success('Picture removed.');
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); setRemoving(null); }
  };
  const images = list.data?.results || [];
  return (
    <Card>
      <Toolbar>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="sm:w-52" aria-label="Kind"><option value="">All pictures</option><option value="background">Backgrounds</option><option value="slide">Picture slides</option></Select>
        {can('media.create') && <Button className="sm:ml-auto" icon={<ImagePlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add picture</Button>}
      </Toolbar>
      <div className="p-4">
        {!images.length && !list.isFetching && <EmptyState title="No pictures yet" message="Add backgrounds for songs and scripture, or pictures to show as slides (flyers, programme covers)." />}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img) => (
            <figure key={img.id} className="group relative overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
              <img src={img.image} alt={img.title} className="aspect-video w-full bg-slate-900 object-cover" loading="lazy" />
              <figcaption className="flex items-center justify-between gap-2 px-2.5 py-2 text-sm">
                <span className="truncate font-medium">{img.title}</span>
                <Badge tone={img.kind === 'background' ? 'blue' : 'purple'}>{img.kind === 'background' ? 'Background' : 'Slide'}</Badge>
              </figcaption>
              {can('media.delete') && (
                <button onClick={() => setRemoving(img)} className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${img.title}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </figure>
          ))}
        </div>
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a picture"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={busy} onClick={upload}>Upload</Button></>}>
        <FormError message={errors.form} />
        <FormGrid>
          <Field label="Name" required error={errors.title}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Blue sky" /></Field>
          <Field label="Use as"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="background">Background behind words</option><option value="slide">Picture slide on its own</option></Select></Field>
        </FormGrid>
        <Field label="Picture" required error={errors.image} hint="PNG, JPG or WebP, up to 4 MB. Wide pictures (16:9) fit the screen best." className="mt-4">
          <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setF({ ...f, file: e.target.files?.[0] || null, title: f.title || (e.target.files?.[0]?.name.replace(/\.[^.]+$/, '') ?? '') })} />
        </Field>
      </Modal>
      <ConfirmDialog open={!!removing} title="Remove this picture?" message="Service plans that use it will show it as missing." confirmLabel="Remove" tone="danger" loading={busy} onConfirm={remove} onClose={() => setRemoving(null)} />
    </Card>
  );
}

export default function LibraryPage() {
  const [tab, setTab] = useState<'songs' | 'pictures'>('songs');
  return (
    <div>
      <PageHeader title="Song & picture library" subtitle="Songs and pictures shared by every branch, ready for the screens."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Media presentation', to: '/presentation' }, { label: 'Library' }]} />
      <Tabs tabs={[{ value: 'songs', label: <span className="inline-flex items-center gap-1.5"><Music className="h-4 w-4" />Songs</span> }, { value: 'pictures', label: <span className="inline-flex items-center gap-1.5"><ImagePlus className="h-4 w-4" />Pictures</span> }]} value={tab} onChange={setTab} />
      {tab === 'songs' ? <SongsTab /> : <PicturesTab />}
    </div>
  );
}
