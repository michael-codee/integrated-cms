/**
 * Moving pictures on the screens: local video files, the live camera / HDMI capture feed, and the
 * overlays drawn on top of anything (lower-third captions, countdown).
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { expectedPosition, type CameraSettings, type Countdown, type LowerThird, type VideoProgress, type VideoTransport } from './channel';

// ---------------------------------------------------------------- time

export function useNow(interval = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(t);
  }, [interval]);
  return now;
}

/** Whole seconds left, counted up so 4.2 s shows as 0:05 and the screen reaches 0:00 on time. */
export function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- video file

/**
 * Plays a local video and keeps it where the transport says it should be. The projector window
 * plays it with sound; the control desk shows the same picture muted.
 */
export function SyncedVideo({ url, transport, muted, onProgress, className, hidden }: {
  url: string; transport: VideoTransport; muted: boolean; onProgress?: (p: VideoProgress) => void; className?: string; hidden?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const blockedSound = useRef(false);
  const report = useRef(onProgress);
  report.current = onProgress;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const sync = () => {
      const dur = v.duration;
      const want = expectedPosition(transport, dur);
      const finished = !transport.loop && Number.isFinite(dur) && dur > 0 && want >= dur - 0.05;
      let drift = Math.abs(v.currentTime - want);
      if (transport.loop && Number.isFinite(dur) && dur > 0) drift = Math.min(drift, dur - drift);
      if (drift > 0.75 && !(finished && v.ended) && v.readyState >= 1) {
        try { v.currentTime = want; } catch { /* not seekable yet */ }
      }
      v.loop = transport.loop;
      v.volume = Math.min(1, Math.max(0, transport.volume));
      v.muted = muted || blockedSound.current;
      if (transport.playing && !finished && v.paused) {
        v.play().catch((e: Error) => {
          // Browsers refuse sound until someone has clicked the window. Play silently rather than not at all.
          if (e.name === 'NotAllowedError' && !v.muted) {
            blockedSound.current = true;
            v.muted = true;
            v.play().catch(() => {});
          }
        });
      } else if ((!transport.playing || finished) && !v.paused) v.pause();
    };
    sync();
    const t = window.setInterval(sync, 1000);
    v.addEventListener('loadedmetadata', sync);
    // The first click in the window allows sound.
    const unblock = () => {
      if (blockedSound.current) { blockedSound.current = false; v.muted = muted; if (transport.playing) v.play().catch(() => {}); }
    };
    window.addEventListener('pointerdown', unblock);
    return () => { window.clearInterval(t); v.removeEventListener('loadedmetadata', sync); window.removeEventListener('pointerdown', unblock); };
  }, [transport, muted, url]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let last = 0;
    const send = (force = false) => {
      const now = Date.now();
      if (!force && now - last < 400) return;
      last = now;
      report.current?.({ id: transport.id, time: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0, ended: v.ended, muted: blockedSound.current && !muted });
    };
    const onTime = () => send();
    const onState = () => send(true);
    v.addEventListener('timeupdate', onTime);
    for (const ev of ['ended', 'pause', 'play', 'loadedmetadata', 'volumechange']) v.addEventListener(ev, onState);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      for (const ev of ['ended', 'pause', 'play', 'loadedmetadata', 'volumechange']) v.removeEventListener(ev, onState);
    };
  }, [transport.id, muted]);

  return (
    <video ref={ref} src={url} playsInline preload="auto" muted={muted}
      className={clsx('absolute inset-0 h-full w-full bg-black object-contain', className)} style={hidden ? { visibility: 'hidden' } : undefined} />
  );
}

/** A still from a local video for the slide grid (no playback). */
export function VideoThumb({ url }: { url: string }) {
  return <video src={`${url}#t=1`} preload="metadata" muted playsInline className="absolute inset-0 h-full w-full bg-black object-contain" />;
}

/** A video looping silently behind the words. */
export function BackgroundVideo({ url }: { url: string }) {
  return <video src={url} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" />;
}

// ---------------------------------------------------------------- live camera

export { cameraBlockedByPolicy } from '@/lib/featurePolicy';

export function cameraErrorMessage(e: unknown) {
  const name = (e as Error)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The camera is blocked. Allow the camera for this site (the camera sign in the address bar), then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'The chosen camera or capture device is not connected.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Another program is using the camera (for example OBS or the Camera app). Close it and try again.';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser cannot use cameras here. Use Chrome or Edge.';
  return (e as Error)?.message || 'The camera could not be opened.';
}

export interface CameraDevice { id: string; label: string }

/** Lists cameras and capture devices. With `ask`, asks for permission first so their names show. */
export async function findCameras(ask: boolean): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) throw new Error('This browser cannot use cameras here. Use Chrome or Edge.');
  if (ask) {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput' && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** The device id for these settings in this window: the saved id, else the device with the saved name. */
async function cameraId(settings: CameraSettings) {
  if (!settings.deviceId) return null;
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (cams.some((d) => d.deviceId === settings.deviceId)) return settings.deviceId;
    const byName = settings.label && cams.find((d) => d.label === settings.label);
    return byName ? byName.deviceId : settings.deviceId;
  } catch { return settings.deviceId; }
}

async function openCamera(saved: CameraSettings, withSound: boolean) {
  const settings = { ...saved, deviceId: await cameraId(saved) };
  // Same size request everywhere, so the desk preview and the projector can share the device.
  const video: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  if (settings.deviceId) video.deviceId = { exact: settings.deviceId };
  let audio: MediaTrackConstraints | false = false;
  if (withSound) {
    // An HDMI capture card shows up as a camera and a microphone with the same group id: take its sound.
    audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cam = all.find((d) => d.kind === 'videoinput' && d.deviceId === settings.deviceId);
      const mic = cam && all.find((d) => d.kind === 'audioinput' && d.groupId && d.groupId === cam.groupId);
      if (mic) audio.deviceId = { exact: mic.deviceId };
    } catch { /* default microphone */ }
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio });
  } catch (e) {
    // The saved device is not found under that id here: prefer it, but take any camera rather than none.
    if ((e as Error).name !== 'OverconstrainedError' || !settings.deviceId) throw e;
    return navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: settings.deviceId }, audio });
  }
}

export function CameraFeed({ settings, muted, hidden, onError }: { settings: CameraSettings; muted: boolean; hidden?: boolean; onError?: (message: string) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const withSound = settings.audio && !muted;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) { setError(cameraErrorMessage(null)); return; }
    openCamera(settings, withSound).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      const v = ref.current;
      if (v) { v.srcObject = s; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); }
      // A capture card unplugged during service ends the track.
      s.getVideoTracks()[0]?.addEventListener('ended', () => setError('The camera or capture device was disconnected.'));
    }, (e) => { if (!cancelled) setError(cameraErrorMessage(e)); });
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [settings.deviceId, settings.label, withSound]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (error) onError?.(error); }, [error, onError]);

  return (
    <div className="absolute inset-0 bg-black" style={hidden ? { visibility: 'hidden' } : undefined}>
      <video ref={ref} playsInline muted={!withSound} className="h-full w-full object-contain" />
      {/* Errors show on the desk preview only, never to the congregation. */}
      {error && muted && <p className="absolute inset-x-[6cqw] top-1/2 -translate-y-1/2 text-center text-[3.2cqh] font-medium text-white/80">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- overlays

export function LowerThirdView({ lt, accent }: { lt: LowerThird; accent: string }) {
  return (
    <div key={`${lt.name}|${lt.title}`} className="absolute bottom-[9cqh] left-[5cqw] max-w-[70cqw] animate-lower-third">
      <div className="rounded-r-[1cqh] border-l-[0.9cqh] py-[1.6cqh] pl-[2.4cqw] pr-[3.2cqw] shadow-2xl"
        style={{ borderColor: accent, background: 'linear-gradient(90deg, rgba(8,18,52,.94), rgba(8,18,52,.82))' }}>
        <p className="font-bold leading-tight text-white" style={{ fontSize: '5cqh' }}>{lt.name}</p>
        {lt.title && <p className="mt-[0.4cqh] font-semibold leading-tight" style={{ fontSize: '3.1cqh', color: accent }}>{lt.title}</p>}
      </div>
    </div>
  );
}

export function CountdownView({ countdown, background, text, accent }: { countdown: Countdown; background: string; text: string; accent: string }) {
  const now = useNow(200);
  const left = formatRemaining(countdown.target - now);
  if (countdown.style === 'corner') {
    return (
      <div className="absolute right-[3cqw] top-[3.5cqh] rounded-[1.2cqh] bg-black/70 px-[2cqw] py-[1.2cqh] text-right text-white shadow-xl">
        {countdown.label && <p className="font-semibold" style={{ fontSize: '2.4cqh', color: accent }}>{countdown.label}</p>}
        <p className="font-bold tabular-nums leading-none" style={{ fontSize: '7cqh' }}>{left}</p>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center" style={{ background, color: text }}>
      {countdown.label && <p className="mb-[3cqh] px-[6cqw] font-semibold" style={{ fontSize: '6cqh', color: accent }}>{countdown.label}</p>}
      <p className="font-bold tabular-nums leading-none" style={{ fontSize: '26cqh', textShadow: '0 0.5cqh 2cqh rgba(0,0,0,.45)' }}>{left}</p>
    </div>
  );
}
