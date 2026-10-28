import { getHubDb } from '@/server/hub/db/client';
import { handlePreviewBootstrap } from '@/server/hub/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only the explicitly enabled webhub Preview can initialize a new, empty DB. */
export async function POST(request: Request) {
  return handlePreviewBootstrap(request, { env: process.env, getDb: getHubDb });
}
