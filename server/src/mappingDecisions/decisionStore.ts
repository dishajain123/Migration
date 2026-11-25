import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MappingDecisionRecord } from '../../../src/types/decisions';
import { GatewayError } from '../providers/types';

interface FileShape { users: Record<string, Record<string, MappingDecisionRecord>> }

export const MAX_DECISIONS_PER_USER = 20_000;

/**
 * Per-user store of human mapping decisions (approve / reject). Persisted as JSON next to the other gateway data so the
 * decisions outlive the browser; `file = null` keeps them in memory only (tests). Holds no secrets: only the reviewer's
 * decision about a source -> target pairing. Approved records feed few-shot context and evaluation runs.
 */
export class DecisionStore {
  private data: FileShape = { users: {} };

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try { this.data = JSON.parse(readFileSync(file, 'utf8')) as FileShape; } catch { this.data = { users: {} }; }
      if (!this.data.users || typeof this.data.users !== 'object') this.data = { users: {} };
    }
  }

  private user(uid: string): Record<string, MappingDecisionRecord> { return (this.data.users[uid] ??= {}); }

  private persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  /** Newest first. */
  list(uid: string): MappingDecisionRecord[] {
    return Object.values(this.user(uid)).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  }

  upsert(uid: string, rec: MappingDecisionRecord): MappingDecisionRecord {
    const mine = this.user(uid);
    if (!mine[rec.id] && Object.keys(mine).length >= MAX_DECISIONS_PER_USER) throw new GatewayError('BAD_REQUEST', 'Too many stored decisions; remove some first.', 409);
    mine[rec.id] = rec;
    this.persist();
    return rec;
  }

  remove(uid: string, id: string): boolean {
    const mine = this.user(uid);
    if (!mine[id]) return false;
    delete mine[id];
    this.persist();
    return true;
  }
}
