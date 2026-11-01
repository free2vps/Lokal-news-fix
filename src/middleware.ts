import { NextRequest, NextResponse } from 'next/server';

// The /admin shell contains no sensitive data. Every data/action API separately
// verifies an HttpOnly session and all mutations enforce origin/CSRF checks.
export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return response;
}
export const config = { matcher: ['/admin/:path*', '/api/hub/:path*'] };
