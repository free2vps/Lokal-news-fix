import { supabaseAdmin } from '../supabase';
import { mapHubTrends } from './mapping';
export const hubEnabled = () => process.env.CONTENT_HUB_ENABLED === 'true';
export async function readHubCache(): Promise<Record<string,{payload:unknown;importedAt:string}>> {
  const {data,error}=await supabaseAdmin().from('content_hub_cache').select('key,payload,imported_at');
  if(error) throw new Error('Snapshot Content Hub belum tersedia; periksa migrasi Supabase');
  return Object.fromEntries((data??[]).map(row=>[row.key,{payload:row.payload,importedAt:row.imported_at}]));
}
/**
 * Snapshot tren dari cache Hub.
 *
 * Sejak endpoint impor Hub dinonaktifkan, cache ini TIDAK pernah diperbarui lagi — isinya bisa
 * berumur berhari-hari dan ditandai "data lama" di panel. Karena itu snapshot yang lebih tua dari
 * `maxAgeHours` diabaikan, supaya baris tabel `trending` (yang ditulis langsung oleh Hub) yang
 * dipakai, bukan arsip basi.
 */
export async function cachedHubTrends(maxAgeHours=6) {
  const cache=await readHubCache();
  const pick=(key:string)=>{
    const row=cache[key]; if(!row)return null;
    const at=Date.parse(row.importedAt); if(!Number.isFinite(at))return null;
    return Date.now()-at<=maxAgeHours*3600000?row.payload:null;
  };
  return mapHubTrends(pick('x-trends'),pick('youtube-music'));
}
