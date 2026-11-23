import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// AES-256-GCM envelope for API keys at rest. Format: v1:<iv b64>:<tag b64>:<ciphertext b64>.

export function parseMasterKey(raw: string): Buffer {
  const t = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64');
  if (buf.length !== 32) throw new Error('GATEWAY_MASTER_KEY must decode to 32 bytes (64 hex chars or base64).');
  return buf;
}

/** Master key: GATEWAY_MASTER_KEY env (production) or an auto-generated, git-ignored file (local demo only). */
export function loadMasterKey(envValue: string | undefined, keyFile: string): Buffer {
  if (envValue) return parseMasterKey(envValue);
  if (existsSync(keyFile)) return parseMasterKey(readFileSync(keyFile, 'utf8'));
  mkdirSync(dirname(keyFile), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  return key;
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string, key: Buffer): string {
  const [v, iv, tag, ct] = payload.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised secret format.');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
