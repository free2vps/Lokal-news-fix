import type { Client } from '@libsql/client';
export async function migrationStatus(db: Client) {
 const tables=(await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('hub_ai_daily_v2','hub_ai_cache_v2','hub_ai_policy_v2')")).rows;
 return {ready:tables.length===3, counts:(await db.execute("SELECT (SELECT count(*) FROM hub_items) AS items,(SELECT count(*) FROM hub_sources) AS sources")).rows[0]};
}
/** Explicit owner operation, never called at request startup. Transaction rolls back on duplicate/index failure. */
export async function prepareOperationalSchema(db: Client){
 const tx=await db.transaction('write');
 try{
  for(const table of ['hub_sources','hub_items']) {
   if((await tx.execute(`SELECT id FROM ${table} GROUP BY id HAVING count(*)>1 LIMIT 1`)).rows.length)throw Error('SCHEMA_CONFLICT');
   await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_migration_id_unique ON ${table}(id)`);
  }
  await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS hub_sources_operational_url_unique ON hub_sources(normalized_url)');
  await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS hub_items_operational_identity_unique ON hub_items(source_id,identity_key)');
  // CSV-created columns can lack defaults. Repair nulls only, never overwrite editorial values.
  await tx.execute('UPDATE hub_items SET version=1 WHERE version IS NULL');
  if((await tx.execute('SELECT id FROM hub_items WHERE version<1 OR version!=CAST(version AS INTEGER) LIMIT 1')).rows.length)throw Error('SCHEMA_CONFLICT');
  if((await tx.execute('SELECT i.id FROM hub_items i LEFT JOIN hub_sources s ON s.id=i.source_id WHERE s.id IS NULL LIMIT 1')).rows.length)throw Error('SCHEMA_CONFLICT');
  await tx.execute('CREATE TABLE IF NOT EXISTS hub_ai_policy_v2 (id TEXT PRIMARY KEY CHECK(id=\'owner\'),allow_public INTEGER NOT NULL DEFAULT 0,groq_free INTEGER NOT NULL DEFAULT 0)');
  await tx.execute("INSERT OR IGNORE INTO hub_ai_policy_v2(id) VALUES('owner')");
  await tx.execute('CREATE TABLE IF NOT EXISTS hub_ai_daily_v2 (day TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0)');
  await tx.execute('CREATE TABLE IF NOT EXISTS hub_ai_cache_v2 (fingerprint TEXT PRIMARY KEY,summary TEXT NOT NULL,provider TEXT NOT NULL,created_at TEXT NOT NULL)');
  await tx.commit();return migrationStatus(db);
 }catch(e){await tx.rollback();throw e;}
}
