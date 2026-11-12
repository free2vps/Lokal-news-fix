/**
 * Pemeriksa robots.txt untuk pintu tautan pemda (dan hanya untuk itu).
 *
 * Aturan yang dipegang:
 *  • Dilarang = berhenti. Tidak ada upaya menembus, menyamar sebagai browser lain,
 *    atau "mencoba lewat jalan lain". Bila sumber melarang, tautan ditolak.
 *  • robots.txt tidak ada (404) → dianggap tidak ada larangan (sesuai RFC 9309).
 *  • robots.txt menolak akses (401/403) atau server bermasalah (5xx) → dianggap DILARANG.
 *    Ini pilihan konservatif: lebih baik draf hilang daripada melanggar.
 *  • Aturan dicocokkan paling spesifik: yang menang adalah pola terpanjang, dan bila
 *    panjangnya sama, `Allow` menang atas `Disallow` (perilaku yang sama dipakai Google).
 */

export type Aturan = { izin: boolean; pola: string };

type Kelompok = { agen: string[]; aturan: Aturan[] };

/** Pecah isi robots.txt menjadi kelompok user-agent + aturan. */
export function uraiRobots(teks: string): Kelompok[] {
  const hasil: Kelompok[] = [];
  let aktif: Kelompok | null = null;
  let menungguAgen = false;
  for (const barisMentah of teks.split(/\r?\n/)) {
    const baris = barisMentah.split('#')[0].trim();
    if (!baris) continue;
    const pisah = baris.indexOf(':');
    if (pisah < 0) continue;
    const kunci = baris.slice(0, pisah).trim().toLowerCase();
    const nilai = baris.slice(pisah + 1).trim();
    if (kunci === 'user-agent') {
      // Baris user-agent setelah aturan = kelompok baru.
      if (!aktif || !menungguAgen) { aktif = { agen: [], aturan: [] }; hasil.push(aktif); }
      aktif.agen.push(nilai.toLowerCase());
      menungguAgen = true;
      continue;
    }
    if (!aktif) continue;
    menungguAgen = false;
    if (kunci === 'allow' || kunci === 'disallow') {
      // `Disallow:` kosong = tidak ada larangan, bukan larangan untuk seluruh situs.
      if (kunci === 'disallow' && !nilai) continue;
      aktif.aturan.push({ izin: kunci === 'allow', pola: nilai });
    }
  }
  return hasil;
}

/** Aturan yang berlaku untuk satu user-agent: kelompok paling spesifik menang. */
export function aturanUntuk(kelompok: Kelompok[], agen: string): Aturan[] {
  const saya = agen.toLowerCase();
  const cocok = kelompok.filter((k) => k.agen.some((a) => a !== '*' && saya.includes(a)));
  if (cocok.length) return cocok.flatMap((k) => k.aturan);
  return kelompok.filter((k) => k.agen.includes('*')).flatMap((k) => k.aturan);
}

function polaKeRegex(pola: string) {
  const escape = pola.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const badan = escape.split('*').join('.*').replace(/\\\$$/, '$');
  return new RegExp('^' + badan);
}

/** Apakah `path` boleh diambil menurut aturan yang sudah disaring? */
export function bolehDiakses(aturan: Aturan[], path: string): boolean {
  let menang: Aturan | null = null;
  let panjang = -1;
  for (const a of aturan) {
    if (!polaKeRegex(a.pola).test(path)) continue;
    // Pola paling panjang menang; bila sama, Allow menang.
    if (a.pola.length > panjang || (a.pola.length === panjang && a.izin)) { menang = a; panjang = a.pola.length; }
  }
  return menang ? menang.izin : true;
}

export type HasilRobots = { diizinkan: boolean; alasan: string; isi?: string };

/**
 * Ambil dan periksa robots.txt untuk satu alamat.
 * Tidak pernah melempar galat: hasilnya selalu keputusan + alasan yang bisa ditampilkan.
 */
export async function periksaRobots(
  alamat: string,
  opsi: { fetcher?: typeof fetch; agen?: string; timeoutMs?: number } = {},
): Promise<HasilRobots> {
  const fetcher = opsi.fetcher ?? fetch;
  const agen = opsi.agen ?? 'PortalHubBot';
  let origin: URL;
  try { origin = new URL(new URL(alamat).origin); } catch { return { diizinkan: false, alasan: 'Alamat sumber tidak sah.' }; }
  let res: Response;
  try {
    res = await fetcher(new URL('/robots.txt', origin).href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(opsi.timeoutMs ?? 12000),
      headers: { 'user-agent': `${agen}/1.0 (+https://portal-hub.online)` },
      cache: 'no-store',
    });
  } catch {
    return { diizinkan: false, alasan: 'robots.txt tidak dapat dihubungi, jadi sumber ini dianggap terlarang.' };
  }
  if (res.status === 401 || res.status === 403) return { diizinkan: false, alasan: `robots.txt menolak akses (HTTP ${res.status}).` };
  if (res.status >= 500) return { diizinkan: false, alasan: `robots.txt bermasalah (HTTP ${res.status}).` };
  if (!res.ok) return { diizinkan: true, alasan: 'Sumber tidak punya robots.txt (tidak ada larangan).' };
  const isi = (await res.text().catch(() => '')).slice(0, 200_000);
  const target = new URL(alamat);
  const izin = bolehDiakses(aturanUntuk(uraiRobots(isi), agen), target.pathname + target.search);
  return izin
    ? { diizinkan: true, alasan: 'robots.txt sumber tidak melarang alamat ini.', isi }
    : { diizinkan: false, alasan: 'robots.txt sumber melarang alamat ini — permintaan dihentikan, tidak diakali.' };
}
