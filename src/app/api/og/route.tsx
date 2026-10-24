import { ImageResponse } from 'next/og';
export const runtime = 'edge';

export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const title = (p.get('t') || '').slice(0, 140);
  const source = (p.get('s') || '').slice(0, 60);
  const site = (p.get('n') || '').slice(0, 40);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#0E5E63', color: '#fff', padding: 64 }}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>{site}</div>
        <div style={{ fontSize: title.length > 90 ? 50 : 62, fontWeight: 700, lineHeight: 1.15 }}>{title}</div>
        <div style={{ fontSize: 28, color: '#F2C14E' }}>Sumber: {source}</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
