import { NextResponse } from 'next/server';
import { addManualSource } from '@/server/hub/domain/sources';
import { authenticatedDb, errorJson, invalidMutation, NO_STORE, readJson } from '@/server/hub/security/http';
import audit from '../../../../../docs/official-ntb-source-check.json';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access = await authenticatedDb(request); if (access.error) return access.error;
  try {
    const result = await access.db.execute(`SELECT s.id,s.name,s.jurisdiction,s.region,s.requested_url,s.source_kind,s.discovered_type,s.feed_url,s.rights_status,s.is_active,
      (SELECT count(*) FROM hub_items i WHERE i.source_id=s.id) AS item_count FROM hub_sources s ORDER BY s.name`);
    type AuditRecord = { id: string; checkedAt: string; robots?: { robots?: string; reason?: string | null } | null; page?: { http?: number | null; reason?: string | null } | null; feed?: { ok?: boolean } | null };
    const checks = new Map<string, AuditRecord>(audit.results.map(item => [item.id, item as AuditRecord]));
    const sources = result.rows.map(row => {
      const check = checks.get(String(row.id));
      return { id: String(row.id), name: String(row.name), jurisdiction: String(row.jurisdiction), region: String(row.region), requestedUrl: String(row.requested_url), sourceKind: String(row.source_kind), discoveredType: String(row.discovered_type), feedUrl: row.feed_url ? String(row.feed_url) : null, rightsStatus: String(row.rights_status), active: Number(row.is_active) === 1, itemCount: Number(row.item_count), audit: check ? { checkedAt: check.checkedAt, robots: check.robots?.robots || null, robotsReason: check.robots?.reason || null, pageStatus: check.page?.http || null, pageReason: check.page?.reason || null, feedVerified: check.feed?.ok === true } : null };
    });
    return NextResponse.json({ ok: true, sources }, { headers: NO_STORE });
  } catch { return errorJson('Daftar sumber belum dapat dibaca; periksa skema Hub.', 503); }
}
export async function POST(request: Request) {
  const rejected = invalidMutation(request); if (rejected) return rejected;
  const access = await authenticatedDb(request); if (access.error) return access.error;
  let body: Record<string, unknown>;
  try { body = await readJson(request); } catch { return errorJson('Permintaan tidak valid atau terlalu besar.', 400); }
  try {
    const result = await addManualSource(access.db, { name: body.name, jurisdiction: body.jurisdiction, region: body.region, url: body.url, kind: body.kind });
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const messages: Record<string, [string, number]> = {
      SOURCE_INVALID: ['Nama, wilayah, jenis, atau URL tidak valid.', 400], URL_INVALID: ['URL harus HTTPS tanpa kredensial, fragmen, atau alamat lokal literal.', 400], DOMAIN_INVALID: ['Situs pemerintah harus menggunakan domain go.id.', 400], SOURCE_DUPLICATE: ['URL sumber sudah terdaftar.', 409], SOURCE_POSSIBLE_DUPLICATE: ['Domain pemerintah yang sama sudah terdaftar; tinjau sebelum menambahkan.', 409],
    };
    const [message, status] = messages[code] || ['Sumber belum dapat disimpan.', 503]; return errorJson(message, status);
  }
}
