import { describe, expect, it } from 'vitest';
import { QUICK_TRANSITIONS, TRANSITION_CSS, TRANSITION_GROUPS, TRANSITION_KINDS, TRANSITIONS, transitionAnimations } from './transitions';

describe('camera transitions', () => {
  it('lists every effect once, in a known group', () => {
    expect(TRANSITIONS.map((t) => t.kind).sort()).toEqual([...TRANSITION_KINDS].sort());
    for (const t of TRANSITIONS) expect(TRANSITION_GROUPS).toContain(t.group);
    for (const k of QUICK_TRANSITIONS) expect(TRANSITION_KINDS).toContain(k);
  });

  it('has keyframes for every animation it names', () => {
    for (const t of TRANSITIONS) {
      for (const name of [t.in, t.out, t.overlay]) if (name) expect(TRANSITION_CSS).toContain(`@keyframes ${name} `);
      if (t.kind !== 'cut') expect(t.in || t.out).toBeTruthy();
    }
  });

  it('cuts at once for cut, unknown effects or no length', () => {
    expect(transitionAnimations('cut', 1000)).toBeNull();
    expect(transitionAnimations('sparkle', 1000)).toBeNull();
    expect(transitionAnimations('fade', 0)).toBeNull();
    expect(transitionAnimations('fade', 500)?.incoming).toBe('cam-fade-in 500ms ease-in-out both');
    expect(transitionAnimations('iris-close', 500)?.outTop).toBe(true);
  });
});
