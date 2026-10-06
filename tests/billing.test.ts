import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../apps/server/src/app.js';
import { env } from '../apps/server/src/config/env.js';
import { store, path } from '../apps/server/src/services/store.js';
import { automationEntitled } from '../apps/server/src/services/billing.js';
import {
  subscriptionEnd,
  subscriptionActive,
  effectiveSubscription,
  paymentUpiLink,
  type ManualPayment,
  type Subscription,
  defaultSettings,
  defaultHours,
  type NormalizedMessage,
} from '@receptly/shared';
import { ReceptionistEngine } from '../apps/server/src/modules/receptionist/engine.js';
import { memoryStore } from './memory.js';
let app: ReturnType<typeof buildApp>;
const original = {
  ADMIN_UIDS: env.ADMIN_UIDS,
  PAYMENT_UPI_ID: env.PAYMENT_UPI_ID,
  PAYMENT_PAYEE_NAME: env.PAYMENT_PAYEE_NAME,
};
const headers = (uid = 'alice') => ({ authorization: `Bearer ${uid}` });
beforeEach(() => {
  memoryStore();
  Object.assign(env, {
    ADMIN_UIDS: 'admin',
    PAYMENT_UPI_ID: 'receptly@upi',
    PAYMENT_PAYEE_NAME: 'Receptly',
  });
  app = buildApp(async (token) => token);
});
afterEach(async () => {
  await app.close();
  mock.restoreAll();
  Object.assign(env, original);
});
async function create(uid = 'alice', planId = 'monthly', requestId = randomUUID()) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/billing/payments',
    headers: headers(uid),
    payload: { planId, requestId },
  });
}
async function submitted(
  uid = 'alice',
  planId = 'monthly',
  reference = randomUUID().replaceAll('-', '').toUpperCase(),
) {
  const payment: ManualPayment = (await create(uid, planId)).json().data;
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/v1/billing/payments/${payment.id}`,
    headers: headers(uid),
    payload: { action: 'submit', reference, expectedVersion: 1 },
  });
  assert.equal(response.statusCode, 200);
  return response.json().data as ManualPayment;
}
async function approve(payment: ManualPayment, payload: object = {}) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/payments/${payment.id}`,
    headers: headers('admin'),
    payload: {
      decision: 'approve',
      expectedVersion: payment.version,
      bankCreditVerified: true,
      verifiedAmountPaise: payment.amountPaise,
      ...payload,
    },
  });
}
test('plans have exact server prices; client amounts and unknown plans are rejected', async () => {
  const response = await app.inject({ url: '/api/v1/billing/plans' });
  assert.deepEqual(
    response.json().data.plans.map((plan: { amountPaise: number }) => plan.amountPaise),
    [5900, 65000],
  );
  const tampered = await app.inject({
    method: 'POST',
    url: '/api/v1/billing/payments',
    headers: headers(),
    payload: { planId: 'yearly', amountPaise: 1, requestId: randomUUID() },
  });
  assert.equal(tampered.statusCode, 400);
  assert.equal((await create('alice', 'unknown')).statusCode, 400);
  assert.equal((await create('alice', 'yearly')).json().data.amountPaise, 65000);
});
test('payment creation is idempotent and concurrent pending requests cannot duplicate', async () => {
  const requestId = randomUUID();
  const responses = await Promise.all([
    create('alice', 'monthly', requestId),
    create('alice', 'monthly', requestId),
  ]);
  assert.equal(responses[0].json().data.id, responses[1].json().data.id);
  assert.equal((await create()).statusCode, 409);
  assert.equal((await store.list(path('manualPayments', 'alice'))).length, 1);
  assert.equal((await create('alice', 'yearly', requestId)).statusCode, 409);
});
test('unconfigured recipient disables requests; tenants cannot read or submit each other payments', async () => {
  env.PAYMENT_UPI_ID = '';
  assert.equal((await create()).statusCode, 503);
  env.PAYMENT_UPI_ID = 'receptly@upi';
  const payment = (await create()).json().data;
  assert.equal(
    (await app.inject({ url: `/api/v1/billing/payments/${payment.id}`, headers: headers('bob') }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/billing/payments/${payment.id}`,
        headers: headers('bob'),
        payload: { action: 'cancel', expectedVersion: 1 },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/admin/payments', headers: headers() })).statusCode,
    403,
  );
  const details = await app.inject({
    url: `/api/v1/billing/payments/${payment.id}`,
    headers: headers(),
  });
  assert.match(details.json().data.qrDataUrl, /^data:image\/png;base64,/);
  assert.equal(new URL(details.json().data.upiLink).searchParams.get('am'), '59.00');
});
test('reference submission does not activate access; global duplicate references and stale changes fail', async () => {
  const alice = await submitted('alice', 'monthly', 'BANKREFERENCE001');
  assert.equal((await store.list<{ status: string }>('paymentNotifications', 10)).length, 1);
  assert.equal(await store.get(path('subscriptions', 'alice')), null);
  const retry = await app.inject({
    method: 'PATCH',
    url: `/api/v1/billing/payments/${alice.id}`,
    headers: headers(),
    payload: { action: 'submit', reference: 'bankreference001', expectedVersion: 1 },
  });
  assert.equal(retry.statusCode, 200);
  const bob = (await create('bob')).json().data;
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/billing/payments/${bob.id}`,
        headers: headers('bob'),
        payload: { action: 'submit', reference: 'BANKREFERENCE001', expectedVersion: 1 },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/billing/payments/${alice.id}`,
        headers: headers(),
        payload: { action: 'cancel', expectedVersion: 2 },
      })
    ).statusCode,
    409,
  );
});
test('approval requires admin, a bank confirmation and exact credited amount', async () => {
  const payment = await submitted();
  const unauthorized = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/payments/${payment.id}`,
    headers: headers(),
    payload: {
      decision: 'approve',
      expectedVersion: 2,
      bankCreditVerified: true,
      verifiedAmountPaise: 5900,
    },
  });
  assert.equal(unauthorized.statusCode, 403);
  assert.equal((await approve(payment, { bankCreditVerified: false })).statusCode, 400);
  assert.equal((await approve(payment, { verifiedAmountPaise: 1 })).statusCode, 400);
  assert.equal((await approve(payment, { expectedVersion: 1 })).statusCode, 409);
  assert.equal(await store.get(path('subscriptions', 'alice')), null);
});
test('concurrent approval grants exactly one period and records an audit entry atomically', async () => {
  const payment = await submitted();
  const results = await Promise.all([approve(payment), approve(payment)]);
  assert.ok(results.every((response) => response.statusCode === 200));
  const subscription = await store.get<Subscription>(path('subscriptions', 'alice'));
  assert.equal(subscription!.version, 1);
  assert.equal(subscription!.expiresAt, subscriptionEnd(subscription!.startsAt, 1));
  assert.equal((await store.list('adminAudit')).length, 1);
  assert.equal((await store.get<ManualPayment>(`paymentQueue/${payment.id}`))?.status, 'approved');
});
test('different plan is scheduled after current expiry; rejection does not grant access and needs a reason', async () => {
  const first = await submitted();
  await approve(first);
  const current = (await store.get<Subscription>(path('subscriptions', 'alice')))!;
  const renewal = await submitted('alice', 'yearly');
  await approve(renewal);
  const extended = (await store.get<Subscription>(path('subscriptions', 'alice')))!;
  assert.equal(extended.startsAt, current.startsAt);
  assert.equal(extended.expiresAt, subscriptionEnd(current.expiresAt, 12));
  assert.equal(extended.planId, 'monthly');
  assert.equal(extended.scheduledPlan?.planId, 'yearly');
  assert.equal(extended.scheduledPlan?.startsAt, current.expiresAt);
  assert.equal(effectiveSubscription(extended, current.expiresAt - 1)?.planId, 'monthly');
  const switched = effectiveSubscription(extended, current.expiresAt)!;
  assert.equal(switched.planId, 'yearly');
  assert.equal(switched.scheduledPlan, undefined);
  assert.equal(subscriptionActive(switched, current.expiresAt), true);
  assert.equal(subscriptionActive(switched, extended.expiresAt), false);
  assert.equal((await create('alice', 'yearly')).json().error.code, 'PLAN_SCHEDULED');
  assert.equal((await create('alice', 'monthly')).json().error.code, 'PLAN_SCHEDULED');
  const bob = await submitted('bob');
  const url = `/api/v1/admin/payments/${bob.id}`;
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url,
        headers: headers('admin'),
        payload: { decision: 'reject', expectedVersion: 2, note: '' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url,
        headers: headers('admin'),
        payload: {
          decision: 'reject',
          expectedVersion: 2,
          note: 'Credit not found in bank account.',
        },
      })
    ).statusCode,
    200,
  );
  assert.equal(await store.get(path('subscriptions', 'bob')), null);
});
test('failed activation write leaves payment submitted and allows a safe retry', async () => {
  const payment = await submitted();
  const originalUpdate = store.update;
  let fail = true;
  mock.method(store, 'update', async (updates) => {
    if (fail && Object.keys(updates).some((key) => key.startsWith('subscriptions/'))) {
      fail = false;
      throw new Error('temporary database failure');
    }
    await originalUpdate(updates);
  });
  assert.equal((await approve(payment)).statusCode, 500);
  assert.equal(await store.get(path('subscriptions', 'alice')), null);
  assert.equal(
    (await store.get<ManualPayment>(path('manualPayments', 'alice', payment.id)))!.status,
    'submitted',
  );
  assert.equal((await approve(payment)).statusCode, 200);
});
test('paid enforcement blocks unpaid automation, preserves intake and allows active subscriptions', async () => {
  assert.equal(await automationEntitled('alice'), false);
  await store.set(path('settings', 'alice'), {
    ...defaultSettings,
    automationEnabled: true,
    timezone: 'UTC',
    defaultCooldownMinutes: 0,
  });
  await store.set(
    path('businessHours', 'alice'),
    defaultHours.map((hour) => ({ ...hour, enabled: true, open: '00:00', close: '23:59' })),
  );
  let sent = 0;
  const engine = new ReceptionistEngine(async () => {
    sent++;
    return `sent-${sent}`;
  });
  const message: NormalizedMessage = {
    id: 'unpaid',
    userId: 'alice',
    chatId: '123456789@s.whatsapp.net',
    senderJid: '123456789@s.whatsapp.net',
    senderNumber: '123456789',
    type: 'text',
    text: 'hello',
    timestamp: Date.now(),
    fromMe: false,
    isGroup: false,
  };
  await engine.handle(message);
  assert.equal(sent, 0);
  assert.equal((await store.list(path('conversations', 'alice'))).length, 1);
  const payment = await submitted();
  await approve(payment);
  assert.equal(await automationEntitled('alice'), true);
  await engine.handle({ ...message, id: 'paid' });
  assert.equal(sent, 1);
  await store.patch(path('subscriptions', 'alice'), { expiresAt: Date.now() - 1 });
  assert.equal(await automationEntitled('alice'), false);
});
test('calendar periods handle January month ends and leap days with exclusive expiry', () => {
  assert.equal(
    new Date(subscriptionEnd(Date.parse('2026-01-31T10:30:00Z'), 1)).toISOString(),
    '2026-02-28T10:30:00.000Z',
  );
  assert.equal(
    new Date(subscriptionEnd(Date.parse('2028-02-29T10:30:00Z'), 12)).toISOString(),
    '2029-02-28T10:30:00.000Z',
  );
  const sub = {
    startsAt: 1000,
    expiresAt: 2000,
    lastPaymentId: 'id',
    updatedAt: 1000,
    version: 1,
    planId: 'monthly' as const,
  };
  assert.equal(subscriptionActive(sub, 1000), true);
  assert.equal(subscriptionActive(sub, 2000), false);
  assert.equal(subscriptionActive(sub, 999), false);
  assert.equal(
    paymentUpiLink({
      upiId: 'test@upi',
      payeeName: 'Studio & Co',
      amountPaise: 65000,
      currency: 'INR',
      planId: 'yearly',
      id: 'request-id',
    } as ManualPayment).includes('am=650.00'),
    true,
  );
});

test('admin can grant complimentary Pro and revoke both complimentary and paid access', async () => {
  const { adminIdentity } = await import('../apps/server/src/services/admin.js');
  mock.method(adminIdentity, 'get', async (uid: string) => ({ uid, metadata: {} }));
  const change = (tier: string, version: number, actor = 'admin') =>
    app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/alice/plan',
      headers: headers(actor),
      payload: { tier, expectedVersion: version },
    });
  assert.equal(await automationEntitled('alice'), false);
  assert.equal((await change('pro', 0, 'alice')).statusCode, 403);
  const grant = await change('pro', 0);
  assert.equal(grant.statusCode, 200);
  assert.equal(grant.json().data.source, 'admin');
  assert.equal(grant.json().data.expiresAt, null);
  assert.equal(await store.get('manualPayments/alice'), null);
  assert.equal(await automationEntitled('alice', Date.now() + 10 * 365 * 86400000), true);
  const summary = await app.inject({ url: '/api/v1/billing', headers: headers() });
  assert.equal(summary.json().data.access.tier, 'pro');
  assert.equal(summary.json().data.active, true);
  assert.equal(summary.json().data.enforcementEnabled, true);
  assert.equal((await change('free', 0)).statusCode, 409);
  await store.set('subscriptions/alice', {
    planId: 'yearly',
    startsAt: Date.now() - 1000,
    expiresAt: Date.now() + 86400000,
    version: 1,
  });
  assert.equal((await change('free', 1)).statusCode, 200);
  assert.equal(await automationEntitled('alice'), false);
  assert.ok((await store.get<Subscription>('subscriptions/alice'))!.expiresAt <= Date.now());
  const audit = await store.list<{ action: string }>('adminAudit', 10);
  assert.ok(audit.some((entry) => entry.action === 'pro_granted'));
  assert.ok(audit.some((entry) => entry.action === 'pro_revoked'));
  const paid = await submitted();
  assert.equal((await approve(paid)).statusCode, 200);
  assert.equal(await automationEntitled('alice'), true);
  assert.equal((await change('free', 2)).statusCode, 409);
  assert.equal((await change('free', 3)).statusCode, 200);
  assert.equal(await automationEntitled('alice'), false);
  assert.equal(
    (await store.get<ManualPayment>(`manualPayments/alice/${paid.id}`))!.status,
    'approved',
  );
});

test('admin plan changes are atomic and reject deleted accounts and invalid tiers', async () => {
  const { adminIdentity } = await import('../apps/server/src/services/admin.js');
  mock.method(adminIdentity, 'get', async (uid: string) => ({ uid, metadata: {} }));
  const change = (tier = 'pro') =>
    app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/alice/plan',
      headers: headers('admin'),
      payload: { tier, expectedVersion: 0 },
    });
  assert.equal((await change('premium')).statusCode, 400);
  await store.set('accountDeletion/alice', { status: 'deleting' });
  assert.equal((await change()).statusCode, 409);
  await store.set('accountDeletion/alice', null);
  mock.method(store, 'update', async () => {
    throw new Error('Database unavailable');
  });
  assert.equal((await change()).statusCode, 500);
  assert.equal(await automationEntitled('alice'), false);
  assert.equal(await store.get('accessProfiles/alice'), null);
  assert.equal(await store.get('adminAudit'), null);
});

test('platform admins are always Pro despite Free grants and expired subscriptions; downgrades are rejected', async () => {
  await store.set('accessProfiles/admin', { tier: 'free', version: 4 });
  await store.set('subscriptions/admin', {
    planId: 'monthly',
    startsAt: 1,
    expiresAt: 2,
    version: 1,
  });
  assert.equal(await automationEntitled('admin'), true);
  assert.equal(await automationEntitled('admin', Date.now() + 50 * 365 * 86400000), true);
  const summary = await app.inject({ url: '/api/v1/billing', headers: headers('admin') });
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.json().data.active, true);
  assert.equal(summary.json().data.access.source, 'platform_admin');
  assert.equal(summary.json().data.access.expiresAt, null);
  const account = await app.inject({ url: '/api/v1/account/access', headers: headers('admin') });
  assert.equal(account.json().data.admin, true);
  assert.equal(account.json().data.access.tier, 'pro');
  const downgrade = await app.inject({
    method: 'PATCH',
    url: '/api/v1/admin/users/admin/plan',
    headers: headers('admin'),
    payload: { tier: 'free', expectedVersion: 4 },
  });
  assert.equal(downgrade.statusCode, 409);
  assert.equal(downgrade.json().error.code, 'ADMIN_PLAN_FIXED');
  assert.equal((await store.get<{ version: number }>('accessProfiles/admin'))!.version, 4);
  assert.equal(await store.get('adminAudit'), null);
  env.ADMIN_UIDS = '';
  assert.equal(await automationEntitled('admin'), false);
});

test('same active plan is blocked server-side and can be purchased after expiry', async () => {
  await approve(await submitted());
  const blocked = await create();
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error.code, 'PLAN_ACTIVE');
  await store.patch('subscriptions/alice', { expiresAt: Date.now() - 1 });
  assert.equal((await create()).statusCode, 200);
});
test('a scheduled plan becomes the current plan in billing at its start', async () => {
  const now = Date.now();
  await store.set('subscriptions/alice', {
    planId: 'monthly',
    startsAt: now - 10000,
    expiresAt: now + 10000,
    lastPaymentId: 'old',
    updatedAt: now,
    version: 2,
    scheduledPlan: {
      planId: 'yearly',
      startsAt: now - 1000,
      expiresAt: now + 10000,
      paymentId: 'next',
    },
  });
  const response = await app.inject({ url: '/api/v1/billing', headers: headers() });
  assert.equal(response.json().data.subscription.planId, 'yearly');
  assert.equal(response.json().data.subscription.scheduledPlan, undefined);
  assert.equal((await create('alice', 'yearly')).json().error.code, 'PLAN_ACTIVE');
});
