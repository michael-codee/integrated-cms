/**
 * Bible translations for the screens.
 *
 * Public-domain translations ship with the app as static files under /bible/ (about 1.2 MB each,
 * compressed). The service worker keeps each one after its first use, so scripture works offline.
 * Licensed translations (NIV, NKJV …) are never shipped: the media team imports the ministry's own
 * licensed copy on the media computer (see bibleImport.ts) and it stays in that browser.
 */
export interface Bible {
  id: string;
  name: string;
  /** Short name shown after a reference, e.g. "KJV". */
  short?: string;
  books: { n: string; c: string[][] }[];
}

export interface Passage {
  book: string;
  chapter: number;
  verses: { n: number; text: string }[];
  reference: string;
}

export interface TranslationInfo {
  id: string;
  name: string;
  short: string;
  /** Imported on this computer under the ministry's licence. */
  imported?: boolean;
}

export const DEFAULT_VERSION = 'kjv';

export const BUILT_IN: TranslationInfo[] = [
  { id: 'kjv', name: 'King James Version', short: 'KJV' },
  { id: 'asv', name: 'American Standard Version (1901)', short: 'ASV' },
  { id: 'web', name: 'World English Bible', short: 'WEB' },
  { id: 'bsb', name: 'Berean Standard Bible', short: 'BSB' },
];

/** The 66 books, in order. Imported files are matched against these names. */
export const BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

/** A translation's short name ("KJV"), from its id when nothing else is known. */
export function shortName(id: string | undefined, list: TranslationInfo[] = BUILT_IN) {
  const v = id || DEFAULT_VERSION;
  return list.find((t) => t.id === v)?.short || v.replace(/^local-/, '').toUpperCase();
}

const loading = new Map<string, Promise<Bible>>();

/** Loads a translation: a built-in one from /bible/, an imported one from this computer. */
export function loadBible(id: string = DEFAULT_VERSION): Promise<Bible> {
  let p = loading.get(id);
  if (!p) {
    p = id.startsWith('local-')
      ? import('./bibleImport').then(({ getImportedBible }) => getImportedBible(id)).then((b) => {
        if (!b) throw new Error('This translation is not on this computer. Import it under Translations.');
        return b;
      })
      : BUILT_IN.some((t) => t.id === id)
        ? fetch(`/bible/${id}.json`, { credentials: 'same-origin' }).then((r) => {
          if (!r.ok) throw new Error('The Bible could not be loaded. Check the connection and try again.');
          return r.json() as Promise<Bible>;
        }).then((b) => ({ ...b, short: shortName(id) }))
        : Promise.reject(new Error('Unknown Bible translation.'));
    p.catch(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

/** Forget a loaded translation (after it is imported again or removed). */
export function forgetBible(id: string) {
  loading.delete(id);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Common short forms. Anything else is matched by the start of the book's name ("Deut", "Philem", "Rev").
const ALIASES: Record<string, string> = {
  gen: 'Genesis', ex: 'Exodus', exo: 'Exodus', lev: 'Leviticus', num: 'Numbers', deut: 'Deuteronomy', dt: 'Deuteronomy',
  josh: 'Joshua', judg: 'Judges', jdg: 'Judges', ps: 'Psalms', psa: 'Psalms', psalm: 'Psalms', pss: 'Psalms',
  prov: 'Proverbs', pr: 'Proverbs', eccl: 'Ecclesiastes', ecc: 'Ecclesiastes', song: 'Song of Solomon',
  songofsongs: 'Song of Solomon', sos: 'Song of Solomon', canticles: 'Song of Solomon', isa: 'Isaiah', jer: 'Jeremiah',
  lam: 'Lamentations', ezek: 'Ezekiel', eze: 'Ezekiel', dan: 'Daniel', hos: 'Hosea', joel: 'Joel', am: 'Amos',
  obad: 'Obadiah', ob: 'Obadiah', jon: 'Jonah', jonah: 'Jonah', mic: 'Micah', nah: 'Nahum', hab: 'Habakkuk',
  zeph: 'Zephaniah', hag: 'Haggai', zech: 'Zechariah', zec: 'Zechariah', mal: 'Malachi',
  mt: 'Matthew', matt: 'Matthew', mk: 'Mark', mrk: 'Mark', lk: 'Luke', luk: 'Luke', jn: 'John', jhn: 'John', john: 'John',
  acts: 'Acts', rom: 'Romans', gal: 'Galatians', eph: 'Ephesians', phil: 'Philippians', php: 'Philippians',
  col: 'Colossians', tit: 'Titus', phlm: 'Philemon', philem: 'Philemon', heb: 'Hebrews', jas: 'James', jm: 'James',
  jude: 'Jude', rev: 'Revelation', revelations: 'Revelation', job: 'Job', ruth: 'Ruth', esth: 'Esther', est: 'Esther',
  ezra: 'Ezra', neh: 'Nehemiah',
};

export function findBook(bible: Bible | string[], raw: string): number {
  // "II Corinthians" → "2corinthians", "1st John" → "1john"
  let key = norm(raw.trim().replace(/^(i{1,3})\s+/i, (m) => String(m.trim().length)));
  key = key.replace(/^(first|1st)/, '1').replace(/^(second|2nd)/, '2').replace(/^(third|3rd)/, '3');
  if (!key) return -1;
  const prefix = /^[1-3]/.test(key) ? key[0] : '';
  const alias = ALIASES[key.slice(prefix.length)];
  const target = alias ? prefix + norm(alias) : key;
  const names = (Array.isArray(bible) ? bible : bible.books.map((b) => b.n)).map(norm);
  const exact = names.indexOf(target);
  return exact >= 0 ? exact : names.findIndex((n) => n.startsWith(target));
}

const REF = /^\s*((?:[1-3]|i{1,3})?\s*[a-z][a-z .]*?)\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?\s*$/i;

/** Parses "John 3:16-18", "Ps 23", "1 Cor 13:4" … Throws an Error with a readable message. */
export function lookup(bible: Bible, reference: string): Passage {
  const m = REF.exec(reference);
  if (!m) throw new Error(`"${reference}" is not a Bible reference. Try a form like John 3:16-18.`);
  const bookIndex = findBook(bible, m[1]);
  if (bookIndex < 0) throw new Error(`There is no book called "${m[1].trim()}".`);
  const book = bible.books[bookIndex];
  const chapter = Number(m[2]);
  if (!book.c.length) throw new Error(`${book.n} is not in this translation.`);
  const verses = book.c[chapter - 1];
  if (!verses) throw new Error(`${book.n} has ${book.c.length} chapter${book.c.length === 1 ? '' : 's'}.`);
  let from = m[3] ? Number(m[3]) : 1;
  let to = m[4] ? Number(m[4]) : m[3] ? from : verses.length;
  if (from < 1 || from > verses.length) throw new Error(`${book.n} ${chapter} has ${verses.length} verses.`);
  to = Math.min(Math.max(to, from), verses.length);
  if (to < from) [from, to] = [to, from];
  const list = [];
  // Some translations leave out verses missing from the oldest manuscripts (e.g. Acts 8:37).
  for (let v = from; v <= to; v++) if (verses[v - 1]) list.push({ n: v, text: verses[v - 1] });
  if (!list.length) throw new Error(`${book.n} ${chapter}:${from}${to > from ? `-${to}` : ''} is not in this translation (it is missing from the oldest manuscripts).`);
  const reference_ = m[3] ? `${book.n} ${chapter}:${from}${to > from ? `-${to}` : ''}` : `${book.n} ${chapter}`;
  return { book: book.n, chapter, verses: list, reference: reference_ };
}

