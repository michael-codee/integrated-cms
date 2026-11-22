import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { openChannel, type LiveState, type VideoProgress } from './channel';
import { formatTime } from './localVideos';
import { formatRemaining, useNow } from './media';
import type { Slide } from './types';

/**
 * The preacher's stage display: a screen facing the pulpit that shows what is on the projector
 * now, what comes next, the notes for this part of the service, the time, the countdown and any
 * message from the media desk. Like the projector window it holds no church data and needs no sign-in.
 */
export default function StagePage() {
  const [state, setState] = useState<LiveState | null>(null);
  const [video, setVideo] = useState<VideoProgress | null>(null);
  const seq = useRef(-1);
  const now = useNow(500);

  useEffect(() => {
    document.title = 'Stage display — RLWM';
    const ch = openChannel((m) => {
      if (m.type === 'state' && m.state.seq !== seq.current) { seq.current = m.state.seq; setState(m.state); }
      if (m.type === 'video') setVideo(m.progress);
    });
    ch.post({ type: 'hello', from: 'stage' });
    const ping = window.setInterval(() => ch.post({ type: 'ping', from: 'stage' }), 2000);
    return () => { window.clearInterval(ping); ch.close(); };
  }, []);

  const fullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const stage = state?.stage;
  const countdown = state?.countdown && state.countdown.where !== 'screen' ? state.countdown : null;
  const remaining = countdown ? countdown.target - now : 0;
  const clock = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const liveVideo = state?.slide?.kind === 'video' && video && video.id === state.slide.video ? video : null;

  return (
    <div className="fixed inset-0 flex flex-col gap-[1.5vh] bg-black p-[2vh] text-white" onClick={fullscreen} onDoubleClick={() => document.exitFullscreen?.().catch(() => {})}>
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-[2vh] font-semibold uppercase tracking-widest text-red-400">
            {!state ? 'Waiting for the control desk' : state.mode === 'black' ? 'Screen is black' : state.mode === 'logo' ? 'Showing the logo' : state.mode === 'clear' ? 'Words cleared' : 'On screen now'}
          </p>
          <p className="truncate text-[3.2vh] font-semibold text-slate-200">{stage?.title || ' '}</p>
        </div>
        <div className="flex shrink-0 items-start gap-6 text-right">
          {countdown && (
            <div>
              <p className="max-w-[30vw] truncate text-[2vh] font-semibold text-amber-300">{countdown.label || 'Time left'}</p>
              <p className={clsx('text-[9vh] font-bold leading-none tabular-nums', remaining <= 0 ? 'text-red-500' : remaining < 60000 ? 'text-amber-300' : 'text-white')}>
                {remaining <= 0 ? `-${formatRemaining(-remaining)}` : formatRemaining(remaining)}
              </p>
            </div>
          )}
          <div>
            <p className="text-[2vh] font-semibold text-slate-400">Time</p>
            <p className="text-[9vh] font-bold leading-none tabular-nums">{clock}</p>
          </div>
        </div>
      </header>

      {stage?.message && (
        <div className="animate-stage-flash rounded-xl bg-amber-400 px-[2vw] py-[1.5vh] text-center text-[5vh] font-bold leading-tight text-black">{stage.message}</div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-[1.5vh]">
        <Panel title="Now">
          <SlideText slide={state?.mode === 'black' ? null : state?.slide || null} size="large" video={liveVideo} />
        </Panel>
        <div className="grid min-h-0 grid-rows-[1fr_1fr] gap-[1.5vh]">
          <Panel title={stage?.nextTitle ? `Next · ${stage.nextTitle}` : 'Next'}>
            <SlideText slide={stage?.next || null} size="small" empty="End of the order of service" />
          </Panel>
          <Panel title="Notes">
            {stage?.notes
              ? <p className="whitespace-pre-wrap text-[3vh] leading-snug text-amber-100">{stage.notes}</p>
              : <p className="text-[2.2vh] text-slate-600">No notes for this part.</p>}
          </Panel>
        </div>
      </main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-slate-900 p-[2vh] ring-1 ring-slate-800">
      <p className="mb-[1vh] truncate text-[2vh] font-semibold uppercase tracking-widest text-slate-500">{title}</p>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

function SlideText({ slide, size, empty = '', video }: { slide: Slide | null; size: 'large' | 'small'; empty?: string; video?: VideoProgress | null }) {
  const big = size === 'large';
  if (!slide) return <p className="text-[2.4vh] text-slate-600">{empty}</p>;
  if (slide.kind === 'video') {
    return (
      <div>
        <p className={clsx('font-semibold', big ? 'text-[5vh]' : 'text-[3.2vh]')}>Video · {slide.label}</p>
        {video && video.duration > 0 && (
          <p className={clsx('mt-[1vh] font-bold tabular-nums text-sky-300', big ? 'text-[7vh]' : 'text-[3.5vh]')}>
            {video.ended ? 'Finished' : `${formatTime(video.duration - video.time)} left`}
          </p>
        )}
      </div>
    );
  }
  if (slide.kind === 'camera') return <p className={clsx('font-semibold text-sky-300', big ? 'text-[5vh]' : 'text-[3.2vh]')}>Live camera</p>;
  if (slide.kind === 'image') return <p className={clsx('font-semibold', big ? 'text-[5vh]' : 'text-[3.2vh]')}>Picture{slide.label ? ` · ${slide.label}` : ''}</p>;
  if (slide.kind === 'blank') return <p className={clsx('font-semibold text-slate-500', big ? 'text-[5vh]' : 'text-[3.2vh]')}>Blank screen</p>;
  return (
    <div className={clsx('leading-snug', big ? 'text-[5.2vh]' : 'text-[3vh] text-slate-300')}>
      {slide.heading && <p className="mb-[1vh] font-bold text-amber-300">{slide.heading}</p>}
      {slide.lines.map((l, i) => <p key={i} className={slide.kind === 'scripture' ? 'font-serif' : 'font-semibold'}>{l}</p>)}
      {slide.footer && <p className={clsx('mt-[1.5vh] font-semibold text-slate-400', big ? 'text-[2.6vh]' : 'text-[2vh]')}>{slide.footer}</p>}
    </div>
  );
}
