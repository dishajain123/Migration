import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ActiveProvider, ProviderId } from '../../src/types/ai';
import { decrypt, encrypt } from './crypto';

export interface StoredProvider {
  encKey?: string;
  baseUrl?: string | null;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  lastTest?: { ok: boolean; message: string; at: string } | null;
}
interface UserRecord { active: ActiveProvider | null; providers: Partial<Record<ProviderId, StoredProvider>> }
interface FileShape { users: Record<string, UserRecord> }

/** Per-user provider settings. API keys are encrypted at rest and only decrypted inside the server process. */
export class SettingsStore {
  private data: FileShape = { users: {} };

  constructor(private readonly file: string | null, private readonly masterKey: Buffer) {
    if (file && existsSync(file)) {
      try { this.data = JSON.parse(readFileSync(file, 'utf8')) as FileShape; } catch { this.data = { users: {} }; }
    }
  }

  private user(uid: string): UserRecord {
    return (this.data.users[uid] ??= { active: null, providers: {} });
  }
  private persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  getProvider(uid: string, id: ProviderId): StoredProvider { return this.user(uid).providers[id] ?? {}; }
  getActive(uid: string): ActiveProvider | null { return this.user(uid).active; }

  /** Decrypted key for server-side use only. Never return this from an HTTP handler. */
  getKey(uid: string, id: ProviderId): string | null {
    const enc = this.getProvider(uid, id).encKey;
    if (!enc) return null;
    try { return decrypt(enc, this.masterKey); } catch { return null; }
  }

  saveProvider(uid: string, id: ProviderId, patch: { apiKey?: string } & Omit<StoredProvider, 'encKey' | 'lastTest'>) {
    const cur = this.getProvider(uid, id);
    const { apiKey, ...rest } = patch;
    this.user(uid).providers[id] = {
      ...cur, ...rest,
      encKey: apiKey ? encrypt(apiKey, this.masterKey) : cur.encKey,
    };
    this.persist();
  }
  /** Delete the saved key. The active selection is cleared too unless another key source (env) still covers it. */
  clearKey(uid: string, id: ProviderId, keepActive = false) {
    const cur = this.getProvider(uid, id);
    delete cur.encKey;
    this.user(uid).providers[id] = cur;
    const u = this.user(uid);
    if (!keepActive && u.active?.provider === id) u.active = null;
    this.persist();
  }
  setLastTest(uid: string, id: ProviderId, r: { ok: boolean; message: string }) {
    this.user(uid).providers[id] = { ...this.getProvider(uid, id), lastTest: { ...r, at: new Date().toISOString() } };
    this.persist();
  }
  setActive(uid: string, active: ActiveProvider | null) { this.user(uid).active = active; this.persist(); }
}
