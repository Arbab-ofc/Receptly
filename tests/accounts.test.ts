import { test, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
Object.assign(process.env, {
  NODE_ENV: 'test',
  FIREBASE_PROJECT_ID: 'receptly-account-test',
  FIREBASE_CLIENT_EMAIL: 'account@example.test',
  FIREBASE_PRIVATE_KEY: 'test-only',
  FIREBASE_DATABASE_URL: 'https://receptly-account-test.firebaseio.com',
});
const instance = initializeApp({
  projectId: 'receptly-account-test',
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  credential: { getAccessToken: async () => ({ access_token: 'test-only', expires_in: 3600 }) },
});
const { buildApp } = await import('../apps/server/src/app.js');
const { store, path } = await import('../apps/server/src/services/store.js');
const { memoryStore } = await import('./memory.js');
const { whatsapp } = await import('../apps/server/src/modules/whatsapp/manager.js');
const { deleteAccount } = await import('../apps/server/src/services/accounts.js');
after(() => deleteApp(instance));
afterEach(() => mock.restoreAll());
const headers = { authorization: 'Bearer test-token' };
test('export is workspace-scoped and excludes credentials and private operation records', async () => {
  memoryStore();
  await store.set('settings/alice', { businessName: 'Alice' });
  await store.set('accessProfiles/alice', { tier: 'pro', version: 1 });
  await store.set('subscriptions/alice', { planId: 'monthly' });
  await store.set('manualPayments/alice/payment-one', { id: 'payment-one', status: 'approved' });
  await store.set('paymentNotifications/payment-one', { id: 'payment-one', userId: 'alice' });
  await store.set('paymentNotificationHistory/payment-one', { id: 'payment-one', userId: 'alice' });
  await store.set('paymentQueue/payment-one', { id: 'payment-one', userId: 'alice' });
  await store.set('catalog/alice/item', { name: 'Haircut' });
  await store.set('holidays/alice/holiday', { name: 'Festival' });
  await store.set('settings/bob', { businessName: 'Bob' });
  await store.set('sendRequests/alice/private', { fingerprint: 'internal' });
  const app = buildApp(async () => 'alice');
  try {
    const response = await app.inject({ url: '/api/v1/account/export', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.data.settings.businessName, 'Alice');
    assert.equal(response.json().data.data.accessProfiles.tier, 'pro');
    assert.equal(response.json().data.data.subscriptions.planId, 'monthly');
    assert.equal(response.json().data.data.manualPayments['payment-one'].status, 'approved');
    assert.equal(response.json().data.data.paymentQueue, undefined);
    assert.equal(response.json().data.data.catalog.item.name, 'Haircut');
    assert.equal(response.json().data.data.holidays.holiday.name, 'Festival');
    assert.equal(response.json().data.data.sendRequests, undefined);
    assert.equal(JSON.stringify(response.json()).includes('Bob'), false);
  } finally {
    await app.close();
  }
});
test('account deletion requires explicit confirmation and a recent login', async () => {
  memoryStore();
  const app = buildApp(async () => ({
    uid: 'alice',
    expiresAt: Date.now() + 60000,
    authTime: Date.now() - 600000,
  }));
  try {
    assert.equal(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/v1/account',
          headers,
          payload: { confirmation: 'yes' },
        })
      ).statusCode,
      400,
    );
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/account',
      headers,
      payload: { confirmation: 'DELETE MY ACCOUNT' },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'RECENT_LOGIN_REQUIRED');
  } finally {
    await app.close();
  }
});
test('confirmed deletion removes one account, closes sessions, and can resume after partial failure', async () => {
  memoryStore();
  await store.set('settings/alice', { businessName: 'Alice' });
  await store.set('accessProfiles/alice', { tier: 'pro', version: 1 });
  await store.set('subscriptions/alice', { planId: 'monthly' });
  await store.set('manualPayments/alice/payment-one', { id: 'payment-one', status: 'approved' });
  await store.set('paymentNotifications/payment-one', { id: 'payment-one', userId: 'alice' });
  await store.set('paymentNotificationHistory/payment-one', { id: 'payment-one', userId: 'alice' });
  await store.set('paymentQueue/payment-one', { id: 'payment-one', userId: 'alice' });
  await store.set('settings/bob', { businessName: 'Bob' });
  await store.set('catalog/alice/item', { name: 'Haircut' });
  await store.set('holidays/alice/holiday', { name: 'Festival' });
  await store.set('messages/alice/chat/one', { text: 'Customer data' });
  mock.method(whatsapp, 'disconnect', async () => {});
  mock.method(whatsapp.engine, 'drain', async () => {});
  const logout = mock.method(whatsapp, 'logout', async () => {});
  const auth = getAuth(instance);
  mock.method(auth, 'revokeRefreshTokens', async () => {});
  let first = true;
  mock.method(auth, 'deleteUser', async () => {
    if (first) {
      first = false;
      throw new Error('temporary failure');
    }
  });
  await assert.rejects(deleteAccount('alice', 'DELETE MY ACCOUNT'));
  assert.ok(await store.get(path('accountDeletion', 'alice')));
  await deleteAccount('alice', 'DELETE MY ACCOUNT');
  assert.equal(await store.get('settings/alice'), null);
  assert.equal(await store.get('accessProfiles/alice'), null);
  assert.equal(await store.get('subscriptions/alice'), null);
  assert.equal(await store.get('manualPayments/alice'), null);
  assert.equal(await store.get('paymentQueue/payment-one'), null);
  assert.equal(await store.get('paymentNotifications/payment-one'), null);
  assert.equal(await store.get('paymentNotificationHistory/payment-one'), null);
  assert.equal(await store.get('messages/alice'), null);
  assert.equal(await store.get('catalog/alice'), null);
  assert.equal(await store.get('holidays/alice'), null);
  assert.equal(
    (await store.get<{ status: string }>(path('accountDeletion', 'alice')))!.status,
    'deleted',
  );
  assert.ok(await store.get('settings/bob'));
  assert.equal(logout.mock.callCount(), 2);
});
