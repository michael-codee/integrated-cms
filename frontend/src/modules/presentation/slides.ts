import { lookup, type Bible } from './bible';
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
export function scriptureSlides(bible: Bible, ref: string, version = 'KJV'): Slide[] {
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
  bible?: Bible;
  songs: Record<string, Song | undefined>;
  images: Record<string, MediaImage | undefined>;
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
    case 'scripture': return item.ref;
    case 'text': return item.title || item.body.split('\n')[0] || 'Text';
    case 'image': return ctx.images[item.image]?.title || 'Picture';
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
    case 'scripture':
      if (!ctx.bible) return { slides: [], loading: true };
      try {
        return { slides: scriptureSlides(ctx.bible, item.ref) };
      } catch (e) {
        return { slides: [], error: (e as Error).message };
      }
    case 'text':
      return { slides: textSlides(item.title, item.body) };
    case 'image':
      return { slides: [{ kind: 'image', image: item.image, lines: [], label: ctx.images[item.image]?.title }] };
    case 'blank':
      return { slides: [{ kind: 'blank', lines: [] }] };
  }
}
