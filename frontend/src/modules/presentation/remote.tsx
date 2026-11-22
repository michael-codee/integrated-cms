/**
 * Phone remote, desk side.
 *
 * The desk pairs with the server and shows a QR code. A phone that scans it can press Next, Back,
 * Black, Clear, Logo, Play/Pause and jump to a slide or item. About once a second the desk sends a
 * short summary of what is on screen and collects the presses waiting for it, then applies them
 * itself: the screens still change only through this desk. Needs the internet (or the church's own
 * server on the local network) on both the media computer and the phone; the screens themselves
 * keep working without it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Copy, Smartphone, Unplug, Wifi, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError, OfflineError } from '@/lib/api';
import { Button, useToast } from '@/components/ui';
import type { ScreenMode } from './channel';

export type RemoteAction = 'next' | 'back' | 'black' | 'clear' | 'logo' | 'show' | 'play' | 'slide' | 'item';
export interface RemoteCommand { id: number; action: RemoteAction; value: number | null }

/** What the phone sees. Kept small: it travels through the server every second. */
export interface RemoteState {
  plan: string;
  title: string;
  kind: string;
  lines: string[];
  mode: ScreenMode;
  slide: number;
  slides: string[];
  item: number | null;
  items: { title: string; kind: string; slides: number }[];
  next: string;
  video: { playing: boolean } | null;
}

interface Session { id: string; token: string; expires_at: string }

const KEY = 'rlwm-remote-session';
const POLL_MS = 1000;

function readSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null') as Session | null;
    return s && new Date(s.expires_at).getTime() > Date.now() ? s : null;
  } catch { return null; }
}
function writeSession(s: Session | null) {
  try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function remoteUrl(token: string, origin = window.location.origin) {
  return `${origin}/presentation/remote#${token}`;
}

const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Trims a state so it stays well under the server's limit. */
export function compactState(s: RemoteState): RemoteState {
  return {
    ...s,
    plan: cut(s.plan, 120),
    title: cut(s.title, 120),
    lines: s.lines.slice(0, 8).map((l) => cut(l, 300)),
    slides: s.slides.slice(0, 100).map((l) => cut(l, 50)),
    items: s.items.slice(0, 120).map((i) => ({ ...i, title: cut(i.title, 60) })),
    next: cut(s.next, 120),
  };
}

export function useRemote(state: RemoteState, onCommand: (c: RemoteCommand) => void) {
  const [session, setSession] = useState<Session | null>(readSession);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [online, setOnline] = useState(true);
  const [starting, setStarting] = useState(false);
  const stateJson = useMemo(() => JSON.stringify(compactState(state)), [state]);
  const latest = useRef({ stateJson, onCommand });
  latest.current = { stateJson, onCommand };

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let timer: number | undefined;
    let after = 0;
    let sent = '';
    const tick = async () => {
      const { stateJson: s } = latest.current;
      try {
        const r = await api<{ active: boolean; commands: RemoteCommand[]; phone_connected: boolean }>(`/media/remote/${session.id}/sync/`, {
          method: 'POST', body: { after, ...(s !== sent ? { state: JSON.parse(s) } : {}) },
        });
        if (stopped) return;
        sent = s;
        setOnline(true);
        setPhoneConnected(r.phone_connected);
        for (const c of r.commands) {
          if (c.id <= after) continue;
          after = c.id;
          try { latest.current.onCommand(c); } catch { /* a press that no longer applies */ }
        }
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiError && (e.status === 410 || e.status === 404)) {
          writeSession(null);
          setSession(null);
          return;
        }
        setOnline(!(e instanceof OfflineError));
        sent = ''; // send the state again once the connection is back
      }
      // Faster while presses are arriving would not help: the phone waits on the same round trip.
      if (!stopped) timer = window.setTimeout(tick, document.hidden ? POLL_MS * 2 : POLL_MS);
    };
    tick();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [session]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const s = await api<Session>('/media/remote/', { method: 'POST' });
      writeSession(s);
      setSession(s);
      setPhoneConnected(false);
    } finally { setStarting(false); }
  }, []);

  const end = useCallback(async () => {
    const s = session;
    writeSession(null);
    setSession(null);
    setPhoneConnected(false);
    if (s) { try { await api(`/media/remote/${s.id}/end/`, { method: 'POST' }); } catch { /* it expires anyway */ } }
  }, [session]);

  return { session, phoneConnected, online, starting, start, end };
}

/** A QR code as an SVG (black on white, with the quiet zone scanners need). */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { size: n + 8, path: d };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label="QR code for the phone remote" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export function RemotePanel({ remote }: { remote: ReturnType<typeof useRemote> }) {
  const toast = useToast();
  const { session, phoneConnected, online, starting, start, end } = remote;
  const url = session ? remoteUrl(session.token) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success('Link copied.'); } catch { toast.error('Copy the link by hand.'); }
  };
  const begin = async () => {
    try { await start(); } catch (e) { toast.error(e instanceof OfflineError ? 'The phone remote needs the internet. Check the connection.' : (e as Error).message); }
  };
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Smartphone className="h-4 w-4 text-royal-600" />Phone remote</p>
        {session && (
          <span className={clsx('inline-flex items-center gap-1 text-xs', !online ? 'text-amber-600' : phoneConnected ? 'text-emerald-600' : 'text-slate-500')}>
            {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {!online ? 'No connection' : phoneConnected ? 'Phone connected' : 'Waiting for a phone'}
          </span>
        )}
      </div>
      {!session ? (
        <>
          <p className="mb-2 text-xs text-slate-500">Move the slides, black the screen or pause a video from a phone anywhere in the church. The phone needs no account; it only gets the screen buttons.</p>
          <Button size="sm" variant="secondary" className="w-full" loading={starting} icon={<Smartphone className="h-4 w-4" />} onClick={begin}>Connect a phone</Button>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <QrCode text={url} className="h-32 w-32 shrink-0 rounded-md ring-1 ring-slate-200" />
            <div className="min-w-0 flex-1 space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <p>Scan with the phone's camera. Anyone with this code can press the screen buttons until you end it, so keep it to the media team.</p>
              <p className="text-slate-500">Ends by itself at {new Date(session.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={copy}>Copy link</Button>
            <Button size="sm" variant="secondary" icon={<Unplug className="h-4 w-4" />} onClick={end}>End remote</Button>
          </div>
        </>
      )}
    </div>
  );
}
