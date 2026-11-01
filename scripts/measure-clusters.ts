#!/usr/bin/env node
/**
 * PENGUKUR KLASTER LIPUTAN — hanya membaca, tidak menulis apa pun.
 *
 * Fase 1 dari rencana "Perbandingan Liputan". Tujuannya menjawab satu pertanyaan:
 * apakah di sumber berita Anda memang ADA peristiwa yang diliput beberapa penerbit berbeda?
 * Tanpa angka ini, membangun halaman perbandingan hanya menebak.
 *
 * Pemakaian:
 *   npx tsx scripts/measure-clusters.ts                 # pakai feed bawaan (5 sumber lokal)
 *   npx tsx scripts/measure-clusters.ts --threshold 0.30
 *   npx tsx scripts/measure-clusters.ts --file data.json   # {items:[{id,source,title,summary,publishedAt}]}
 *
 * CATATAN KEAMANAN: skrip ini TIDAK memanggil database dan TIDAK menulis berkas.
 * Tidak ada INSERT/UPDATE/DELETE di seluruh berkas ini.
 */
import { readFileSync } from 'node:fs';
import { clusterArticles, measure, type ClusterItem } from '../src/lib/clusters';

const DEFAULT_FEEDS: { name: string; url: string }[] = [
  { name: 'suarantb.com', url: 'https://www.suarantb.com/feed' },
  { name: 'radarlombok.co.id', url: 'https://radarlombok.co.id/feed' },
  { name: 'nusabali.com', url: 'https://nusabali.com/rss' },
  { name: 'balipuspanews.com', url: 'https://balipuspanews.com/feed' },
  { name: 'koranntb.com', url: 'https://koranntb.com/feed' },
];

const UA = 'Mozilla/5.0 (compatible; PortalContentHub/1.0; +cluster-measure)';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function clean(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readFeed(name: string, url: string): Promise<ClusterItem[]> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
    if (!r.ok) { console.log(`   lewati ${name}: HTTP ${r.status}`); return []; }
    const xml = await r.text();
    const out: ClusterItem[] = [];
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
    items.forEach((block, i) => {
      const title = clean((block.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? '');
      if (!title) return;
      const summary = clean((block.match(/<description>([\s\S]*?)<\/description>/) ?? [])[1] ?? '').slice(0, 400);
      const pub = clean((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1] ?? '');
      const link = clean((block.match(/<link>([\s\S]*?)<\/link>/) ?? [])[1] ?? '');
      const t = pub ? Date.parse(pub) : NaN;
      out.push({ id: `${name}#${i}`, source: name, title, summary, url: link, publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null });
    });
    console.log(`   ${name}: ${out.length} artikel`);
    return out;
  } catch (e) {
    console.log(`   lewati ${name}: ${(e as Error).message.slice(0, 60)}`);
    return [];
  }
}

async function main() {
  const thresholdArg = Number(arg('threshold'));
  const file = arg('file');

  let items: ClusterItem[] = [];
  if (file) {
    console.log(`Membaca data dari berkas: ${file}`);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { items?: ClusterItem[] } | ClusterItem[];
    items = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
  } else {
    console.log('Membaca feed (hanya baca, tanpa database):');
    const bundles = await Promise.all(DEFAULT_FEEDS.map((f) => readFeed(f.name, f.url)));
    items = bundles.flat();
  }

  if (items.length < 2) {
    console.log('\nTidak cukup artikel untuk diukur (minimal 2).');
    process.exit(0);
  }

  console.log(`\nTotal artikel: ${items.length}`);

  const sweep = Number.isFinite(thresholdArg) && thresholdArg > 0 ? [thresholdArg] : [0.34, 0.30, 0.24, 0.18];
  console.log('\n=== Ambang → klaster ===');
  console.log('  ambang | klaster | lintas-sumber | artikel berklaster | cakupan');
  for (const th of sweep) {
    const m = measure(items, th);
    console.log(
      `   ${th.toFixed(2)}  |   ${String(m.clusters).padStart(3)}   |      ${String(m.crossSourceClusters).padStart(3)}      |         ${String(m.articlesInCrossSource).padStart(3)}         |  ${m.coveragePct}%`,
    );
  }

  const chosen = Number.isFinite(thresholdArg) && thresholdArg > 0 ? thresholdArg : 0.24;
  const cross = clusterArticles(items, { threshold: chosen }).filter((c) => c.crossSource);
  console.log(`\n=== Klaster LINTAS-SUMBER pada ambang ${chosen.toFixed(2)} ===`);
  if (!cross.length) {
    console.log('  Tidak ada. Sumber-sumber ini belum saling meliput peristiwa yang sama.');
  } else {
    cross.forEach((c, n) => {
      console.log(`\n  ${n + 1}. ${c.members.length} artikel · ${c.sources.length} penerbit · kemiripan ${c.similarity}`);
      for (const m of c.members) console.log(`     [${m.source}] ${m.title.slice(0, 92)}`);
    });
    console.log('\n  ⚠️  Periksa manual: pastikan setiap klaster benar-benar SATU peristiwa.');
    console.log('     Angka di atas hanya kemiripan kata; verifikator AI (tugas A) belum dipasang.');
  }

  console.log('\nSelesai. Skrip ini tidak menulis apa pun — tidak ada perubahan data maupun tampilan.');
}

main().catch((e) => { console.error('Gagal mengukur:', e); process.exit(1); });
