import React from 'react';
import HubApp from '@/components/hub/HubApp';
export const dynamic = 'force-dynamic';
export default function AdminPage() {
  // This is a static, read-only shell, not a bypass for any protected API.
  const staticPreviewEnabled = process.env.VERCEL_ENV === 'preview' && !process.env.HUB_DATABASE_URL;
  return <HubApp staticPreviewEnabled={staticPreviewEnabled} />;
}
