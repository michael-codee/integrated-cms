import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import type { ScreenMode } from './channel';
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
export function SlideView({ slide, theme, mode = 'show', imageUrl, backgroundUrl, className, fill }: {
  slide: Slide | null; theme: Theme; mode?: ScreenMode; imageUrl?: string | null; backgroundUrl?: string | null; className?: string; fill?: boolean;
}) {
  const preset = presetById(theme.preset);
  const size = useMemo(() => (slide ? fitSize(slide, theme.font_scale || 1) : 6), [slide, theme.font_scale]);
  const left = theme.align === 'left';
  const textStyle: CSSProperties = {
    color: preset.text,
    textShadow: preset.shadow || backgroundUrl ? '0 0.35cqh 1.2cqh rgba(0,0,0,.65)' : undefined,
    textTransform: theme.uppercase ? 'uppercase' : undefined,
  };
  const showText = mode === 'show' && slide && slide.kind !== 'blank' && slide.kind !== 'image';
  return (
    <div className={clsx('relative overflow-hidden select-none', fill ? 'h-full w-full' : 'aspect-video w-full', className)}
      style={{ containerType: 'size', background: mode === 'black' ? '#000' : preset.background }}>
      {mode !== 'black' && backgroundUrl && (
        <>
          <img src={backgroundUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.38)' }} />
        </>
      )}
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
    </div>
  );
}
