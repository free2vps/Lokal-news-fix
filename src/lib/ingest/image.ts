// Membaca dimensi gambar dari header file (tanpa mengunduh seluruh gambar).
type Size = { w: number; h: number };

function parse(b: Buffer): Size | null {
  if (b.length < 30) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };           // PNG
  if (b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };        // GIF
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {                    // WEBP
    const t = b.toString('ascii', 12, 16);
    if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {                                                                   // JPEG
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

export async function imageSize(url: string): Promise<Size | null> {
  try {
    if (!/^https?:\/\//i.test(url)) return null;
    const r = await fetch(url, { headers: { Range: 'bytes=0-131071', 'User-Agent': 'KabarLokalBot/1.0' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    while (n < 131072) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
    reader.cancel().catch(() => {});
    return parse(Buffer.concat(chunks));
  } catch { return null; }
}

/** Pilih gambar dengan lebar terbesar (seri: urutan pertama menang). */
export async function bestImage(urls: (string | null | undefined)[]) {
  const uniq = [...new Set(urls.filter(Boolean) as string[])];
  if (!uniq.length) return null;
  const res = await Promise.all(uniq.map(async (u) => ({ u, s: await imageSize(u) })));
  res.sort((a, b) => (b.s?.w ?? 0) - (a.s?.w ?? 0));
  return { url: res[0].u, width: res[0].s?.w ?? null, height: res[0].s?.h ?? null };
}
