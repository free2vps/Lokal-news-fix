import {randomUUID} from 'node:crypto';
import type {Client} from '@libsql/client';
import {prepareAutoEditor, prepareDependencies, setAutoEditor, saveAutoConfig, readAutoConfig} from './auto-editor';
import {issueAutomationToken, prepareAutomationSchema} from './automation';
import {issueSocialToken, prepareSocialSchema} from './social-pull';
import {setSourceRights} from './sources';

/**
 * "Sekali Atur" — satu tombol untuk menyiapkan dan mengaktifkan seluruh alur.
 *
 * Tetap menjaga hal yang tidak boleh dilonggarkan:
 * - keputusan hak tetap dinyatakan pemilik (satu pernyataan untuk daftar sumber yang ditampilkan),
 * - hanya sumber RSS yang feed-nya terverifikasi dan aktif yang disertakan,
 * - satu frasa konfirmasi, bukan sebelas.
 *
 * Tidak mengarang data, tidak menulis ke database situs, tidak menyentuh Production.
 */
export const QUICK_SETUP_CONFIRM = 'SIAPKAN SEMUA';
export type QuickRights = 'permission_confirmed' | 'metadata_only';

export type QuickSetupResult = {
  at: string;
  tables: {name: string; ok: boolean; detail: string}[];
  sources: {included: {id: string; name: string; rights: string}[]; skipped: {id: string; name: string; reason: string}[]};
  editor: {enabled: boolean; minTier: string; windowHours: number; maxPerRun: number; maxPerDay: number};
  tokens: {automation?: string; social?: string};
  next: string[];
};

export async function quickSetup(
  db: Client,
  input: {rights?: unknown; enable?: unknown; issueTokens?: unknown; minTier?: unknown; windowHours?: unknown; actor: string; confirm: unknown; now?: number},
): Promise<QuickSetupResult> {
  if (String(input.confirm || '') !== QUICK_SETUP_CONFIRM) throw Error('CONFIRM_REQUIRED');
  const now = input.now ?? Date.now();
  const at = new Date(now).toISOString();
  const rights: QuickRights = input.rights === 'metadata_only' ? 'metadata_only' : 'permission_confirmed';

  // 1. Semua tabel: redaktur + pendukung.
  const deps = await prepareDependencies(db);
  const auto = await prepareAutoEditor(db);
  const tables = [...(auto.dependencies || deps)];
  for (const [name, fn] of [['automation', () => prepareAutomationSchema(db)], ['social_tokens', () => prepareSocialSchema(db)]] as [string, () => Promise<unknown>][]) {
    try { await fn(); tables.push({name, ok: true, detail: 'siap'}); }
    catch (e) { tables.push({name, ok: false, detail: (e as Error).message.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)}); }
  }
  tables.push({name: 'auto_editor', ok: true, detail: 'siap'});

  // 2. Sumber: hanya RSS yang feed-nya terverifikasi. Sumber lain dilaporkan, tidak disentuh.
  const rows = (await db.execute("SELECT id,name,is_active,discovered_type,feed_url,rights_status,source_kind FROM hub_sources ORDER BY name")).rows;
  const included: {id: string; name: string; rights: string}[] = [];
  const skipped: {id: string; name: string; reason: string}[] = [];
  for (const r of rows) {
    const id = String(r.id), name = String(r.name || '');
    if (String(r.source_kind) !== 'rss') { skipped.push({id, name, reason: 'bukan_rss'}); continue; }
    if (!r.feed_url) { skipped.push({id, name, reason: 'feed_kosong'}); continue; }
    if (String(r.discovered_type) !== 'rss') { skipped.push({id, name, reason: 'feed_belum_terverifikasi'}); continue; }
    // Aktifkan bila belum aktif, lalu nyatakan haknya dalam satu langkah.
    await db.execute({sql: 'UPDATE hub_sources SET is_active=1,updated_at=? WHERE id=?', args: [at, id]});
    await setSourceRights(db, id, rights, input.actor, now);
    included.push({id, name, rights});
  }

  // 3. Kriteria (hanya bila dikirim; selain itu pertahankan yang ada).
  const patch: Record<string, unknown> = {};
  if (input.minTier !== undefined) patch.minTier = input.minTier;
  if (input.windowHours !== undefined) patch.windowHours = input.windowHours;
  if (Object.keys(patch).length) await saveAutoConfig(db, patch, input.actor, now);
  if (input.enable !== false) await setAutoEditor(db, true, 'AKTIFKAN REDAKTUR OTOMATIS', input.actor, now);
  const cfg = await readAutoConfig(db);

  // 4. Token sekaligus, hanya bila diminta. Nilai token hanya muncul di respons ini.
  const tokens: {automation?: string; social?: string} = {};
  if (input.issueTokens === true) {
    try { tokens.automation = (await issueAutomationToken(db, 'penjadwal', now)).token; } catch { /* tabel belum siap */ }
    try { tokens.social = (await issueSocialToken(db, 'make', now)).token; } catch { /* tabel belum siap */ }
  }

  const next: string[] = [];
  if (!included.length) next.push('Belum ada sumber RSS terverifikasi. Tambahkan feed di RSS Manager lebih dulu (jenis RSS, feed valid).');
  if (rights === 'permission_confirmed') next.push('Hak ditandai atas pernyataan Anda. Bila ada sumber yang ternyata tidak boleh, turunkan ke metadata_only di RSS Manager.');
  next.push('Uji satu putaran dengan "Jalankan sekarang" untuk melihat berapa yang ditarik dan diterbitkan.');
  next.push('Untuk otomatis tiap 3 jam: pakai berkas penjadwal gratis yang disertakan (tidak wajib Make).');

  return {at, tables, sources: {included, skipped}, editor: {enabled: cfg.enabled, minTier: cfg.minTier, windowHours: cfg.windowHours, maxPerRun: cfg.maxPerRun, maxPerDay: cfg.maxPerDay}, tokens, next};
}

/** Ringkasan singkat keadaan saat ini, dipakai layar utama. */
export async function quickStatus(db: Client) {
  const auto = await prepareAutoEditorSafe(db);
  const rows = (await db.execute("SELECT source_kind,is_active,discovered_type,feed_url,rights_status FROM hub_sources")).rows;
  const rss = rows.filter(r => String(r.source_kind) === 'rss');
  const ready = rss.filter(r => r.feed_url && String(r.discovered_type) === 'rss');
  const confirmed = ready.filter(r => String(r.rights_status) === 'permission_confirmed').length;
  const active = ready.filter(r => Number(r.is_active) === 1).length;
  return {
    configured: ready.length > 0 && confirmed > 0,
    rssTotal: rss.length, rssReady: ready.length, rssActive: active, rightsConfirmed: confirmed,
    editorEnabled: auto?.config?.enabled === true,
    hint: ready.length === 0
      ? 'Tambahkan feed RSS yang valid di RSS Manager.'
      : confirmed === 0
        ? 'Tekan "Sekali Atur" untuk menyiapkan semuanya dalam satu langkah.'
        : 'Siap. Jalankan satu putaran untuk menguji, atau pakai penjadwal 3 jam.',
  };
}

async function prepareAutoEditorSafe(db: Client) {
  try { return await prepareAutoEditor(db); } catch { return null; }
}

export {randomUUID};
