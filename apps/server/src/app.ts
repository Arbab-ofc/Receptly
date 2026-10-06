import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError, type ZodType } from 'zod';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  defaultSettings,
  subscriptionPlans,
  defaultHours,
  settingsSchema,
  hoursSchema,
  ruleSchema,
  templateSchema,
  faqSchema,
  catalogSchema,
  holidaySchema,
  type Holiday,
  contactSchema,
  leadSchema,
  contactRequestSchema,
  type Settings,
  type Conversation,
  type DailyAnalytics,
} from '@receptly/shared';
import { env, firebaseConfigured } from './config/env.js';
import { firebase } from './config/firebase.js';
import { store, path, safeId } from './services/store.js';
import { registerBilling, automationEntitled } from './services/billing.js';
import { registerAdmin } from './services/admin.js';
import { events } from './services/events.js';
import { withLock } from './services/locks.js';
import { monitoring } from './services/monitoring.js';
import { listQuery } from './services/pagination.js';
import { sendOnce } from './services/outbound.js';
import { openEventStream } from './services/stream.js';
import { accountExport, deleteAccount } from './services/accounts.js';
import { whatsapp } from './modules/whatsapp/manager.js';
import { renderTemplate, businessOpen } from './modules/receptionist/logic.js';
declare module 'fastify' {
  interface FastifyRequest {
    uid: string;
    tokenExpiresAt: number;
    authTime: number;
  }
}
export type AuthVerifier = (
  token: string,
) => Promise<string | { uid: string; expiresAt: number; authTime: number }>;
export function buildApp(
  verify: AuthVerifier = async (token) => {
    const decoded = await firebase().auth.verifyIdToken(token, true);
    return { uid: decoded.uid, expiresAt: decoded.exp * 1000, authTime: decoded.auth_time * 1000 };
  },
) {
  // Cache successful registry initialization only; identity/revocation and deletion checks stay per-request.
  const registrations = new Map<string, { expiresAt: number; pending?: Promise<void> }>();
  const registerWorkspace = async (uid: string) => {
    const existing = registrations.get(uid);
    if (existing?.pending) return existing.pending;
    if (existing && existing.expiresAt > Date.now()) return;
    if (registrations.size >= 10000) registrations.delete(registrations.keys().next().value!);
    const entry: { expiresAt: number; pending?: Promise<void> } = { expiresAt: 0 };
    registrations.set(uid, entry);
    entry.pending = (async () => {
      try {
        await store.transaction(
          path('workspaceRegistry', uid),
          (current) => current || { createdAt: Date.now() },
        );
        entry.expiresAt = Date.now() + 5 * 60000;
      } catch (error) {
        if (registrations.get(uid) === entry) registrations.delete(uid);
        throw error;
      } finally {
        entry.pending = undefined;
      }
    })();
    return entry.pending;
  };
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: ['req.headers.authorization', 'req.body', 'res.headers.set-cookie'],
    },
    bodyLimit: 65536,
    trustProxy: '127.0.0.1',
    genReqId: () => randomUUID(),
  });
  app.register(cors, {
    origin: env.WEB_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['ETag', 'X-Request-Id'],
    maxAge: 600,
  });
  app.register(helmet);
  app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.decorateRequest('uid', '');
  app.decorateRequest('tokenExpiresAt', 0);
  app.decorateRequest('authTime', 0);
  const requestStarts = new WeakMap<FastifyRequest, number>();
  app.addHook('onRequest', async (r, reply) => {
    requestStarts.set(r, performance.now());
    reply.header('X-Request-Id', r.id);
    if (r.url.startsWith('/api/v1/')) reply.header('Cache-Control', 'no-store');
  });
  app.addHook('onResponse', async (r, reply) => {
    const duration = performance.now() - (requestStarts.get(r) || performance.now());
    monitoring.increment('api.requests');
    monitoring.increment('api.durationMs', Math.round(duration));
    monitoring.increment(
      duration <= 100
        ? 'api.latency.le100ms'
        : duration <= 500
          ? 'api.latency.le500ms'
          : duration <= 2000
            ? 'api.latency.le2000ms'
            : 'api.latency.gt2000ms',
    );
    monitoring.increment(`api.status.${reply.statusCode}`);
    if (reply.statusCode >= 500)
      monitoring.alert('api_service_failure', { requestId: r.id, status: reply.statusCode });
    if (duration > 2000 && r.routeOptions.url !== '/api/v1/events')
      monitoring.alert('api_slow_request', { requestId: r.id, durationMs: Math.round(duration) });
  });
  app.get('/api/health/live', async () => ({ status: 'ok' }));
  app.get('/api/health/ready', async (_r, reply) => {
    let available = false;
    if (firebaseConfigured) {
      try {
        await firebase().db.ref('__healthcheck').get();
        available = true;
      } catch {
        /* Return readiness status only. */
      }
    }
    if (!available || !monitoring.snapshot().ready) reply.code(503);
    return { status: available && monitoring.snapshot().ready ? 'ok' : 'not_ready' };
  });
  app.get('/api/operations', async (r, reply) => {
    const token = r.headers.authorization?.replace(/^Bearer /, '') || '';
    if (
      !env.OPERATIONS_TOKEN ||
      Buffer.byteLength(token) !== Buffer.byteLength(env.OPERATIONS_TOKEN) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(env.OPERATIONS_TOKEN))
    )
      return reply.code(404).send({ success: false });
    return { success: true, data: monitoring.snapshot() };
  });
  app.addHook('preClose', async () => {
    events.emit('shutdown');
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & { statusCode?: number; code?: string };
    const status = error instanceof ZodError ? 400 : e.statusCode || 500;
    if (status >= 500)
      req.log.error({ operation: 'api', code: e.code || 'INTERNAL_ERROR' }, 'Request failed');
    reply.code(status).send({
      success: false,
      error: {
        code: error instanceof ZodError ? 'VALIDATION_ERROR' : e.code || 'INTERNAL_ERROR',
        requestId: req.id,
        message:
          error instanceof ZodError
            ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
            : status >= 500
              ? 'The service is temporarily unavailable. Please try again.'
              : e.message,
      },
    });
  });
  app.get('/api/health', async () => {
    let connected = false;
    if (firebaseConfigured) {
      try {
        await firebase().db.ref('__healthcheck').get();
        connected = true;
      } catch (error) {
        app.log.error({ error }, 'Firebase health check failed');
      }
    }
    return {
      status: connected ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: { firebase: connected ? 'ok' : 'unconfigured_or_unavailable' },
    };
  });
  app.get('/api/v1/billing/plans', async () => ({
    success: true,
    data: { plans: subscriptionPlans },
  }));
  app.post(
    '/api/v1/contact',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req) => {
      const data = contactRequestSchema.parse(req.body);
      const id = randomUUID();
      await store.set(`contactRequests/${id}`, {
        ...data,
        id,
        createdAt: Date.now(),
        status: 'new',
      });
      return { success: true, data: { id } };
    },
  );
  app.register(
    async (api) => {
      api.addHook('preHandler', async (req) => {
        const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        if (!token)
          throw Object.assign(new Error('Please sign in to continue.'), {
            statusCode: 401,
            code: 'UNAUTHENTICATED',
          });
        try {
          const identity = await verify(token);
          req.uid = typeof identity === 'string' ? identity : identity.uid;
          req.tokenExpiresAt =
            typeof identity === 'string' ? Date.now() + 45 * 60000 : identity.expiresAt;
          req.authTime = typeof identity === 'string' ? 0 : identity.authTime;
          if (req.tokenExpiresAt <= Date.now()) throw new Error('Expired token');
          safeId(req.uid);
        } catch {
          throw Object.assign(new Error('Your session has expired. Sign in again.'), {
            statusCode: 401,
            code: 'INVALID_TOKEN',
          });
        }
        if (await store.get(path('accountDeletion', req.uid)))
          throw Object.assign(new Error('Account deletion is in progress.'), {
            statusCode: 409,
            code: 'ACCOUNT_DELETING',
          });
        await registerWorkspace(req.uid);
      });
      const ok = (data: unknown) => ({ success: true, data });
      const uid = (r: FastifyRequest) => r.uid;
      const id = (r: FastifyRequest) => safeId((r.params as { id: string }).id);
      const pagination = (r: FastifyRequest) => listQuery.parse(r.query);
      const mutate =
        (handler: (r: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
        (r: FastifyRequest, reply: FastifyReply) =>
          withLock(`workspace:${uid(r)}`, async () => {
            if (await store.get(path('accountDeletion', uid(r))))
              throw Object.assign(new Error('Account deletion is in progress.'), {
                statusCode: 409,
                code: 'ACCOUNT_DELETING',
              });
            return handler(r, reply);
          });
      const checkVersion = (r: FastifyRequest, old: Record<string, unknown>) => {
        const requested = r.headers['if-match'];
        if (requested !== undefined) {
          const expected = z.coerce
            .number()
            .int()
            .min(0)
            .parse(String(requested).replace(/^"|"$/g, ''));
          if (expected !== Number(old.version || 0))
            throw Object.assign(new Error('This record changed. Refresh before saving.'), {
              statusCode: 409,
              code: 'VERSION_CONFLICT',
            });
        }
      };
      const listRecords = async (r: FastifyRequest, p: string, order: string) => {
        const q = pagination(r);
        if (q.page === 'true' || q.cursor || q.search || q.filter !== 'all' || q.status || q.type) {
          const result = await store.page<Record<string, unknown>>(p, order, q);
          return ok(q.page === 'true' || q.cursor ? result : result.items);
        }
        return ok(await store.list(p, q.limit, order, q.before));
      };
      await registerAdmin(api);
      await registerBilling(api);
      api.get('/events', async (req, reply) => openEventStream(req, reply));
      api.get('/account/export', async (r) => ok(await accountExport(uid(r))));
      api.get('/diagnostics', async (r) => {
        const summarize = (records: Record<string, unknown>[]) =>
          records.map((record) => ({
            id: record.id,
            status: record.status,
            attempts: record.attempts,
            timestamp: record.timestamp,
            errorCode: record.errorCode,
            nextAttemptAt: record.nextAttemptAt,
            scheduledFor: record.scheduledFor,
          }));
        const inputs = await store.findMany<Record<string, unknown>>(
          path('processingInbox', uid(r)),
          'status',
          'failed',
          100,
        );
        const jobs = (
          await Promise.all(
            ['failed', 'uncertain'].map((status) =>
              store.findMany<Record<string, unknown>>(path('jobs', uid(r)), 'status', status, 100),
            ),
          )
        ).flat();
        const sends = await store.findMany<Record<string, unknown>>(
          path('sendRequests', uid(r)),
          'status',
          'uncertain',
          100,
        );
        return ok({
          failedInputs: summarize(inputs),
          failedJobs: summarize(jobs),
          uncertainSends: summarize(sends),
        });
      });
      api.delete('/account', async (r) => {
        const { confirmation } = z
          .object({ confirmation: z.literal('DELETE MY ACCOUNT') })
          .parse(r.body);
        if (!r.authTime || Date.now() - r.authTime > 300000)
          throw Object.assign(new Error('Sign in again before deleting your account.'), {
            statusCode: 401,
            code: 'RECENT_LOGIN_REQUIRED',
          });
        return ok(await deleteAccount(uid(r), confirmation));
      });
      api.get('/send-requests/:id', async (r) => {
        const record = await store.get<Record<string, unknown>>(
          path('sendRequests', uid(r), id(r)),
        );
        if (!record)
          throw Object.assign(new Error('Send request not found.'), {
            statusCode: 404,
            code: 'NOT_FOUND',
          });
        const { fingerprint: _fingerprint, ...result } = record;
        return ok(result);
      });
      api.get('/receptionist/status', async (r) => {
        const settings = (await store.get<Settings>(path('settings', uid(r)))) || defaultSettings;
        const hours =
          (await store.get<typeof defaultHours>(path('businessHours', uid(r)))) || defaultHours;
        const entitled = await automationEntitled(uid(r));
        return ok({
          enabled: settings.automationEnabled && entitled,
          subscriptionRequired: !entitled,
          mode: settings.mode,
          businessOpen: businessOpen(
            hours,
            settings.timezone,
            new Date(),
            await store.list<Holiday>(path('holidays', uid(r)), 200),
          ),
          timezone: settings.timezone,
        });
      });
      api.get('/onboarding', async (r) =>
        ok({
          connected: whatsapp.getStatus(uid(r)).status === 'connected',
          scheduleConfigured: !!(await store.get(path('businessHours', uid(r)))),
          hasRules: (await store.list(path('rules', uid(r)), 1, 'priority')).length > 0,
          enabled:
            (await store.get<Settings>(path('settings', uid(r))))?.automationEnabled || false,
        }),
      );
      api.get('/settings', async (r) => {
        const settings =
          (await store.get<Record<string, unknown>>(path('settings', uid(r)))) || defaultSettings;
        return ok({
          ...defaultSettings,
          ...settings,
          modeReplies: {
            ...defaultSettings.modeReplies,
            ...(settings.modeReplies as Settings['modeReplies'] | undefined),
          },
          version: Number(('version' in settings && settings.version) || 0),
        });
      });
      api.patch(
        '/settings',
        mutate(async (r) => {
          const old = (await store.get<Settings & { version?: number }>(
            path('settings', uid(r)),
          )) || { ...defaultSettings, version: 0 };
          checkVersion(r, old);
          const body = z.record(z.string(), z.unknown()).parse(r.body);
          const next = {
            ...settingsSchema.parse({ ...old, ...body }),
            version: Number(old.version || 0) + 1,
          };
          await store.set(path('settings', uid(r)), next);
          if (old.automationEnabled !== next.automationEnabled)
            await store.log(
              uid(r),
              next.automationEnabled ? 'receptionist_enabled' : 'receptionist_paused',
              next.automationEnabled ? 'Receptionist enabled.' : 'Receptionist paused.',
              next.automationEnabled ? 'success' : 'info',
            );
          await store.log(uid(r), 'settings_changed', 'Receptionist settings updated.');
          events.emit(uid(r), { type: 'settings' });
          return ok(next);
        }),
      );
      api.get('/schedule', async (r, reply) => {
        const record = await store.get<{ version: number }>(path('scheduleVersions', uid(r)));
        reply.header('ETag', `"${record?.version || 0}"`);
        return ok((await store.get(path('businessHours', uid(r)))) || defaultHours);
      });
      api.patch(
        '/schedule',
        mutate(async (r, reply) => {
          const current = (await store.get<{ version?: number }>(
            path('scheduleVersions', uid(r)),
          )) || { version: 0 };
          checkVersion(r, current);
          const hours = hoursSchema.parse(r.body);
          await store.update({
            [path('businessHours', uid(r))]: hours,
            [path('scheduleVersions', uid(r))]: { version: Number(current.version || 0) + 1 },
          });
          await store.log(uid(r), 'schedule_changed', 'Business hours updated.');
          events.emit(uid(r), { type: 'schedule' });
          reply.header('ETag', `"${Number(current.version || 0) + 1}"`);
          return ok(hours);
        }),
      );
      async function validateRuleReference(
        name: string,
        uid: string,
        data: object,
        recordId?: string,
      ) {
        if (name === 'holidays') {
          const existing = await store.find<{ id: string }>(
            path(name, uid),
            'date',
            (data as { date: string }).date,
          );
          if (existing && existing.id !== recordId)
            throw Object.assign(
              new Error('A holiday schedule already exists for this date. Edit that entry.'),
              { statusCode: 409, code: 'HOLIDAY_EXISTS' },
            );
        }
        if (name === 'leads') {
          const lead = data as { contactId: string; conversationId: string };
          const conversation = await store.get<Conversation>(
            path('conversations', uid, lead.conversationId),
          );
          if (!conversation || conversation.contactId !== lead.contactId)
            throw Object.assign(
              new Error('Select a valid conversation and contact for this lead.'),
              { statusCode: 400, code: 'INVALID_CONVERSATION' },
            );
        }
        if (name !== 'rules') return;
        const ref = (data as { replyTemplateId?: string }).replyTemplateId;
        if (ref && !(await store.get(path('templates', uid, ref))))
          throw Object.assign(new Error('Select a template from your workspace.'), {
            statusCode: 400,
            code: 'INVALID_TEMPLATE',
          });
      }
      function resource(name: string, schema: ZodType) {
        api.get(`/${name}`, async (r) =>
          listRecords(r, path(name, uid(r)), name === 'rules' ? 'priority' : 'createdAt'),
        );
        api.post(
          `/${name}`,
          mutate(async (r) => {
            const data = schema.parse(r.body) as object;
            await validateRuleReference(name, uid(r), data);
            if (name === 'contacts') {
              const number = (data as { number: string }).number;
              if (await store.find(path(name, uid(r)), 'number', number))
                throw Object.assign(
                  new Error('This phone number already exists. Edit the existing contact.'),
                  { statusCode: 409, code: 'CONTACT_EXISTS' },
                );
            }
            if (
              ['rules', 'templates', 'knowledgeBase', 'catalog', 'holidays'].includes(name) &&
              (
                await store.list(
                  path(name, uid(r)),
                  200,
                  name === 'rules' ? 'priority' : 'createdAt',
                )
              ).length >= 200
            )
              throw Object.assign(
                new Error('This workspace supports up to 200 configuration records per library.'),
                { statusCode: 409, code: 'LIBRARY_LIMIT' },
              );
            const record = {
              ...data,
              id: randomUUID(),
              createdAt: Date.now(),
              updatedAt: Date.now(),
              version: 1,
            };
            if (name === 'leads') {
              const lead = record as { conversationId?: string; contactId?: string };
              const c = lead.conversationId
                ? await store.get<Conversation>(path('conversations', uid(r), lead.conversationId))
                : null;
              if (!c || c.contactId !== lead.contactId)
                throw Object.assign(new Error('Select a valid conversation for this lead.'), {
                  statusCode: 400,
                  code: 'INVALID_CONVERSATION',
                });
            }
            const writes: Record<string, unknown> = { [path(name, uid(r), record.id)]: record };
            if (name === 'leads') {
              const l = record as { id: string; conversationId?: string };
              if (l.conversationId)
                writes[`${path('conversations', uid(r), l.conversationId)}/leadId`] = l.id;
              Object.assign(writes, store.metricUpdates(uid(r), ['leads']));
            }
            await store.update(writes);
            events.emit(uid(r), { type: name });
            return ok(record);
          }),
        );
        const get = async (r: FastifyRequest) => {
          const data = await store.get<Record<string, unknown>>(path(name, uid(r), id(r)));
          if (!data)
            throw Object.assign(new Error('The requested record was not found.'), {
              statusCode: 404,
              code: 'NOT_FOUND',
            });
          return data;
        };
        api.get(`/${name}/:id`, async (r) => ok(await get(r)));
        api.patch(
          `/${name}/:id`,
          mutate(async (r) => {
            const old = await get(r);
            checkVersion(r, old);
            const body = z.record(z.string(), z.unknown()).parse(r.body);
            const parsed = schema.parse({ ...old, ...body }) as object;
            await validateRuleReference(name, uid(r), parsed, id(r));
            if (name === 'contacts') {
              const existing = await store.find<{ id: string }>(
                path(name, uid(r)),
                'number',
                (parsed as { number: string }).number,
              );
              if (existing && existing.id !== id(r))
                throw Object.assign(
                  new Error('This phone number already belongs to another contact.'),
                  { statusCode: 409, code: 'CONTACT_EXISTS' },
                );
            }
            const data = {
              ...old,
              ...parsed,
              id: id(r),
              updatedAt: Date.now(),
              version: Number(old.version || 0) + 1,
            };
            const writes: Record<string, unknown> = { [path(name, uid(r), id(r))]: data };
            if (name === 'leads') {
              const lead = data as { conversationId?: string };
              if (
                old.conversationId !== lead.conversationId &&
                typeof old.conversationId === 'string'
              )
                writes[`${path('conversations', uid(r), old.conversationId)}/leadId`] = null;
              if (lead.conversationId)
                writes[`${path('conversations', uid(r), lead.conversationId)}/leadId`] = data.id;
            }
            await store.update(writes);
            events.emit(uid(r), { type: name });
            return ok(data);
          }),
        );
        api.delete(
          `/${name}/:id`,
          mutate(async (r) => {
            const old = await get(r);
            checkVersion(r, old);
            if (name === 'templates') {
              const rules = await store.list<{ replyTemplateId: string }>(
                path('rules', uid(r)),
                200,
                'priority',
              );
              if (rules.some((rule) => rule.replyTemplateId === id(r)))
                throw Object.assign(
                  new Error('Remove this template from its reply rules before deleting it.'),
                  { statusCode: 409, code: 'TEMPLATE_IN_USE' },
                );
            }
            const writes: Record<string, unknown> = { [path(name, uid(r), id(r))]: null };
            if (name === 'leads' && typeof old.conversationId === 'string') {
              const conversation = await store.get<Conversation>(
                path('conversations', uid(r), old.conversationId),
              );
              if (conversation?.leadId === id(r))
                writes[`${path('conversations', uid(r), old.conversationId)}/leadId`] = null;
            }
            await store.update(writes);
            events.emit(uid(r), { type: name });
            return ok({ deleted: true });
          }),
        );
        if (['rules', 'templates', 'knowledgeBase', 'catalog'].includes(name)) {
          api.post(
            `/${name}/:id/duplicate`,
            mutate(async (r) => {
              const old = await get(r);
              if (
                (
                  await store.list(
                    path(name, uid(r)),
                    200,
                    name === 'rules' ? 'priority' : 'createdAt',
                  )
                ).length >= 200
              )
                throw Object.assign(new Error('This library supports up to 200 records.'), {
                  statusCode: 409,
                  code: 'LIBRARY_LIMIT',
                });
              await validateRuleReference(name, uid(r), old, id(r));
              const record = {
                ...(schema.parse({
                  ...old,
                  name: `${String(old.name || '').slice(0, 113)} (copy)`,
                  question: `${String(old.question || '').slice(0, 493)} (copy)`,
                  enabled: false,
                }) as object),
                id: randomUUID(),
                enabled: false,
                version: 1,
                triggerCount: 0,
                usageCount: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              await store.set(path(name, uid(r), record.id), record);
              events.emit(uid(r), { type: name });
              return ok(record);
            }),
          );
        }
        if (['rules', 'templates', 'knowledgeBase', 'catalog', 'holidays'].includes(name)) {
          api.patch(
            `/${name}/:id/toggle`,
            mutate(async (r) => {
              const old = await get(r);
              checkVersion(r, old);
              await validateRuleReference(name, uid(r), old, id(r));
              const { enabled } = z.object({ enabled: z.boolean() }).parse(r.body);
              const data = {
                enabled,
                updatedAt: Date.now(),
                version: Number(old.version || 0) + 1,
              };
              await store.patch(path(name, uid(r), id(r)), data);
              events.emit(uid(r), { type: name });
              return ok({ ...old, ...data });
            }),
          );
        }
      }
      resource('rules', ruleSchema);
      resource('templates', templateSchema);
      resource('knowledgeBase', faqSchema);
      resource('catalog', catalogSchema);
      resource('holidays', holidaySchema);
      resource('contacts', contactSchema);
      resource('leads', leadSchema);
      api.get('/conversations', async (r) =>
        listRecords(r, path('conversations', uid(r)), 'lastMessageAt'),
      );
      const conversation = async (r: FastifyRequest) => {
        const c = await store.get<Conversation>(path('conversations', uid(r), id(r)));
        if (!c)
          throw Object.assign(new Error('Conversation not found.'), {
            statusCode: 404,
            code: 'CONVERSATION_NOT_FOUND',
          });
        return c;
      };
      api.get('/conversations/:id', async (r) => ok(await conversation(r)));
      api.get('/conversations/:id/messages', async (r) => {
        await conversation(r);
        return listRecords(r, path(`messages/${uid(r)}`, id(r)), 'timestamp');
      });
      api.patch('/conversations/:id', async (r) => {
        const original = await conversation(r);
        return whatsapp.engine.withConversation(uid(r), original.chatId, async () => {
          if (await store.get(path('accountDeletion', uid(r))))
            throw Object.assign(new Error('Account deletion is in progress.'), {
              code: 'ACCOUNT_DELETING',
              statusCode: 409,
            });
          const data = z
            .object({
              unreadCount: z.literal(0).optional(),
              notes: z.string().max(5000).optional(),
              tags: z.array(z.string().max(50)).max(20).optional(),
            })
            .parse(r.body);
          await store.patch(path('conversations', uid(r), id(r)), {
            ...data,
            updatedAt: Date.now(),
          });
          events.emit(uid(r), { type: 'conversation' });
          return ok(await conversation(r));
        });
      });
      for (const action of ['pause', 'resume'])
        api.post(`/conversations/:id/${action}-automation`, async (r) => {
          const c = await conversation(r);
          return whatsapp.engine.withConversation(uid(r), c.chatId, async () => {
            if (await store.get(path('accountDeletion', uid(r))))
              throw Object.assign(new Error('Account deletion is in progress.'), {
                code: 'ACCOUNT_DELETING',
                statusCode: 409,
              });
            await store.patch(path('conversations', uid(r), id(r)), {
              automationEnabled: action === 'resume',
              needsHuman: false,
              pauseUntil: 0,
              updatedAt: Date.now(),
            });
            await store.log(
              uid(r),
              `chat_${action}`,
              `Conversation automation ${action === 'pause' ? 'paused' : 'resumed'}.`,
            );
            events.emit(uid(r), { type: 'conversation' });
            return ok(await conversation(r));
          });
        });
      api.post('/conversations/:id/messages', async (r) => {
        const initial = await conversation(r);
        const { text, requestId } = z
          .object({ text: z.string().trim().min(1).max(10000), requestId: z.uuid() })
          .parse(r.body);
        return whatsapp.engine.withConversation(uid(r), initial.chatId, async () => {
          const current = await conversation(r);
          const settings = (await store.get<Settings>(path('settings', uid(r)))) || defaultSettings;
          const hours =
            (await store.get<typeof defaultHours>(path('businessHours', uid(r)))) || defaultHours;
          const rendered = renderTemplate(
            text,
            settings,
            hours,
            current.name,
            new Date(),
            await store.list<Holiday>(path('holidays', uid(r)), 200),
          );
          if (!rendered.trim())
            throw Object.assign(new Error('Message is empty after resolving variables.'), {
              statusCode: 400,
              code: 'EMPTY_MESSAGE',
            });
          const result = await sendOnce(
            uid(r),
            current,
            rendered,
            requestId,
            whatsapp.sendMessage.bind(whatsapp),
            {
              source: 'manual',
              originalText: text,
              pauseMinutes: settings.pauseAfterManualReplyMinutes,
            },
          );
          events.emit(uid(r), { type: 'message', conversationId: current.id });
          return ok(result);
        });
      });
      api.get('/whatsapp/status', async (r) => ok(whatsapp.getStatus(uid(r))));
      api.get('/whatsapp/qr', async (r) => ok(whatsapp.getStatus(uid(r))));
      for (const action of ['connect', 'reconnect', 'disconnect', 'logout'] as const)
        api.post(`/whatsapp/${action}`, async (r) => {
          await whatsapp[action](uid(r));
          if (action === 'disconnect' || action === 'logout')
            await store.log(
              uid(r),
              action === 'logout' ? 'whatsapp_unlinked' : 'whatsapp_disconnected',
              action === 'logout' ? 'WhatsApp account unlinked.' : 'WhatsApp disconnected.',
              'info',
            );
          return ok(whatsapp.getStatus(uid(r)));
        });
      api.get('/logs', async (r) => listRecords(r, path('logs', uid(r)), 'timestamp'));
      api.get('/analytics', async (r) => {
        const { range } = z
          .object({ range: z.enum(['1d', '7d', '30d']).default('7d') })
          .parse(r.query);
        const days = Number(range.slice(0, -1));
        const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
        const snap = await firebase()
          .db.ref(`analytics/${uid(r)}/daily`)
          .orderByKey()
          .startAt(since)
          .limitToLast(days)
          .get();
        const daily = (snap.val() as Record<string, DailyAnalytics>) || {};
        const totals: Record<string, number> = {
          incoming: 0,
          outgoing: 0,
          autoReplies: 0,
          manualReplies: 0,
          leads: 0,
          humanTakeovers: 0,
          newContacts: 0,
          rulesTriggered: 0,
        };
        for (const day of Object.values(daily))
          for (const metric of Object.keys(totals))
            totals[metric] += Number(day[metric as keyof DailyAnalytics] || 0);
        return ok({ daily, totals, hourTimezone: 'UTC' });
      });
    },
    { prefix: '/api/v1' },
  );
  return app;
}
