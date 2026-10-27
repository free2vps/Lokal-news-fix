import { supabaseAdmin } from '../supabase';
import { mapHubTrends } from './mapping';
export const hubEnabled = () => process.env.CONTENT_HUB_ENABLED === 'true';
export async function readHubCache(): Promise<Record<string,{payload:unknown;importedAt:string}>> {
  const {data,error}=await supabaseAdmin().from('content_hub_cache').select('key,payload,imported_at');
  if(error) throw new Error('Snapshot Content Hub belum tersedia; periksa migrasi Supabase');
  return Object.fromEntries((data??[]).map(row=>[row.key,{payload:row.payload,importedAt:row.imported_at}]));
}
export async function cachedHubTrends() {
  const cache=await readHubCache();
  return mapHubTrends(cache['x-trends']?.payload,cache['youtube-music']?.payload);
}
