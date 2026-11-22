/**
 * The control desk and the projector window run on the same computer and talk through a
 * BroadcastChannel, so the screens keep working if the internet drops during service.
 * Pictures travel as Blobs (no expiring links on the projector side).
 */
import type { Slide, Theme } from './types';

export type ScreenMode = 'show' | 'black' | 'clear' | 'logo';

/**
 * How the video on screen should be playing. Both windows work out the position from the same
 * clock (they run on one computer): position + (now - at) while playing.
 */
export interface VideoTransport {
  /** Local video id (see localVideos.ts). */
  id: string;
  playing: boolean;
  /** Seconds into the video at time `at`. */
  position: number;
  at: number;
  loop: boolean;
  /** 0–1 */
  volume: number;
}

export interface CameraSettings {
  deviceId: string | null;
  /** The device's name: device ids can differ between windows, so the projector also looks it up by name. */
  label?: string;
  /** Play the capture device's own sound through the projector computer. */
  audio: boolean;
}

export interface LowerThird {
  name: string;
  title: string;
}

export interface Countdown {
  /** Ends at this time (ms since 1970, this computer's clock). */
  target: number;
  label: string;
  where: 'screen' | 'stage' | 'both';
  style: 'full' | 'corner';
}

/** What the preacher's stage display needs beyond the screen itself. */
export interface StageInfo {
  title: string;
  notes: string;
  next: Slide | null;
  nextTitle: string;
  message: string;
}

export interface LiveState {
  slide: Slide | null;
  theme: Theme;
  mode: ScreenMode;
  slideImage?: Blob | null;
  background?: Blob | null;
  /** The background video to loop behind the words (local id), when this computer has it. */
  backgroundVideo?: string | null;
  video?: VideoTransport | null;
  camera?: CameraSettings;
  lowerThird?: LowerThird | null;
  countdown?: Countdown | null;
  stage?: StageInfo;
  /** Bumped on every change so a window can ignore stale messages. */
  seq: number;
}

export type ScreenWindow = 'output' | 'stage';

/** Sent by the projector window while a video plays, so the desk and stage display can show the time. */
export interface VideoProgress {
  id: string;
  time: number;
  duration: number;
  ended: boolean;
  /** The browser refused to play sound until someone clicks the projector window. */
  muted: boolean;
}

export type Message =
  | { type: 'state'; state: LiveState }
  | { type: 'hello'; from?: ScreenWindow }
  | { type: 'ping'; from?: ScreenWindow }
  | { type: 'video'; progress: VideoProgress };

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

/** Seconds into the video the transport says we should be at now. */
export function expectedPosition(t: VideoTransport, duration: number, now = Date.now()) {
  const pos = t.position + (t.playing ? (now - t.at) / 1000 : 0);
  if (!duration || !Number.isFinite(duration)) return Math.max(0, pos);
  return t.loop ? pos % duration : Math.min(Math.max(0, pos), duration);
}

/** Opens (or focuses) the projector window, on the second screen when the browser allows it. */
export async function openOutputWindow() {
  return openScreenWindow('/presentation/output', 'rlwm-output');
}

/** Opens the preacher's stage display (next slide, notes, clock), on another screen when there is one. */
export async function openStageWindow() {
  return openScreenWindow('/presentation/stage', 'rlwm-stage', true);
}

async function openScreenWindow(path: string, name: string, preferLast = false) {
  let features = 'popup,width=1280,height=720';
  try {
    const w = window as Window & { getScreenDetails?: () => Promise<{ screens: { isPrimary: boolean; availLeft: number; availTop: number; availWidth: number; availHeight: number }[] }> };
    if (w.getScreenDetails) {
      const details = await w.getScreenDetails();
      const others = details.screens.filter((s) => !s.isPrimary);
      const other = preferLast ? others[others.length - 1] : others[0];
      if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    }
  } catch {
    /* permission refused: open on this screen; the team drags it across */
  }
  return window.open(path, name, features);
}
