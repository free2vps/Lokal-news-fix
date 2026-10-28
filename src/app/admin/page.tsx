import React from 'react';
import HubApp from '@/components/hub/HubApp';
import { canBootstrapPreview } from '@/server/hub/db/bootstrap';
export const dynamic = 'force-dynamic';
export default function AdminPage() {
  // This is a static, read-only shell, not a bypass for any protected API.
  const staticPreviewEnabled = process.env.VERCEL_ENV === 'preview' && !process.env.HUB_DATABASE_URL;
  const bootstrapEnabled = canBootstrapPreview();
  return <HubApp staticPreviewEnabled={staticPreviewEnabled} bootstrapEnabled={bootstrapEnabled} />;
}
