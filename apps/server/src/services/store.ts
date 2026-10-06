import { randomUUID, createHash } from 'node:crypto';
import { firebase } from '../config/firebase.js';
import type { ActivityLog, DailyAnalytics } from '@receptly/shared';
import { ServerValue } from 'firebase-admin/database';
import {
  decodeCursor,
  encodeCursor,
  matchesFilter,
  scopeFor,
  type ListQuery,
} from './pagination.js';
import { withLock } from './locks.js';
import { events } from './events.js';
export const key = (value: string) => Buffer.from(value).toString('base64url');
export const stableKey = (value: string) => createHash('sha256').update(value).digest('hex');
export const safeId = (id: string) => {
  if (!/^[\w-]{1,200}$/.test(id))
    throw Object.assign(new Error('Invalid record identifier.'), {
      statusCode: 400,
      code: 'INVALID_ID',
    });
  return id;
};
export const path = (collection: string, uid: string, id?: string) =>
  `${collection}/${safeId(uid)}${id ? `/${safeId(id)}` : ''}`;
export class Store {
  async transaction<T>(p: string, transform: (current: T | null) => T | null | undefined) {
    const result = await firebase().db.ref(p).transaction(transform);
    return { committed: result.committed, value: result.snapshot.val() as T | null };
  }
  async update(values: Record<string, unknown>) {
    await firebase()
      .db.ref()
      .update(JSON.parse(JSON.stringify(values)));
  }
  async keys(p: string) {
    return Object.keys((await this.get<Record<string, unknown>>(p)) || {});
  }
  async page<T extends Record<string, unknown>>(p: string, order: string, options: ListQuery) {
    const scope = scopeFor(p, order, options);
    let anchor = options.cursor ? decodeCursor(options.cursor, scope) : undefined;
    const items: T[] = [];
    let nextCursor: string | null = null;
    // Bound work per request. A page may be empty with a continuation cursor when filters are sparse.
    for (let batch = 0; batch < 20; batch++) {
      let query = firebase().db.ref(p).orderByChild(order);
      if (anchor) query = query.endBefore(anchor.value, anchor.id);
      else if (options.before !== undefined) query = query.endBefore(options.before);
      const snapshot = await query.limitToLast(200).get();
      const records: { id: string; value: T }[] = [];
      snapshot.forEach((child) => {
        records.push({ id: child.key!, value: child.val() as T });
      });
      records.reverse();
      if (!records.length) {
        nextCursor = null;
        break;
      }
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        anchor = { id: record.id, value: Number(record.value[order] || 0), scope };
        if (matchesFilter(record.value, options)) items.push(record.value);
        if (items.length === options.limit) {
          nextCursor =
            index < records.length - 1 || records.length === 200
              ? encodeCursor(anchor.value, anchor.id, scope)
              : null;
          return { items, nextCursor };
        }
      }
      nextCursor = records.length === 200 ? encodeCursor(anchor!.value, anchor!.id, scope) : null;
      if (!nextCursor) break;
    }
    return { items, nextCursor };
  }
  metricUpdates(uid: string, metrics: (keyof DailyAnalytics)[], now = Date.now()) {
    const date = new Date(now);
    const p = `analytics/${safeId(uid)}/daily/${date.toISOString().slice(0, 10)}`;
    const writes: Record<string, unknown> = {};
    for (const name of metrics) {
      writes[`${p}/${name}`] = ServerValue.increment(1);
      if (['incoming', 'autoReplies', 'manualReplies'].includes(name))
        writes[`${p}/hours/${date.getUTCHours()}/${name}`] = ServerValue.increment(1);
    }
    return writes;
  }
  async get<T>(p: string): Promise<T | null> {
    return (await firebase().db.ref(p).get()).val() as T | null;
  }
  async set(p: string, v: unknown) {
    await firebase()
      .db.ref(p)
      .set(JSON.parse(JSON.stringify(v)));
  }
  async patch(p: string, v: object) {
    await firebase()
      .db.ref(p)
      .update(JSON.parse(JSON.stringify(v)));
  }
  async remove(p: string) {
    await firebase().db.ref(p).remove();
  }
  async list<T>(p: string, limit = 100, order = 'createdAt', before?: number): Promise<T[]> {
    let q = firebase().db.ref(p).orderByChild(order);
    if (before !== undefined) q = q.endBefore(before);
    const s = await q.limitToLast(Math.min(limit, 200)).get();
    const out: T[] = [];
    s.forEach((child) => {
      out.push(child.val() as T);
    });
    return out.reverse();
  }
  async find<T>(p: string, field: string, value: string): Promise<T | null> {
    const snapshot = await firebase()
      .db.ref(p)
      .orderByChild(field)
      .equalTo(value)
      .limitToFirst(1)
      .get();
    const records = snapshot.val() as Record<string, T> | null;
    return records ? Object.values(records)[0] : null;
  }
  async findMany<T>(p: string, field: string, value: string, limit = 100): Promise<T[]> {
    const snapshot = await firebase()
      .db.ref(p)
      .orderByChild(field)
      .equalTo(value)
      .limitToFirst(limit)
      .get();
    return Object.values(snapshot.val() || {}) as T[];
  }
  async due<T>(p: string, now: number, limit = 200, field = 'scheduledFor'): Promise<T[]> {
    const snapshot = await firebase()
      .db.ref(p)
      .orderByChild(field)
      .startAt(1)
      .endAt(now)
      .limitToFirst(limit)
      .get();
    const out: T[] = [];
    snapshot.forEach((child) => {
      out.push({ ...child.val(), id: child.val().id || child.key } as T);
    });
    return out;
  }
  async claim(p: string) {
    const result = await firebase()
      .db.ref(p)
      .transaction((current) => (current ? undefined : { timestamp: Date.now() }));
    return result.committed;
  }
  async increment(p: string, delta = 1) {
    await firebase()
      .db.ref(p)
      .transaction((v) => (typeof v === 'number' ? v : 0) + delta);
  }
  async log(
    uid: string,
    type: string,
    message: string,
    severity: ActivityLog['severity'] = 'info',
    metadata: Record<string, unknown> = {},
  ) {
    const id = randomUUID();
    await this.set(path('logs', uid, id), {
      id,
      type,
      message,
      severity,
      metadata,
      timestamp: Date.now(),
    });
    events.emit(uid, { type: 'activity' });
  }
  async metric(uid: string, name: keyof DailyAnalytics, ruleId?: string) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const p = `analytics/${safeId(uid)}/daily/${date}`;
    await this.increment(`${p}/${name}`);
    if (['incoming', 'autoReplies', 'manualReplies'].includes(name))
      await this.increment(`${p}/hours/${now.getUTCHours()}/${name}`);
    if (ruleId) await this.increment(`${p}/rules/${safeId(ruleId)}`);
    events.emit(uid, { type: 'analytics' });
  }
  async metricOnce(uid: string, token: string, name: keyof DailyAnalytics, ruleId?: string) {
    await withLock(`metric:${uid}`, async () => {
      const marker = path('metricClaims', uid, token);
      if (await this.get(marker)) return;
      const writes = this.metricUpdates(uid, [name]);
      if (ruleId)
        writes[
          `analytics/${safeId(uid)}/daily/${new Date().toISOString().slice(0, 10)}/rules/${safeId(ruleId)}`
        ] = ServerValue.increment(1);
      await this.update({ ...writes, [marker]: { timestamp: Date.now() } });
    });
  }
  async counterOnce(uid: string, token: string, counterPath: string) {
    await withLock(`metric:${uid}`, async () => {
      const marker = path('metricClaims', uid, token);
      if (await this.get(marker)) return;
      await this.update({
        [counterPath]: ServerValue.increment(1),
        [marker]: { timestamp: Date.now() },
      });
    });
  }
}
export const store = new Store();
