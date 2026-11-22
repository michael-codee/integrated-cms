/**
 * The King James Version (public domain) ships as a static file (/bible/kjv.json, about 1.2 MB
 * compressed). The service worker keeps it after the first use, so scripture works offline.
 */
export interface Bible {
  id: string;
  name: string;
  books: { n: string; c: string[][] }[];
}

export interface Passage {
  book: string;
  chapter: number;
  verses: { n: number; text: string }[];
  reference: string;
}

let loading: Promise<Bible> | null = null;

export function loadBible(): Promise<Bible> {
  if (!loading) {
    loading = fetch('/bible/kjv.json', { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error('The Bible could not be loaded. Check the connection and try again.');
        return r.json() as Promise<Bible>;
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
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

export function findBook(bible: Bible, raw: string): number {
  // "II Corinthians" → "2corinthians", "1st John" → "1john"
  let key = norm(raw.trim().replace(/^(i{1,3})\s+/i, (m) => String(m.trim().length)));
  key = key.replace(/^(first|1st)/, '1').replace(/^(second|2nd)/, '2').replace(/^(third|3rd)/, '3');
  if (!key) return -1;
  const prefix = /^[1-3]/.test(key) ? key[0] : '';
  const alias = ALIASES[key.slice(prefix.length)];
  const target = alias ? prefix + norm(alias) : key;
  const names = bible.books.map((b) => norm(b.n));
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
  const verses = book.c[chapter - 1];
  if (!verses) throw new Error(`${book.n} has ${book.c.length} chapter${book.c.length === 1 ? '' : 's'}.`);
  let from = m[3] ? Number(m[3]) : 1;
  let to = m[4] ? Number(m[4]) : m[3] ? from : verses.length;
  if (from < 1 || from > verses.length) throw new Error(`${book.n} ${chapter} has ${verses.length} verses.`);
  to = Math.min(Math.max(to, from), verses.length);
  if (to < from) [from, to] = [to, from];
  const list = [];
  for (let v = from; v <= to; v++) list.push({ n: v, text: verses[v - 1] });
  const reference_ = m[3] ? `${book.n} ${chapter}:${from}${to > from ? `-${to}` : ''}` : `${book.n} ${chapter}`;
  return { book: book.n, chapter, verses: list, reference: reference_ };
}

