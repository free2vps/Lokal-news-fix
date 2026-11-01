/**
 * Penjaga kualitas isi — aturan kata yang DETERMINISTIK (tanpa AI).
 *
 * Tiga gejala nyata yang ditangani di sini, semuanya terbukti di situs produksi:
 *  B1. Judul artikel berisi NAMA SITUS ("Kementerian Komunikasi dan Digital - Komdigi").
 *  B3. Berita pemerintahan diberi label "Lowongan terbaru" hanya karena memuat kata PPPK.
 *  B4. Halaman topik dibuat dari kata umum ("tahun", "orang", "jadi") → puluhan halaman tipis.
 */

/** Kata yang tidak layak dijadikan halaman topik: terlalu umum, tak menunjuk peristiwa. */
const STOP_TAGS = new Set([
  'tahun', 'orang', 'jadi', 'atas', 'cara', 'ruang', 'jaga', 'hapus', 'kata', 'kali', 'hari',
  'baru', 'bisa', 'akan', 'para', 'dalam', 'lebih', 'sangat', 'masih', 'sudah', 'harus', 'agar',
  'banyak', 'semua', 'warga', 'pemkab', 'pemkot', 'pemda', 'kota', 'desa', 'daerah', 'lokal',
  'kabupaten', 'provinsi', 'indonesia', 'nasional', 'berita', 'update', 'terbaru', 'viral',
  'pemerintah', 'masyarakat', 'kegiatan', 'acara', 'informasi', 'umum',
  // kata sambung/bantu 3 huruf — bukan topik, walau pendek
  'dan', 'yang', 'dari', 'ini', 'itu', 'ada', 'oleh', 'para', 'saat', 'usai', 'kata', 'ujar',
  'bagi', 'atas', 'juga', 'agar', 'jika', 'bila', 'serta', 'per', 'ke', 'di', 'the', 'and',
]);

/** Tag dianggap layak bila bukan kata umum, bukan angka, dan punya isi. */
export function isMeaningfulTag(raw: unknown): boolean {
  const tag = String(raw ?? '').trim().toLowerCase();
  if (tag.length < 3 || tag.length > 40) return false;
  if (/^\d+$/.test(tag)) return false;      // "2026"
  if (STOP_TAGS.has(tag)) return false;
  if (!/[a-z]/.test(tag)) return false;
  return true;
}

/** Saring daftar tag agar hanya yang layak tampil sebagai halaman topik. */
export function meaningfulTags(list: unknown): string[] {
  return (Array.isArray(list) ? list : []).filter((t): t is string => typeof t === 'string').filter(isMeaningfulTag);
}

/**
 * B1 — apakah judul ini sebenarnya nama situs, bukan judul berita?
 *
 * Contoh nyata: "Kementerian Komunikasi dan Digital - Komdigi" untuk artikel yang sumbernya
 * Google News. Judul seperti ini tidak menjelaskan peristiwa apa pun.
 */
export function isSiteNameTitle(title: unknown, sourceName?: unknown): boolean {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  const src = String(sourceName ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const low = t.toLowerCase();
  // Persis sama dengan nama penerbit.
  if (src && low === src) return true;
  // Berakhiran " - NamaPenerbit" dan bagian depannya juga nama lembaga (tanpa kata kerja berita).
  const m = t.match(/^(.*?)\s+[-–—|]\s+(.+)$/);
  if (m) {
    const head = m[1].trim(), tail = m[2].trim();
    if (src && tail.toLowerCase() === src) return true;
    if (head.length <= 60 && tail.length <= 60 && !hasNewsVerb(`${head} ${tail}`) && isOrgLike(head)) return true;
  }
  // Nama lembaga saja tanpa kata kerja berita, mis. "Kementerian Komunikasi dan Digital".
  if (t.length <= 70 && !hasNewsVerb(t) && isOrgLike(t)) return true;
  return false;
}

const NEWS_VERBS = /\b(dorong|dukung|buka|tutup|resmikan|canangkan|umumkan|tetapkan|minta|imbau|larang|tinjau|kunjungi|hadiri|buka|gelar|targetkan|luncurkan|rilis|tanda\s?tangan|sebut|ungkap|jelaskan|tegaskan|pastikan|tingkatkan|bangun|renovasi|salurkan|serahkan|terima|raih|menang|kalah|kalahkan|tembus|capai|naik|turun|kena|imbas|dampak|imbangi|susun|uji|periksa|selidiki|tangkap|tahan|tuntut|gugat|putuskan|batalkan|sahkan|angket|sidang|vonis|temukan|evakuasi|selamatkan|bagikan|edukasi|sosialisasi|launching|groundbreaking)\b/i;
const ORG_WORDS = /\b(kementerian|kemenko|badan|lembaga|dinas|kantor|balai|pemkab|pemkot|pemprov|pemda|pemerintah|provinsi|kabupaten|kota|polres|polsek|polda|kejari|kejaksaan|pengadilan|universitas|institut|sekolah|rumah sakit|rsud|puskesmas|bank|pt|cv|yayasan|organisasi|perhimpunan|forum|komunitas|asosiasi)\b/i;

function hasNewsVerb(text: string): boolean {
  return NEWS_VERBS.test(text);
}
function isOrgLike(text: string): boolean {
  // Harus benar-benar memuat kata lembaga. Jangan memakai pola "huruf kapital" saja:
  // itu menolak judul sah seperti "Pelatihan Mataram".
  return ORG_WORDS.test(text);
}

/**
 * B3 — apakah teks ini benar-benar lowongan kerja?
 *
 * "Bupati Dompu dukung BPR NTB perluas layanan PPPK dan UMKM" BUKAN lowongan walau memuat
 * "PPPK". Yang menentukan adalah ada tidaknya niat pengumuman lowongan.
 */
const JOB_INTENT = /\b(lowongan|loker|rekrutmen|rekrut|dibuka|membuka\s+pendaftaran|pendaftaran\s+(?:cpns|pppk|asn|pegawai|karyawan|calon)|seleksi\s+(?:calon\s+)?(?:cpns|pppk|asn|pegawai|karyawan)|formasi\s+(?:cpns|pppk|asn)|bursa\s+kerja|job\s?fair|walk[\s-]?in\s+interview|dicari|dibutuhkan\s+\d*\s*(?:orang|karyawan|tenaga))\b/i;

export function isJobPosting(text: unknown): boolean {
  return JOB_INTENT.test(String(text ?? ''));
}

/** Untuk kartu "Lowongan terbaru": syaratnya judul itu sendiri harus lowongan. */
export function jobPostingOnly<T extends { title?: string | null; original_title?: string | null }>(items: T[]): T[] {
  return items.filter((a) => isJobPosting(a.title) || isJobPosting(a.original_title));
}
