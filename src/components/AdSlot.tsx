'use client';
import { useEffect } from 'react';
import { ADS, type AdKey } from '@/config/ads';

export default function AdSlot({ slot, className = '' }: { slot: AdKey; className?: string }) {
  const cfg = ADS[slot];
  useEffect(() => {
    if (cfg.kind === 'adsense') {
      try { ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({}); } catch {}
    }
  }, [cfg.kind]);

  const box = `relative mx-auto w-full overflow-hidden ${className}`;
  const style = { minHeight: cfg.minHeight };

  if (cfg.kind === 'none') {
    if (process.env.NODE_ENV === 'production') return null;
    return <div className={`${box} grid place-items-center rounded-md border border-dashed border-line text-xs text-muted`} style={style}>Ruang iklan: {slot}</div>;
  }
  if (cfg.kind === 'adsense') {
    return (
      <div className={box} style={style} aria-label="Iklan">
        <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client={process.env.NEXT_PUBLIC_ADSENSE_CLIENT}
          data-ad-slot={cfg.slotId} data-ad-format="auto" data-full-width-responsive="true" />
      </div>
    );
  }
  const src = cfg.src ? (cfg.src.startsWith('//') ? 'https:' + cfg.src : cfg.src) : '';
  const doc = `<!doctype html><html><body style="margin:0;display:flex;justify-content:center">${cfg.inline ? `<script>${cfg.inline}</script>` : ''}${src ? `<script src="${src}"></script>` : ''}${cfg.html ?? ''}</body></html>`;
  return (
    <div className={box} style={style} aria-label="Iklan">
      <iframe title="Iklan" srcDoc={doc} loading="lazy" scrolling="no" className="w-full border-0" style={{ height: cfg.minHeight }}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin" />
    </div>
  );
}
