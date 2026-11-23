import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Camera, ChevronLeft, ChevronRight, Image as ImageIcon, ListOrdered, Pause, Play, RefreshCw, Square, Type, WifiOff } from 'lucide-react';
import type { RemoteAction, RemoteState } from './remote';
import { PhoneCameraSender, phoneCameraError, type Facing, type ReceivedSignal, type Signal } from './phoneCamera';

/**
 * The phone remote. It opens from the QR code on the control desk; the token after # is its only
 * key (no sign-in, no church records). Presses go to the server and the desk applies them.
 */
const POLL_MS = 1500;

type Status = 'loading' | 'ok' | 'offline' | 'ended';

function useToken() {
  const [token] = useState(() => window.location.hash.slice(1));
  return token;
}

async function call(token: string, method: 'GET' | 'POST', body?: unknown, path = '/api/media/remote/phone/') {
  const res = await fetch(path, {
    method,
    headers: { 'X-Remote-Token': token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'omit',
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

export default function RemotePage() {
  const token = useToken();
  const [status, setStatus] = useState<Status>(token ? 'loading' : 'ended');
  const [state, setState] = useState<RemoteState | null>(null);
  const [deskConnected, setDeskConnected] = useState(true);
  const [tab, setTab] = useState<'slides' | 'items' | 'camera'>('slides');
  const [message, setMessage] = useState('');
  const timer = useRef<number>();
  const signalsAfter = useRef(0);
  const [, rerender] = useState(0);
  const camera = useRef<PhoneCameraSender | null>(null);
  if (!camera.current) {
    camera.current = new PhoneCameraSender(async (sig: Signal) => {
      const r = await call(token, 'POST', sig, '/api/media/remote/phone/signal/');
      if (r.status !== 202) throw new Error(r.data?.detail || 'The camera could not be offered to the desk.');
    }, () => rerender((n) => n + 1));
  }
  const cam = camera.current;

  const refresh = useCallback(async () => {
    window.clearTimeout(timer.current);
    try {
      const r = await call(token, 'GET', undefined, `/api/media/remote/phone/?signals_after=${signalsAfter.current}`);
      if (r.status === 410 || r.status === 404) { setStatus('ended'); return; }
      if (r.status === 200) {
        setStatus('ok');
        setDeskConnected(!!r.data.desk_connected);
        if (r.data.state && Object.keys(r.data.state).length) setState(r.data.state as RemoteState);
        for (const sig of (r.data.signals || []) as ReceivedSignal[]) {
          if (sig.id <= signalsAfter.current) continue;
          signalsAfter.current = sig.id;
          await camera.current?.answer(sig);
        }
      } else setStatus('offline');
    } catch { setStatus('offline'); }
    // Quicker while the camera waits for the desk's answer.
    const waiting = camera.current?.status === 'connecting';
    timer.current = window.setTimeout(refresh, waiting ? 600 : document.hidden ? POLL_MS * 3 : POLL_MS);
  }, [token]);

  useEffect(() => {
    document.title = 'Remote — RLWM';
    if (!token) return;
    refresh();
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible); camera.current?.stop(); };
  }, [token, refresh]);

  // Keep the phone's screen on while the remote is open.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const ask = async () => {
      try { lock = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not allowed */ }
    };
    ask();
    const again = () => { if (!document.hidden) ask(); };
    document.addEventListener('visibilitychange', again);
    return () => { document.removeEventListener('visibilitychange', again); lock?.release().catch(() => {}); };
  }, []);

  const press = async (action: RemoteAction, value?: number) => {
    try { navigator.vibrate?.(15); } catch { /* not supported */ }
    try {
      const r = await call(token, 'POST', { action, ...(value !== undefined ? { value } : {}) });
      if (r.status === 410) { setStatus('ended'); return; }
      if (r.status !== 202) { setMessage(r.data?.detail || 'That press did not go through. Try again.'); return; }
      setMessage('');
      setStatus('ok');
      // The desk picks the press up within a second; look again shortly after.
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(refresh, 900);
    } catch { setStatus('offline'); setMessage('No connection. Check the phone\'s internet.'); }
  };

  if (status === 'ended' && cam.status !== 'idle') cam.stop(false);
  if (status === 'ended') {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <ListOrdered className="h-10 w-10 text-slate-500" />
          <p className="text-lg font-semibold">This remote has ended</p>
          <p className="text-sm text-slate-400">On the control desk, choose <b>Connect a phone</b> and scan the new code.</p>
        </div>
      </Shell>
    );
  }

  const mode = state?.mode || 'show';
  const slides = state?.slides || [];
  const items = state?.items || [];
  return (
    <Shell>
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-slate-400">{state?.plan || 'Media presentation'}</p>
          <p className="truncate font-semibold">{state?.title || 'Nothing on screen yet'}</p>
        </div>
        {status === 'offline' && <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300"><WifiOff className="h-3.5 w-3.5" />Offline</span>}
        {status === 'ok' && !deskConnected && <span className="rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">Desk not open</span>}
        {mode !== 'show' && <span className="rounded bg-red-600 px-2 py-1 text-xs font-bold uppercase">{mode === 'clear' ? 'Words off' : mode}</span>}
      </header>

      <section className="mx-4 rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800" aria-live="polite">
        {state?.lines.length ? (
          <div className={clsx('space-y-1 text-center text-[15px] leading-snug', state.kind === 'scripture' ? 'font-serif' : 'font-medium', mode !== 'show' && 'opacity-40')}>
            {state.lines.map((l, i) => <p key={i}>{l}</p>)}
          </div>
        ) : (
          <p className="py-3 text-center text-sm text-slate-500">{state?.kind ? `${state.kind[0].toUpperCase()}${state.kind.slice(1)} on screen` : 'Waiting for the control desk…'}</p>
        )}
        {state?.next && <p className="mt-3 truncate border-t border-slate-800 pt-2 text-xs text-slate-400">Next: {state.next}</p>}
      </section>

      <div className="mx-4 mt-3 grid grid-cols-2 gap-3">
        <BigButton onClick={() => press('back')} label="Back"><ChevronLeft className="h-9 w-9" /></BigButton>
        <BigButton onClick={() => press('next')} label="Next" primary><ChevronRight className="h-9 w-9" /></BigButton>
      </div>
      <div className="mx-4 mt-3 grid grid-cols-3 gap-2">
        <ModeButton on={mode === 'black'} onClick={() => press('black')} icon={<Square className="h-4 w-4" />}>Black</ModeButton>
        <ModeButton on={mode === 'clear'} onClick={() => press('clear')} icon={<Type className="h-4 w-4" />}>Clear words</ModeButton>
        <ModeButton on={mode === 'logo'} onClick={() => press('logo')} icon={<ImageIcon className="h-4 w-4" />}>Logo</ModeButton>
      </div>
      {state?.video && (
        <button type="button" onClick={() => press('play')} className="mx-4 mt-2 flex items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 font-semibold active:bg-slate-700">
          {state.video.playing ? <><Pause className="h-5 w-5" />Pause video</> : <><Play className="h-5 w-5" />Play video</>}
        </button>
      )}
      {message && <p className="mx-4 mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{message}</p>}

      <div className="mx-4 mt-4 flex rounded-lg bg-slate-900 p-1 text-sm ring-1 ring-slate-800" role="tablist">
        {(['slides', 'items', 'camera'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={clsx('flex-1 rounded-md py-1.5 font-medium', tab === t ? 'bg-slate-700 text-white' : 'text-slate-400')}>
            {t === 'slides' ? `Slides${slides.length ? ` (${slides.length})` : ''}` : t === 'items' ? 'Order' : <span className="inline-flex items-center gap-1">{cam.status === 'live' && <span className="h-2 w-2 rounded-full bg-red-500" />}Camera</span>}
          </button>
        ))}
      </div>
      <ol className="mx-4 mb-6 mt-2 space-y-1">
        {tab === 'slides' && slides.map((label, i) => (
          <li key={i}>
            <button type="button" onClick={() => press('slide', i)} className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm', i === state?.slide ? 'bg-red-600 text-white' : 'bg-slate-900 active:bg-slate-800')}>
              <span className="w-5 shrink-0 text-xs text-slate-400">{i + 1}</span><span className="truncate">{label}</span>
            </button>
          </li>
        ))}
        {tab === 'slides' && !slides.length && <li className="py-4 text-center text-sm text-slate-500">Nothing on screen yet.</li>}
        {tab === 'items' && items.map((it, i) => (
          <li key={i}>
            <button type="button" disabled={!it.slides} onClick={() => press('item', i)} className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm disabled:opacity-40', i === state?.item ? 'bg-red-600 text-white' : 'bg-slate-900 active:bg-slate-800')}>
              <span className="w-5 shrink-0 text-xs text-slate-400">{i + 1}</span><span className="truncate">{it.title}</span>
            </button>
          </li>
        ))}
        {tab === 'items' && !items.length && <li className="py-4 text-center text-sm text-slate-500">No order of service is open on the desk.</li>}
      </ol>
      {tab === 'camera' && <CameraTab sender={cam} onRefresh={refresh} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-[100dvh] select-none flex-col bg-slate-950 pb-[env(safe-area-inset-bottom)] text-white">{children}</main>;
}

function BigButton({ onClick, label, primary, children }: { onClick: () => void; label: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className={clsx('flex h-28 flex-col items-center justify-center rounded-2xl text-sm font-semibold transition active:scale-[0.97]', primary ? 'bg-royal-600 active:bg-royal-700' : 'bg-slate-800 active:bg-slate-700')}>
      {children}{label}
    </button>
  );
}

function ModeButton({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={clsx('flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold', on ? 'bg-gold-400 text-slate-950' : 'bg-slate-800 active:bg-slate-700')}>
      {icon}{children}
    </button>
  );
}

const CAMERA_STATUS = {
  idle: '',
  connecting: 'Connecting to the control desk…',
  live: 'Sending. On the desk, open Cameras, click this camera and press Transition.',
  failed: 'The camera could not reach the media computer. Join the church Wi-Fi (the same network as the media computer) and try again.',
};

/** Sends this phone's camera to the media computer, where the desk shows it as a live camera. */
function CameraTab({ sender, onRefresh }: { sender: PhoneCameraSender; onRefresh: () => void }) {
  const preview = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [sound, setSound] = useState(false);
  const [name, setName] = useState(() => { try { return localStorage.getItem('rlwm-phone-camera-name') || ''; } catch { return ''; } });
  const [portrait, setPortrait] = useState(() => window.matchMedia?.('(orientation: portrait)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(orientation: portrait)');
    if (!mq) return;
    const on = () => setPortrait(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const on = sender.status !== 'idle';
  useEffect(() => {
    const v = preview.current;
    if (v) { v.srcObject = sender.stream; if (sender.stream) v.play().catch(() => {}); }
  });
  const start = async () => {
    setBusy(true);
    setError('');
    try { localStorage.setItem('rlwm-phone-camera-name', name.trim()); } catch { /* ignore */ }
    try { await sender.start(facing, sound, name || 'Phone camera'); onRefresh(); } catch (e) { sender.stop(false); setError(phoneCameraError(e)); } finally { setBusy(false); }
  };
  const flip = async () => {
    const next: Facing = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    if (on) { try { await sender.switchCamera(next); } catch (e) { setError(phoneCameraError(e)); } }
  };
  return (
    <section className="mx-4 mb-8 mt-2 space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-slate-800">
        <video ref={preview} playsInline muted className={clsx('h-full w-full object-cover', facing === 'user' && '-scale-x-100')} />
        {!on && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-400">Use this phone as a camera for the screens, for example to show the preacher, the choir or a baptism.</p>}
        {sender.status === 'live' && <span className="absolute left-2 top-2 rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase">Live</span>}
      </div>
      {!on ? (
        <>
          <label className="block text-sm text-slate-300">
            Camera name on the desk
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Pulpit, Choir, Balcony"
              className="mt-1 block w-full rounded-lg bg-slate-900 px-3 py-2 text-white ring-1 ring-slate-700 placeholder:text-slate-500 focus:outline-none focus:ring-royal-500" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
            Also send the phone&apos;s microphone
          </label>
          <button type="button" disabled={busy} onClick={start} className="flex w-full items-center justify-center gap-2 rounded-xl bg-royal-600 py-3.5 font-semibold active:bg-royal-700 disabled:opacity-60">
            <Camera className="h-5 w-5" />{busy ? 'Opening the camera…' : 'Send camera'}
          </button>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={flip} className="flex items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 font-semibold active:bg-slate-700"><RefreshCw className="h-4 w-4" />{facing === 'environment' ? 'Front camera' : 'Back camera'}</button>
          <button type="button" onClick={() => sender.stop()} className="flex items-center justify-center gap-2 rounded-xl bg-red-600 py-3 font-semibold active:bg-red-700"><Square className="h-4 w-4" />Stop camera</button>
        </div>
      )}
      {portrait && <p className="rounded-lg bg-gold-400/15 px-3 py-2 text-sm text-gold-300">Turn the phone sideways for a landscape picture that fills the screen.</p>}
      {CAMERA_STATUS[sender.status] && <p className={clsx('text-sm', sender.status === 'failed' ? 'text-red-300' : 'text-slate-400')}>{CAMERA_STATUS[sender.status]}</p>}
      {error && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</p>}
      <p className="text-xs text-slate-500">Keep this page open and the phone plugged in. The picture goes straight to the media computer over the Wi-Fi; on mobile data it may not connect.</p>
    </section>
  );
}
