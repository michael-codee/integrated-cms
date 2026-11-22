/**
 * Control-desk panels for phase 2: videos kept on this computer, the video player controls, the
 * live camera, lower-third captions, the countdown and messages to the stage display.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Captions, Film, MessageSquareText, Pause, Play, Plus, Repeat, RotateCcw, Timer, Trash2, Volume2, Webcam,
} from 'lucide-react';
import { Button, Field, Input, Modal, Select, useToast } from '@/components/ui';
import { expectedPosition, type CameraSettings, type Countdown, type LowerThird, type VideoProgress, type VideoTransport } from './channel';
import { addVideoFiles, deleteVideo, formatBytes, formatTime, storageEstimate, useLocalVideoUrl, type LocalVideoInfo } from './localVideos';
import { cameraBlockedByPolicy, cameraErrorMessage, findCameras, formatRemaining, useNow, VideoThumb, type CameraDevice } from './media';
import { PHONE_CAMERA, type CameraLinkStatus } from './phoneCamera';

export function Panel({ icon, title, children, aside }: { icon: ReactNode; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">{icon}{title}</p>
        {aside}
      </div>
      {children}
    </div>
  );
}

function readJson<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

// ---------------------------------------------------------------- videos on this computer

export function VideoLibrary({ videos, onClose, onPick, pickLabel = 'Add' }: {
  videos: LocalVideoInfo[]; onClose: () => void; onPick?: (v: LocalVideoInfo) => void; pickLabel?: string;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [space, setSpace] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => { storageEstimate().then(setSpace); }, [videos]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const { added, refused } = await addVideoFiles(Array.from(files));
      refused.forEach((m) => toast.error(m));
      if (added.length) toast.success(added.length === 1 ? `${added[0].name} is ready.` : `${added.length} videos are ready.`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const remove = async (v: LocalVideoInfo) => {
    if (!window.confirm(`Remove ${v.name} from this computer? Orders of service that use it will show it as missing here.`)) return;
    await deleteVideo(v.id);
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Videos on this computer"
      subtitle="Videos are copied into this browser on the media computer, not uploaded, so they play without internet. Use MP4 (H.264) or WebM files."
      footer={<>
        <input ref={input} type="file" accept="video/*,.mp4,.m4v,.webm,.mov,.mkv" multiple hidden onChange={(e) => add(e.target.files)} />
        <Button variant="secondary" loading={busy} icon={<Plus className="h-4 w-4" />} onClick={() => input.current?.click()}>Add videos</Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      {!videos.length && (
        <p className="py-8 text-center text-sm text-slate-500">No videos on this computer yet. Press <b>Add videos</b> and choose sermon clips, song videos or moving backgrounds.</p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {videos.map((v) => <VideoRow key={v.id} video={v} onPick={onPick} pickLabel={pickLabel} onRemove={() => remove(v)} />)}
      </ul>
      {space && space.quota > 0 && (
        <p className="mt-4 text-xs text-slate-500">Space used by this app on this computer: {formatBytes(space.used)} of about {formatBytes(space.quota)}.</p>
      )}
    </Modal>
  );
}

function VideoRow({ video, onPick, pickLabel, onRemove }: { video: LocalVideoInfo; onPick?: (v: LocalVideoInfo) => void; pickLabel: string; onRemove: () => void }) {
  const url = useLocalVideoUrl(video.id);
  return (
    <li className="overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
      <div className="relative aspect-video bg-black" style={{ containerType: 'size' }}>{url && <VideoThumb url={url} />}</div>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={video.name}>{video.name}</p>
          <p className="text-xs text-slate-500">{formatBytes(video.size)}</p>
        </div>
        {onPick && <Button size="sm" onClick={() => onPick(video)}>{pickLabel}</Button>}
        <button type="button" onClick={onRemove} aria-label={`Remove ${video.name}`} title="Remove from this computer" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- video player controls

export function VideoControls({ name, transport, progress, onChange }: {
  name: string; transport: VideoTransport; progress: VideoProgress | null; onChange: (t: VideoTransport) => void;
}) {
  const now = useNow(250);
  const duration = progress?.duration || 0;
  const position = progress && transport.playing && !progress.ended ? expectedPosition(transport, duration, now) : progress?.time ?? expectedPosition(transport, duration, now);
  const ended = !!progress?.ended && !transport.loop;
  const at = (patch: Partial<VideoTransport>) => onChange({ ...transport, at: Date.now(), ...patch });
  const togglePlay = () => {
    if (transport.playing && !ended) at({ playing: false, position });
    else at({ playing: true, position: ended ? 0 : position });
  };
  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
      <p className="mb-1.5 flex items-center gap-1.5 truncate text-xs font-semibold text-slate-600 dark:text-slate-300"><Film className="h-3.5 w-3.5 shrink-0" />{name}</p>
      <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(position, duration || 1)} disabled={!duration}
        onChange={(e) => at({ position: Number(e.target.value) })} aria-label="Position in the video" className="w-full accent-red-500" />
      <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-500">
        <span>{formatTime(position)}</span>
        <span>{ended ? 'Finished' : duration ? `-${formatTime(duration - position)}` : '…'}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button size="sm" onClick={togglePlay} title="P" icon={transport.playing && !ended ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}>
          {transport.playing && !ended ? 'Pause' : 'Play'}
        </Button>
        <Button size="sm" variant="secondary" aria-label="Start again" title="Start again" onClick={() => at({ position: 0, playing: true })}><RotateCcw className="h-4 w-4" /></Button>
        <Button size="sm" variant="secondary" aria-label="Repeat" title="Repeat" aria-pressed={transport.loop} onClick={() => at({ loop: !transport.loop, position })}><Repeat className="h-4 w-4" /></Button>
        <label className="ml-auto flex min-w-0 items-center gap-1 text-slate-500" title="Volume">
          <Volume2 className="h-4 w-4 shrink-0" />
          <input type="range" min={0} max={1} step={0.05} value={transport.volume} onChange={(e) => onChange({ ...transport, volume: Number(e.target.value) })} aria-label="Volume" className="w-20 accent-royal-600" />
        </label>
      </div>
      {progress?.muted && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">The projector is playing without sound. Click once inside the projector window to allow sound.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- live camera

const CAMERA_KEY = 'rlwm-presentation-camera';
export const readCameraSettings = (): CameraSettings => readJson(CAMERA_KEY, { deviceId: null, audio: false });

const PHONE_STATUS: Record<CameraLinkStatus, string> = {
  idle: 'No phone is sending its camera. On the phone remote, open Camera and press Send camera.',
  connecting: 'Connecting to the phone camera…',
  live: 'Phone camera connected.',
  failed: 'The phone camera could not connect. Put the phone on the church Wi-Fi and press Send camera again.',
};

export function CameraPanel({ settings, onChange, onShow, live, phoneStatus = 'idle' }: { settings: CameraSettings; onChange: (s: CameraSettings) => void; onShow: () => void; live: boolean; phoneStatus?: CameraLinkStatus }) {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [error, setError] = useState('');
  const [looking, setLooking] = useState(false);
  const blocked = cameraBlockedByPolicy();
  const look = async (ask: boolean) => {
    setLooking(true);
    try {
      const list = await findCameras(ask);
      setDevices(list);
      setError(list.length ? '' : 'No camera or capture device is connected.');
      if (list.length && settings.deviceId !== PHONE_CAMERA && !list.some((d) => d.id === settings.deviceId)) update({ deviceId: list[list.length - 1].id, label: list[list.length - 1].label });
    } catch (e) { setError(cameraErrorMessage(e)); }
    finally { setLooking(false); }
  };
  useEffect(() => { if (!blocked) look(false).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (patch: Partial<CameraSettings>) => { const next = { ...settings, ...patch }; writeJson(CAMERA_KEY, next); onChange(next); };
  const named = devices.some((d) => !/^Camera \d+$/.test(d.label));

  return (
    <Panel icon={<Webcam className="h-4 w-4 text-royal-600" />} title="Live camera"
      aside={<Button size="sm" variant={live ? 'secondary' : 'primary'} disabled={blocked} onClick={onShow}>{live ? 'On screen' : 'Show'}</Button>}>
      {blocked ? (
        <div className="text-xs text-slate-600 dark:text-slate-300">
          <p>This page was opened in a way that keeps the camera switched off.</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => window.location.reload()}>Reload to use the camera</Button>
          <p className="mt-1.5 text-slate-500">If this stays, accept the app update when it is offered, then reload.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Select value={settings.deviceId || ''} onChange={(e) => update({ deviceId: e.target.value || null, label: devices.find((d) => d.id === e.target.value)?.label })} aria-label="Camera or capture device" className="min-w-0 flex-1">
              {!devices.length && <option value="">Default camera</option>}
              {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              <option value={PHONE_CAMERA}>Phone camera (from the phone remote)</option>
            </Select>
            <Button variant="secondary" loading={looking} onClick={() => look(true)}>{named ? 'Refresh' : 'Find cameras'}</Button>
          </div>
          {settings.deviceId === PHONE_CAMERA && (
            <p className={clsx('mt-2 text-xs', phoneStatus === 'live' ? 'text-emerald-600' : phoneStatus === 'failed' ? 'text-red-600' : 'text-slate-500')}>{PHONE_STATUS[phoneStatus]}</p>
          )}
          <label className="mt-2 inline-flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={settings.audio} onChange={(e) => update({ audio: e.target.checked })} />
            {settings.deviceId === PHONE_CAMERA ? 'Play the phone\'s sound on the projector computer' : <>Play the device&apos;s sound on the projector computer</>}
          </label>
          <p className="mt-1 text-xs text-slate-500">Leave this off when the sound already goes through the mixer, to avoid an echo.</p>
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- lower thirds

const CAPTIONS_KEY = 'rlwm-presentation-captions';

export function LowerThirdPanel({ value, onShow, onHide }: { value: LowerThird | null; onShow: (lt: LowerThird) => void; onHide: () => void }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [recent, setRecent] = useState<LowerThird[]>(() => readJson(CAPTIONS_KEY, []));
  const show = (lt: LowerThird) => {
    const clean = { name: lt.name.trim(), title: lt.title.trim() };
    if (!clean.name) return;
    const next = [clean, ...recent.filter((r) => r.name !== clean.name || r.title !== clean.title)].slice(0, 8);
    setRecent(next);
    writeJson(CAPTIONS_KEY, next);
    onShow(clean);
  };
  const forget = (lt: LowerThird) => {
    const next = recent.filter((r) => r !== lt);
    setRecent(next);
    writeJson(CAPTIONS_KEY, next);
  };
  return (
    <Panel icon={<Captions className="h-4 w-4 text-royal-600" />} title="Name caption"
      aside={value && <Button size="sm" variant="secondary" onClick={onHide}>Hide</Button>}>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); show({ name, title }); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Rev. John Kamara" aria-label="Name" />
        <div className="flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Guest Minister" aria-label="Title" className="min-w-0 flex-1" />
          <Button type="submit" disabled={!name.trim()}>Show</Button>
        </div>
      </form>
      {value && <p className="mt-2 truncate text-xs text-emerald-700 dark:text-emerald-400">On screen: {value.name}{value.title ? ` · ${value.title}` : ''}</p>}
      {!!recent.length && (
        <ul className="mt-2 space-y-1">
          {recent.map((r, i) => {
            const on = value?.name === r.name && value?.title === r.title;
            return (
              <li key={i} className="group flex items-center gap-1">
                <button type="button" onClick={() => (on ? onHide() : show(r))}
                  className={clsx('min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-xs', on ? 'bg-gold-100 text-ink-950 ring-1 ring-gold-400 dark:bg-gold-400/20 dark:text-gold-100' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>
                  <b>{r.name}</b>{r.title ? ` · ${r.title}` : ''}
                </button>
                <button type="button" aria-label={`Forget ${r.name}`} onClick={() => forget(r)} className="rounded p-1 text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- countdown

export function CountdownPanel({ value, onStart, onStop }: { value: Countdown | null; onStart: (c: Countdown) => void; onStop: () => void }) {
  const now = useNow(500);
  const [label, setLabel] = useState('Service begins in');
  const [minutes, setMinutes] = useState('5');
  const [until, setUntil] = useState('');
  const [where, setWhere] = useState<Countdown['where']>('screen');
  const [style, setStyle] = useState<Countdown['style']>('full');
  const start = (target: number) => onStart({ target, label: label.trim(), where, style });
  const startMinutes = (m: number) => { if (m > 0) start(Date.now() + m * 60000); };
  const startUntil = () => {
    const [h, m] = until.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    start(d.getTime());
  };
  return (
    <Panel icon={<Timer className="h-4 w-4 text-royal-600" />} title="Countdown"
      aside={value && <Button size="sm" variant="secondary" onClick={onStop}>Stop</Button>}>
      {value && (
        <p className="mb-2 rounded-lg bg-slate-50 px-2 py-1.5 text-sm dark:bg-slate-800/60">
          <span className="font-bold tabular-nums">{formatRemaining(value.target - now)}</span>
          <span className="text-slate-500"> · {value.where === 'stage' ? 'stage display only' : value.where === 'both' ? 'screen and stage' : 'screen'}</span>
        </p>
      )}
      <Field label="Words above the time"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Service begins in" /></Field>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Select value={where} onChange={(e) => setWhere(e.target.value as Countdown['where'])} aria-label="Where to show it">
          <option value="screen">On the screen</option>
          <option value="stage">Stage display only</option>
          <option value="both">Screen and stage</option>
        </Select>
        <Select value={style} onChange={(e) => setStyle(e.target.value as Countdown['style'])} aria-label="Size on the screen" disabled={where === 'stage'}>
          <option value="full">Full screen</option>
          <option value="corner">Small, in the corner</option>
        </Select>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[2, 5, 10, 15, 30].map((m) => <Button key={m} size="sm" variant="secondary" onClick={() => startMinutes(m)}>{m} min</Button>)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); startMinutes(Number(minutes)); }}>
          <Input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes" className="min-w-0 flex-1" />
          <Button type="submit" size="md" variant="secondary">Min</Button>
        </form>
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); startUntil(); }}>
          <Input type="time" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Until this time" className="min-w-0 flex-1" />
          <Button type="submit" size="md" variant="secondary" disabled={!until}>Until</Button>
        </form>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- stage message

export function StageMessagePanel({ value, onSend, connected }: { value: string; onSend: (m: string) => void; connected: boolean }) {
  const [text, setText] = useState('');
  const quick = ['5 minutes left', 'Please wrap up', 'Time is up'];
  return (
    <Panel icon={<MessageSquareText className="h-4 w-4 text-royal-600" />} title="Message to the preacher"
      aside={value && <Button size="sm" variant="secondary" onClick={() => onSend('')}>Clear</Button>}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(''); } }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Shown on the stage display only" aria-label="Message" className="min-w-0 flex-1" maxLength={140} />
        <Button type="submit" disabled={!text.trim()}>Send</Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {quick.map((q) => <Button key={q} size="sm" variant="secondary" aria-pressed={value === q} onClick={() => onSend(value === q ? '' : q)}>{q}</Button>)}
      </div>
      {value && <p className="mt-2 truncate text-xs text-emerald-700 dark:text-emerald-400">Showing: {value}</p>}
      {!connected && <p className="mt-2 text-xs text-slate-500">The stage display is not open. Open it with <b>Stage display</b> at the top.</p>}
    </Panel>
  );
}
