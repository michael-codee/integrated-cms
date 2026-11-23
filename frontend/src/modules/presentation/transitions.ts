/**
 * Camera transitions: how the projector changes from one camera to the next.
 *
 * Each effect animates the incoming picture (on top) and, for some, the outgoing one underneath.
 * Effects marked `outTop` animate the old picture away over the new one instead. Everything is
 * plain CSS keyframes, so the projector page needs nothing extra to play them.
 */

export const TRANSITION_KINDS = [
  'cut', 'fade', 'dip', 'dipwhite', 'blur', 'flash',
  'wipe', 'wipe-left', 'wipe-down', 'wipe-up', 'wipe-diagonal', 'clock', 'blinds', 'blinds-h',
  'slide', 'slide-right', 'slide-up', 'slide-down', 'cover', 'cover-up', 'uncover',
  'iris', 'iris-close', 'diamond', 'split', 'split-v', 'split-close',
  'zoom-in', 'zoom-out', 'flip', 'spin',
] as const;

export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export interface TransitionEffect {
  kind: TransitionKind;
  label: string;
  group: 'Basic' | 'Wipe' | 'Slide' | 'Shape' | 'Motion';
  /** Keyframes for the new picture. */
  in?: string;
  /** Keyframes for the old picture. */
  out?: string;
  /** Draw the old picture over the new one while it leaves. */
  outTop?: boolean;
  /** A coloured flash between the pictures. */
  overlay?: string;
}

export const TRANSITIONS: TransitionEffect[] = [
  { kind: 'cut', label: 'Cut', group: 'Basic' },
  { kind: 'fade', label: 'Fade', group: 'Basic', in: 'cam-fade-in' },
  { kind: 'dip', label: 'Dip to black', group: 'Basic', in: 'cam-dip-in', out: 'cam-dip-out' },
  { kind: 'dipwhite', label: 'Dip to white', group: 'Basic', in: 'cam-dip-in', out: 'cam-dip-out', overlay: 'cam-dipwhite' },
  { kind: 'blur', label: 'Blur dissolve', group: 'Basic', in: 'cam-blur-in', out: 'cam-blur-out' },
  { kind: 'flash', label: 'Flash', group: 'Basic', in: 'cam-flash-in', overlay: 'cam-flash' },

  { kind: 'wipe', label: 'Wipe right', group: 'Wipe', in: 'cam-wipe-in' },
  { kind: 'wipe-left', label: 'Wipe left', group: 'Wipe', in: 'cam-wipe-left-in' },
  { kind: 'wipe-down', label: 'Wipe down', group: 'Wipe', in: 'cam-wipe-down-in' },
  { kind: 'wipe-up', label: 'Wipe up', group: 'Wipe', in: 'cam-wipe-up-in' },
  { kind: 'wipe-diagonal', label: 'Diagonal wipe', group: 'Wipe', in: 'cam-wipe-diagonal-in' },
  { kind: 'clock', label: 'Clock wipe', group: 'Wipe', in: 'cam-clock-in' },
  { kind: 'blinds', label: 'Blinds', group: 'Wipe', in: 'cam-blinds-in' },
  { kind: 'blinds-h', label: 'Venetian blinds', group: 'Wipe', in: 'cam-blinds-h-in' },

  { kind: 'slide', label: 'Push left', group: 'Slide', in: 'cam-slide-in', out: 'cam-slide-out' },
  { kind: 'slide-right', label: 'Push right', group: 'Slide', in: 'cam-slide-right-in', out: 'cam-slide-right-out' },
  { kind: 'slide-up', label: 'Push up', group: 'Slide', in: 'cam-slide-up-in', out: 'cam-slide-up-out' },
  { kind: 'slide-down', label: 'Push down', group: 'Slide', in: 'cam-slide-down-in', out: 'cam-slide-down-out' },
  { kind: 'cover', label: 'Cover from right', group: 'Slide', in: 'cam-slide-in' },
  { kind: 'cover-up', label: 'Cover from below', group: 'Slide', in: 'cam-slide-up-in' },
  { kind: 'uncover', label: 'Uncover', group: 'Slide', out: 'cam-slide-out', outTop: true },

  { kind: 'iris', label: 'Circle open', group: 'Shape', in: 'cam-iris-in' },
  { kind: 'iris-close', label: 'Circle close', group: 'Shape', out: 'cam-iris-out', outTop: true },
  { kind: 'diamond', label: 'Diamond', group: 'Shape', in: 'cam-diamond-in' },
  { kind: 'split', label: 'Doors open', group: 'Shape', in: 'cam-split-in' },
  { kind: 'split-v', label: 'Split from middle', group: 'Shape', in: 'cam-split-v-in' },
  { kind: 'split-close', label: 'Doors close', group: 'Shape', in: 'cam-split-close-in' },

  { kind: 'zoom-in', label: 'Zoom in', group: 'Motion', in: 'cam-zoom-in' },
  { kind: 'zoom-out', label: 'Zoom out', group: 'Motion', out: 'cam-zoom-out', outTop: true },
  { kind: 'flip', label: 'Flip', group: 'Motion', in: 'cam-flip-in', out: 'cam-flip-out' },
  { kind: 'spin', label: 'Spin', group: 'Motion', in: 'cam-spin-in' },
];

export const TRANSITION_GROUPS = ['Basic', 'Wipe', 'Slide', 'Shape', 'Motion'] as const;

/** The effects shown as quick buttons on the switcher. */
export const QUICK_TRANSITIONS: TransitionKind[] = ['cut', 'fade', 'dip', 'wipe', 'slide'];

export const effectFor = (kind: string | undefined) => TRANSITIONS.find((t) => t.kind === kind);
export const isTransitionKind = (kind: unknown): kind is TransitionKind => TRANSITIONS.some((t) => t.kind === kind);

/** The animations for the old picture, the new picture and the optional flash, or none for a cut. */
export function transitionAnimations(kind: string | undefined, ms: number) {
  const e = effectFor(kind);
  if (!e || e.kind === 'cut' || !ms) return null;
  const a = (name?: string) => (name ? `${name} ${ms}ms ease-in-out both` : undefined);
  return { incoming: a(e.in), outgoing: a(e.out), overlay: a(e.overlay), outTop: !!e.outTop, overlayColor: e.kind === 'flash' || e.kind === 'dipwhite' ? '#fff' : undefined };
}

export const TRANSITION_CSS = `
@property --cam-p { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
@property --cam-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
@keyframes cam-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes cam-dip-in { 0%, 50% { opacity: 0 } 100% { opacity: 1 } }
@keyframes cam-dip-out { 0% { opacity: 1 } 50%, 100% { opacity: 0 } }
@keyframes cam-dipwhite { 0% { opacity: 0 } 50% { opacity: 1 } 100% { opacity: 0 } }
@keyframes cam-blur-in { from { opacity: 0; filter: blur(24px) } to { opacity: 1; filter: blur(0) } }
@keyframes cam-blur-out { from { filter: blur(0) } to { filter: blur(24px) } }
@keyframes cam-flash-in { 0%, 30% { opacity: 0 } 31%, 100% { opacity: 1 } }
@keyframes cam-flash { 0% { opacity: 0 } 30% { opacity: 1 } 100% { opacity: 0 } }
@keyframes cam-wipe-in { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes cam-wipe-left-in { from { clip-path: inset(0 0 0 100%) } to { clip-path: inset(0 0 0 0) } }
@keyframes cam-wipe-down-in { from { clip-path: inset(0 0 100% 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes cam-wipe-up-in { from { clip-path: inset(100% 0 0 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes cam-wipe-diagonal-in { from { clip-path: polygon(0 0, 0 0, 0 0, 0 0) } to { clip-path: polygon(0 0, 200% 0, 0 200%, 0 0) } }
@keyframes cam-clock-in {
  from { --cam-a: 0deg; -webkit-mask-image: conic-gradient(#000 var(--cam-a), transparent 0); mask-image: conic-gradient(#000 var(--cam-a), transparent 0) }
  to { --cam-a: 360deg; -webkit-mask-image: conic-gradient(#000 var(--cam-a), transparent 0); mask-image: conic-gradient(#000 var(--cam-a), transparent 0) }
}
@keyframes cam-blinds-in {
  from { --cam-p: 0%; -webkit-mask-image: repeating-linear-gradient(90deg, #000 0 var(--cam-p), transparent var(--cam-p) 10%); mask-image: repeating-linear-gradient(90deg, #000 0 var(--cam-p), transparent var(--cam-p) 10%) }
  to { --cam-p: 10%; -webkit-mask-image: repeating-linear-gradient(90deg, #000 0 var(--cam-p), transparent var(--cam-p) 10%); mask-image: repeating-linear-gradient(90deg, #000 0 var(--cam-p), transparent var(--cam-p) 10%) }
}
@keyframes cam-blinds-h-in {
  from { --cam-p: 0%; -webkit-mask-image: repeating-linear-gradient(180deg, #000 0 var(--cam-p), transparent var(--cam-p) 12.5%); mask-image: repeating-linear-gradient(180deg, #000 0 var(--cam-p), transparent var(--cam-p) 12.5%) }
  to { --cam-p: 12.5%; -webkit-mask-image: repeating-linear-gradient(180deg, #000 0 var(--cam-p), transparent var(--cam-p) 12.5%); mask-image: repeating-linear-gradient(180deg, #000 0 var(--cam-p), transparent var(--cam-p) 12.5%) }
}
@keyframes cam-slide-in { from { transform: translateX(100%) } to { transform: translateX(0) } }
@keyframes cam-slide-out { from { transform: translateX(0) } to { transform: translateX(-100%) } }
@keyframes cam-slide-right-in { from { transform: translateX(-100%) } to { transform: translateX(0) } }
@keyframes cam-slide-right-out { from { transform: translateX(0) } to { transform: translateX(100%) } }
@keyframes cam-slide-up-in { from { transform: translateY(100%) } to { transform: translateY(0) } }
@keyframes cam-slide-up-out { from { transform: translateY(0) } to { transform: translateY(-100%) } }
@keyframes cam-slide-down-in { from { transform: translateY(-100%) } to { transform: translateY(0) } }
@keyframes cam-slide-down-out { from { transform: translateY(0) } to { transform: translateY(100%) } }
@keyframes cam-iris-in { from { clip-path: circle(0% at 50% 50%) } to { clip-path: circle(75% at 50% 50%) } }
@keyframes cam-iris-out { from { clip-path: circle(75% at 50% 50%) } to { clip-path: circle(0% at 50% 50%) } }
@keyframes cam-diamond-in { from { clip-path: polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%) } to { clip-path: polygon(50% -50%, 150% 50%, 50% 150%, -50% 50%) } }
@keyframes cam-split-in { from { clip-path: inset(0 50% 0 50%) } to { clip-path: inset(0 0 0 0) } }
@keyframes cam-split-v-in { from { clip-path: inset(50% 0 50% 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes cam-split-close-in { from { clip-path: polygon(0 0, 0 0, 0 100%, 100% 100%, 100% 0, 100% 0, 100% 100%, 0 100%) } to { clip-path: polygon(0 0, 50% 0, 50% 100%, 50% 100%, 50% 0, 100% 0, 100% 100%, 0 100%) } }
@keyframes cam-zoom-in { from { opacity: 0; transform: scale(0.2) } to { opacity: 1; transform: scale(1) } }
@keyframes cam-zoom-out { from { opacity: 1; transform: scale(1) } to { opacity: 0; transform: scale(2.5) } }
@keyframes cam-flip-in { 0%, 50% { transform: perspective(1600px) rotateY(-90deg) } 100% { transform: perspective(1600px) rotateY(0) } }
@keyframes cam-flip-out { 0% { transform: perspective(1600px) rotateY(0) } 50%, 100% { transform: perspective(1600px) rotateY(90deg) } }
@keyframes cam-spin-in { from { opacity: 0; transform: rotate(-180deg) scale(0) } to { opacity: 1; transform: rotate(0) scale(1) } }
`;
