import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return new NextResponse('ADMIN_PASSWORD belum diatur', { status: 503 });
  const h = req.headers.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    const decoded = atob(h.slice(6));
    const i = decoded.indexOf(':');
    if (decoded.slice(0, i) === 'admin' && decoded.slice(i + 1) === pass) return NextResponse.next();
  }
  return new NextResponse('Autentikasi diperlukan', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Admin"' } });
}
export const config = { matcher: ['/admin/:path*'] };
