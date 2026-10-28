import type {Client} from '@libsql/client';
import {getPreferences} from './operations';
const messages:Record<string,string>={
 ACCESS_NOT_CONFIRMED:'Izin akses manual belum diaktifkan. Buka Pengaturan, tinjau ketentuan sumber/hosting, centang izin yang sesuai, lalu simpan.',
 JOB_COOLDOWN:'Pekerjaan masih berjalan atau dalam jeda 10 menit. Tunggu sebelum mencoba lagi.',
 ROBOTS_UNAVAILABLE:'Aturan robots.txt belum dapat diperiksa. Akses dihentikan tanpa melewati pembatasan.',
 ROBOTS_BLOCKED:'Aturan robots.txt sumber tidak mengizinkan akses ini. Jangan melewati pembatasan.',
 NETWORK_BLOCKED:'Alamat atau koneksi diblokir oleh pengaman jaringan.',
 NETWORK_TIMEOUT:'Waktu koneksi ke sumber habis. Coba lagi setelah jeda.',
 X_ONE_HOUR_UNAVAILABLE:'Bagian berlabel “1 hour ago” yang valid tidak ditemukan. Periode lain tidak digunakan.',
 PLAYLIST_UNAVAILABLE:'Feed playlist belum tersedia, identitasnya tidak cocok, atau tidak berisi video valid.',
 RSS_INVALID:'Respons sumber belum dapat divalidasi sebagai feed RSS/Atom.',
 SOURCE_NOT_READY:'Sumber belum siap. Validasi feed dan konfirmasikan izin metadata sebelum mengaktifkannya.',
 RESPONSE_TOO_LARGE:'Respons sumber melampaui batas ukuran aman.',
 SCHEMA_NOT_READY:'Tabel fitur belum siap. Jalankan Siapkan skema Preview; tidak perlu impor ulang database.',
 SYNC_FAILED:'Pembaruan tidak berhasil. Periksa status sumber dan log; data valid terakhir dipertahankan.'
};
export function workspaceFailure(raw:string){
 const code=Object.hasOwn(messages,raw)?raw:/^HTTP_\d{3}$/.test(raw)?raw:'SYNC_FAILED';
 const error=messages[code]||`Sumber merespons HTTP ${code.slice(5)}. Izin aplikasi tidak membatalkan pembatasan dari sumber.`;
 return {code,error,dataPreserved:true};
}
/** No network request, no mutation, no archive/master access. Unknown permission is never treated as consent. */
export async function accessStatus(db:Client){
 let preferences:Awaited<ReturnType<typeof getPreferences>>|null=null;
 let schemaReady=false;
 try{const tables=(await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('hub_preferences_v3','hub_logs_v3','hub_datasets_v3','hub_jobs_v3')")).rows;schemaReady=tables.length===4;if(tables.some(r=>r.name==='hub_preferences_v3'))preferences=await getPreferences(db);}catch{}
 const result:Record<string,unknown>={schemaReady};
 for(const kind of ['x','youtube'] as const){
  let lastAttempt:null|{status:string;startedAt:string;finishedAt:string|null;explanation:string}=null;
  try{const row=(await db.execute({sql:'SELECT status,started_at,finished_at,message FROM hub_logs_v3 WHERE kind=? ORDER BY started_at DESC,id DESC LIMIT 1',args:[kind]})).rows[0];if(row){const status=String(row.status);lastAttempt={status,startedAt:String(row.started_at),finishedAt:row.finished_at?String(row.finished_at):null,explanation:status==='ERROR'?workspaceFailure(String(row.message)).error:status==='RUNNING'?'Proses tercatat berjalan; belum ada hasil selesai.':status==='PARTIAL'?'Pembaruan selesai dengan data sebagian; bukan jaminan daftar lengkap.':'Pembaruan terakhir tercatat selesai.'};}}catch{}
  result[kind]={allowed:preferences?(kind==='x'?preferences.allowX===true:preferences.allowYoutube===true):null,lastAttempt};
 }
 return result;
}
