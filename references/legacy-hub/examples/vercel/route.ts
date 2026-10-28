// Place in your existing Next.js project: app/api/content-hub/route.ts
// PORTAL_HUB_URL and PORTAL_API_TOKEN are server-only environment variables.
export async function GET() {
  const base = process.env.PORTAL_HUB_URL;
  const token = process.env.PORTAL_API_TOKEN;
  if (!base || !token) return Response.json({ok:false,error:'Integrasi belum dikonfigurasi'}, {status:503});
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/portal-feed?type=recommended&limit=20`, {
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 300 }
    });
    if (!response.ok) return Response.json({ok:false,error:'Content Hub belum tersedia'}, {status:502});
    return Response.json(await response.json());
  } catch {
    return Response.json({ok:false,error:'Koneksi Content Hub gagal'}, {status:502});
  }
}
