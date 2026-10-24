export async function http(url: string) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'KabarLokalBot/1.0 (+news aggregator; respects takedown requests)', Accept: 'text/html,application/xml,application/rss+xml,*/*' },
    signal: AbortSignal.timeout(12000), cache: 'no-store',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} untuk ${url}`);
  return r.text();
}
