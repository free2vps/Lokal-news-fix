// Langkah 3: keragaman rekomendasi. Deterministik, tanpa AI, tanpa publikasi.
export type MixSubtype = 'drakor' | 'dracin' | 'idol_group';

export const MIX_SUBTYPE_LABEL: Record<MixSubtype, string> = {
  drakor: 'Drakor · drama Korea',
  dracin: 'Dracin · drama Tiongkok',
  idol_group: 'Idol · grup idola',
};
const SUBTYPE_ORDER: MixSubtype[] = ['drakor', 'dracin', 'idol_group'];

export const MIX_POLICY = {
  subtypes: SUBTYPE_ORDER,
  targetMinShare: 0.05,
  targetMaxShare: 0.10,
  capShare: 0.10,
  counting: 'Bagian dari jatah non-regional maksimal 20%, bukan tambahan di luar batas itu.',
  selection: 'round_robin_across_subtypes_then_score',
  quotaGuaranteed: false,
  publicationEnabled: false,
  notes: [
    'Porsi 5–10% adalah batas atas gabungan drakor+dracin+idol, bukan 5–10% per kategori.',
    'Bila bahan layak kurang, daftar lebih pendek; konten tidak dibuat atau dipaksakan untuk memenuhi porsi.',
    'Hanya judul/cuplik/atribusi sumber yang dipakai; tidak menyalin naskah, gambar, atau video.',
    'Konten hiburan lintas negara tidak otomatis relevan bagi Bali–Nusra dan bukan bukti kesesuaian semua usia.',
  ],
} as const;

const hit = (text: string, pattern: string) => new RegExp(pattern, 'iu').test(text);
const KOREA = '(?<![\\p{L}])(korea|korean)(?![\\p{L}])';
const CHINA = '(?<![\\p{L}])(china|tiongkok|tionghoa|mandarin)(?![\\p{L}])';
const FICTION = '(?<![\\p{L}])(drama|aktor|aktris|serial|sinopsis|episode|pemain)(?![\\p{L}])';

/** Mendeteksi subkategori hiburan lintas negara dari metadata teks saja. */
export function detectMixSubtype(title: string, snippet: string): MixSubtype | null {
  const text = `${title || ''} ${snippet || ''}`;
  if (hit(text, '(?<![\\p{L}])(drakor|k-?drama|kdrama)(?![\\p{L}])')) return 'drakor';
  if (hit(text, '(?<![\\p{L}])(dracin|c-?drama|cdrama)(?![\\p{L}])')) return 'dracin';
  if (hit(text, KOREA) && hit(text, FICTION)) return 'drakor';
  if (hit(text, CHINA) && hit(text, FICTION)) return 'dracin';
  if (hit(text, '(?<![\\p{L}])(idol|idola|k-?pop|c-?pop|boy\\s?group|girl\\s?group|grup\\s?idola|fandom|fan\\s?meeting|fancon|light\\s?stick|trainee|comeback)(?![\\p{L}])')) return 'idol_group';
  if (hit(text, '(?<![\\p{L}])(jkt48|bts|blackpink|seventeen|twice|aespa|exo|unis|ive|nct|stray kids|enhypen|itzy|red velvet|newjeans|le sserafim|treasure|bigbang|2ne1)(?![\\p{L}])')) return 'idol_group';
  if (hit(text, '(?<![\\p{L}])(bighit|hybe|sm entertainment|jyp|yg entertainment)(?![\\p{L}])')) return 'idol_group';
  return null;
}

/** Hanya sinyal kata hiburan; bukan penilaian mutu, hak siar, atau kesesuaian usia. */
export function mixPolicySummary() {
  return { ...MIX_POLICY };
}

export type SelectionCandidate = {
  id: string;
  score: number;
  group: 'news' | 'entertainment';
  regionKind: 'regional' | 'national';
  mix: MixSubtype | null;
  mixRiskFlagged: boolean;
};

export type MixReport = {
  count: number;
  share: number;
  targetMinShare: number;
  targetMaxShare: number;
  capShare: number;
  available: number;
  excludedRiskFlagged: number;
  subtypesUsed: Record<string, number>;
  withinTargetShare: boolean;
  shortfall: string | null;
  counting: string;
};

const byScore = (a: SelectionCandidate, b: SelectionCandidate) => b.score - a.score || a.id.localeCompare(b.id);

export function selectDiverse(candidates: SelectionCandidate[], limit = 50) {
  const capNational = Math.floor(limit * MIX_POLICY.capShare * 2); // 20% total non-regional
  const capMix = Math.min(capNational, Math.floor(limit * MIX_POLICY.capShare));
  const regional = candidates.filter(c => c.regionKind === 'regional' && !c.mix).sort(byScore);
  const national = candidates.filter(c => c.regionKind !== 'regional' && !c.mix).sort(byScore);
  const mixAll = candidates.filter(c => c.mix).sort(byScore);
  const mixPool = mixAll.filter(c => !c.mixRiskFlagged);

  // Porsi dihitung terhadap panjang daftar yang benar-benar bisa dihasilkan,
  // sehingga daftar pendek tidak dipaksa melewati batas 10%.
  const baseSupply = regional.length + Math.min(national.length, capNational);
  let mixCount = 0;
  if (mixPool.length) {
    const target = Math.round(limit * ((MIX_POLICY.targetMinShare + MIX_POLICY.targetMaxShare) / 2));
    const ceiling = Math.min(capMix, mixPool.length, Math.max(1, target));
    for (let m = ceiling; m >= 1; m--) {
      const projected = Math.min(limit, baseSupply + m);
      if (projected > 0 && m / projected <= MIX_POLICY.capShare + 1e-9) { mixCount = m; break; }
    }
  }

  const groups: Record<MixSubtype, SelectionCandidate[]> = { drakor: [], dracin: [], idol_group: [] };
  for (const c of mixPool) groups[c.mix as MixSubtype].push(c);
  const mixPick: SelectionCandidate[] = [];
  while (mixPick.length < mixCount) {
    let progressed = false;
    for (const sub of SUBTYPE_ORDER) {
      if (mixPick.length >= mixCount) break;
      const next = groups[sub].shift();
      if (next) { mixPick.push(next); progressed = true; }
    }
    if (!progressed) break;
  }

  const news = regional.filter(c => c.group === 'news');
  const entertainment = regional.filter(c => c.group === 'entertainment');
  const base: SelectionCandidate[] = [];
  const baseTarget = limit - mixPick.length;
  while ((news.length || entertainment.length) && base.length < baseTarget) {
    const wantNews = Math.round((base.length + 1) * 0.6) > Math.round(base.length * 0.6);
    const next = (wantNews ? news : entertainment).shift() || (wantNews ? entertainment : news).shift();
    if (!next) break;
    base.push(next);
  }
  const nationalCap = Math.max(0, capNational - mixPick.length);
  const ordered: SelectionCandidate[] = [];
  let n = 0;
  base.forEach((c, i) => {
    ordered.push(c);
    if ((i + 1) % 4 === 0 && n < nationalCap && national[n]) ordered.push(national[n++]);
  });
  const trimmed = ordered.slice(0, baseTarget);

  const assembled = [...trimmed];
  mixPick.forEach((c, i) => {
    const step = (assembled.length + mixPick.length) / (mixPick.length + 1);
    const pos = Math.min(assembled.length, Math.max(3, Math.round(step * (i + 1)) - 1));
    assembled.splice(pos, 0, c);
  });

  const final = assembled.slice(0, limit);
  // Batas 20% non-regional dan 10% hiburan lintas negara dihitung dari panjang daftar nyata,
  // bukan dari target 50, agar daftar pendek tidak melewati batas.
  const nonRegional = () => final.filter(c => c.regionKind !== 'regional').length;
  while (final.length && nonRegional() / final.length > 0.2 + 1e-9) {
    const idx = [...final].reverse().findIndex(c => !c.mix && c.regionKind !== 'regional');
    if (idx < 0) break;
    final.splice(final.length - 1 - idx, 1);
  }
  const mixCountFinal = () => final.filter(c => c.mix).length;
  while (final.length && mixCountFinal() / final.length > MIX_POLICY.capShare + 1e-9) {
    const idx = [...final].reverse().findIndex(c => !!c.mix);
    const removed = final.splice(final.length - 1 - idx, 1)[0];
    const pool = groups[removed.mix as MixSubtype];
    if (pool) pool.push(removed as SelectionCandidate);
  }

  const subtypesUsed: Record<string, number> = {};
  for (const c of final) if (c.mix) subtypesUsed[c.mix] = (subtypesUsed[c.mix] || 0) + 1;
  const count = mixCountFinal();
  const share = final.length ? count / final.length : 0;
  const report: MixReport = {
    count,
    share: Math.round(share * 1000) / 1000,
    targetMinShare: MIX_POLICY.targetMinShare,
    targetMaxShare: MIX_POLICY.targetMaxShare,
    capShare: MIX_POLICY.capShare,
    available: mixPool.length,
    excludedRiskFlagged: mixAll.length - mixPool.length,
    subtypesUsed,
    withinTargetShare: count > 0 && share >= MIX_POLICY.targetMinShare - 1e-9 && share <= MIX_POLICY.targetMaxShare + 1e-9,
    shortfall: mixCount === 0 && mixPool.length > 0
      ? 'Daftar kandidat saat ini terlalu pendek untuk menampung hiburan lintas negara di bawah batas 10%; porsi tidak dipaksakan.'
      : mixPool.length < Math.ceil(limit * MIX_POLICY.targetMinShare)
      ? `Hanya ${mixPool.length} kandidat hiburan lintas negara yang lolos syarat; porsi 5% tidak dipaksakan dan daftar tidak diisi konten buatan.`
      : null,
    counting: MIX_POLICY.counting,
  };
  return { items: final, mix: report, nationalCount: final.filter(c => c.regionKind !== 'regional').length };
}
