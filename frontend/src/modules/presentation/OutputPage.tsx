import { useCallback, useEffect, useRef, useState } from 'react';
import { openChannel, type LiveState, type VideoProgress } from './channel';
import { startRelayReceiver } from './phoneCamera';
import { useLocalVideoUrl } from './localVideos';
import { SlideView, useObjectUrl } from './SlideView';

/**
 * The projector window. It shows only what the control desk on this computer sends; it holds no
 * church data itself and needs no sign-in. Click once to fill the screen.
 */
export default function OutputPage() {
  const [state, setState] = useState<LiveState | null>(null);
  const [cursor, setCursor] = useState(true);
  const seq = useRef(-1);
  const hideTimer = useRef<number>();
  const channel = useRef<ReturnType<typeof openChannel>>();

  useEffect(() => {
    document.title = 'Projector — RLWM';
    const ch = openChannel((m) => {
      if (m.type === 'state' && m.state.seq !== seq.current) {
        seq.current = m.state.seq;
        setState(m.state);
      }
    });
    channel.current = ch;
    ch.post({ type: 'hello', from: 'output' });
    const stopRelay = startRelayReceiver();
    const ping = window.setInterval(() => ch.post({ type: 'ping', from: 'output' }), 2000);
    return () => { window.clearInterval(ping); ch.close(); stopRelay(); };
  }, []);

  // Hide the mouse pointer when it is not moving.
  useEffect(() => {
    const move = () => {
      setCursor(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setCursor(false), 2000);
    };
    move();
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  const imageUrl = useObjectUrl(state?.slideImage);
  const backgroundUrl = useObjectUrl(state?.background);
  // Videos are read from this computer's storage, not sent through the channel.
  const videoUrl = useLocalVideoUrl(state?.slide?.kind === 'video' ? state.slide.video : null);
  const backgroundVideoUrl = useLocalVideoUrl(state?.backgroundVideo);
  const onVideoProgress = useCallback((progress: VideoProgress) => channel.current?.post({ type: 'video', progress }), []);
  const countdown = state?.countdown && state.countdown.where !== 'stage' ? state.countdown : null;
  const fullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="fixed inset-0 bg-black" style={{ cursor: cursor ? 'default' : 'none' }} onClick={fullscreen} onDoubleClick={() => document.exitFullscreen?.().catch(() => {})}>
      {state ? (
        <SlideView fill slide={state.slide} theme={state.theme} mode={state.mode} imageUrl={imageUrl} backgroundUrl={backgroundUrl}
          videoUrl={videoUrl} transport={state.video} camera={state.camera} backgroundVideoUrl={backgroundVideoUrl}
          lowerThird={state.lowerThird} countdown={countdown} muted={false} onVideoProgress={onVideoProgress} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-slate-300">
          <img src="/logo.webp" alt="" className="h-28 w-28 rounded-full bg-white object-contain p-2" />
          <p className="text-xl font-semibold">Projector screen</p>
          <p className="max-w-md text-sm text-slate-400">Move this window to the projector and click it to fill the screen. It shows whatever the control desk sends.</p>
        </div>
      )}
      {cursor && state && !document.fullscreenElement && (
        <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">Click to fill the screen · double-click to leave</p>
      )}
    </div>
  );
}
