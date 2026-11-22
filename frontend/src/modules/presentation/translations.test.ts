import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOKS, BUILT_IN, lookup, shortName, type Bible } from './bible';
import { parseBible } from './bibleImport';
import { compactState, remoteUrl, type RemoteState } from './remote';
import { itemTitle, slidesFor, type SlideContext } from './slides';

const load = (id: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../../../public/bible/${id}.json`), 'utf-8')) as Bible;

describe('built-in translations', () => {
  it.each(BUILT_IN.map((t) => t.id))('%s has every book and the usual references', (id) => {
    const b = load(id);
    expect(b.books.map((x) => x.n)).toEqual(BOOKS);
    expect(lookup(b, 'John 3:16').verses[0].text).toMatch(/God so loved the world/);
    expect(lookup(b, 'Ps 23').verses.length).toBe(6);
    expect(lookup(b, 'Rev 22:21').book).toBe('Revelation');
  });

  it('leaves out verses a translation does not have', () => {
    const asv = load('asv');
    expect(lookup(asv, 'Acts 8:36-38').verses.map((v) => v.n)).toEqual([36, 38]);
    expect(() => lookup(asv, 'Acts 8:37')).toThrow(/not in this translation/);
    expect(lookup(load('kjv'), 'Acts 8:37').verses).toHaveLength(1);
  });

  it('uses the plan translation unless the passage names its own', () => {
    const ctx: SlideContext = { songs: {}, images: {}, version: 'bsb', bibles: { bsb: { ...load('bsb'), short: 'BSB' }, kjv: { ...load('kjv'), short: 'KJV' } } };
    expect(slidesFor({ kind: 'scripture', key: 'a', ref: 'John 3:16' }, ctx).slides[0].footer).toBe('John 3:16 (BSB)');
    expect(slidesFor({ kind: 'scripture', key: 'b', ref: 'John 3:16', version: 'kjv' }, ctx).slides[0].footer).toBe('John 3:16 (KJV)');
    expect(slidesFor({ kind: 'scripture', key: 'c', ref: 'John 3:16', version: 'local-niv' }, { ...ctx, bibleErrors: { 'local-niv': 'Not here' } }).error).toBe('Not here');
    expect(itemTitle({ kind: 'scripture', key: 'b', ref: 'John 3:16', version: 'local-niv' }, ctx)).toBe('John 3:16 (NIV)');
    expect(shortName('web')).toBe('WEB');
  });
});

describe('importing a licensed translation', () => {
  it('reads one verse per line', () => {
    const p = parseBible('Gen 1:1 In the beginning.\nGenesis 1:2 And the earth.\nJohn 3:16 For God so loved.\n1 Jn 1:9 If we confess.\nNotABook 1:1 x');
    expect(p.verses).toBe(4);
    expect(p.books[0].c[0]).toEqual(['In the beginning.', 'And the earth.']);
    expect(p.books[61].n).toBe('1 John');
    expect(p.books[61].c[0][8]).toBe('If we confess.');
    expect(p.unknownBooks).toEqual(['NotABook']);
  });

  it('reads CSV with quotes and book numbers', () => {
    const p = parseBible('book,chapter,verse,text\n43,3,16,"For God so loved the world, that he gave"\nJohn,3,17,"For God sent not his Son"');
    expect(lookup({ id: 'x', name: 'x', books: p.books }, 'John 3:16-17').verses.map((v) => v.text)).toEqual(['For God so loved the world, that he gave', 'For God sent not his Son']);
  });

  it('reads the common JSON layouts and strips markup', () => {
    const nested = parseBible(JSON.stringify({ Psalms: { 23: { 1: 'The <i>LORD</i> is my shepherd' } } }), 'x.json');
    expect(nested.books[18].c[22][0]).toBe('The LORD is my shepherd');
    const flat = parseBible(JSON.stringify([{ book_name: 'Romans', chapter: 8, verse: 28, text: 'And we know' }]));
    expect(flat.books[44].c[7][27]).toBe('And we know');
    const chapters = parseBible(JSON.stringify({ books: [{ name: 'Jude', chapters: [{ chapter: 1, verses: [{ verse: 1, text: 'Jude, a servant' }] }] }] }));
    expect(chapters.books[64].c[0][0]).toBe('Jude, a servant');
    const own = parseBible(readFileSync(path.resolve(__dirname, '../../../public/bible/web.json'), 'utf-8'), 'web.json');
    expect(own.bookCount).toBe(66);
  });

  it('refuses a file with no verses', () => {
    expect(() => parseBible('hello world')).toThrow(/No Bible verses/);
    expect(() => parseBible('{oops', 'a.json')).toThrow(/not valid JSON/);
  });

  it('says when a book is missing from an imported translation', () => {
    const p = parseBible('John 3:16 For God so loved.');
    expect(() => lookup({ id: 'x', name: 'x', books: p.books }, 'Gen 1:1')).toThrow(/Genesis is not in this translation/);
  });
});

describe('phone remote', () => {
  it('keeps the state small and builds the link', () => {
    const big: RemoteState = {
      plan: 'Sunday', title: 'x'.repeat(500), kind: 'song', lines: Array(20).fill('y'.repeat(1000)), mode: 'show', slide: 0,
      slides: Array(500).fill('z'.repeat(200)), item: 0, items: Array(400).fill({ title: 'w'.repeat(300), kind: 'song', slides: 3 }), next: '', video: null,
    };
    expect(JSON.stringify(compactState(big)).length).toBeLessThan(24_000);
    expect(remoteUrl('abc', 'https://cms.example')).toBe('https://cms.example/presentation/remote#abc');
  });
});
