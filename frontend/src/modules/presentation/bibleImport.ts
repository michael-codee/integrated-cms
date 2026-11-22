/**
 * Licensed Bible translations, imported on the media computer.
 *
 * Publishers license translations such as the NIV, NKJV or ESV; their text may not be published
 * with the web app. The media team imports the ministry's own licensed copy from a file, and it
 * stays in this browser's storage (like the videos), never on the server. Each media computer
 * imports its own copy. Kept when someone signs out: it is church media, not personal records.
 */
import Dexie, { type Table } from 'dexie';
import { useCallback, useEffect, useState } from 'react';
import { BOOKS, BUILT_IN, findBook, forgetBible, type Bible, type TranslationInfo } from './bible';

/** The translations the ministry asked for. Others can be imported under any short name. */
export const LICENSED: { short: string; name: string; holder: string }[] = [
  { short: 'NIV', name: 'New International Version', holder: 'Biblica' },
  { short: 'NKJV', name: 'New King James Version', holder: 'Thomas Nelson (HarperCollins Christian Publishing)' },
  { short: 'ESV', name: 'English Standard Version', holder: 'Crossway' },
  { short: 'NLT', name: 'New Living Translation', holder: 'Tyndale House Publishers' },
  { short: 'CEV', name: 'Contemporary English Version', holder: 'American Bible Society' },
  { short: 'TPT', name: 'The Passion Translation', holder: 'Passion & Fire Ministries (BroadStreet Publishing)' },
  { short: 'AMP', name: 'Amplified Bible', holder: 'The Lockman Foundation' },
];

interface StoredBible extends Bible {
  addedAt: number;
  verses: number;
}

class BibleDb extends Dexie {
  bibles!: Table<StoredBible, string>;
  constructor() {
    super('rlwm-bibles-local');
    this.version(1).stores({ bibles: 'id, short' });
  }
}

let database: BibleDb | null = null;
const db = () => (database ??= new BibleDb());

const CHANGED = 'rlwm-local-bibles';
function announce() {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(CHANGED);
  ch.postMessage('changed');
  ch.close();
}

export const MAX_BIBLE_FILE = 40 * 1024 * 1024;

export function idFor(short: string) {
  return `local-${short.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
}

const clean = (t: unknown) => String(t ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

type Verse = { book: string | number; chapter: number; verse: number; text: string };

/** Book name or number (1–66) → index, or -1. */
function bookIndex(book: string | number) {
  const n = typeof book === 'number' ? book : /^\d{1,2}$/.test(book.trim()) ? Number(book) : NaN;
  if (Number.isInteger(n)) return n >= 1 && n <= 66 ? n - 1 : -1;
  return findBook(BOOKS, String(book));
}

function splitCsvLine(line: string, sep: string) {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const VPL = /^\s*((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s+(\d{1,3})\s*[:.]\s*(\d{1,3})\s+(.+)$/;

function versesFromText(text: string): Verse[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const out: Verse[] = [];
  const sep = lines.slice(0, 5).some((l) => l.includes('\t')) ? '\t' : ',';
  for (const line of lines) {
    const cols = splitCsvLine(line, sep);
    // "book, chapter, verse, text" (extra leading id columns are allowed)
    if (cols.length >= 4) {
      const c = cols.length - 3;
      const [book, ch, v] = [cols[c - 1], cols[c], cols[c + 1]];
      if (/^\s*\d+\s*$/.test(ch) && /^\s*\d+\s*$/.test(v)) {
        out.push({ book: book.trim(), chapter: Number(ch), verse: Number(v), text: cols.slice(c + 2).join(sep) });
        continue;
      }
    }
    // "John 3:16 For God so loved …"
    const m = VPL.exec(line);
    if (m) out.push({ book: m[1], chapter: Number(m[2]), verse: Number(m[3]), text: m[4] });
  }
  return out;
}

type Json = Record<string, unknown>;

function versesFromJson(data: unknown): Verse[] {
  const out: Verse[] = [];
  const root = data as Json;
  const books = (Array.isArray(data) ? data : root?.books) as unknown;
  if (Array.isArray(books) && books.length && typeof books[0] === 'object') {
    const first = books[0] as Json;
    // This app's own format: { books: [{ n, c: [[verse, …], …] }] }
    if ('c' in first) {
      books.forEach((b: Json, i) => (b.c as string[][]).forEach((ch, ci) => ch.forEach((t, vi) => out.push({ book: (b.n as string) || i + 1, chapter: ci + 1, verse: vi + 1, text: t }))));
      return out;
    }
    // { books: [{ name, chapters: [{ chapter, verses: [{ verse, text }] }] }] }
    if ('chapters' in first) {
      books.forEach((b: Json, i) => (b.chapters as Json[]).forEach((ch, ci) => {
        const vs = (Array.isArray(ch) ? ch : ch.verses) as unknown[];
        vs.forEach((v, vi) => {
          const vv = v as Json | string;
          out.push(typeof vv === 'string'
            ? { book: (b.name as string) || (b.book as string) || i + 1, chapter: Number((ch as Json).chapter) || ci + 1, verse: vi + 1, text: vv }
            : { book: (b.name as string) || (b.book as string) || i + 1, chapter: Number((ch as Json).chapter ?? vv.chapter) || ci + 1, verse: Number(vv.verse) || vi + 1, text: vv.text as string });
        });
      }));
      return out;
    }
    // A flat list: [{ book, chapter, verse, text }]
    for (const v of books as Json[]) {
      const book = (v.book ?? v.book_name ?? v.bookName ?? v.b) as string | number;
      const chapter = Number(v.chapter ?? v.c);
      const verse = Number(v.verse ?? v.v);
      const text = (v.text ?? v.t) as string;
      if (book != null && chapter && verse && text != null) out.push({ book, chapter, verse, text });
    }
    return out;
  }
  // { "Genesis": { "1": { "1": "In the beginning …" } } }
  if (root && typeof root === 'object') {
    for (const [book, chapters] of Object.entries(root)) {
      if (!chapters || typeof chapters !== 'object') continue;
      for (const [ch, verses] of Object.entries(chapters as Json)) {
        if (!verses || typeof verses !== 'object') continue;
        for (const [v, text] of Object.entries(verses as Json)) {
          if (typeof text === 'string' && /^\d+$/.test(ch) && /^\d+$/.test(v)) out.push({ book, chapter: Number(ch), verse: Number(v), text });
        }
      }
    }
  }
  return out;
}

export interface ParsedBible {
  books: Bible['books'];
  verses: number;
  /** Books found in the file. */
  bookCount: number;
  /** Book names in the file that match none of the 66 books. */
  unknownBooks: string[];
}

/**
 * Reads a Bible from a file's text: JSON (several common layouts), CSV or tab-separated
 * (book, chapter, verse, text) or one verse per line ("John 3:16 For God so loved …").
 * Throws an Error with a readable message when nothing usable is found.
 */
export function parseBible(text: string, fileName = ''): ParsedBible {
  let raw: Verse[];
  const trimmed = text.trimStart().replace(/^﻿/, '');
  if (/\.json$/i.test(fileName) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try { data = JSON.parse(trimmed); } catch { throw new Error('This file is not valid JSON.'); }
    raw = versesFromJson(data);
  } else raw = versesFromText(text);
  const books: Bible['books'] = BOOKS.map((n) => ({ n, c: [] }));
  const unknown = new Set<string>();
  let count = 0;
  for (const v of raw) {
    const bi = bookIndex(v.book);
    if (bi < 0) { unknown.add(String(v.book)); continue; }
    const t = clean(v.text);
    if (!t || v.chapter < 1 || v.chapter > 150 || v.verse < 1 || v.verse > 200) continue;
    const chapters = books[bi].c;
    while (chapters.length < v.chapter) chapters.push([]);
    const verses = chapters[v.chapter - 1];
    while (verses.length < v.verse) verses.push('');
    if (!verses[v.verse - 1]) count++;
    verses[v.verse - 1] = t;
  }
  if (!count) throw new Error('No Bible verses were found in this file. Use JSON, CSV (book, chapter, verse, text) or one verse per line such as "John 3:16 For God so loved…".');
  return { books, verses: count, bookCount: books.filter((b) => b.c.length).length, unknownBooks: [...unknown].slice(0, 10) };
}

export async function saveImportedBible(short: string, name: string, parsed: ParsedBible) {
  const code = short.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(code)) throw new Error('Give a short name of 2 to 12 letters or digits, such as NIV.');
  if (BUILT_IN.some((t) => t.short === code)) throw new Error(`${code} is already built in.`);
  const id = idFor(code);
  try { await navigator.storage?.persist?.(); } catch { /* not supported */ }
  try {
    await db().bibles.put({ id, short: code, name: name.trim() || code, books: parsed.books, addedAt: Date.now(), verses: parsed.verses });
  } catch (e) {
    const full = (e as Error).name === 'QuotaExceededError' || /quota/i.test((e as Error).message);
    throw new Error(full ? 'There is not enough space on this computer.' : `The translation could not be saved: ${(e as Error).message}`);
  }
  forgetBible(id);
  announce();
  return id;
}

export async function getImportedBible(id: string): Promise<Bible | null> {
  const b = await db().bibles.get(id);
  return b ? { id: b.id, name: b.name, short: b.short, books: b.books } : null;
}

export async function deleteImportedBible(id: string) {
  await db().bibles.delete(id);
  forgetBible(id);
  announce();
}

export interface ImportedInfo extends TranslationInfo { verses: number; addedAt: number }

export async function listImportedBibles(): Promise<ImportedInfo[]> {
  const rows: ImportedInfo[] = [];
  await db().bibles.orderBy('short').each((b) => { rows.push({ id: b.id, name: b.name, short: b.short || b.id, imported: true, verses: b.verses, addedAt: b.addedAt }); });
  return rows;
}

/** Built-in translations followed by those imported on this computer. */
export function useTranslations() {
  const [imported, setImported] = useState<ImportedInfo[]>([]);
  const refresh = useCallback(() => { listImportedBibles().then(setImported, () => setImported([])); }, []);
  useEffect(() => {
    refresh();
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANGED);
    ch.onmessage = refresh;
    return () => ch.close();
  }, [refresh]);
  return { all: [...BUILT_IN, ...imported] as TranslationInfo[], imported, refresh };
}
