/**
 * Resolusi tujuan terbit (tabel `articles` situs).
 *
 * Urutan: variabel khusus Hub dulu (`HUB_WEBSITE_*`), lalu variabel situs yang sudah ada
 * (`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) sebagai cadangan.
 * Cadangan dipakai karena Hub dan situs berada pada project Supabase yang sama
 * (`public.articles`), sehingga admin tidak perlu menyalin rahasia apa pun.
 * Nilai rahasia tidak pernah keluar dari backend: hanya dipakai untuk header permintaan.
 */
export type DeliveryTarget = {url: string; key: string; source: 'dedicated' | 'fallback' | 'none'};

export function resolveDeliveryTarget(env: NodeJS.ProcessEnv = process.env): DeliveryTarget {
  const dedicatedUrl = env.HUB_WEBSITE_SUPABASE_URL;
  const dedicatedKey = env.HUB_WEBSITE_SERVICE_ROLE_KEY;
  if (dedicatedUrl && dedicatedKey) return {url: dedicatedUrl, key: dedicatedKey, source: 'dedicated'};
  const siteUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const siteKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (siteUrl && siteKey) return {url: siteUrl, key: siteKey, source: 'fallback'};
  return {url: '', key: '', source: 'none'};
}

export function deliveryReady(env: NodeJS.ProcessEnv = process.env) {
  return resolveDeliveryTarget(env).source !== 'none';
}
