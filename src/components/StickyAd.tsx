'use client';
import { useState } from 'react';
import AdSlot from './AdSlot';
import { ADS } from '@/config/ads';

export default function StickyAd() {
  const [open, setOpen] = useState(true);
  if (!open || (ADS.sticky.kind === 'none' && process.env.NODE_ENV === 'production')) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 p-1 backdrop-blur md:hidden">
      <button onClick={() => setOpen(false)} aria-label="Tutup iklan" className="absolute -top-7 right-2 rounded-t-md border border-b-0 border-line bg-surface px-2 py-0.5 text-xs text-muted">Tutup</button>
      <AdSlot slot="sticky" />
    </div>
  );
}
