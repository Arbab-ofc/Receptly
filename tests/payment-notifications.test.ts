import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../apps/server/src/config/env.js';
import { store } from '../apps/server/src/services/store.js';
import { paymentWhatsapp as whatsapp } from '../apps/server/src/modules/whatsapp/payment-sender.js';
import {
  runPaymentNotifications,
  paymentNotificationIdentity,
} from '../apps/server/src/services/payment-notifications.js';
import { memoryStore } from './memory.js';
const original = {
  ADMIN_UIDS: env.ADMIN_UIDS,
  PAYMENT_NOTIFY_WHATSAPP_NUMBER: env.PAYMENT_NOTIFY_WHATSAPP_NUMBER,
};
const now = Date.now();
let sends: { uid: string; jid: string; text: string }[];
beforeEach(async () => {
  memoryStore();
  Object.assign(env, {
    ADMIN_UIDS: 'admin',
    PAYMENT_NOTIFY_WHATSAPP_NUMBER: '919876543210',
  });
  sends = [];
  mock.method(whatsapp, 'getStatus', () => ({ status: 'connected' }));
  mock.method(whatsapp, 'sendMessage', async (uid: string, jid: string, text: string) => {
    sends.push({ uid, jid, text });
    return 'message-one';
  });
  mock.method(paymentNotificationIdentity, 'get', async () => ({
    displayName: 'Alice\nInjected line',
    email: 'alice@example.test',
  }));
  await store.set('manualPayments/alice/payment-one', {
    id: 'payment-one',
    userId: 'alice',
    planId: 'yearly',
    amountPaise: 65000,
    status: 'submitted',
    reference: 'UTR123456789',
    submittedAt: now,
    version: 2,
  });
  await store.set('paymentNotifications/payment-one', {
    id: 'payment-one',
    userId: 'alice',
    phase: 'queued',
    status: 'pending',
    attempts: 0,
    timestamp: now,
    scheduledFor: now,
    createdAt: now,
  });
});
afterEach(() => {
  mock.restoreAll();
  Object.assign(env, original);
});

test('submissions notify only the configured admin recipient once, with identity, plan and reference', async () => {
  await Promise.all([runPaymentNotifications(now), runPaymentNotifications(now)]);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].uid, 'sender');
  assert.equal(sends[0].jid, '919876543210@s.whatsapp.net');
  assert.match(sends[0].text, /Name: Alice Injected line/);
  assert.match(sends[0].text, /alice@example.test/);
  assert.match(sends[0].text, /User ID: alice/);
  assert.match(sends[0].text, /Plan: Yearly \(12 months\)/);
  assert.match(sends[0].text, /Amount: ₹650\.00 INR/);
  assert.match(sends[0].text, /Submitted: .* IST/);
  assert.match(sends[0].text, /UTR123456789/);
  assert.match(sends[0].text, /Bank credit is unverified/);
  assert.equal(await store.get('subscriptions/alice'), null);
  assert.equal(await store.get('paymentNotifications/payment-one'), null);
  assert.equal(
    (await store.get<{ status: string }>('paymentNotificationHistory/payment-one'))!.status,
    'completed',
  );
  await runPaymentNotifications(now + 60000);
  assert.equal(sends.length, 1);
});

test('missing recipient settings and disconnected dedicated sender keep jobs queued without attempts', async () => {
  env.PAYMENT_NOTIFY_WHATSAPP_NUMBER = '';
  await runPaymentNotifications(now);
  env.PAYMENT_NOTIFY_WHATSAPP_NUMBER = '919876543210';
  mock.method(whatsapp, 'getStatus', () => ({ status: 'disconnected' }));
  await runPaymentNotifications(now);
  assert.equal(sends.length, 0);
  assert.equal(
    (await store.get<{ attempts: number }>('paymentNotifications/payment-one'))!.attempts,
    0,
  );
});

test('safe identity failures retry with backoff and later succeed', async () => {
  let first = true;
  mock.method(paymentNotificationIdentity, 'get', async () => {
    if (first) {
      first = false;
      throw new Error('Identity unavailable');
    }
    return { displayName: 'Alice', email: 'alice@example.test' };
  });
  await runPaymentNotifications(now);
  const job = (await store.get<{ status: string; attempts: number; scheduledFor: number }>(
    'paymentNotifications/payment-one',
  ))!;
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 1);
  assert.equal(sends.length, 0);
  await runPaymentNotifications(now + 1);
  assert.equal(sends.length, 0);
  await runPaymentNotifications(job.scheduledFor + 1);
  assert.equal(sends.length, 1);
});

test('uncertain transport delivery is recorded and never automatically repeated', async () => {
  const send = mock.method(whatsapp, 'sendMessage', async () => {
    throw new Error('Acknowledgement lost');
  });
  await runPaymentNotifications(now);
  assert.equal(
    (await store.get<{ status: string }>('paymentNotificationHistory/payment-one'))!.status,
    'uncertain',
  );
  await runPaymentNotifications(now + 60000);
  assert.equal(send.mock.callCount(), 1);
});

test('restart after dispatch preserves uncertainty; preparation can be retried safely', async () => {
  await store.patch('paymentNotifications/payment-one', {
    status: 'processing',
    phase: 'sending',
    leaseUntil: now - 1,
    attempts: 1,
  });
  await runPaymentNotifications(now);
  assert.equal(sends.length, 0);
  assert.equal(
    (await store.get<{ status: string }>('paymentNotificationHistory/payment-one'))!.status,
    'uncertain',
  );
  await store.set('paymentNotifications/payment-one', {
    id: 'payment-one',
    userId: 'alice',
    status: 'processing',
    phase: 'preparing',
    attempts: 1,
    leaseUntil: now - 1,
    scheduledFor: now,
    createdAt: now,
  });
  await runPaymentNotifications(now);
  assert.equal(sends.length, 1);
});

test('already reviewed and deleted customer payments are cancelled rather than sent', async () => {
  await store.patch('manualPayments/alice/payment-one', { status: 'approved' });
  await runPaymentNotifications(now);
  assert.equal(sends.length, 0);
  assert.equal(
    (await store.get<{ status: string }>('paymentNotificationHistory/payment-one'))!.status,
    'cancelled',
  );
  await store.patch('manualPayments/alice/payment-one', { status: 'submitted' });
  await store.set('paymentNotifications/payment-one', {
    id: 'payment-one',
    userId: 'alice',
    status: 'pending',
    phase: 'queued',
    attempts: 0,
    scheduledFor: now,
  });
  await store.set('accountDeletion/alice', { status: 'deleting' });
  await runPaymentNotifications(now);
  assert.equal(sends.length, 0);
});

test('notification retries are bounded and do not retain copied customer identity', async () => {
  await store.patch('paymentNotifications/payment-one', { status: 'failed', attempts: 5 });
  await runPaymentNotifications(now);
  const history = await store.get<{ status: string }>('paymentNotificationHistory/payment-one');
  assert.equal(history!.status, 'failed');
  assert.equal(sends.length, 0);
  assert.equal(JSON.stringify(history).includes('alice@example.test'), false);
});
