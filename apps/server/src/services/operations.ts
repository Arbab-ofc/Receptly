import { randomUUID } from 'node:crypto';
import { store } from './store.js';
export type Operation = {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'uncertain';
  timestamp: number;
  attempts: number;
  owner?: string;
  leaseUntil?: number;
  nextAttemptAt?: number;
  errorCode?: string;
};
export const leaseMs = 120_000;
export const backoff = (attempt: number) => Math.min(300_000, 1000 * 2 ** Math.min(attempt, 8));
export async function acquire(p: string, now = Date.now()) {
  const owner = randomUUID();
  const result = await store.transaction<Operation>(p, (current) => {
    if (current?.status === 'completed' || current?.status === 'uncertain') return undefined;
    if (current?.status === 'processing' && (current.leaseUntil || 0) > now) return undefined;
    if ((current?.nextAttemptAt || 0) > now || (current?.attempts || 0) >= 5) return undefined;
    // Legacy deduplication records represent already processed work.
    if (current && !current.status) return undefined;
    return {
      ...current,
      status: 'processing',
      attempts: (current?.attempts || 0) + 1,
      timestamp: now,
      leaseUntil: now + leaseMs,
      owner,
    };
  });
  return result.committed ? { owner, attempts: result.value!.attempts } : null;
}
export async function finish(p: string, owner: string, fields: Partial<Operation>) {
  return store.transaction<Operation>(p, (current) =>
    current?.owner === owner
      ? { ...current, ...fields, timestamp: Date.now(), leaseUntil: fields.leaseUntil || 0 }
      : undefined,
  );
}
