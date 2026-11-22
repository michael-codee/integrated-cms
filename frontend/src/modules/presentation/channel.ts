/**
 * The control desk and the projector window run on the same computer and talk through a
 * BroadcastChannel, so the screens keep working if the internet drops during service.
 * Pictures travel as Blobs (no expiring links on the projector side).
 */
import type { Slide, Theme } from './types';

export type ScreenMode = 'show' | 'black' | 'clear' | 'logo';

export interface LiveState {
  slide: Slide | null;
  theme: Theme;
  mode: ScreenMode;
  slideImage?: Blob | null;
  background?: Blob | null;
  /** Bumped on every change so a window can ignore stale messages. */
  seq: number;
}

export type Message =
  | { type: 'state'; state: LiveState }
  | { type: 'hello' }
  | { type: 'ping' };

export const CHANNEL = 'rlwm-presentation';

export function openChannel(onMessage: (m: Message) => void) {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, close: () => {} };
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<Message>) => onMessage(e.data);
  return {
    post: (m: Message) => {
      try { ch.postMessage(m); } catch { /* window closing */ }
    },
    close: () => ch.close(),
  };
}

/** Opens (or focuses) the projector window, on the second screen when the browser allows it. */
export async function openOutputWindow() {
  let features = 'popup,width=1280,height=720';
  try {
    const w = window as Window & { getScreenDetails?: () => Promise<{ screens: { isPrimary: boolean; availLeft: number; availTop: number; availWidth: number; availHeight: number }[] }> };
    if (w.getScreenDetails) {
      const details = await w.getScreenDetails();
      const other = details.screens.find((s) => !s.isPrimary);
      if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    }
  } catch {
    /* permission refused: open on this screen; the team drags it across */
  }
  return window.open('/presentation/output', 'rlwm-output', features);
}
