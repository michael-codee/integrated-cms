import { describe, expect, it } from 'vitest';
import { expectedPosition, type VideoTransport } from './channel';
import { resolveVideo, formatTime } from './localVideos';
import { formatRemaining } from './media';
import { itemTitle, nextSlide, slidesFor, type SlideContext } from './slides';
import type { PlanItem } from './types';

const ctx: SlideContext = { songs: {}, images: {} };

describe('video transport', () => {
  const t: VideoTransport = { id: 'v_1', playing: true, position: 10, at: 1_000_000, loop: false, volume: 1 };
  it('moves on while playing and stands still when paused', () => {
    expect(expectedPosition(t, 120, 1_005_000)).toBe(15);
    expect(expectedPosition({ ...t, playing: false }, 120, 1_005_000)).toBe(10);
  });
  it('stops at the end, or wraps round when repeating', () => {
    expect(expectedPosition(t, 12, 1_005_000)).toBe(12);
    expect(expectedPosition({ ...t, loop: true }, 12, 1_005_000)).toBe(3);
    expect(expectedPosition(t, NaN, 1_005_000)).toBe(15);
  });
});

describe('videos on this computer', () => {
  const list = [{ id: 'v_a', name: 'Welcome.mp4', size: 1, type: 'video/mp4', addedAt: 1 }];
  it('finds a plan video by id, or by file name on another computer', () => {
    expect(resolveVideo(list, 'v_a', 'x.mp4')?.id).toBe('v_a');
    expect(resolveVideo(list, 'v_other', 'Welcome.mp4')?.id).toBe('v_a');
    expect(resolveVideo(list, 'v_other', 'Missing.mp4')).toBeUndefined();
    expect(resolveVideo(list, null, null)).toBeUndefined();
  });
  it('formats times', () => {
    expect(formatTime(75.4)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatRemaining(4200)).toBe('00:05');
    expect(formatRemaining(-50)).toBe('00:00');
    expect(formatRemaining(3_600_000 + 61_000)).toBe('1:01:01');
  });
});

describe('video, camera and stage slides', () => {
  const items: PlanItem[] = [
    { kind: 'video', key: 'a', video: 'v_a', name: 'Sermon clip.mp4', loop: true },
    { kind: 'blank', key: 'b' },
    { kind: 'camera', key: 'c', notes: 'Pastor on screen' },
    { kind: 'text', key: 'd', title: 'Welcome', body: 'One\n\nTwo' },
  ];
  it('makes one slide per video or camera item', () => {
    expect(slidesFor(items[0], ctx).slides).toEqual([{ kind: 'video', video: 'v_a', loop: true, lines: [], label: 'Sermon clip' }]);
    expect(slidesFor(items[2], ctx).slides[0].kind).toBe('camera');
    expect(itemTitle(items[2], ctx)).toBe('Live camera');
  });
  it('finds the next slide for the stage display', () => {
    const of = (i: PlanItem) => slidesFor(i, ctx);
    expect(nextSlide(items, 0, of(items[0]).slides, 0, of)?.item?.key).toBe('b');
    const text = of(items[3]).slides;
    expect(nextSlide(items, 3, text, 0, of)).toEqual({ slide: text[1], item: null });
    expect(nextSlide(items, 3, text, 1, of)).toBeNull();
    expect(nextSlide(items, null, of(items[0]).slides, 0, of)).toBeNull();
  });
});
