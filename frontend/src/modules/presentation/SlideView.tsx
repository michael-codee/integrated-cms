import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { Webcam } from 'lucide-react';
import type { CameraSettings, Countdown, LowerThird, ScreenMode, VideoProgress, VideoTransport } from './channel';
import { BackgroundVideo, CameraFeed, CountdownView, LowerThirdView, SyncedVideo, VideoThumb } from './media';
import { presetById } from './themes';
import type { Slide, Theme } from './types';

/** Font size in container-height units, smaller as the words get longer. */
export function fitSize(slide: Slide, scale = 1) {
  const chars = slide.lines.join(' ').length + (slide.heading?.length || 0);
  const lines = slide.lines.length + (slide.heading ? 1 : 0);
  const byChars = 9 * Math.sqrt(160 / Math.max(160, chars));
  const byLines = 62 / Math.max(5, lines * 1.35);
  return Math.max(3, Math.min(byChars, byLines, 9.5)) * scale;
}

export function useObjectUrl(blob?: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/**
 * Draws one screen. Used at full size in the projector window and scaled down on the control
 * desk, so what the operator sees is exactly what the congregation sees. Sizes use container
 * units, so the layout follows whatever box it is put in.
 */
export interface LiveExtras {
  /** Object URL of the slide's local video. */
  videoUrl?: string | null;
  /** How the video should be playing; without it a video slide shows a still. */
  transport?: VideoTransport | null;
  /** Live camera settings; without them a camera slide shows a placeholder. */
  camera?: CameraSettings;
  backgroundVideoUrl?: string | null;
  lowerThird?: LowerThird | null;
  countdown?: Countdown | null;
  /** Previews are silent; only the projector plays sound. */
  muted?: boolean;
  onVideoProgress?: (p: VideoProgress) => void;
  onCameraError?: (message: string) => void;
}

export function SlideView({ slide, theme, mode = 'show', imageUrl, backgroundUrl, className, fill, videoUrl, transport, camera, backgroundVideoUrl, lowerThird, countdown, muted = true, onVideoProgress, onCameraError }: {
  slide: Slide | null; theme: Theme; mode?: ScreenMode; imageUrl?: string | null; backgroundUrl?: string | null; className?: string; fill?: boolean;
} & LiveExtras) {
  const preset = presetById(theme.preset);
  const size = useMemo(() => (slide ? fitSize(slide, theme.font_scale || 1) : 6), [slide, theme.font_scale]);
  const left = theme.align === 'left';
  const textStyle: CSSProperties = {
    color: preset.text,
    textShadow: preset.shadow || backgroundUrl || backgroundVideoUrl ? '0 0.35cqh 1.2cqh rgba(0,0,0,.65)' : undefined,
    textTransform: theme.uppercase ? 'uppercase' : undefined,
  };
  const showText = mode === 'show' && slide && (slide.kind === 'song' || slide.kind === 'scripture' || slide.kind === 'text');
  const fullPicture = slide?.kind === 'video' || slide?.kind === 'camera';
  const showContent = mode === 'show';
  return (
    <div className={clsx('relative overflow-hidden select-none', fill ? 'h-full w-full' : 'aspect-video w-full', className)}
      style={{ containerType: 'size', background: mode === 'black' ? '#000' : preset.background }}>
      {mode !== 'black' && backgroundVideoUrl ? (
        <>
          <BackgroundVideo url={backgroundVideoUrl} />
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.38)' }} />
        </>
      ) : mode !== 'black' && backgroundUrl && (
        <>
          <img src={backgroundUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.38)' }} />
        </>
      )}
      {/* Video and camera stay running while hidden (Black, Clear) so they come back without a pause. */}
      {slide?.kind === 'video' && videoUrl && (transport && transport.id === slide.video
        ? <SyncedVideo url={videoUrl} transport={transport} muted={muted} onProgress={onVideoProgress} hidden={!showContent} />
        : showContent && <VideoThumb url={videoUrl} />)}
      {slide?.kind === 'video' && !videoUrl && showContent && (
        <div className="absolute inset-0 flex items-center justify-center bg-black px-[6cqw] text-center font-medium text-white/80" style={{ fontSize: '3.6cqh' }}>
          This video is not on this computer. Add it under Videos.
        </div>
      )}
      {slide?.kind === 'camera' && (camera
        ? <CameraFeed settings={camera} muted={muted} hidden={!showContent} onError={onCameraError} />
        : showContent && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2cqh] bg-black text-white/80">
            <Webcam style={{ width: '16cqh', height: '16cqh' }} strokeWidth={1.5} />
            <span className="font-semibold" style={{ fontSize: '5cqh' }}>Live camera</span>
          </div>
        ))}
      {mode === 'show' && slide?.kind === 'image' && imageUrl && (
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full bg-black object-contain" draggable={false} />
      )}
      {mode === 'logo' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <img src="/logo.webp" alt="" className="h-[45cqh] w-[45cqh] rounded-full bg-white/95 object-contain p-[1.5cqh] shadow-2xl" draggable={false} />
        </div>
      )}
      {showText && (
        <div className={clsx('absolute inset-0 flex flex-col justify-center px-[6cqw] py-[7cqh]', left ? 'items-start text-left' : 'items-center text-center')} style={textStyle}>
          {slide.heading && (
            <p className="mb-[2.5cqh] font-bold leading-tight" style={{ fontSize: `${size * 1.15}cqh`, color: preset.accent }}>{slide.heading}</p>
          )}
          <div className={clsx('font-semibold leading-[1.28]', slide.kind === 'scripture' && 'font-serif font-medium')} style={{ fontSize: `${size}cqh` }}>
            {slide.lines.map((l, i) => <p key={i} className="[text-wrap:balance]">{l}</p>)}
          </div>
        </div>
      )}
      {showText && slide.footer && theme.show_reference !== false && (
        <p className="absolute bottom-[3.5cqh] left-0 right-0 px-[6cqw] text-center font-semibold tracking-wide"
          style={{ fontSize: '3.4cqh', color: preset.accent, textShadow: textStyle.textShadow }}>{slide.footer}</p>
      )}
      {mode !== 'black' && lowerThird && lowerThird.name && <LowerThirdView lt={lowerThird} accent={preset.accent === '#1d3fa6' ? '#f6c34a' : preset.accent} />}
      {mode !== 'black' && countdown && <CountdownView countdown={countdown} background={fullPicture || !backgroundUrl ? preset.background : `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), center / cover no-repeat url(${backgroundUrl})`} text={preset.text} accent={preset.accent} />}
    </div>
  );
}
