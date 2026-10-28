import { NextResponse } from 'next/server';
import { approveEditorial, editEditorial } from '@/server/hub/domain/editorial';
import { authenticatedDb, errorJson, invalidMutation, NO_STORE, readJson } from '@/server/hub/security/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access = await authenticatedDb(request); if (access.error) return access.error;
  try {
    const raw=new URL(request.url).searchParams.get('offset')||'0';
    if(!/^\d{1,7}$/.test(raw))return errorJson('Offset tidak valid.',400);
    const offset=Number(raw);
    const total=Number((await access.db.execute('SELECT count(*) AS n FROM hub_items')).rows[0].n);
    const rows = (await access.db.execute(`SELECT i.*,s.name AS source_name,
      (SELECT count(*) FROM hub_items other WHERE other.normalized_original_url=i.normalized_original_url AND other.id<>i.id) AS possible_duplicates
      FROM hub_items i JOIN hub_sources s ON s.id=i.source_id ORDER BY i.last_seen_at DESC,i.id LIMIT 100 OFFSET ${offset}`)).rows;
    const items = rows.map(r => ({ id: String(r.id), sourceId: String(r.source_id), sourceName: String(r.source_name), sourceUrl: String(r.original_url), sourceTitle: String(r.source_title), sourceSnippet: r.source_snippet == null ? null : String(r.source_snippet), sourcePublishedAt: r.source_published_at == null ? null : String(r.source_published_at), sourceDateRaw: r.source_date_raw == null ? null : String(r.source_date_raw), firstSeenAt: String(r.first_seen_at), lastSeenAt: String(r.last_seen_at), editorialTitle: r.editorial_title == null ? null : String(r.editorial_title), editorialSummary: r.editorial_summary == null ? null : String(r.editorial_summary), editorialCategory: r.editorial_category == null ? null : String(r.editorial_category), version: Number(r.version), reviewState: String(r.review_state), approvedVersion: r.approved_version == null ? null : Number(r.approved_version), possibleDuplicates: Number(r.possible_duplicates) }));
    return NextResponse.json({ ok: true, items, total, offset, publicationEnabled: false }, { headers: NO_STORE });
  } catch { return errorJson('Data berita belum dapat dibaca.', 503); }
}
export async function POST(request: Request) {
  const rejected = invalidMutation(request); if (rejected) return rejected;
  const access = await authenticatedDb(request); if (access.error) return access.error;
  let body: Record<string, unknown>;
  try { body = await readJson(request); } catch { return errorJson('Permintaan tidak valid atau terlalu besar.', 400); }
  const id = body.id, version = body.version;
  if (typeof id !== 'string' || !/^(?:legacy-news:)?[0-9a-f-]{36}$/.test(id) || typeof version !== 'number' || !Number.isInteger(version)) return errorJson('ID atau versi tidak valid.', 400);
  try {
    if (body.action === 'edit') {
      const values = [body.editorialTitle, body.editorialSummary, body.editorialCategory];
      if (!values.every(v => v === null || typeof v === 'string')) return errorJson('Data editorial tidak valid.', 400);
      const result = await editEditorial(access.db, { id, expectedVersion: version, editorialTitle: body.editorialTitle as string | null, editorialSummary: body.editorialSummary as string | null, editorialCategory: body.editorialCategory as string | null });
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }
    if (body.action === 'approve') {
      const result = await approveEditorial(access.db, id, version, 'owner');
      return NextResponse.json({ ok: true, ...result, publicationEnabled: false }, { headers: NO_STORE });
    }
    return errorJson('Aksi tidak dikenal.', 400);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const messages: Record<string, [string, number]> = { VERSION_CONFLICT: ['Versi telah berubah. Muat ulang sebelum melanjutkan.', 409], NOT_FOUND: ['Berita tidak ditemukan.', 404], IDENTITY_REVIEW_REQUIRED: ['Kemungkinan identitas ganda perlu ditinjau; persetujuan diblokir.', 409], SOURCE_DATE_REQUIRED: ['Tanggal publikasi sumber belum terverifikasi.', 409], INPUT_INVALID: ['Data editorial tidak valid.', 400], VERSION_INVALID: ['Versi tidak valid.', 400] };
    const [message, status] = messages[code] || ['Aksi editorial gagal.', 503]; return errorJson(message, status);
  }
}
