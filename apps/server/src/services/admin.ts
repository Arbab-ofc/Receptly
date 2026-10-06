import { paymentWhatsapp, paymentSenderSessionId } from '../modules/whatsapp/payment-sender.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  defaultSettings,
  type Settings,
  type DailyAnalytics,
  type Subscription,
} from '@receptly/shared';
import { env } from '../config/env.js';
import { firebase } from '../config/firebase.js';
import { store, path, safeId } from './store.js';
import { withLock } from './locks.js';
import { events } from './events.js';
import { monitoring } from './monitoring.js';
import { listQuery } from './pagination.js';
import { accessProfile, type AccessGrant } from './access.js';

import { isPlatformAdmin } from './roles.js';
export { isPlatformAdmin } from './roles.js';
// Keep identity access behind a narrow adapter; never return credentials or provider tokens.
export const adminIdentity = {
  list: (limit: number, cursor?: string) => firebase().auth.listUsers(limit, cursor),
  get: (uid: string) => firebase().auth.getUser(uid),
};
const ok = (data: unknown) => ({ success: true, data });
const conflict = () =>
  Object.assign(new Error('This record changed. Refresh before saving.'), {
    statusCode: 409,
    code: 'VERSION_CONFLICT',
  });
function audit(actorId: string, targetId: string, action: string, details: object) {
  const id = randomUUID();
  return {
    [`adminAudit/${id}`]: { id, actorId, targetId, action, details, createdAt: Date.now() },
  };
}
async function account(uid: string) {
  try {
    const user = await adminIdentity.get(uid);
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      disabled: user.disabled,
      emailVerified: user.emailVerified,
      createdAt: user.metadata.creationTime,
      lastSignInAt: user.metadata.lastSignInTime || null,
      admin: isPlatformAdmin(uid),
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found')
      throw Object.assign(new Error('This user was not found.'), {
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    throw error;
  }
}
async function workspace(uid: string) {
  const [settings, connection, deletion] = await Promise.all([
    store.get<Settings & { version?: number }>(path('settings', uid)),
    store.get<{ status?: string; updatedAt?: number }>(path('whatsapp', uid)),
    store.get<{ status: string }>(path('accountDeletion', uid)),
  ]);
  return {
    businessName: settings?.businessName || defaultSettings.businessName,
    timezone: settings?.timezone || defaultSettings.timezone,
    automationEnabled: settings?.automationEnabled || false,
    mode: settings?.mode || defaultSettings.mode,
    version: settings?.version || 0,
    connectionStatus: connection?.status || 'disconnected',
    deletionStatus: deletion?.status || null,
    access: await accessProfile(uid),
  };
}
export async function registerAdmin(api: FastifyInstance) {
  api.get('/account/access', async (r) =>
    ok({ admin: isPlatformAdmin(r.uid), access: await accessProfile(r.uid) }),
  );
  await api.register(
    async (admin) => {
      admin.addHook('preHandler', async (r) => {
        if (!isPlatformAdmin(r.uid))
          throw Object.assign(new Error('Platform administrator access is required.'), {
            statusCode: 403,
            code: 'FORBIDDEN',
          });
      });
      admin.get('/payment-whatsapp/status', async () =>
        ok({
          ...paymentWhatsapp.getStatus(paymentSenderSessionId),
          recipientNumber: env.PAYMENT_NOTIFY_WHATSAPP_NUMBER,
        }),
      );
      for (const action of ['connect', 'reconnect', 'disconnect', 'logout'] as const) {
        admin.post(`/payment-whatsapp/${action}`, async (r) => {
          await paymentWhatsapp[action](paymentSenderSessionId);
          await store.update(audit(r.uid, 'payment-whatsapp', `payment_whatsapp_${action}`, {}));
          return ok(paymentWhatsapp.getStatus(paymentSenderSessionId));
        });
      }
      admin.get('/system', async () => ok(monitoring.snapshot()));
      admin.get('/users', async (r) => {
        const query = z
          .object({
            limit: z.coerce.number().int().min(1).max(100).default(25),
            cursor: z.string().min(1).max(2048).optional(),
          })
          .parse(r.query);
        const result = await adminIdentity.list(query.limit, query.cursor);
        const items = await Promise.all(
          result.users.map(async (user) => ({
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || '',
            disabled: user.disabled,
            emailVerified: user.emailVerified,
            createdAt: user.metadata.creationTime,
            lastSignInAt: user.metadata.lastSignInTime || null,
            admin: isPlatformAdmin(user.uid),
            workspace: await workspace(user.uid),
          })),
        );
        return ok({ items, nextCursor: result.pageToken || null });
      });
      admin.get('/users/:id', async (r) => {
        const uid = safeId((r.params as { id: string }).id);
        const [identity, summary, daily] = await Promise.all([
          account(uid),
          workspace(uid),
          store.get<Record<string, DailyAnalytics>>(`analytics/${uid}/daily`),
        ]);
        return ok({
          ...identity,
          workspace: summary,
          analytics: Object.entries(daily || {})
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, 30)
            .map(([date, metrics]) => ({ date, ...metrics })),
        });
      });
      admin.patch('/users/:id/plan', async (r) => {
        const uid = safeId((r.params as { id: string }).id);
        const body = z
          .object({ tier: z.enum(['free', 'pro']), expectedVersion: z.number().int().min(0) })
          .strict()
          .parse(r.body);
        if (isPlatformAdmin(uid))
          throw Object.assign(
            new Error('Platform admins always have Pro access. Their plan cannot be changed.'),
            { statusCode: 409, code: 'ADMIN_PLAN_FIXED' },
          );
        return withLock('billing', () =>
          withLock(`workspace:${uid}`, async () => {
            await account(uid);
            if (await store.get(path('accountDeletion', uid)))
              throw Object.assign(new Error('Account deletion is in progress.'), {
                statusCode: 409,
                code: 'ACCOUNT_DELETING',
              });
            const current = await store.get<AccessGrant>(path('accessProfiles', uid));
            if (body.expectedVersion !== (current?.version || 0)) throw conflict();
            const now = Date.now();
            const updates: Record<string, unknown> = {
              [path('accessProfiles', uid)]: {
                tier: body.tier,
                version: (current?.version || 0) + 1,
                updatedAt: now,
                updatedBy: r.uid,
              },
              ...audit(r.uid, uid, body.tier === 'pro' ? 'pro_granted' : 'pro_revoked', {
                tier: body.tier,
              }),
            };
            if (body.tier === 'free') {
              const subscription = await store.get<Subscription>(path('subscriptions', uid));
              if (subscription)
                updates[path('subscriptions', uid)] = {
                  ...subscription,
                  expiresAt: Math.min(subscription.expiresAt, now),
                  updatedAt: now,
                  version: subscription.version + 1,
                };
            }
            await store.update(updates);
            events.emit(uid, { type: 'billing' });
            return ok(await accessProfile(uid));
          }),
        );
      });
      admin.patch('/users/:id/automation', async (r) => {
        const uid = safeId((r.params as { id: string }).id);
        const body = z
          .object({ enabled: z.boolean(), expectedVersion: z.number().int().min(0) })
          .strict()
          .parse(r.body);
        return withLock(`workspace:${uid}`, async () => {
          await account(uid);
          if (await store.get(path('accountDeletion', uid)))
            throw Object.assign(new Error('Account deletion is in progress.'), {
              statusCode: 409,
              code: 'ACCOUNT_DELETING',
            });
          const current = await store.get<Settings & { version?: number }>(path('settings', uid));
          if (body.expectedVersion !== (current?.version || 0)) throw conflict();
          const next = {
            ...(current || defaultSettings),
            automationEnabled: body.enabled,
            version: (current?.version || 0) + 1,
          };
          await store.update({
            [path('settings', uid)]: next,
            ...audit(r.uid, uid, body.enabled ? 'automation_enabled' : 'automation_paused', {
              enabled: body.enabled,
            }),
          });
          events.emit(uid, { type: 'settings' });
          return ok({ automationEnabled: next.automationEnabled, version: next.version });
        });
      });
      admin.get('/enquiries', async (r) => {
        const query = listQuery.parse(r.query);
        const result = await store.page<Record<string, unknown>>(
          'contactRequests',
          'createdAt',
          query,
        );
        return ok({
          ...result,
          items: result.items.map((item) => ({ ...item, version: Number(item.version || 0) })),
        });
      });
      admin.patch('/enquiries/:id', async (r) => {
        const id = safeId((r.params as { id: string }).id);
        const body = z
          .object({ status: z.enum(['new', 'resolved']), expectedVersion: z.number().int().min(0) })
          .strict()
          .parse(r.body);
        return withLock(`admin-enquiry:${id}`, async () => {
          const current = await store.get<Record<string, unknown>>(`contactRequests/${id}`);
          if (!current)
            throw Object.assign(new Error('This enquiry was not found.'), {
              statusCode: 404,
              code: 'NOT_FOUND',
            });
          if (body.expectedVersion !== Number(current.version || 0)) throw conflict();
          const next = {
            ...current,
            status: body.status,
            version: Number(current.version || 0) + 1,
            updatedAt: Date.now(),
          };
          await store.update({
            [`contactRequests/${id}`]: next,
            ...audit(r.uid, id, 'enquiry_status_changed', { status: body.status }),
          });
          return ok(next);
        });
      });
      admin.get('/audit', async (r) =>
        ok(await store.page('adminAudit', 'createdAt', listQuery.parse(r.query))),
      );
    },
    { prefix: '/admin' },
  );
}
