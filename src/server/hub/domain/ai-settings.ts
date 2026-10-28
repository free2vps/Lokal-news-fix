import type { Client } from '@libsql/client';
import { decryptSecret, encryptSecret, masterKeyConfigured } from '../security/encryption';

const PROVIDERS = ['openrouter', 'groq', 'cohere'] as const;
type Provider = typeof PROVIDERS[number];
function isProvider(value: unknown): value is Provider { return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value); }
function validModel(provider: Provider, model: unknown): model is string {
  if (typeof model !== 'string' || model.length < 1 || model.length > 150 || !/^[a-zA-Z0-9_.:/-]+$/.test(model)) return false;
  return provider !== 'openrouter' || (model === 'openrouter/free' || model.endsWith(':free'));
}
/** Persist dashboard inputs, but never enable or call any provider in this foundation. */
export async function saveAiSetting(db: Client, input: { provider: unknown; model: unknown; apiKey?: unknown }, master: string | undefined) {
  if (!isProvider(input.provider) || !validModel(input.provider, input.model)) throw new Error('AI_MODEL_INVALID');
  if (input.apiKey != null && (typeof input.apiKey !== 'string' || input.apiKey.length > 1000 || input.apiKey.length < 8 || /\s/.test(input.apiKey))) throw new Error('AI_KEY_INVALID');
  const tx = await db.transaction('write');
  try {
    const existing = (await tx.execute({ sql: 'SELECT key_ciphertext FROM hub_ai_provider_settings WHERE provider=?', args: [input.provider] })).rows[0];
    const ciphertext = typeof input.apiKey === 'string' ? encryptSecret(input.apiKey, input.provider, master) : existing?.key_ciphertext || null;
    await tx.execute({ sql: `INSERT INTO hub_ai_provider_settings(provider,model,key_ciphertext,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(provider) DO UPDATE SET model=excluded.model,key_ciphertext=excluded.key_ciphertext,updated_at=excluded.updated_at`, args: [input.provider, input.model, ciphertext, new Date().toISOString()] });
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
}
export async function readAiSettings(db: Client, master: string | undefined) {
  const rows = (await db.execute('SELECT provider,model,key_ciphertext,updated_at FROM hub_ai_provider_settings ORDER BY provider')).rows;
  return {
    masterKeyReady: masterKeyConfigured(master),
    runtime: 'manual_suggestions',
    policy: await db.execute("SELECT allow_public,groq_free FROM hub_ai_policy_v2 WHERE id='owner'").then(x => ({allowPublic:Number(x.rows[0]?.allow_public)===1,groqFree:Number(x.rows[0]?.groq_free)===1})).catch(() => ({allowPublic:false,groqFree:false})),
    keysReadable: rows.every(r => { if (!r.key_ciphertext) return true; try {decryptSecret(String(r.key_ciphertext),String(r.provider),master);return true;} catch{return false;} }),
    providers: rows.map(r => ({ provider: String(r.provider), model: String(r.model), keyConfigured: Boolean(r.key_ciphertext), updatedAt: String(r.updated_at), use: r.provider === 'cohere' ? 'evaluation_only' : 'disabled' }))
  };
}
