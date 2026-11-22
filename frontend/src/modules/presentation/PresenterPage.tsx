import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowDown, ArrowUp, BookOpen, ChevronLeft, ChevronRight, Image as ImageIcon, Library, MonitorPlay, MonitorX, Music, Plus, Save, Square, Sun, Type, X,
} from 'lucide-react';
import { api, ApiError, type Page } from '@/lib/api';
import { useLookup } from '@/lib/queries';
import { useAuth } from '@/app/AuthContext';
import { Button, Field, FormError, FormGrid, Input, Modal, PageHeader, SearchInput, Select, Textarea, useToast } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { loadBible, lookup, type Bible } from './bible';
import { withLocalCopy } from './cache';
import { openChannel, openOutputWindow, type LiveState, type ScreenMode } from './channel';
import { slidesFor, itemTitle, type SlideContext } from './slides';
import { SlideView } from './SlideView';
import { PRESETS } from './themes';
import { SongForm } from './LibraryPage';
import type { MediaImage, PlanItem, ServicePlan, Slide, Song, SongSummary, Theme } from './types';

const SERVICE_TITLES = ['Sunday Divine Service', 'Tuesday Bible Studies', 'Friday Prayer and Deliverance Service'];
const DEFAULT_THEME: Theme = { preset: 'royal', font_scale: 1, align: 'center', show_reference: true, uppercase: false };
const LAST_PLAN = 'rlwm-presentation-last-plan';

type Selection = { source: 'plan'; index: number } | { source: 'quick'; item: PlanItem };
interface Live { item: PlanItem; planIndex: number | null; slide: number }

const newKey = () => Math.random().toString(36).slice(2, 10);
const ITEM_ICONS: Record<PlanItem['kind'], typeof Music> = { song: Music, scripture: BookOpen, text: Type, image: ImageIcon, blank: Square };

function readLastPlan() {
  try { return localStorage.getItem(LAST_PLAN) || ''; } catch { return ''; }
}

export default function PresenterPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const planId = params.get('plan') || readLastPlan();
  const canEdit = can('media.edit');

  // ---------------------------------------------------------------- data
  const plans = useQuery({
    queryKey: ['media', 'plans'],
    queryFn: () => withLocalCopy('plans', () => api<Page<ServicePlan>>('/media/plans/', { params: { page_size: 60 } })),
  });
  const plan = useQuery({
    queryKey: ['media', 'plan', planId],
    queryFn: () => withLocalCopy(`plan:${planId}`, () => api<ServicePlan>(`/media/plans/${planId}/`)),
    enabled: !!planId,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const images = useQuery({
    queryKey: ['media', 'images', 'all'],
    queryFn: () => withLocalCopy('images', () => api<Page<MediaImage>>('/media/images/', { params: { page_size: 200 } })),
    staleTime: 5 * 60 * 1000,
  });
  const [bible, setBible] = useState<Bible>();
  const [bibleError, setBibleError] = useState('');
  useEffect(() => { loadBible().then(setBible, (e: Error) => setBibleError(e.message)); }, []);

  // The plan being edited: a local draft, saved with the Save button.
  const [items, setItems] = useState<PlanItem[]>([]);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (plan.data) {
      setItems(plan.data.items || []);
      setTheme({ ...DEFAULT_THEME, ...(plan.data.theme || {}) });
      setDirty(false);
      try { localStorage.setItem(LAST_PLAN, plan.data.id); } catch { /* ignore */ }
    }
  }, [plan.data]);
  useEffect(() => {
    if (plan.error instanceof ApiError && plan.error.status === 404) {
      try { localStorage.removeItem(LAST_PLAN); } catch { /* ignore */ }
    }
  }, [plan.error]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const [selection, setSelection] = useState<Selection | null>(null);
  const selectedItem = selection?.source === 'plan' ? items[selection.index] : selection?.item;

  const songIds = useMemo(() => {
    const ids = new Set<string>();
    for (const it of items) if (it.kind === 'song') ids.add(it.song);
    if (selectedItem?.kind === 'song') ids.add(selectedItem.song);
    return [...ids];
  }, [items, selectedItem]);
  const songQueries = useQueries({
    queries: songIds.map((id) => ({
      queryKey: ['media', 'song', id],
      queryFn: () => withLocalCopy(`song:${id}`, () => api<Song>(`/media/songs/${id}/`)),
      staleTime: 10 * 60 * 1000,
    })),
  });
  const songMap = useMemo(() => {
    const m: Record<string, Song | undefined> = {};
    songQueries.forEach((q, i) => { if (q.data) m[songIds[i]] = q.data; });
    return m;
  }, [songQueries, songIds]);
  const imageMap = useMemo(() => Object.fromEntries((images.data?.results || []).map((i) => [i.id, i])), [images.data]);
  const ctx: SlideContext = useMemo(() => ({ bible, songs: songMap, images: imageMap }), [bible, songMap, imageMap]);
  const missingSongs = useMemo(() => new Set(songIds.filter((_id, i) => songQueries[i]?.error)), [songIds, songQueries]);

  const slidesOf = useCallback((item: PlanItem) => {
    if (item.kind === 'song' && missingSongs.has(item.song)) return { slides: [] as Slide[], error: 'This song is no longer in the library.' };
    return slidesFor(item, ctx);
  }, [ctx, missingSongs]);

  // ---------------------------------------------------------------- live output
  const [live, setLive] = useState<Live | null>(null);
  const [mode, setMode] = useState<ScreenMode>('show');
  const [outputSeen, setOutputSeen] = useState(0);
  const [, tick] = useState(0);
  const liveSlides = useMemo(() => (live ? slidesOf(live.item).slides : []), [live, slidesOf]);
  const liveSlide = live ? liveSlides[live.slide] || null : null;

  const channel = useRef<ReturnType<typeof openChannel>>();
  const seq = useRef(0);
  const lastState = useRef<LiveState | null>(null);
  const blobs = useRef(new Map<string, Promise<Blob | null>>());
  const blobFor = useCallback((imageId?: string | null) => {
    if (!imageId) return Promise.resolve(null);
    const url = imageMap[imageId]?.image;
    if (!url) return Promise.resolve(null);
    let p = blobs.current.get(imageId);
    if (!p) {
      p = fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
      p.then((b) => { if (!b) blobs.current.delete(imageId); });
      blobs.current.set(imageId, p);
    }
    return p;
  }, [imageMap]);

  useEffect(() => {
    const ch = openChannel((m) => {
      if (m.type === 'hello' || m.type === 'ping') setOutputSeen(Date.now());
      if (m.type === 'hello' && lastState.current) ch.post({ type: 'state', state: lastState.current });
    });
    channel.current = ch;
    const t = window.setInterval(() => tick((n) => n + 1), 2500);
    return () => { window.clearInterval(t); ch.close(); };
  }, []);
  const outputConnected = Date.now() - outputSeen < 5000;

  useEffect(() => {
    let cancelled = false;
    const s = ++seq.current;
    Promise.all([blobFor(liveSlide?.kind === 'image' ? liveSlide.image : null), blobFor(theme.background_image)]).then(([slideImage, background]) => {
      if (cancelled || s !== seq.current) return;
      const state: LiveState = { slide: liveSlide, theme, mode, slideImage, background, seq: s };
      lastState.current = state;
      channel.current?.post({ type: 'state', state });
    });
    return () => { cancelled = true; };
  }, [liveSlide, theme, mode, blobFor]);

  const goLive = useCallback((item: PlanItem, planIndex: number | null, slide: number) => {
    setLive({ item, planIndex, slide });
    if (mode !== 'show' && mode !== 'black') setMode('show');
  }, [mode]);

  const step = useCallback((dir: 1 | -1) => {
    if (!live) {
      const first = items.findIndex((it) => slidesOf(it).slides.length);
      if (dir === 1 && first >= 0) { setSelection({ source: 'plan', index: first }); goLive(items[first], first, 0); }
      return;
    }
    const next = live.slide + dir;
    if (next >= 0 && next < liveSlides.length) { setLive({ ...live, slide: next }); return; }
    if (live.planIndex === null) return;
    // move into the next (or previous) item of the order of service that has something to show
    for (let i = live.planIndex + dir; i >= 0 && i < items.length; i += dir) {
      const n = slidesOf(items[i]).slides.length;
      if (n) {
        setSelection({ source: 'plan', index: i });
        goLive(items[i], i, dir === 1 ? 0 : n - 1);
        return;
      }
    }
  }, [live, liveSlides.length, items, slidesOf, goLive]);

  const toggle = (m: ScreenMode) => setMode((cur) => (cur === m ? 'show' : m));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable=true],[role=dialog]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') { e.preventDefault(); step(1); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); step(-1); }
      else if (k === 'b' || k === 'B' || k === '.') toggle('black');
      else if (k === 'c' || k === 'C') toggle('clear');
      else if (k === 'l' || k === 'L') toggle('logo');
      else if (k === 'Escape') setMode('show');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  // ---------------------------------------------------------------- plan editing
  const update = (next: PlanItem[]) => { setItems(next); setDirty(true); };
  const addItem = (item: PlanItem) => {
    const at = selection?.source === 'plan' ? selection.index + 1 : items.length;
    update([...items.slice(0, at), item, ...items.slice(at)]);
    setSelection({ source: 'plan', index: at });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
    if (selection?.source === 'plan' && selection.index === i) setSelection({ source: 'plan', index: j });
    if (live?.planIndex === i) setLive({ ...live, planIndex: j });
    else if (live?.planIndex === j) setLive({ ...live, planIndex: i });
  };
  const removeAt = (i: number) => {
    update(items.filter((_, k) => k !== i));
    if (selection?.source === 'plan') setSelection(selection.index === i ? null : { source: 'plan', index: selection.index > i ? selection.index - 1 : selection.index });
    if (live?.planIndex != null) setLive(live.planIndex === i ? { ...live, planIndex: null } : { ...live, planIndex: live.planIndex > i ? live.planIndex - 1 : live.planIndex });
  };
  const setThemeValue = (patch: Partial<Theme>) => { setTheme((t) => ({ ...t, ...patch })); if (plan.data) setDirty(true); };

  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!plan.data) return;
    setSaving(true);
    try {
      const saved = await api<ServicePlan>(`/media/plans/${plan.data.id}/`, { method: 'PATCH', body: { items, theme } });
      qc.setQueryData(['media', 'plan', saved.id], saved);
      qc.invalidateQueries({ queryKey: ['media', 'plans'] });
      setDirty(false);
      toast.success('Order of service saved.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  };
  const choosePlan = (id: string) => {
    if (dirty && !window.confirm('This order of service has changes that are not saved. Leave them?')) return;
    setSelection(null);
    setParams(id ? { plan: id } : {});
    if (!id) { setItems([]); setTheme(DEFAULT_THEME); setDirty(false); try { localStorage.removeItem(LAST_PLAN); } catch { /* ignore */ } }
  };

  // ---------------------------------------------------------------- dialogs
  const [dialog, setDialog] = useState<null | 'plan' | 'song' | 'song-edit' | 'scripture' | 'text' | 'picture'>(null);
  const [quickRef, setQuickRef] = useState('');
  const [quickError, setQuickError] = useState('');
  const showQuickScripture = () => {
    if (!bible) return;
    try {
      const p = lookup(bible, quickRef);
      const item: PlanItem = { kind: 'scripture', key: newKey(), ref: p.reference };
      setSelection({ source: 'quick', item });
      goLive(item, null, 0);
      setQuickError('');
    } catch (e) { setQuickError((e as Error).message); }
  };

  const selected = selectedItem ? slidesOf(selectedItem) : null;
  const selectedPlanIndex = selection?.source === 'plan' ? selection.index : null;
  const isLiveItem = (planIndex: number | null, item?: PlanItem) => !!live && (planIndex !== null ? live.planIndex === planIndex : live.item === item);

  return (
    <div>
      <PageHeader title="Media presentation" subtitle="Run the screens: songs, scripture and slides on the projector."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Media presentation' }]}
        actions={<>
          <Link to="/presentation/library"><Button variant="secondary" icon={<Library className="h-4 w-4" />}>Library</Button></Link>
          <Button variant={outputConnected ? 'secondary' : 'gold'} icon={<MonitorPlay className="h-4 w-4" />} onClick={() => openOutputWindow()}>
            {outputConnected ? 'Projector open' : 'Open projector window'}
          </Button>
        </>} />

      <div className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)_22rem] lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* ---------------------------------------------------- order of service */}
        <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="space-y-2 border-b border-slate-100 p-3 dark:border-slate-800">
            <div className="flex gap-2">
              <Select value={plan.data?.id || ''} onChange={(e) => choosePlan(e.target.value)} aria-label="Order of service" className="min-w-0 flex-1">
                <option value="">No order of service</option>
                {(plans.data?.results || []).map((p) => <option key={p.id} value={p.id}>{p.service_date} · {p.title}</option>)}
              </Select>
              {can('media.create') && <Button variant="secondary" size="md" aria-label="New order of service" title="New order of service" onClick={() => setDialog('plan')}><Plus className="h-4 w-4" /></Button>}
            </div>
            {plan.data && <p className="truncate text-xs text-slate-500">{plan.data.org_unit_name}{plan.data.service_type_name ? ` · ${plan.data.service_type_name}` : ''}</p>}
            {dirty && canEdit && <Button size="sm" className="w-full" loading={saving} icon={<Save className="h-4 w-4" />} onClick={save}>Save changes</Button>}
          </div>
          <ol className="max-h-[52vh] overflow-y-auto p-2 lg:max-h-[60vh]">
            {!plan.data && !items.length && (
              <li className="px-2 py-6 text-center text-sm text-slate-500">
                {plan.isLoading ? 'Loading…' : 'Choose or create an order of service, or show scripture and songs straight away from the panels.'}
              </li>
            )}
            {plan.data && !items.length && <li className="px-2 py-6 text-center text-sm text-slate-500">Nothing here yet. Add songs, scripture and slides below.</li>}
            {items.map((it, i) => {
              const Icon = ITEM_ICONS[it.kind];
              const on = selectedPlanIndex === i;
              const isLive = isLiveItem(i);
              const info = slidesOf(it);
              return (
                <li key={it.key + i} className="group">
                  <div className={clsx('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm', on ? 'bg-royal-50 text-royal-900 ring-1 ring-royal-200 dark:bg-royal-900/40 dark:text-white dark:ring-royal-700' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
                    <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelection({ source: 'plan', index: i })}>
                      <Icon className={clsx('h-4 w-4 shrink-0', isLive ? 'text-red-500' : 'text-slate-400')} />
                      <span className="min-w-0 flex-1 truncate">{itemTitle(it, ctx)}</span>
                      {info.error && <span className="text-xs text-red-500" title={info.error}>!</span>}
                      {isLive && <span className="rounded bg-red-500 px-1 text-[10px] font-bold uppercase text-white">Live</span>}
                    </button>
                    {canEdit && (
                      <span className="flex shrink-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        <IconBtn label="Move up" onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn label="Move down" onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn label="Remove" onClick={() => removeAt(i)}><X className="h-3.5 w-3.5" /></IconBtn>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {plan.data && canEdit && (
            <div className="grid grid-cols-5 gap-1 border-t border-slate-100 p-2 dark:border-slate-800">
              <AddBtn icon={Music} label="Song" onClick={() => setDialog('song')} />
              <AddBtn icon={BookOpen} label="Scripture" onClick={() => setDialog('scripture')} />
              <AddBtn icon={Type} label="Text" onClick={() => setDialog('text')} />
              <AddBtn icon={ImageIcon} label="Picture" onClick={() => setDialog('picture')} />
              <AddBtn icon={Square} label="Blank" onClick={() => addItem({ kind: 'blank', key: newKey() })} />
            </div>
          )}
        </section>

        {/* ---------------------------------------------------- slides of the selected item */}
        <section className="min-h-[20rem] rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          {!selectedItem ? (
            <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
              <MonitorPlay className="h-8 w-8 text-slate-300" />
              <p>Pick an item on the left to see its slides. Click a slide to put it on the screen.</p>
              <p className="text-xs">Keys: → or Space next · ← back · B black · C clear words · L logo · Esc show again</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="truncate font-semibold">{itemTitle(selectedItem, ctx)}</h2>
                {selectedItem.kind === 'song' && can('media.edit') && songMap[selectedItem.song] && (
                  <Button size="sm" variant="ghost" onClick={() => setDialog('song-edit')}>Edit words</Button>
                )}
              </div>
              {selected?.loading && <p className="py-10 text-center text-sm text-slate-500">{selectedItem.kind === 'scripture' && bibleError ? bibleError : 'Loading…'}</p>}
              {selected?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{selected.error}</p>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {selected?.slides.map((sl, si) => {
                  const on = isLiveItem(selectedPlanIndex, selectedItem) && live?.slide === si;
                  return (
                    <button key={si} onClick={() => goLive(selectedItem, selectedPlanIndex, si)}
                      className={clsx('group rounded-lg p-1 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-royal-500', on ? 'bg-red-500/90 ring-2 ring-red-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>
                      <SlideView slide={sl} theme={theme} imageUrl={sl.image ? imageMap[sl.image]?.image : null} backgroundUrl={theme.background_image ? imageMap[theme.background_image]?.image : null} className="rounded-md" />
                      <span className={clsx('mt-1 block truncate px-0.5 text-[11px] font-medium', on ? 'text-white' : 'text-slate-500')}>{si + 1}{sl.label ? ` · ${sl.label}` : ''}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* ---------------------------------------------------- live screen and controls */}
        <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
          <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wide text-red-600">On screen</span>
              <span className={clsx('inline-flex items-center gap-1', outputConnected ? 'text-emerald-600' : 'text-slate-500')}>
                {outputConnected ? <MonitorPlay className="h-3.5 w-3.5" /> : <MonitorX className="h-3.5 w-3.5" />}
                {outputConnected ? 'Projector connected' : 'Projector not open'}
              </span>
            </div>
            <SlideView slide={liveSlide} theme={theme} mode={mode} className="rounded-md ring-1 ring-slate-300 dark:ring-slate-700"
              imageUrl={liveSlide?.image ? imageMap[liveSlide.image]?.image : null} backgroundUrl={theme.background_image ? imageMap[theme.background_image]?.image : null} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => step(-1)}>Back</Button>
              <Button icon={<ChevronRight className="h-4 w-4" />} onClick={() => step(1)}>Next</Button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Button size="sm" variant="secondary" aria-pressed={mode === 'black'} onClick={() => toggle('black')} title="B">Black</Button>
              <Button size="sm" variant="secondary" aria-pressed={mode === 'clear'} onClick={() => toggle('clear')} title="C">Clear words</Button>
              <Button size="sm" variant="secondary" aria-pressed={mode === 'logo'} onClick={() => toggle('logo')} title="L">Logo</Button>
            </div>
          </div>

          <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><BookOpen className="h-4 w-4 text-royal-600" />Quick scripture</p>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); showQuickScripture(); }}>
              <Input value={quickRef} onChange={(e) => setQuickRef(e.target.value)} placeholder="e.g. John 3:16-18" aria-label="Bible reference" className="min-w-0 flex-1" />
              <Button type="submit" disabled={!bible || !quickRef.trim()}>Show</Button>
            </form>
            {quickError && <p className="mt-1.5 text-xs text-red-600">{quickError}</p>}
            {!bible && <p className="mt-1.5 text-xs text-slate-500">{bibleError || 'Loading the Bible (King James Version)…'}</p>}
            <QuickSong onShow={(item) => { setSelection({ source: 'quick', item }); goLive(item, null, 0); }} />
          </div>

          <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Sun className="h-4 w-4 text-gold-500" />Look</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p.id} title={p.name} aria-label={p.name} aria-pressed={theme.preset === p.id} onClick={() => setThemeValue({ preset: p.id })}
                  className={clsx('h-9 w-14 rounded-md ring-offset-2 dark:ring-offset-slate-900', theme.preset === p.id ? 'ring-2 ring-gold-400' : 'ring-1 ring-slate-300 dark:ring-slate-600')} style={{ background: p.background }} />
              ))}
            </div>
            <Field label="Background picture" className="mt-3">
              <Select value={theme.background_image || ''} onChange={(e) => setThemeValue({ background_image: e.target.value || null })}>
                <option value="">None (colour only)</option>
                {(images.data?.results || []).filter((i) => i.kind === 'background').map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
              </Select>
            </Field>
            <Field label={`Text size ${Math.round((theme.font_scale || 1) * 100)}%`} className="mt-3">
              <input type="range" min={0.7} max={1.4} step={0.05} value={theme.font_scale || 1} onChange={(e) => setThemeValue({ font_scale: Number(e.target.value) })} className="w-full accent-royal-600" />
            </Field>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={theme.align === 'left'} onChange={(e) => setThemeValue({ align: e.target.checked ? 'left' : 'center' })} />Left-aligned</label>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={theme.show_reference !== false} onChange={(e) => setThemeValue({ show_reference: e.target.checked })} />Show title / reference</label>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!theme.uppercase} onChange={(e) => setThemeValue({ uppercase: e.target.checked })} />CAPITALS</label>
            </div>
            {plan.data && <p className="mt-2 text-xs text-slate-500">The look is saved with this order of service.</p>}
          </div>
        </aside>
      </div>

      {dialog === 'plan' && <NewPlanDialog onClose={() => setDialog(null)} onCreated={(p) => { qc.invalidateQueries({ queryKey: ['media', 'plans'] }); choosePlan(p.id); }} />}
      {dialog === 'song' && <SongPicker onClose={() => setDialog(null)} onPick={(s) => { addItem({ kind: 'song', key: newKey(), song: s.id }); setDialog(null); }} />}
      {dialog === 'scripture' && <ScriptureDialog bible={bible} onClose={() => setDialog(null)} onAdd={(ref) => { addItem({ kind: 'scripture', key: newKey(), ref }); setDialog(null); }} />}
      {dialog === 'text' && <TextDialog onClose={() => setDialog(null)} onAdd={(title, body) => { addItem({ kind: 'text', key: newKey(), title, body }); setDialog(null); }} />}
      {dialog === 'picture' && <PicturePicker images={(images.data?.results || [])} onClose={() => setDialog(null)} onPick={(img) => { addItem({ kind: 'image', key: newKey(), image: img.id }); setDialog(null); }} />}
      {dialog === 'song-edit' && selectedItem?.kind === 'song' && <SongForm songId={selectedItem.song} onClose={() => setDialog(null)} />}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded p-1 text-slate-500 hover:bg-white hover:text-royal-700 dark:hover:bg-slate-700">{children}</button>;
}

function AddBtn({ icon: Icon, label, onClick }: { icon: typeof Music; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-medium text-slate-600 hover:bg-royal-50 hover:text-royal-800 dark:text-slate-300 dark:hover:bg-slate-800">
      <Icon className="h-4 w-4" />{label}
    </button>
  );
}

function useSongSearch(search: string) {
  return useQuery({
    queryKey: ['media', 'songs', 'search', search],
    queryFn: () => api<Page<SongSummary>>('/media/songs/', { params: { search: search || undefined, page_size: 30 } }),
    staleTime: 30 * 1000,
  });
}

function QuickSong({ onShow }: { onShow: (item: PlanItem) => void }) {
  const [search, setSearch] = useState('');
  const list = useSongSearch(search);
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Music className="h-4 w-4 text-royal-600" />Quick song</p>
      <SearchInput value={search} onChange={setSearch} placeholder="Title or words" />
      {search && (
        <ul className="mt-1 max-h-44 overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
          {(list.data?.results || []).map((s) => (
            <li key={s.id}>
              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-royal-50 dark:hover:bg-slate-800" onClick={() => onShow({ kind: 'song', key: newKey(), song: s.id })}>
                <span className="block truncate font-medium">{s.title}</span>
                <span className="block truncate text-xs text-slate-500">{s.first_line}</span>
              </button>
            </li>
          ))}
          {list.data && !list.data.results.length && <li className="px-3 py-2 text-xs text-slate-500">No song matches.</li>}
        </ul>
      )}
    </div>
  );
}

function SongPicker({ onClose, onPick }: { onClose: () => void; onPick: (s: SongSummary | Song) => void }) {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useSongSearch(search);
  if (adding) return <SongForm onClose={() => setAdding(false)} onSaved={onPick} />;
  return (
    <Modal open onClose={onClose} title="Add a song" footer={can('media.create') ? <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New song</Button> : undefined}>
      <SearchInput value={search} onChange={setSearch} placeholder="Title, words, writer or tag" />
      <ul className="mt-3 max-h-[50vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {(list.data?.results || []).map((s) => (
          <li key={s.id}>
            <button className="w-full px-1 py-2 text-left hover:bg-royal-50 dark:hover:bg-slate-800" onClick={() => onPick(s)}>
              <span className="block font-medium">{s.title}{s.language && s.language !== 'English' ? <span className="ml-2 text-xs text-slate-500">{s.language}</span> : null}</span>
              <span className="block truncate text-xs text-slate-500">{s.first_line}</span>
            </button>
          </li>
        ))}
        {list.data && !list.data.results.length && <li className="py-6 text-center text-sm text-slate-500">No songs found.{can('media.create') ? ' Add it with New song.' : ''}</li>}
      </ul>
    </Modal>
  );
}

function ScriptureDialog({ bible, onClose, onAdd }: { bible?: Bible; onClose: () => void; onAdd: (ref: string) => void }) {
  const [ref, setRef] = useState('');
  let preview: ReturnType<typeof lookup> | null = null;
  let error = '';
  if (bible && ref.trim()) {
    try { preview = lookup(bible, ref); } catch (e) { error = (e as Error).message; }
  }
  return (
    <Modal open onClose={onClose} title="Add scripture" subtitle="King James Version"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!preview} onClick={() => preview && onAdd(preview.reference)}>Add {preview?.reference || ''}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (preview) onAdd(preview.reference); }}>
        <Field label="Reference" hint="e.g. John 3:16-18, Psalm 23, 1 Cor 13:4-7" error={ref.trim() ? error : undefined}>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} autoFocus />
        </Field>
      </form>
      {!bible && <p className="mt-3 text-sm text-slate-500">Loading the Bible…</p>}
      {preview && (
        <div className="mt-4 max-h-[40vh] space-y-1.5 overflow-y-auto rounded-lg bg-slate-50 p-3 font-serif text-sm dark:bg-slate-800/60">
          {preview.verses.map((v) => <p key={v.n}><sup className="mr-1 font-sans text-[10px] font-semibold text-royal-700">{v.n}</sup>{v.text}</p>)}
        </div>
      )}
    </Modal>
  );
}

function TextDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (title: string, body: string) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const ok = !!(title.trim() || body.trim());
  return (
    <Modal open onClose={onClose} title="Add a text slide" subtitle="For announcements, sermon points or welcome messages. A blank line starts another slide."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!ok} onClick={() => onAdd(title.trim(), body.trim())}>Add</Button></>}>
      <Field label="Heading"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Welcome to Holy Ghost Bible Church" /></Field>
      <Field label="Words" className="mt-4"><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      {ok && <div className="mt-4"><SlideView slide={{ kind: 'text', heading: title, lines: body.split(/\n\s*\n/)[0].split('\n').filter(Boolean) }} theme={{ preset: 'royal' }} className="rounded-md" /></div>}
    </Modal>
  );
}

function PicturePicker({ images, onClose, onPick }: { images: MediaImage[]; onClose: () => void; onPick: (img: MediaImage) => void }) {
  const slides = images.filter((i) => i.kind === 'slide');
  const list = slides.length ? slides : images;
  return (
    <Modal open onClose={onClose} title="Add a picture" size="lg">
      {!list.length && <p className="py-6 text-center text-sm text-slate-500">No pictures yet. Add them in the <Link to="/presentation/library" className="text-royal-700 underline">library</Link>.</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {list.map((img) => (
          <button key={img.id} onClick={() => onPick(img)} className="overflow-hidden rounded-lg text-left ring-1 ring-slate-200 hover:ring-2 hover:ring-royal-500 dark:ring-slate-700">
            <img src={img.image} alt="" className="aspect-video w-full bg-slate-900 object-cover" />
            <span className="block truncate px-2 py-1.5 text-sm">{img.title}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function NewPlanDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ServicePlan) => void }) {
  const toast = useToast();
  const serviceTypes = useLookup('service-types');
  const today = new Date();
  const nextSunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((7 - today.getDay()) % 7));
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [f, setF] = useState({ org_unit: '', title: SERVICE_TITLES[0], service_date: iso(nextSunday), service_type: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.org_unit) e.org_unit = 'Choose the church.';
    if (!f.title.trim()) e.title = 'Name the service.';
    if (!f.service_date) e.service_date = 'Choose the date.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const p = await api<ServicePlan>('/media/plans/', { method: 'POST', body: { ...f, service_type: f.service_type || null, items: [], theme: DEFAULT_THEME } });
      toast.success('Order of service created.');
      onCreated(p);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New order of service"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Create</Button></>}>
      <FormError message={errors.form} />
      <FormGrid>
        <Field label="Church" required error={errors.org_unit}><UnitSelect value={f.org_unit} onChange={(v) => setF({ ...f, org_unit: v })} placeholder="Choose the church" invalid={!!errors.org_unit} /></Field>
        <Field label="Date" required error={errors.service_date}><Input type="date" value={f.service_date} onChange={(e) => setF({ ...f, service_date: e.target.value })} /></Field>
        <Field label="Service" required error={errors.title}>
          <Input list="service-titles" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <datalist id="service-titles">{SERVICE_TITLES.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="Service type">
          <Select value={f.service_type} onChange={(e) => setF({ ...f, service_type: e.target.value })}>
            <option value="">—</option>
            {(serviceTypes.data || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      </FormGrid>
    </Modal>
  );
}
