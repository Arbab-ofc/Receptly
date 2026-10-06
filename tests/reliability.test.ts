import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { store, path, key, stableKey } from '../apps/server/src/services/store.js';
import { memoryStore } from './memory.js';
import { ReceptionistEngine } from '../apps/server/src/modules/receptionist/engine.js';
import {
  defaultSettings,
  defaultHours,
  holidaySchema,
  localDate,
  type Conversation,
  type NormalizedMessage,
} from '@receptly/shared';
import { acquire, finish } from '../apps/server/src/services/operations.js';
import { runSchedulerTick } from '../apps/server/src/jobs/scheduler.js';
import { whatsapp } from '../apps/server/src/modules/whatsapp/manager.js';
import { env } from '../apps/server/src/config/env.js';
import { cleanupWorkspace } from '../apps/server/src/services/retention.js';
import { encryptBackup, decryptBackup } from '../apps/server/src/services/backup.js';
const input: NormalizedMessage = {
  id: 'original',
  userId: 'alice',
  chatId: '123@s.whatsapp.net',
  senderJid: '123@s.whatsapp.net',
  senderNumber: '15555550123',
  senderName: 'Customer',
  type: 'text',
  text: 'hello',
  timestamp: Date.now(),
  fromMe: false,
  isGroup: false,
};
const cid = key(input.chatId);
let engine: ReceptionistEngine;
let calls: number;
beforeEach(async () => {
  memoryStore();
  await store.set('accessProfiles/alice', { tier: 'pro', version: 1 });
  calls = 0;
  engine = new ReceptionistEngine(async () => {
    calls++;
    return `sent-${calls}`;
  });
  await store.set(path('settings', 'alice'), {
    ...defaultSettings,
    timezone: 'UTC',
    automationEnabled: true,
    followUpEnabled: true,
    defaultCooldownMinutes: 0,
  });
  await store.set(
    path('businessHours', 'alice'),
    defaultHours.map((h) => ({ ...h, enabled: true, open: '00:00', close: '23:59' })),
  );
});
afterEach(() => mock.restoreAll());
test('an interrupted intake can retry without losing the message or duplicating counters', async () => {
  const update = store.update.bind(store);
  let fault = true;
  mock.method(store, 'update', async (writes) => {
    if (fault && Object.keys(writes).some((p) => p.endsWith('/stage'))) {
      fault = false;
      throw new Error('database temporarily unavailable');
    }
    await update(writes);
  });
  await assert.rejects(engine.handle(input));
  const p = path('processingInbox', 'alice', key(`${input.chatId}:${input.id}`));
  await store.patch(p, { nextAttemptAt: 0 });
  await engine.handle(input);
  await engine.handle(input);
  assert.equal(
    (await store.get<Conversation>(path('conversations', 'alice', cid)))!.unreadCount,
    1,
  );
  assert.equal(calls, 1);
  assert.equal(
    await store.get(`analytics/alice/daily/${new Date().toISOString().slice(0, 10)}/incoming`),
    1,
  );
});
test('a stored intake checkpoint survives failure before automation', async () => {
  const find = store.findMany.bind(store);
  let fail = true;
  mock.method(store, 'findMany', async (...args) => {
    if (fail) {
      fail = false;
      throw new Error('temporary');
    }
    return find(...args);
  });
  await assert.rejects(engine.handle(input));
  await store.patch(path('processingInbox', 'alice', key(`${input.chatId}:${input.id}`)), {
    nextAttemptAt: 0,
  });
  await engine.handle(input);
  assert.equal(calls, 1);
  assert.equal(
    (await store.get<Conversation>(path('conversations', 'alice', cid)))!.unreadCount,
    1,
  );
});
test('expired processing leases recover after a restart; active claims do not', async () => {
  const p = path('processingInbox', 'alice', key(`${input.chatId}:${input.id}`));
  await store.set(p, {
    payload: input,
    status: 'processing',
    attempts: 1,
    owner: 'old',
    leaseUntil: Date.now() + 10000,
    timestamp: Date.now(),
  });
  await engine.recover('alice');
  assert.equal(calls, 0);
  await store.patch(p, { leaseUntil: Date.now() - 1 });
  await engine.recover('alice');
  assert.equal(calls, 1);
  assert.equal((await store.get<{ status: string }>(p))!.status, 'completed');
});
test('handover recovery finishes its counter once after an interrupted metric write', async () => {
  const metric = store.metricOnce.bind(store);
  let fail = true;
  mock.method(store, 'metricOnce', async (...args) => {
    if (fail && args[2] === 'humanTakeovers') {
      fail = false;
      throw new Error('temporary metric failure');
    }
    await metric(...args);
  });
  const message = { ...input, id: 'handover', text: 'speak to someone' };
  await assert.rejects(engine.handle(message));
  await store.patch(path('processingInbox', 'alice', key(`${message.chatId}:${message.id}`)), {
    nextAttemptAt: 0,
  });
  await engine.handle(message);
  await engine.handle(message);
  assert.equal(calls, 1);
  assert.equal(
    await store.get(
      `analytics/alice/daily/${new Date().toISOString().slice(0, 10)}/humanTakeovers`,
    ),
    1,
  );
});
test('ambiguous transport failures remain uncertain and are never automatically resent', async () => {
  engine = new ReceptionistEngine(async () => {
    calls++;
    throw new Error('timeout after possible delivery');
  });
  await assert.rejects(engine.handle(input));
  await store.patch(path('processingInbox', 'alice', key(`${input.chatId}:${input.id}`)), {
    nextAttemptAt: 0,
  });
  await engine.recover('alice');
  assert.equal(calls, 1);
  assert.ok(
    (await store.list<{ sendStatus?: string }>(`messages/alice/${cid}`)).some(
      (m) => m.sendStatus === 'uncertain',
    ),
  );
});
test('lease ownership prevents an old worker from completing a reclaimed operation', async () => {
  const first = await acquire('operations/example', 100);
  assert.ok(first);
  const second = await acquire('operations/example', 120101);
  assert.ok(second);
  assert.equal(
    (await finish('operations/example', first.owner, { status: 'completed' })).committed,
    false,
  );
  assert.equal(
    (await finish('operations/example', second.owner, { status: 'completed' })).committed,
    true,
  );
});
async function followup() {
  await store.set(path('conversations', 'alice', cid), {
    id: cid,
    chatId: input.chatId,
    contactId: 'customer',
    name: 'Customer',
    number: input.senderNumber,
    automationEnabled: true,
    needsHuman: false,
    unreadCount: 0,
    lastMessageAt: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  await store.set(path('jobs', 'alice', 'follow-up'), {
    id: 'follow-up',
    conversationId: cid,
    payload: { text: 'Checking in' },
    status: 'pending',
    scheduledFor: Date.now() - 1000,
    timestamp: Date.now(),
    attempts: 0,
    createdAt: Date.now(),
  });
  mock.method(whatsapp, 'getStatus', () => ({ status: 'connected' as const }));
  mock.method(whatsapp.engine, 'recover', async () => {});
}
test('a stale job lease is reclaimed and completes once', async () => {
  await followup();
  await store.patch(path('jobs', 'alice', 'follow-up'), {
    status: 'processing',
    owner: 'crashed',
    leaseUntil: 1,
    attempts: 1,
  });
  mock.method(whatsapp.engine, 'reply', async () => {
    calls++;
    return true;
  });
  await runSchedulerTick();
  await runSchedulerTick();
  assert.equal(calls, 1);
  assert.equal(await store.get(path('jobs', 'alice', 'follow-up')), null);
  assert.equal(
    (await store.get<{ status: string }>(path('jobHistory', 'alice', 'follow-up')))!.status,
    'completed',
  );
});
test('follow-ups retry safe failures with backoff but preserve uncertain delivery', async () => {
  await followup();
  mock.method(whatsapp.engine, 'reply', async () => {
    throw Object.assign(new Error('disconnected'), { code: 'WHATSAPP_DISCONNECTED' });
  });
  const now = Date.now();
  await runSchedulerTick(now);
  const job = await store.get<{ status: string; scheduledFor: number; attempts: number }>(
    path('jobs', 'alice', 'follow-up'),
  );
  assert.equal(job!.status, 'failed');
  assert.ok(job!.scheduledFor > now);
  assert.equal(job!.attempts, 1);
  mock.restoreAll();
  mock.method(whatsapp, 'getStatus', () => ({ status: 'connected' as const }));
  mock.method(whatsapp.engine, 'recover', async () => {});
  mock.method(whatsapp.engine, 'reply', async () => {
    throw Object.assign(new Error('uncertain'), { code: 'DELIVERY_UNCERTAIN' });
  });
  await runSchedulerTick(job!.scheduledFor + 1);
  assert.equal(
    (await store.get<{ status: string }>(path('jobs', 'alice', 'follow-up')))!.status,
    'uncertain',
  );
});
test('closed hours defer follow-ups instead of cancelling them', async () => {
  await followup();
  await store.set(
    path('businessHours', 'alice'),
    defaultHours.map((h) => ({ ...h, enabled: false })),
  );
  mock.method(whatsapp.engine, 'reply', async () => {
    calls++;
    return true;
  });
  const now = Date.now();
  await runSchedulerTick(now);
  const job = await store.get<{ status: string; scheduledFor: number; attempts: number }>(
    path('jobs', 'alice', 'follow-up'),
  );
  assert.equal(calls, 0);
  assert.equal(job!.status, 'pending');
  assert.equal(job!.attempts, 0);
  assert.ok(job!.scheduledFor > now);
});
test('cleanup applies to disconnected workspaces and preserves uncertain messages', async () => {
  const previous = env.LOG_RETENTION_DAYS;
  env.LOG_RETENTION_DAYS = 1;
  try {
    await store.set(path('logs', 'alice', 'old'), {
      id: 'old',
      timestamp: Date.now() - 2 * 86400000,
    });
    await store.set(path('logs', 'bob', 'other'), {
      id: 'other',
      timestamp: Date.now() - 2 * 86400000,
    });
    mock.method(whatsapp.engine, 'recover', async () => {});
    await runSchedulerTick();
    assert.equal(await store.get(path('logs', 'alice', 'old')), null);
    assert.ok(await store.get(path('logs', 'bob', 'other')));
  } finally {
    env.LOG_RETENTION_DAYS = previous;
  }
  const days = env.MESSAGE_RETENTION_DAYS;
  env.MESSAGE_RETENTION_DAYS = 1;
  try {
    await store.set(`messages/alice/${cid}/uncertain`, {
      id: 'uncertain',
      timestamp: 1,
      sendStatus: 'uncertain',
    });
    await store.set(`messages/alice/${cid}/sent`, { id: 'sent', timestamp: 1, sendStatus: 'sent' });
    await cleanupWorkspace('alice');
    assert.ok(await store.get(`messages/alice/${cid}/uncertain`));
    assert.equal(await store.get(`messages/alice/${cid}/sent`), null);
  } finally {
    env.MESSAGE_RETENTION_DAYS = days;
  }
});
test('backups round-trip database and session material and reject tampering or wrong keys', () => {
  const secret = 'ab'.repeat(32);
  const backup = {
    format: 'receptly-backup-v1' as const,
    createdAt: new Date().toISOString(),
    database: { settings: { alice: { businessName: 'Test' } } },
    sessions: [
      {
        directory: `user_${stableKey('alice')}`,
        name: 'creds.json',
        contents: Buffer.from('test-only-session').toString('base64'),
      },
    ],
  };
  const blob = encryptBackup(backup, secret);
  assert.deepEqual(decryptBackup(blob, secret), backup);
  assert.equal(blob.includes(Buffer.from('test-only-session')), false);
  const modified = Buffer.from(blob);
  modified[modified.length - 1] ^= 1;
  assert.throws(() => decryptBackup(modified, secret), /integrity/);
  assert.throws(() => decryptBackup(blob, 'cd'.repeat(32)), /integrity/);
  assert.throws(() =>
    encryptBackup({ ...backup, sessions: [{ ...backup.sessions[0], name: '../outside' }] }, secret),
  );
});

test('holiday closures defer follow-ups without consuming retry attempts', async () => {
  await followup();
  await store.set(path('holidays', 'alice', 'holiday'), {
    ...holidaySchema.parse({ name: 'Holiday', date: localDate('UTC') }),
    id: 'holiday',
  });
  mock.method(whatsapp.engine, 'reply', async () => {
    calls++;
    return true;
  });
  const now = Date.now();
  await runSchedulerTick(now);
  assert.equal(calls, 0);
  const job = await store.get<{ scheduledFor: number; attempts: number }>(
    path('jobs', 'alice', 'follow-up'),
  );
  assert.ok(job!.scheduledFor > now);
  assert.equal(job!.attempts, 0);
});

test('inactive subscriptions defer follow-ups without consuming retry attempts', async () => {
  await store.set('accessProfiles/alice', null);
  await followup();
  mock.method(whatsapp.engine, 'reply', async () => {
    calls++;
    return true;
  });
  const now = Date.now();
  await runSchedulerTick(now);
  const job = await store.get<{ status: string; scheduledFor: number; attempts: number }>(
    path('jobs', 'alice', 'follow-up'),
  );
  assert.equal(calls, 0);
  assert.equal(job!.status, 'pending');
  assert.equal(job!.attempts, 0);
  assert.ok(job!.scheduledFor > now);
});

test('daily customer stop cancels queued follow-ups without dispatching', async () => {
  await followup();
  await store.patch(path('conversations', 'alice', cid), {
    receptionistStoppedDate: localDate('UTC'),
  });
  mock.method(whatsapp.engine, 'reply', async () => {
    calls++;
    return true;
  });
  await runSchedulerTick();
  assert.equal(calls, 0);
  assert.equal(
    (await store.get<{ status: string }>(path('jobHistory', 'alice', 'follow-up')))!.status,
    'cancelled',
  );
});
