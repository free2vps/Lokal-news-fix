import type {Client} from '@libsql/client';
import {AUTO_EDITOR_POLICY, readAutoConfig, SELECTION_RULES} from './auto-editor';
import {detectRegion} from '@/config/regions';

/**
 * Diagnosa seleksi — BACA SAJA.
 * Menjawab "2088 kandidat tersimpan, kenapa 0 terbit?" dengan saringan yang PERSIS sama
 * seperti yang dipakai runAutoEditor, dihitung berurutan (funnel) sehingga terlihat
 * gerbang mana yang menghabiskan semuanya.
 * Tidak ada INSERT/UPDATE/DELETE dan tidak ada artikel yang diterbitkan.
 */
export type Gate = {key: string; label: string; dropped: number; remaining: number};
export type SelectionDiagnose = {
  at: string; windowHours: number; rightsMode: string; allowedRegions: string[];
  totalItems: number; rowsScanned: number; survivors: number;
  gates: Gate[];
  byTier: Record<string, number>; byRegion: Record<string, number>;
  sources: {id: string; name: string; region: string; rights: string; active: boolean; items: number; inWindow: number; passAll: boolean; blockedBy: string | null}[];
  verdict: string;
  suggestion: string;
  rightsSummary: {total: number; permissionConfirmed: number; metadataOnly: number; unknown: number; inactive: number};
  rules: readonly {key: string; label: string}[]; regionalSurvivors: number; nationalSurvivors: number;
  plan: {capacity: number; mixRegionalPct: number; regionalAvailable: number; nationalAvailable: number; regionalWillTake: number; nationalWillTake: number};
};

const PROVINCE_OF: Record<string, string> = {
  bali: 'Bali', denpasar: 'Bali', badung: 'Bali', gianyar: 'Bali', tabanan: 'Bali', jembrana: 'Bali',
  karangasem: 'Bali', buleleng: 'Bali', klungkung: 'Bali', bangli: 'Bali',
  'sumbawa-barat': 'NTB', sumbawa: 'NTB', mataram: 'NTB', 'lombok-barat': 'NTB', 'lombok-tengah': 'NTB',
  'lombok-timur': 'NTB', 'lombok-utara': 'NTB', bima: 'NTB', dompu: 'NTB', ntb: 'NTB',
  ntt: 'NTT', kupang: 'NTT', manggarai: 'NTT', ende: 'NTT', sikka: 'NTT', sumba: 'NTT', flores: 'NTT',
};
const LABEL: Record<string, string> = {
  source_missing: 'sumbernya tidak dikenal',
  already_in_outbox: 'sudah pernah masuk antrean terbit',
  date_outside_window: 'tanggal di luar jendela umur berita',
  date_unreadable: 'tanggal terbit tidak ada / tidak bisa dibaca',
  rights_unknown: 'hak sumber belum jelas',
  rights_not_permission_confirmed: 'hak sumber belum terkonfirmasi',
  risk_needs_review: 'profil risiko minta tinjauan',
  text_missing: 'judul atau ringkasan kosong',
};

function parse(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw) return null;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : null; } catch { return null; }
}
function plain(v: unknown) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function stamp(value: unknown): number {
  const s = plain(value); if (!s) return NaN;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) return NaN;
  const t = Date.parse(s); return Number.isFinite(t) ? t : NaN;
}

export async function diagnoseSelection(db: Client, opts: {now?: number; samplePerSource?: number} = {}): Promise<SelectionDiagnose> {
  const now = opts.now ?? Date.now();
  const cfg = await readAutoConfig(db);
  const allowed = cfg.regions.slice();
  const gatesOrder = ['source_missing', 'already_in_outbox', 'date_outside_window', 'date_unreadable', 'rights_unknown',
    ...(cfg.rightsMode === 'permission_confirmed' ? ['rights_not_permission_confirmed'] : []),
    'risk_needs_review', 'text_missing'] as const;

  const sources = new Map<string, {name: string; region: string; rights: string; active: boolean}>();
  for (const s of (await db.execute('SELECT id,name,region,rights_status,is_active FROM hub_sources')).rows) {
    sources.set(String(s.id), {name: plain(s.name), region: plain(s.region), rights: plain(s.rights_status) || 'unknown', active: Number(s.is_active) === 1});
  }
  const open = new Set<string>();
  try { for (const r of (await db.execute("SELECT item_id FROM hub_publish_outbox WHERE status IN ('queued','sending','published','duplicate')")).rows) open.add(String(r.item_id)); } catch {}
  const totalItems = Number((await db.execute('SELECT count(*) n FROM hub_items')).rows[0]?.n || 0);

  let rows: Record<string, unknown>[] = [];
  try {
    rows = (await db.execute(`SELECT i.id,i.source_id,i.source_title,i.source_snippet,i.source_published_at,
        i.editorial_title,i.editorial_summary,p.profile_json,v.value_json
      FROM hub_items i LEFT JOIN hub_content_profiles_v2 p ON p.item_id=i.id LEFT JOIN hub_editorial_value_v2 v ON v.item_id=i.id`)).rows as unknown as Record<string, unknown>[];
  } catch {
    rows = (await db.execute(`SELECT i.id,i.source_id,i.source_title,i.source_snippet,i.source_published_at,
        i.editorial_title,i.editorial_summary,NULL profile_json,NULL value_json FROM hub_items i`)).rows as unknown as Record<string, unknown>[];
  }

  const dropped: Record<string, number> = {};
  let regionalSurvivors = 0, nationalSurvivors = 0;
  const byTier: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  const perSource = new Map<string, {items: number; inWindow: number; passAll: boolean; blockedBy: string | null}>();
  for (const key of sources.keys()) perSource.set(key, {items: 0, inWindow: 0, passAll: false, blockedBy: null});
  let survivors = 0;

  for (const row of rows) {
    const itemId = String(row.id);
    const srcId = String(row.source_id);
    const stat = perSource.get(srcId) ?? {items: 0, inWindow: 0, passAll: false, blockedBy: null};
    perSource.set(srcId, stat);
    stat.items += 1;

    let block: string | null = null;
    const src = sources.get(srcId);
    if (!src) block = 'source_missing';
    else if (open.has(itemId)) block = 'already_in_outbox';
    else {
      const t = stamp(row.source_published_at);
      if (!Number.isFinite(t)) block = 'date_unreadable';
      else if (t > now + 300000 || t < now - cfg.windowHours * 3600000) block = 'date_outside_window';
      else {
        stat.inWindow += 1;
        byRegion[src.region || '(tanpa wilayah)'] = (byRegion[src.region || '(tanpa wilayah)'] || 0) + 1;
        const value = parse(row.value_json);
        const tier = value?.tier ? String(value.tier) : 'radar';
        byTier[tier] = (byTier[tier] || 0) + 1;
        const profile = parse(row.profile_json);
        const profileRegions: string[] = Array.isArray(profile?.regions) ? (profile!.regions as unknown[]).map(String) : [];
        const regions = profileRegions.length ? profileRegions : (src.region ? [src.region] : []);
        const title = plain(row.editorial_title) || plain(row.source_title);
        const summary = plain(row.editorial_summary) || plain(row.source_snippet);
        if (src.rights === 'unknown') block = 'rights_unknown';
        else if (cfg.rightsMode === 'permission_confirmed' && src.rights !== 'permission_confirmed') block = 'rights_not_permission_confirmed';
        else if ((profile?.risk as Record<string, unknown>)?.status === 'needs_review') block = 'risk_needs_review';
        else if (!title || !summary) block = 'text_missing';
      }
    }
    if (block) { dropped[block] = (dropped[block] || 0) + 1; if (!stat.blockedBy) stat.blockedBy = block; }
    else {
      survivors += 1; stat.passAll = true;
      const province = PROVINCE_OF[String(detectRegion(`${row.source_title || ''} ${row.source_snippet || ''}`) || '')]
        || (Array.isArray(parse(row.profile_json)?.regions) ? ((parse(row.profile_json)!.regions as unknown[]).map(r => PROVINCE_OF[String(r)]).find(Boolean) || null) : null);
      if (province && allowed.includes(province)) regionalSurvivors += 1; else nationalSurvivors += 1;
    }
  }

  const gates: Gate[] = [];
  let remaining = rows.length;
  for (const key of gatesOrder) {
    const n = dropped[key] || 0;
    remaining -= n;
    gates.push({key, label: LABEL[key] || key, dropped: n, remaining});
  }

  const capacity = Math.min(cfg.maxPerRun, cfg.maxPerDay);
  const regionalTarget = Math.round((capacity * cfg.mixRegionalPct) / 100);
  const plan = {
    capacity, mixRegionalPct: cfg.mixRegionalPct,
    regionalAvailable: regionalSurvivors, nationalAvailable: nationalSurvivors,
    regionalWillTake: Math.min(regionalSurvivors, regionalTarget),
    nationalWillTake: Math.min(nationalSurvivors, capacity - Math.min(regionalSurvivors, regionalTarget)),
  };
  const list = [...perSource.entries()].map(([id, s]) => ({
    id, name: sources.get(id)?.name || '(tidak dikenal)', region: sources.get(id)?.region || '',
    rights: sources.get(id)?.rights || 'unknown', active: sources.get(id)?.active ?? false,
    items: s.items, inWindow: s.inWindow, passAll: s.passAll, blockedBy: s.blockedBy,
  })).sort((a, b) => b.items - a.items);

  const biggest = gates.filter(g => g.dropped > 0).sort((a, b) => b.dropped - a.dropped)[0];
  const inWindowTotal = rows.length - (dropped.source_missing || 0) - (dropped.already_in_outbox || 0) - (dropped.date_outside_window || 0) - (dropped.date_unreadable || 0);

  const verdict = !rows.length
    ? 'Belum ada satu pun kandidat tersimpan. Masalahnya di penarikan, bukan di penyaringan.'
    : survivors > 0
      ? `${survivors} dari ${rows.length} kandidat tersimpan lolos semua saringan dan siap terbit pada putaran berikutnya.`
      : `0 dari ${rows.length} kandidat tersimpan lolos. Gerbang terbesar: ${biggest?.label || 'tidak diketahui'} (${biggest?.dropped || 0} berita).`;

  const tips: Record<string, string> = {
    date_outside_window: `Terlalu tua: hanya berita ≤ ${cfg.windowHours} jam yang diterima. Perbesar "Umur berita" di Lanjutan bila Anda ingin menampilkan arsip lebih lama.`,
    date_unreadable: 'Tanggal terbit di feed tidak berformat ISO berzona (mis. +0800), jadi ditolak. Ini perlu perbaikan pembaca tanggal, bukan tombol.',
    rights_not_permission_confirmed: 'Hak sumber belum dinyatakan. Tandai "Hak pakai" di RSS Manager untuk sumber yang Anda nilai boleh, atau ubah mode hak di Lanjutan.',
    rights_unknown: 'Sumber berstatus hak tidak jelas sehingga selalu dilewati.',
    value_tier_below_minimum: `Semua berita dinilai "radar". Turunkan "Kelas minimum" ke Radar di Lanjutan, atau biarkan penilaian otomatis menaikkannya.`,
    text_missing: 'Judul/ringkasan sumber kosong sehingga tidak bisa diolah.',
    already_in_outbox: 'Berita ini sudah pernah dikirim/diterbitkan sehingga sengaja tidak diulang.',
    risk_needs_review: 'Profil risiko menandai berita ini butuh tinjauan manusia.',
  };
  const suggestion = survivors > 0
    ? 'Tekan "Jalankan sekarang" — kandidatnya sudah siap.'
    : tips[biggest?.key || ''] || 'Periksa rincian per sumber di bawah untuk melihat sumber mana yang menyumbang blokir terbesar.';

  const allRights = [...sources.values()];
  const rightsSummary = {
    total: allRights.length,
    permissionConfirmed: allRights.filter(x => x.rights === 'permission_confirmed' && x.active).length,
    metadataOnly: allRights.filter(x => x.rights === 'metadata_only' && x.active).length,
    unknown: allRights.filter(x => x.rights === 'unknown' && x.active).length,
    inactive: allRights.filter(x => !x.active).length,
  };
  return {at: new Date(now).toISOString(), windowHours: cfg.windowHours, rightsMode: cfg.rightsMode, allowedRegions: allowed, rules: SELECTION_RULES, rightsSummary,
    regionalSurvivors, nationalSurvivors, plan,
    totalItems, rowsScanned: rows.length, survivors, gates, byTier, byRegion,
    sources: list.slice(0, 40), verdict, suggestion};
}
