/**
 * Mesin klaster liputan — MURNI, tanpa AI, tanpa database.
 *
 * Tujuan: mengelompokkan beberapa artikel dari PENERBIT BERBEDA yang meliput PERISTIWA YANG SAMA,
 * sebagai bahan halaman "Perbandingan Liputan". Fungsi di sini tidak menulis apa pun ke mana pun.
 *
 * Batasan yang disengaja:
 *  - Hanya memakai judul + ringkasan. Tidak membuka halaman artikel.
 *  - Tidak memanggil AI. Penilaian "benar-benar peristiwa sama" diserahkan ke verifikator (tugas A).
 *  - Klaster satu penerbit BUKAN klaster liputan: di sini ia ditandai `crossSource: false`
 *    supaya tidak pernah dipakai sebagai perbandingan.
 */

export type ClusterItem = {
  id: string;
  source: string;          // nama penerbit
  title: string;
  summary?: string;
  publishedAt?: string | null;
  url?: string;
};

export type Cluster = {
  members: ClusterItem[];
  sources: string[];        // penerbit unik
  crossSource: boolean;     // >= 2 penerbit berbeda
  similarity: number;       // rata-rata kemiripan antar-anggota (0–1)
};

/** Kata sambung/bantu yang tidak membedakan peristiwa. */
const STOP = new Set(`dan yang di ke dari untuk pada dengan akan ini itu juga dalam tidak ada oleh karena
sebagai atau para telah sudah lebih kini bakal usai jadi bagi hingga sejak saat setelah sebelum agar supaya
bila jika tentang terhadap secara per juta ribu miliar persen orang kata ujar sebut jelas terang menurut
kami kita mereka dia ia nya pun lah kah the and for with from that this was were has have had will would
about after before over under into out up down off than then them they their there here`.split(/\s+/).filter(Boolean));

export function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

export function similarityMatrix(items: ClusterItem[]): number[][] {
  const docs = items.map((i) => tokenize(`${i.title} ${i.summary ?? ''}`));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = Math.max(1, docs.length);
  const vectors = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    const v = new Map<string, number>();
    // IDF diperhalus: log(1 + N/(1+df)) SELALU positif. Rumus tanpa "+1" bisa menghasilkan
    // bobot negatif ketika kata muncul di hampir semua dokumen (mis. hanya 2 artikel) dan
    // membuat kemiripan dua berita yang sama justru jatuh.
    for (const [w, c] of tf) v.set(w, (1 + Math.log(c)) * Math.log(1 + N / (1 + (df.get(w) ?? 0))));
    return v;
  });
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
  const norms = vectors.map(norm);
  const out: number[][] = vectors.map(() => vectors.map(() => 0));
  for (let i = 0; i < vectors.length; i++) {
    out[i][i] = 1;
    for (let j = i + 1; j < vectors.length; j++) {
      const a = vectors[i], b = vectors[j];
      let dot = 0;
      for (const [w, x] of a) { const y = b.get(w); if (y) dot += x * y; }
      const denom = norms[i] * norms[j];
      const sim = denom ? dot / denom : 0;
      out[i][j] = out[j][i] = sim;
    }
  }
  return out;
}

/**
 * Kelompokkan artikel. Dua artikel dianggap satu peristiwa bila kemiripannya >= threshold.
 * Penggabungan memakai union-find sehingga rantai A–B–C menjadi satu klaster.
 */
export function clusterArticles(
  items: ClusterItem[],
  opts: { threshold?: number; windowHours?: number } = {},
): Cluster[] {
  const threshold = opts.threshold ?? 0.24;
  const windowHours = opts.windowHours ?? 72;
  const now = Date.now();
  const pool = items.filter((i) => {
    if (!i.publishedAt) return true;
    const t = Date.parse(i.publishedAt);
    return !Number.isFinite(t) || now - t <= windowHours * 3600_000;
  });
  if (pool.length < 2) return [];

  const sim = similarityMatrix(pool);
  const parent = pool.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (sim[i][j] >= threshold) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  pool.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); });

  const clusters: Cluster[] = [];
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const members = idx.map((i) => pool[i]);
    const sources = [...new Set(members.map((m) => m.source))];
    let sum = 0, pairs = 0;
    for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) { sum += sim[idx[a]][idx[b]]; pairs++; }
    clusters.push({
      members,
      sources,
      crossSource: sources.length >= 2,
      similarity: pairs ? Number((sum / pairs).toFixed(3)) : 0,
    });
  }
  return clusters.sort((a, b) => b.sources.length - a.sources.length || b.members.length - a.members.length);
}

export type Measurement = {
  articles: number;
  clusters: number;
  crossSourceClusters: number;
  articlesInCrossSource: number;
  coveragePct: number;
  perSource: Record<string, number>;
};

/** Hitung angka ringkas untuk satu nilai threshold. */
export function measure(items: ClusterItem[], threshold: number, windowHours = 72): Measurement {
  const clusters = clusterArticles(items, { threshold, windowHours });
  const cross = clusters.filter((c) => c.crossSource);
  const inCross = cross.reduce((n, c) => n + c.members.length, 0);
  const perSource: Record<string, number> = {};
  for (const i of items) perSource[i.source] = (perSource[i.source] ?? 0) + 1;
  return {
    articles: items.length,
    clusters: clusters.length,
    crossSourceClusters: cross.length,
    articlesInCrossSource: inCross,
    coveragePct: items.length ? Number(((inCross / items.length) * 100).toFixed(1)) : 0,
    perSource,
  };
}
