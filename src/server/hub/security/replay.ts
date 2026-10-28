import type { Client } from '@libsql/client';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Future collector contract only. No route invokes it, and no collector is enabled. */
export function verifyCollectorSignature(input: { timestamp: string; nonce: string; signature: string; rawBody: string }, secret: string, now = Date.now()): boolean {
  if (secret.length < 32 || !/^\d{13}$/.test(input.timestamp) || !/^[A-Za-z0-9_-]{22,128}$/.test(input.nonce) || !/^[0-9a-f]{64}$/i.test(input.signature) || Buffer.byteLength(input.rawBody) > 3_000_000) return false;
  if (Math.abs(now - Number(input.timestamp)) > 5 * 60_000) return false;
  const bodyHash = createHash('sha256').update(input.rawBody).digest('hex');
  const expected = createHmac('sha256', secret).update(`${input.timestamp}.${input.nonce}.${bodyHash}`).digest();
  return timingSafeEqual(expected, Buffer.from(input.signature, 'hex'));
}
export async function consumeNonce(db: Client, nonce: string, now = Date.now()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{22,128}$/.test(nonce)) return false;
  const hash = createHash('sha256').update(nonce).digest('hex');
  const result = await db.execute({ sql: 'INSERT INTO hub_consumed_nonces(nonce_hash,consumed_at_ms,expires_at_ms) VALUES(?,?,?) ON CONFLICT(nonce_hash) DO NOTHING', args: [hash, now, now + 10 * 60_000] });
  return result.rowsAffected === 1;
}
