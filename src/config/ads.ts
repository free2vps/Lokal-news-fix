// Isi kode iklan dari jaringan Anda. Slot dengan kind "none" tidak tampil di production.
export type AdKey = 'header' | 'inArticle' | 'sidebar' | 'sticky';
export type AdConfig = { minHeight: number } & (
  | { kind: 'none' }
  | { kind: 'adsense'; slotId: string }                              // butuh NEXT_PUBLIC_ADSENSE_CLIENT
  | { kind: 'script'; src?: string; inline?: string; html?: string } // Adsterra / Monetag / MGID (dirender di iframe terisolasi)
);

export const ADS: Record<AdKey, AdConfig> = {
  header:    { kind: 'none', minHeight: 90 },
  inArticle: { kind: 'none', minHeight: 250 },
  sidebar:   { kind: 'none', minHeight: 250 },
  sticky:    { kind: 'none', minHeight: 60 },
};

/* Contoh Adsterra banner:
header: { kind: 'script', minHeight: 90,
  inline: "atOptions = {'key':'KEY_ANDA','format':'iframe','height':90,'width':728,'params':{}};",
  src: '//www.highperformanceformat.com/KEY_ANDA/invoke.js' },
Contoh AdSense:
sidebar: { kind: 'adsense', slotId: '1234567890', minHeight: 250 }, */
