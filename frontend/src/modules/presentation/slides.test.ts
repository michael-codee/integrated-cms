import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBook, lookup, type Bible } from './bible';
import { songSlides } from './slides';

const bible = JSON.parse(readFileSync(path.resolve(__dirname, '../../../public/bible/kjv.json'), 'utf-8')) as Bible;

describe('scripture lookup', () => {
  it('reads common references', () => {
    const p = lookup(bible, 'John 3:16-18');
    expect(p.reference).toBe('John 3:16-18');
    expect(p.verses.map((v) => v.n)).toEqual([16, 17, 18]);
    expect(p.verses[0].text).toMatch(/^For God so loved the world/);
    expect(lookup(bible, 'ps 23').verses).toHaveLength(6);
    expect(lookup(bible, '1 cor 13:4').reference).toBe('1 Corinthians 13:4');
    expect(lookup(bible, 'II Kings 2:9').book).toBe('2 Kings');
    expect(lookup(bible, '1jn 1:9').book).toBe('1 John');
    expect(lookup(bible, 'Rev 22:21').verses[0].text).toMatch(/grace/);
    expect(lookup(bible, 'Song 2:4').book).toBe('Song of Solomon');
  });

  it('tells the operator what is wrong', () => {
    expect(() => lookup(bible, 'Hezekiah 1:1')).toThrow(/no book/);
    expect(() => lookup(bible, 'Jude 2')).toThrow(/1 chapter/);
    expect(() => lookup(bible, 'John 3:99')).toThrow(/36 verses/);
    expect(() => lookup(bible, 'hello')).toThrow(/not a Bible reference/);
    expect(findBook(bible, 'Philemon')).toBe(56);
  });
});

describe('song slides', () => {
  it('splits on blank lines and names sections', () => {
    const slides = songSlides({ title: 'Grace', author: '', copyright: '', lyrics: '[Verse 1]\na\nb\n\n[Chorus]\nc\n\nd\ne\nf\ng\nh\ni\nj\nk' });
    expect(slides.map((s) => s.label)).toEqual(['Verse 1', 'Chorus', 'Chorus', 'Chorus']);
    expect(slides[0].lines).toEqual(['a', 'b']);
    expect(slides[2].lines).toHaveLength(4); // eight lines split into two slides
  });
});
