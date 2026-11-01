import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function masterKey(encoded: string | undefined): Buffer {
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('MASTER_KEY_REQUIRED');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('MASTER_KEY_REQUIRED');
  return key;
}
export function masterKeyConfigured(encoded: string | undefined): boolean {
  try { masterKey(encoded); return true; } catch { return false; }
}
export function encryptSecret(value: string, provider: string, encodedMaster: string | undefined): string {
  if (!value || value.length > 1000) throw new Error('SECRET_INVALID');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', masterKey(encodedMaster), iv);
  cipher.setAAD(Buffer.from(`hub-ai:v1:${provider}`));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}
export function decryptSecret(payload: string, provider: string, encodedMaster: string | undefined): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('CIPHERTEXT_INVALID');
  const iv = Buffer.from(parts[1], 'base64'), tag = Buffer.from(parts[2], 'base64'), data = Buffer.from(parts[3], 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('CIPHERTEXT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(encodedMaster), iv);
  decipher.setAAD(Buffer.from(`hub-ai:v1:${provider}`)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
