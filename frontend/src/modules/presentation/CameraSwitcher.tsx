/**
 * Camera switcher on the control desk: every camera live side by side (the cameras and capture
 * cards on this computer, and each phone sending from the phone remote). Click a camera to make
 * it the next one (PREVIEW, green), then press Transition to put it on the projector (ON SCREEN,
 * red) with the chosen effect. Any camera opens full screen on the desk, landscape, with Capture
 * (a still picture) and Record; none of these controls ever reach the projector.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Camera, Circle, Expand, Maximize2, Minimize2, RefreshCw, RotateCw, Square, X, Zap } from 'lucide-react';
import { Button, Select, useToast } from '@/components/ui';
import type { CameraSettings, CameraTransition, TransitionKind } from './channel';
import { addVideoFiles, formatTime } from './localVideos';
import { cameraBlockedByPolicy, cameraErrorMessage, findCameras, openCamera, StreamVideo, type CameraDevice } from './media';
import { isPhoneSource, phoneSourceId, phoneStreamFor, usePhoneSources, type PhoneSource } from './phoneCamera';

export const TRANSITIONS: { kind: TransitionKind; label: string }[] = [
  { kind: 'cut', label: 'Cut' },
  { kind: 'fade', label: 'Fade' },
  { kind: 'dip', label: 'Dip to black' },
  { kind: 'wipe', label: 'Wipe' },
  { kind: 'slide', label: 'Slide' },
];
const DURATIONS = [500, 1000, 1500, 2000];
const PREFS = 'rlwm-camera-switcher';

interface Source { id: string; label: string; phone?: PhoneSource }

function readPrefs(): CameraTransition {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) || 'null');
    if (p && TRANSITIONS.some((t) => t.kind === p.kind) && DURATIONS.includes(p.ms)) return p;
  } catch { /* ignore */ }
  return { kind: 'fade', ms: 1000 };
}

/** A camera on this computer, opened for a tile or the full-screen view (closed when not shown). */
function useDeviceStream(deviceId: string | null, label?: string, withSound = false) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (deviceId === null || isPhoneSource(deviceId)) { setStream(null); return; }
    let s: MediaStream | null = null;
    let cancelled = false;
    setError('');
    openCamera({ deviceId: deviceId || null, label, audio: withSound }, withSound).then((st) => {
      if (cancelled) { st.getTracks().forEach((t) => t.stop()); return; }
      s = st;
      setStream(st);
    }, (e) => { if (!cancelled) setError(cameraErrorMessage(e)); });
    return () => { cancelled = true; s?.getTracks().forEach((t) => t.stop()); setStream(null); };
  }, [deviceId, label, withSound]);
  return { stream, error };
}

function SourcePicture({ source, className }: { source: Source; className?: string }) {
  const local = useDeviceStream(source.phone ? null : source.id, source.label);
  const stream = source.phone ? source.phone.stream : local.stream;
  const note = source.phone
    ? (source.phone.status === 'failed' ? 'Could not connect' : !stream ? 'Connecting…' : '')
    : local.error;
  return (
    <div className={clsx('relative overflow-hidden bg-black', className)}>
      <StreamVideo stream={stream} className="h-full w-full object-contain" />
      {note && <p className="absolute inset-x-2 top-1/2 -translate-y-1/2 text-center text-xs text-white/75">{note}</p>}
    </div>
  );
}

export function CameraSwitcher({ program, onScreen, onTake, audio }: {
  /** The camera on the projector now. */
  program: CameraSettings;
  /** Whether the screen is showing the camera at all (or a slide). */
  onScreen: boolean;
  onTake: (s: { deviceId: string; label: string; transition: CameraTransition }) => void;
  audio: boolean;
}) {
  const toast = useToast();
  const phones = usePhoneSources();
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [transition, setTransition] = useState<CameraTransition>(readPrefs);
  const [viewing, setViewing] = useState<string | null>(null);
  const blocked = cameraBlockedByPolicy();

  const look = useCallback(async (ask: boolean) => {
    setLooking(true);
    try {
      const list = await findCameras(ask);
      setDevices(list);
      setError(list.length ? '' : 'No camera or capture device is connected to this computer.');
    } catch (e) { setError(cameraErrorMessage(e)); } finally { setLooking(false); }
  }, []);
  useEffect(() => { if (!blocked) look(false); }, [blocked, look]);
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify(transition)); } catch { /* ignore */ } }, [transition]);

  // Cameras listed before permission have no names; ask once so the tiles can show pictures.
  const unnamed = devices.length > 0 && devices.every((d) => /^Camera \d+$/.test(d.label));
  const sources: Source[] = [
    ...(unnamed ? [] : devices.map((d) => ({ id: d.id, label: d.label }))),
    ...phones.map((p) => ({ id: phoneSourceId(p.cid), label: p.label, phone: p })),
  ];
  const programId = program.deviceId === 'phone' ? (phones[0] ? phoneSourceId(phones[0].cid) : 'phone') : program.deviceId;
  const nextId = preview && preview !== programId && sources.some((s) => s.id === preview) ? preview : null;

  const take = (id: string | null, kind?: TransitionKind) => {
    const src = sources.find((s) => s.id === id);
    if (!src) { toast.error('Click the camera to show next first.'); return; }
    onTake({ deviceId: src.id, label: src.label, transition: { ...transition, kind: kind || transition.kind } });
    // Like a vision mixer: the camera that was on screen becomes the next one.
    setPreview(programId && programId !== src.id ? programId : null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable=true]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' && nextId && !viewing) { e.preventDefault(); take(nextId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const viewed = sources.find((s) => s.id === viewing);

  return (
    <section className="mb-4 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800" aria-label="Camera switcher">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto flex items-center gap-1.5 text-sm font-semibold"><Camera className="h-4 w-4 text-royal-600" />Camera switcher</p>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Transition">
          {TRANSITIONS.map((t) => (
            <button key={t.kind} type="button" role="radio" aria-checked={transition.kind === t.kind} onClick={() => setTransition({ ...transition, kind: t.kind })}
              className={clsx('rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1', transition.kind === t.kind ? 'bg-royal-600 text-white ring-royal-600' : 'text-slate-600 ring-slate-300 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-800')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="w-24 shrink-0">
          <Select value={transition.ms} onChange={(e) => setTransition({ ...transition, ms: Number(e.target.value) })} aria-label="Transition length" disabled={transition.kind === 'cut'}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d / 1000} s</option>)}
          </Select>
        </div>
        <Button variant="secondary" onClick={() => take(nextId, 'cut')} disabled={!nextId} title="Switch at once">Cut now</Button>
        <Button variant="gold" icon={<Zap className="h-4 w-4" />} onClick={() => take(nextId)} disabled={!nextId} title="Enter">Transition</Button>
      </div>

      {blocked ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">This page was opened in a way that keeps the camera switched off. <button type="button" className="font-semibold underline" onClick={() => window.location.reload()}>Reload to use the cameras</button>.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {sources.map((src) => {
            const isProgram = src.id === programId && onScreen;
            const isNext = src.id === nextId;
            return (
              <div key={src.id} className={clsx('group relative overflow-hidden rounded-lg ring-4 transition', isProgram ? 'ring-red-500' : isNext ? 'ring-emerald-500' : 'ring-transparent')}>
                <button type="button" className="block w-full text-left" onClick={() => setPreview(src.id)} onDoubleClick={() => take(src.id, 'cut')} aria-pressed={isNext} title="Click: show next · Double-click: cut to it now">
                  <SourcePicture source={src} className="aspect-video w-full" />
                </button>
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5">
                  {isProgram ? <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">On screen</span>
                    : isNext ? <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Next</span> : <span />}
                  <button type="button" onClick={() => setViewing(src.id)} className="pointer-events-auto rounded bg-black/60 p-1 text-white opacity-80 hover:opacity-100" aria-label={`Open ${src.label} full screen`} title="Full screen, capture and record">
                    <Expand className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="truncate bg-slate-900 px-2 py-1 text-xs font-medium text-white">{src.label}{src.phone ? ' · phone' : ''}</p>
              </div>
            );
          })}
          <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
            <p>{unnamed ? 'Allow the cameras to see them here.' : 'Add a phone: Phone remote → Connect a phone, then Camera → Send camera on the phone.'}</p>
            <Button size="sm" variant="secondary" loading={looking} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => look(true)}>{unnamed ? 'Allow cameras' : 'Find cameras'}</Button>
          </div>
        </div>
      )}
      {error && !sources.length && <p className="mt-2 text-xs text-slate-500">{error}</p>}
      {!onScreen && <p className="mt-2 text-xs text-slate-500">The screen is showing slides. Transition puts the camera on the screen.</p>}

      {viewed && <CameraViewer source={viewed} audio={audio} onClose={() => setViewing(null)} onShow={() => take(viewed.id)} isProgram={viewed.id === programId && onScreen} />}
    </section>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
};

function recorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']) if (MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

/**
 * One camera full screen on the desk, landscape, with Capture and Record. Desk only: nothing here
 * is sent to the projector except "Show on screen".
 */
export function CameraViewer({ source, audio, onClose, onShow, isProgram }: { source: Source; audio: boolean; onClose: () => void; onShow: () => void; isProgram: boolean }) {
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const phones = usePhoneSources();
  const local = useDeviceStream(source.phone ? null : source.id, source.label, audio);
  const stream = source.phone ? phoneStreamFor(phones, source.id) : local.stream;
  const [fill, setFill] = useState(false);
  const [rotate, setRotate] = useState(0);
  const [full, setFull] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const el = box.current;
    el?.requestFullscreen?.().catch(() => {});
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);

  useEffect(() => {
    if (recordingSince === null) return;
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [recordingSince]);

  // Stop (and keep) a recording if the viewer closes or the camera goes away.
  useEffect(() => () => { if (recorder.current?.state === 'recording') recorder.current.stop(); }, []);
  useEffect(() => { if (!stream && recorder.current?.state === 'recording') recorder.current.stop(); }, [stream]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) { toast.error('There is no picture to capture yet.'); return; }
    const turned = rotate % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = turned ? v.videoHeight : v.videoWidth;
    c.height = turned ? v.videoWidth : v.videoHeight;
    const g = c.getContext('2d');
    if (!g) return;
    g.translate(c.width / 2, c.height / 2);
    g.rotate((rotate * Math.PI) / 180);
    g.drawImage(v, -v.videoWidth / 2, -v.videoHeight / 2);
    c.toBlob((b) => {
      if (!b) return;
      download(b, `${source.label} ${stamp()}.png`);
      toast.success('Picture saved to the Downloads folder.');
    }, 'image/png');
  };

  const record = () => {
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return; }
    if (!stream) { toast.error('There is no picture to record yet.'); return; }
    const type = recorderType();
    if (type === null) { toast.error('This browser cannot record. Use Chrome or Edge.'); return; }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 6_000_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      setRecordingSince(null);
      recorder.current = null;
      if (!chunks.length) return;
      const ext = (rec.mimeType || type || 'video/webm').includes('mp4') ? 'mp4' : 'webm';
      const file = new File(chunks, `${source.label} ${stamp()}.${ext}`, { type: rec.mimeType || 'video/webm' });
      download(file, file.name);
      // Also kept under Videos on this computer, ready to play back on the screen.
      const { added } = await addVideoFiles([file]);
      toast.success(added.length ? 'Recording saved to Downloads and to Videos.' : 'Recording saved to the Downloads folder.');
    };
    rec.start(1000);
    recorder.current = rec;
    setRecordingSince(Date.now());
  };

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else box.current?.requestFullscreen?.().catch(() => {});
  };
  const recording = recordingSince !== null;

  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label={`${source.label} full screen`} className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Landscape picture filling the screen; Rotate turns a phone held upright. */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div style={{ transform: `rotate(${rotate}deg)`, width: rotate % 180 ? '100vh' : '100%', height: rotate % 180 ? '100vw' : '100%' }}>
            <StreamVideo stream={stream} videoRef={video} className={clsx('h-full w-full', fill ? 'object-cover' : 'object-contain')} />
          </div>
        </div>
        {!stream && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-white/70">{local.error || 'Waiting for the picture…'}</p>}
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className="rounded bg-black/60 px-2 py-1 text-sm font-semibold">{source.label}</span>
          {isProgram && <span className="rounded bg-red-600 px-2 py-1 text-xs font-bold uppercase">On screen</span>}
          {recording && <span className="flex items-center gap-1.5 rounded bg-red-600 px-2 py-1 text-xs font-bold tabular-nums"><span className="h-2 w-2 animate-pulse rounded-full bg-white" />REC {formatTime((Date.now() - recordingSince!) / 1000)}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 bg-slate-950/95 px-3 py-2">
        <ViewerButton onClick={capture} icon={<Camera className="h-4 w-4" />}>Capture</ViewerButton>
        <ViewerButton onClick={record} icon={recording ? <Square className="h-4 w-4" /> : <Circle className="h-4 w-4 fill-red-500 text-red-500" />} danger={recording}>{recording ? 'Stop recording' : 'Record'}</ViewerButton>
        <ViewerButton onClick={() => setRotate((r) => (r + 90) % 360)} icon={<RotateCw className="h-4 w-4" />}>Rotate</ViewerButton>
        <ViewerButton onClick={() => setFill((f) => !f)} icon={fill ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}>{fill ? 'Fit whole picture' : 'Fill screen'}</ViewerButton>
        <ViewerButton onClick={toggleFull} icon={<Expand className="h-4 w-4" />}>{full ? 'Leave full screen' : 'Full screen'}</ViewerButton>
        {!isProgram && <ViewerButton onClick={onShow} icon={<Zap className="h-4 w-4" />} gold>Show on screen</ViewerButton>}
        <ViewerButton onClick={onClose} icon={<X className="h-4 w-4" />}>Close</ViewerButton>
      </div>
    </div>
  );
}

function ViewerButton({ onClick, icon, children, danger, gold }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode; danger?: boolean; gold?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={clsx('flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold', danger ? 'bg-red-600 hover:bg-red-700' : gold ? 'bg-gold-400 text-slate-950 hover:bg-gold-300' : 'bg-white/10 hover:bg-white/20')}>
      {icon}{children}
    </button>
  );
}
