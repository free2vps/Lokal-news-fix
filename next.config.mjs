import path from 'node:path';
import { fileURLToPath } from 'node:url';
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  outputFileTracingRoot: projectRoot,
  allowedDevOrigins: ['127.0.0.1', 'localhost', '*.e2b.app'],
  async redirects() {
    // Local-only preview has no public Supabase credentials; normal site routes are unchanged.
    return process.env.NODE_ENV !== 'production' && process.env.HUB_LOCAL_PREVIEW === 'true'
      ? [{ source: '/', destination: '/admin', permanent: false }]
      : [];
  },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ] }];
  },
};
