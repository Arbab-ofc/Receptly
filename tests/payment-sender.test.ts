import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import makeWASocket from '@whiskeysockets/baileys';
import { WhatsAppConnectionManager } from '../apps/server/src/modules/whatsapp/manager.js';
import {
  paymentWhatsapp,
  paymentSenderSessionId,
} from '../apps/server/src/modules/whatsapp/payment-sender.js';
import type { SessionAuth, SessionStorage } from '../apps/server/src/modules/whatsapp/storage.js';
import { buildApp } from '../apps/server/src/app.js';
import { env } from '../apps/server/src/config/env.js';
import { store } from '../apps/server/src/services/store.js';
import { memoryStore } from './memory.js';
import { defaultSettings } from '@receptly/shared';
const originalAdmins = env.ADMIN_UIDS;
beforeEach(() => {
  memoryStore();
  env.ADMIN_UIDS = 'admin';
});
afterEach(() => {
  mock.restoreAll();
  env.ADMIN_UIDS = originalAdmins;
});
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};
function harness(purpose: 'automation' | 'payment-notifications') {
  const handlers: Record<string, (event: unknown) => void> = {};
  const storage: SessionStorage = {
    load: async () =>
      ({
        state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
        saveCreds: async () => {},
      }) as unknown as SessionAuth,
    destroy: async () => {},
    flush: async () => {},
  };
  const socket = {
    ev: {
      on: (name: string, fn: (event: unknown) => void) => {
        handlers[name] = fn;
      },
    },
    user: { id: '919876543210:1@s.whatsapp.net', name: 'Payments' },
    end: () => {},
    logout: async () => {},
    sendMessage: async () => ({ key: { id: 'notification-one' } }),
  };
  const factory = (() => socket) as unknown as typeof makeWASocket;
  return { manager: new WhatsAppConnectionManager(storage, purpose, factory), handlers, storage };
}

test('payment socket uses separate metadata, skips receptionist intake and can unlink independently', async () => {
  const automation = harness('automation');
  const payment = harness('payment-notifications');
  const intake = mock.method(payment.manager.engine, 'handle', async () => {});
  await automation.manager.connect('alice');
  await payment.manager.connect('sender');
  automation.handlers['connection.update']({ connection: 'open' });
  payment.handlers['connection.update']({ connection: 'open' });
  await settle();
  assert.equal(automation.manager.getStatus('alice').status, 'connected');
  assert.equal(payment.manager.getStatus('sender').status, 'connected');
  assert.equal((await store.get<{ status: string }>('whatsapp/alice'))!.status, 'connected');
  assert.equal(
    (await store.get<{ status: string }>('paymentWhatsApp/sender'))!.status,
    'connected',
  );
  assert.equal(await store.get('whatsapp/sender'), null);
  payment.handlers['messages.upsert']({
    type: 'notify',
    messages: [
      {
        key: { id: 'incoming-one', remoteJid: '919999999999@s.whatsapp.net', fromMe: false },
        message: { conversation: 'hello' },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    ],
  });
  await settle();
  assert.equal(intake.mock.callCount(), 0);
  const destroyed = mock.method(payment.storage, 'destroy', async () => {});
  await payment.manager.logout('sender');
  assert.equal(destroyed.mock.calls[0].arguments[0], 'sender');
  assert.equal(payment.manager.getStatus('sender').status, 'disconnected');
  assert.equal(automation.manager.getStatus('alice').status, 'connected');
  await automation.manager.shutdown();
  await payment.manager.shutdown();
});

test('dedicated payment connection restores without reading workspace sessions', async () => {
  const payment = harness('payment-notifications');
  await store.set('paymentWhatsApp/sender', { status: 'connected' });
  const connected = mock.method(payment.manager, 'connect', async () => {});
  await payment.manager.restore();
  assert.equal(connected.mock.callCount(), 1);
  assert.equal(connected.mock.calls[0].arguments[0], 'sender');
  assert.equal(await store.get('whatsapp/sender'), null);
});

test('only admins can read the payment QR or mutate its connection', async () => {
  const app = buildApp(async (token) => token);
  const connect = mock.method(paymentWhatsapp, 'connect', async () => {});
  mock.method(paymentWhatsapp, 'getStatus', () => ({
    status: 'qr_required',
    qr: 'private-qr',
    qrExpiresAt: Date.now() + 60000,
  }));
  try {
    for (const action of ['status', 'connect', 'reconnect', 'disconnect', 'logout']) {
      const denied = await app.inject({
        url: `/api/v1/admin/payment-whatsapp/${action}`,
        method: action === 'status' ? 'GET' : 'POST',
        headers: { authorization: 'Bearer alice' },
      });
      assert.equal(denied.statusCode, 403);
      assert.equal(denied.body.includes('private-qr'), false);
    }
    const read = await app.inject({
      url: '/api/v1/admin/payment-whatsapp/status',
      headers: { authorization: 'Bearer admin' },
    });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().data.qr, 'private-qr');
    const linked = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/payment-whatsapp/connect',
      headers: { authorization: 'Bearer admin' },
    });
    assert.equal(linked.statusCode, 200);
    assert.equal(connect.mock.calls[0].arguments[0], paymentSenderSessionId);
    assert.equal(
      (await store.list<{ action: string }>('adminAudit', 10))[0].action,
      'payment_whatsapp_connect',
    );
  } finally {
    await app.close();
  }
});

test('automation ingests live and offline deliveries, deduplicates them and replies with Firebase-omitted lists', async () => {
  memoryStore({ strictTransactions: true });
  const automation = harness('automation');
  const settings = {
    ...defaultSettings,
    automationEnabled: true,
    outOfHoursEnabled: false,
    mode: 'Available' as const,
    defaultCooldownMinutes: 0,
    fallbackCooldownMinutes: 0,
  };
  const { menuOptions: _menu, ...storedSettings } = settings;
  await store.set('settings/admin', storedSettings);
  await automation.manager.connect('admin');
  automation.handlers['connection.update']({ connection: 'open' });
  await settle();
  const send = mock.method(automation.manager, 'sendMessage', async () => 'reply-' + Math.random());
  const incoming = (id: string) => ({
    key: { id, remoteJid: '919999999999@s.whatsapp.net', fromMe: false },
    message: { conversation: 'hello' },
    messageTimestamp: Math.floor(Date.now() / 1000),
  });
  automation.handlers['messages.upsert']({ type: 'append', messages: [incoming('offline-one')] });
  await automation.manager.engine.drain();
  await settle();
  assert.equal((await store.list('conversations/admin')).length, 1);
  assert.equal(send.mock.callCount(), 1);
  automation.handlers['messages.upsert']({
    type: 'notify',
    messages: [incoming('offline-one'), incoming('live-two')],
  });
  await automation.manager.engine.drain();
  await settle();
  assert.equal(send.mock.callCount(), 2);
  const intake = await store.list<{ status: string }>('processingInbox/admin');
  assert.equal(intake.length, 2);
  assert.ok(intake.every((record) => record.status === 'completed'));
  await automation.manager.shutdown();
});
