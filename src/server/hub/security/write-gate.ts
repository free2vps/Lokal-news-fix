/**
 * Gerbang tulis Hub — satu tempat, bukan 11 salinan.
 *
 * Sebelumnya setiap API menulis sendiri syarat:
 *     VERCEL_ENV === 'preview' && VERCEL_GIT_COMMIT_REF === 'webhub'
 * sehingga Hub MUSTAHIL bekerja di Production: semua dijawab 403.
 *
 * Sekarang satu saklar: HUB_WRITE_TARGET
 *   (kosong)      → hanya Preview branch webhub   ← bawaan, aman, sama seperti dulu
 *   'preview'     → sama dengan di atas
 *   'production'  → hanya Production
 *   'both'        → keduanya
 *
 * Production tetap butuh satu syarat tambahan: deployment-nya memang Production
 * (VERCEL_ENV==='production'), jadi pengujian di preview tidak ikut mengubah Production.
 */
export type WriteEnv = Record<string, string | undefined>;

export function writeTarget(env: WriteEnv = process.env): 'preview' | 'production' | 'both' {
  const raw = String(env.HUB_WRITE_TARGET ?? '').trim().toLowerCase();
  return raw === 'production' || raw === 'both' ? raw : 'preview';
}

export function writesAllowed(env: WriteEnv = process.env): boolean {
  const target = writeTarget(env);
  const isPreviewBranch = env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'webhub';
  const isProduction = env.VERCEL_ENV === 'production';
  if (target === 'both') return isPreviewBranch || isProduction;
  if (target === 'production') return isProduction;
  return isPreviewBranch;
}

/** Pesan galat yang menyebutkan SAAT INI berlaku di mana, bukan sekadar "dibatasi". */
export function writeGateMessage(env: WriteEnv = process.env): string {
  const target = writeTarget(env);
  const where = env.VERCEL_ENV === 'production' ? 'Production' : env.VERCEL_ENV === 'preview' ? 'Preview' : 'lokal';
  if (target === 'production') return `Perubahan hanya berlaku di Production, sedangkan permintaan ini datang dari ${where}.`;
  if (target === 'both') return `Perubahan berlaku di Production dan Preview branch webhub; permintaan ini dari ${where}.`;
  return `Perubahan dibatasi Preview branch webhub (sekarang: ${where}). Set HUB_WRITE_TARGET=production atau both untuk mengizinkan Production.`;
}
