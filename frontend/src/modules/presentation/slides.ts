import { DEFAULT_VERSION, lookup, shortName, type Bible } from './bible';
import type { MediaImage, PlanItem, Slide, Song } from './types';

const SECTION = /^\[(.+)\]$/;
const MAX_LINES = 6;

/**
 * Lyrics → slides. A blank line starts a new slide; a line like "[Chorus]" names the slides that
 * follow. A block longer than six lines is split so the words stay large enough to read.
 */
export function songSlides(song: Pick<Song, 'title' | 'lyrics' | 'author' | 'copyright'>): Slide[] {
  const slides: Slide[] = [];
  let label = '';
  const footer = [song.title, song.author].filter(Boolean).join(' · ');
  for (const block of song.lyrics.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines: string[] = [];
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      const sec = SECTION.exec(line);
      if (sec) label = sec[1].trim();
      else if (line) lines.push(line);
    }
    if (!lines.length) continue;
    const parts = Math.ceil(lines.length / MAX_LINES);
    const per = Math.ceil(lines.length / parts);
    for (let i = 0; i < lines.length; i += per) slides.push({ kind: 'song', label, lines: lines.slice(i, i + per), footer });
  }
  return slides;
}

/** One verse per slide, the verse number kept in front of the words. */
export function scriptureSlides(bible: Bible, ref: string, version = bible.short || shortName(bible.id)): Slide[] {
  const p = lookup(bible, ref);
  return p.verses.map((v) => ({
    kind: 'scripture' as const,
    label: `Verse ${v.n}`,
    lines: [v.text],
    footer: `${p.book} ${p.chapter}:${v.n} (${version})`,
  }));
}

export function textSlides(title: string, body: string): Slide[] {
  const blocks = body.split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  if (!blocks.length) return [{ kind: 'text', heading: title, lines: [] }];
  return blocks.map((lines, i) => ({ kind: 'text' as const, heading: title, lines, label: blocks.length > 1 ? `Part ${i + 1}` : undefined }));
}

export interface SlideContext {
  /** Translations loaded so far, by id. */
  bibles?: Record<string, Bible | undefined>;
  /** Why a translation could not be loaded, by id. */
  bibleErrors?: Record<string, string | undefined>;
  /** The translation for scripture items that do not name one (the plan's choice). */
  version?: string;
  songs: Record<string, Song | undefined>;
  images: Record<string, MediaImage | undefined>;
}

/** The slide after the given one: later in the same item, or the first slide of the next item that has one. */
export function nextSlide(items: PlanItem[], planIndex: number | null, current: Slide[], slide: number, slidesOf: (i: PlanItem) => ItemSlides) {
  if (slide + 1 < current.length) return { slide: current[slide + 1], item: null as PlanItem | null };
  if (planIndex === null) return null;
  for (let i = planIndex + 1; i < items.length; i++) {
    const s = slidesOf(items[i]).slides;
    if (s.length) return { slide: s[0], item: items[i] };
  }
  return null;
}

export interface ItemSlides {
  slides: Slide[];
  error?: string;
  loading?: boolean;
}

export function itemTitle(item: PlanItem, ctx: SlideContext): string {
  if (item.label) return item.label;
  switch (item.kind) {
    case 'song': return ctx.songs[item.song]?.title || 'Song';
    case 'scripture': return item.version ? `${item.ref} (${shortName(item.version)})` : item.ref;
    case 'text': return item.title || item.body.split('\n')[0] || 'Text';
    case 'image': return ctx.images[item.image]?.title || 'Picture';
    case 'video': return item.name.replace(/\.[a-z0-9]{2,4}$/i, '') || 'Video';
    case 'camera': return 'Live camera';
    case 'blank': return 'Blank screen';
  }
}

export function slidesFor(item: PlanItem, ctx: SlideContext): ItemSlides {
  switch (item.kind) {
    case 'song': {
      const song = ctx.songs[item.song];
      if (!song) return { slides: [], loading: true };
      return { slides: songSlides(song) };
    }
    case 'scripture': {
      const version = versionOf(item, ctx);
      const bible = ctx.bibles?.[version];
      if (!bible) {
        const error = ctx.bibleErrors?.[version];
        return error ? { slides: [], error } : { slides: [], loading: true };
      }
      try {
        return { slides: scriptureSlides(bible, item.ref) };
      } catch (e) {
        return { slides: [], error: (e as Error).message };
      }
    }
    case 'text':
      return { slides: textSlides(item.title, item.body) };
    case 'image':
      return { slides: [{ kind: 'image', image: item.image, lines: [], label: ctx.images[item.image]?.title }] };
    case 'video':
      return { slides: [{ kind: 'video', video: item.video, loop: !!item.loop, lines: [], label: itemTitle(item, ctx) }] };
    case 'camera':
      return { slides: [{ kind: 'camera', lines: [], label: item.label || 'Live camera' }] };
    case 'blank':
      return { slides: [{ kind: 'blank', lines: [] }] };
  }
}

/** The translation a scripture item is shown in. */
export function versionOf(item: PlanItem, ctx: Pick<SlideContext, 'version'>) {
  return (item.kind === 'scripture' && item.version) || ctx.version || DEFAULT_VERSION;
}
