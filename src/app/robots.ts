import type { MetadataRoute } from 'next';
import { SITE } from '@/config/site';
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/cari'] }], sitemap: `${SITE.url}/sitemap.xml` };
}
