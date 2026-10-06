import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import {
  subscriptionPlans,
  planIdSchema,
  paymentReferenceSchema,
  subscriptionActive,
  effectiveSubscription,
  subscriptionEnd,
  paymentUpiLink,
  type ManualPayment,
  type Subscription,
} from '@receptly/shared';
import { env } from '../config/env.js';
import { store, path, stableKey, safeId } from './store.js';
import { withLock } from './locks.js';
import { listQuery } from './pagination.js';
import { events } from './events.js';
import { isPlatformAdmin } from './roles.js';
import { accessProfile, type AccessGrant } from './access.js';
const ok = (data: unknown) => ({ success: true, data });
const fail = (message: string, code: string, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });
export const paymentsConfigured = () => !!(env.PAYMENT_UPI_ID && env.PAYMENT_PAYEE_NAME);
export async function automationEntitled(uid: string, now = Date.now()) {
  return (await accessProfile(uid, now)).tier === 'pro';
}
const mutate = <T>(uid: string, fn: () => Promise<T>) =>
  withLock('billing', () =>
    withLock(`workspace:${uid}`, async () => {
      if (await store.get(path('accountDeletion', uid)))
        throw fail('Account deletion is in progress.', 'ACCOUNT_DELETING');
      return fn();
    }),
  );
async function getPayment(uid: string, id: string) {
  const payment = await store.get<ManualPayment>(path('manualPayments', uid, id));
  if (!payment) throw fail('Payment request not found.', 'NOT_FOUND', 404);
  return payment;
}
function checkVersion(payment: ManualPayment, version: number) {
  if (payment.version !== version)
    throw fail('This payment changed. Refresh before continuing.', 'VERSION_CONFLICT');
}
function checkPurchase(subscription: Subscription | null, planId: string, now = Date.now()) {
  const current = effectiveSubscription(subscription, now);
  if (!subscriptionActive(current, now)) return;
  if (current!.scheduledPlan)
    throw fail(
      'Your next plan is already scheduled. Wait until it expires before purchasing again.',
      'PLAN_SCHEDULED',
    );
  if (current!.planId === planId)
    throw fail(
      'You can purchase this plan again after your current subscription expires.',
      'PLAN_ACTIVE',
    );
}
function writes(payment: ManualPayment) {
  return {
    [path('manualPayments', payment.userId, payment.id)]: payment,
    [`paymentQueue/${payment.id}`]: payment,
  };
}
export async function registerBilling(api: FastifyInstance) {
  api.get('/billing', async (r) => {
    const subscription = await store.get<Subscription>(path('subscriptions', r.uid));
    const access = await accessProfile(r.uid);
    return ok({
      plans: subscriptionPlans,
      paymentConfigured: paymentsConfigured(),
      enforcementEnabled: true,
      access,
      subscription: effectiveSubscription(subscription),
      active: access.tier === 'pro',
      payments: await store.list<ManualPayment>(path('manualPayments', r.uid), 50),
    });
  });
  api.get('/billing/payments', async (r) =>
    ok(await store.page(path('manualPayments', r.uid), 'createdAt', listQuery.parse(r.query))),
  );
  api.get('/billing/payments/:id', async (r) => {
    const payment = await getPayment(r.uid, safeId((r.params as { id: string }).id));
    const upiLink = paymentUpiLink(payment);
    return ok({
      ...payment,
      upiLink,
      qrDataUrl: await QRCode.toDataURL(upiLink, { width: 256, margin: 2 }),
    });
  });
  api.post(
    '/billing/payments',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (r) => {
      const body = z.object({ planId: planIdSchema, requestId: z.uuid() }).strict().parse(r.body);
      return mutate(r.uid, async () => {
        const previous = await store.get<{ paymentId: string }>(
          path('billingRequests', r.uid, body.requestId),
        );
        if (previous) {
          const payment = await getPayment(r.uid, previous.paymentId);
          if (payment.planId !== body.planId)
            throw fail('This request ID belongs to another plan.', 'REQUEST_CONFLICT');
          return ok(payment);
        }
        checkPurchase(await store.get<Subscription>(path('subscriptions', r.uid)), body.planId);
        const pending =
          (await store.find<ManualPayment>(path('manualPayments', r.uid), 'status', 'pending')) ||
          (await store.find<ManualPayment>(path('manualPayments', r.uid), 'status', 'submitted'));
        if (pending)
          throw fail(
            'Finish or cancel your existing payment request before starting another.',
            'PAYMENT_PENDING',
          );
        if (!paymentsConfigured())
          throw fail(
            'Payment details are not configured yet. Please contact support.',
            'PAYMENTS_UNAVAILABLE',
            503,
          );
        const plan = subscriptionPlans.find((plan) => plan.id === body.planId)!;
        const now = Date.now();
        const payment: ManualPayment = {
          id: randomUUID(),
          userId: r.uid,
          planId: plan.id,
          amountPaise: plan.amountPaise,
          currency: 'INR',
          status: 'pending',
          upiId: env.PAYMENT_UPI_ID,
          payeeName: env.PAYMENT_PAYEE_NAME,
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        await store.update({
          ...writes(payment),
          [path('billingRequests', r.uid, body.requestId)]: { paymentId: payment.id },
        });
        events.emit(r.uid, { type: 'billing' });
        return ok(payment);
      });
    },
  );
  api.patch('/billing/payments/:id', async (r) => {
    const id = safeId((r.params as { id: string }).id);
    const body = z
      .discriminatedUnion('action', [
        z
          .object({
            action: z.literal('submit'),
            reference: paymentReferenceSchema,
            expectedVersion: z.number().int().min(1),
          })
          .strict(),
        z
          .object({ action: z.literal('cancel'), expectedVersion: z.number().int().min(1) })
          .strict(),
      ])
      .parse(r.body);
    return mutate(r.uid, async () => {
      const payment = await getPayment(r.uid, id);
      if (
        body.action === 'submit' &&
        payment.status === 'submitted' &&
        payment.reference === body.reference
      )
        return ok(payment);
      checkVersion(payment, body.expectedVersion);
      if (payment.status !== 'pending')
        throw fail('Only an unpaid request can be submitted or cancelled.', 'PAYMENT_STATE');
      const now = Date.now();
      const next: ManualPayment = {
        ...payment,
        status: body.action === 'cancel' ? 'cancelled' : 'submitted',
        version: payment.version + 1,
        updatedAt: now,
      };
      const updates: Record<string, unknown> = {};
      if (body.action === 'submit') {
        const referencePath = `paymentReferences/${stableKey(body.reference)}`;
        if (await store.get(referencePath))
          throw fail('This transaction reference has already been submitted.', 'REFERENCE_USED');
        next.reference = body.reference;
        next.submittedAt = now;
        updates[`paymentNotifications/${id}`] = {
          id,
          userId: r.uid,
          status: 'pending',
          phase: 'queued',
          attempts: 0,
          scheduledFor: now,
          createdAt: now,
          timestamp: now,
        };

        updates[referencePath] = { paymentId: id, createdAt: now };
      }
      await store.update({ ...writes(next), ...updates });
      events.emit(r.uid, { type: 'billing' });
      return ok(next);
    });
  });
  await api.register(
    async (admin) => {
      admin.addHook('preHandler', async (r) => {
        if (!isPlatformAdmin(r.uid))
          throw fail('Platform administrator access is required.', 'FORBIDDEN', 403);
      });
      admin.get('/payments', async (r) => {
        const page = await store.page<ManualPayment & Record<string, unknown>>(
          'paymentQueue',
          'createdAt',
          listQuery.parse(r.query),
        );
        const items = await Promise.all(
          page.items.map(async (payment) => {
            const notification =
              (await store.get<{ status: string }>(`paymentNotifications/${payment.id}`)) ||
              (await store.get<{ status: string }>(`paymentNotificationHistory/${payment.id}`));
            return { ...payment, notificationStatus: notification?.status || null };
          }),
        );
        return ok({ ...page, items });
      });
      admin.patch('/payments/:id', async (r) => {
        const id = safeId((r.params as { id: string }).id);
        const body = z
          .discriminatedUnion('decision', [
            z
              .object({
                decision: z.literal('approve'),
                expectedVersion: z.number().int().min(1),
                bankCreditVerified: z.literal(true),
                verifiedAmountPaise: z.number().int().positive(),
                note: z.string().trim().max(1000).default(''),
              })
              .strict(),
            z
              .object({
                decision: z.literal('reject'),
                expectedVersion: z.number().int().min(1),
                note: z.string().trim().min(1).max(1000),
              })
              .strict(),
          ])
          .parse(r.body);
        const queued = await store.get<ManualPayment>(`paymentQueue/${id}`);
        if (!queued) throw fail('Payment request not found.', 'NOT_FOUND', 404);
        return mutate(queued.userId, async () => {
          const payment = await getPayment(queued.userId, id);
          if (payment.status === 'approved' && body.decision === 'approve') return ok(payment);
          checkVersion(payment, body.expectedVersion);
          if (payment.status !== 'submitted')
            throw fail('Only submitted payments can be reviewed.', 'PAYMENT_STATE');
          const now = Date.now();
          const next: ManualPayment = {
            ...payment,
            status: body.decision === 'approve' ? 'approved' : 'rejected',
            updatedAt: now,
            reviewedAt: now,
            reviewedBy: r.uid,
            reviewNote: body.note,
            version: payment.version + 1,
          };
          const updates: Record<string, unknown> = {};
          if (body.decision === 'approve') {
            if (body.verifiedAmountPaise !== payment.amountPaise)
              throw fail(
                'The verified bank amount must match the requested plan amount.',
                'AMOUNT_MISMATCH',
                400,
              );
            const current = effectiveSubscription(
              await store.get<Subscription>(path('subscriptions', payment.userId)),
              now,
            );
            checkPurchase(current, payment.planId, now);
            const start = Math.max(now, current?.expiresAt || 0);
            const end = subscriptionEnd(
              start,
              subscriptionPlans.find((plan) => plan.id === payment.planId)!.months,
            );
            next.periodStart = start;
            next.periodEnd = end;
            updates[path('subscriptions', payment.userId)] = {
              ...(subscriptionActive(current, now)
                ? {
                    scheduledPlan: {
                      planId: payment.planId,
                      startsAt: start,
                      expiresAt: end,
                      paymentId: id,
                    },
                  }
                : {}),
              planId: subscriptionActive(current, now) ? current!.planId : payment.planId,
              startsAt: subscriptionActive(current, now) ? current!.startsAt : now,
              expiresAt: end,
              lastPaymentId: id,
              updatedAt: now,
              version: (current?.version || 0) + 1,
            } satisfies Subscription;
          }
          const grant = await store.get<AccessGrant>(path('accessProfiles', payment.userId));
          updates[path('accessProfiles', payment.userId)] = {
            tier: grant?.tier || 'free',
            version: (grant?.version || 0) + 1,
            updatedAt: now,
            updatedBy: r.uid,
          };
          const auditId = randomUUID();
          updates[`adminAudit/${auditId}`] = {
            id: auditId,
            actorId: r.uid,
            targetId: payment.userId,
            action: `payment_${next.status}`,
            createdAt: now,
            details: { paymentId: id, planId: payment.planId, amountPaise: payment.amountPaise },
          };
          await store.update({ ...writes(next), ...updates });
          events.emit(payment.userId, { type: 'billing' });
          return ok(next);
        });
      });
    },
    { prefix: '/admin' },
  );
}
