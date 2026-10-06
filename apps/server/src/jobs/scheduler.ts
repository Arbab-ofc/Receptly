import { runPaymentNotifications } from '../services/payment-notifications.js';
import { automationEntitled } from '../services/billing.js';
import { store, path, stableKey } from '../services/store.js';
import { whatsapp } from '../modules/whatsapp/manager.js';
import {
  defaultSettings,
  defaultHours,
  localDate,
  type Settings,
  type Conversation,
  type Hours,
  type Holiday,
  type Contact,
} from '@receptly/shared';
import { acquire, finish, backoff, leaseMs, type Operation } from '../services/operations.js';
import { cleanupWorkspace } from '../services/retention.js';
import { monitoring } from '../services/monitoring.js';
import { businessOpen } from '../modules/receptionist/logic.js';
import { env } from '../config/env.js';
import { deleteAccount } from '../services/accounts.js';
import pino from 'pino';
const logger = pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
type Job = Operation & {
  id: string;
  conversationId: string;
  scheduledFor: number;
  payload: { text: string };
  createdAt: number;
};
export async function runSchedulerTick(now = Date.now()) {
  await runPaymentNotifications(now).catch(() =>
    monitoring.alert('payment_notification_worker_failed'),
  );
  const uids = new Set(
    (
      await Promise.all(
        ['workspaceRegistry', 'settings', 'whatsapp', 'accountDeletion'].map((root) =>
          store.keys(root),
        ),
      )
    ).flat(),
  );
  for (const uid of uids) {
    let stage = 'account_deletion';
    try {
      const deletion = await store.get<{ status: string }>(path('accountDeletion', uid));
      if (deletion) {
        if (deletion.status === 'deleting') await deleteAccount(uid, 'DELETE MY ACCOUNT');
        continue;
      }
      stage = 'retention';
      await cleanupWorkspace(uid, now);
      stage = 'inbox_recovery';
      await whatsapp.engine.recover(uid);
      stage = 'followups';
      const settings = (await store.get<Settings>(path('settings', uid))) || defaultSettings;
      const jobs = await store.due<Job>(path('jobs', uid), now);
      for (const job of jobs) {
        const p = path('jobs', uid, job.id);
        if (
          (job.status === 'failed' && job.attempts >= 5) ||
          ['completed', 'uncertain', 'cancelled'].includes(job.status)
        ) {
          await store.update({
            [path('jobHistory', uid, job.id)]: { ...job, updatedAt: now },
            [p]: null,
          });
          continue;
        }
        if (now - job.scheduledFor > env.ALERT_JOB_AGE_MINUTES * 60000)
          monitoring.alert('followup_overdue', {
            ageMinutes: Math.floor((now - job.scheduledFor) / 60000),
          });
        if (whatsapp.getStatus(uid).status !== 'connected') continue;
        const claim = await acquire(p, now);
        if (!claim) continue;
        const renewal = setInterval(() => {
          void finish(p, claim.owner, {
            status: 'processing',
            leaseUntil: Date.now() + leaseMs,
          }).catch(() => monitoring.alert('job_lease_renewal_failed'));
        }, leaseMs / 3);
        try {
          const outcome = await whatsapp.engine.withConversation(
            uid,
            (await store.get<Conversation>(path('conversations', uid, job.conversationId)))
              ?.chatId || job.conversationId,
            async () => {
              const current = await store.get<Conversation>(
                path('conversations', uid, job.conversationId),
              );
              const currentJob = await store.get<Job>(p);
              const currentSettings =
                (await store.get<Settings>(path('settings', uid))) || settings;
              const recipient = current
                ? await store.get<Contact>(path('contacts', uid, current.contactId))
                : null;
              if (
                currentJob?.status !== 'processing' ||
                currentJob.owner !== claim.owner ||
                !current ||
                (recipient && ['Ignore', 'Blocked'].includes(recipient.type)) ||
                !currentSettings.automationEnabled ||
                !currentSettings.followUpEnabled ||
                !current.automationEnabled ||
                current.needsHuman ||
                current.receptionistStoppedDate ===
                  localDate(currentSettings.timezone, new Date(now))
              )
                return 'cancelled';
              const hours = (await store.get<Hours>(path('businessHours', uid))) || defaultHours;
              if (
                !(await automationEntitled(uid, now)) ||
                (current.pauseUntil || 0) > now ||
                !businessOpen(
                  hours,
                  currentSettings.timezone,
                  new Date(now),
                  await store.list<Holiday>(path('holidays', uid), 200),
                )
              )
                return 'deferred';
              const sent = await whatsapp.engine.reply(
                uid,
                current,
                job.payload.text,
                currentSettings,
                hours,
                'follow_up',
                0,
                undefined,
                `job:${job.id}`,
              );
              if (sent) return 'completed';
              const request = await store.get<{ status: string }>(
                path('sendRequests', uid, stableKey(`job:${job.id}:follow_up:`)),
              );
              return request && ['sending', 'uncertain'].includes(request.status)
                ? 'uncertain'
                : 'deferred';
            },
          );
          if (outcome === 'deferred') {
            await finish(p, claim.owner, { status: 'pending', attempts: claim.attempts - 1 });
            await store.patch(p, { scheduledFor: now + 60000 });
          } else {
            await finish(p, claim.owner, {
              status: outcome === 'cancelled' ? 'completed' : outcome,
            });
            const current = await store.get<Job>(p);
            await store.update({
              [path('jobHistory', uid, job.id)]: { ...current, status: outcome, updatedAt: now },
              [p]: null,
            });
          }
        } catch (error) {
          const code = (error as { code?: string }).code || 'JOB_FAILED';
          await finish(p, claim.owner, {
            status: code === 'DELIVERY_UNCERTAIN' ? 'uncertain' : 'failed',
            errorCode: code,
            nextAttemptAt: now + backoff(claim.attempts),
          });
          await store.patch(p, { scheduledFor: now + backoff(claim.attempts), updatedAt: now });
          monitoring.alert('followup_failed', { code, attempts: claim.attempts });
        } finally {
          clearInterval(renewal);
        }
      }
    } catch (error) {
      monitoring.alert('workspace_maintenance_failed', {
        code:
          (error as { code?: string }).code ||
          (/index not defined/i.test((error as Error).message || '')
            ? 'FIREBASE_INDEX_MISSING'
            : 'UNKNOWN'),
        stage,
      });
    }
  }
  monitoring.schedulerTick();
}
export function startScheduler() {
  let stopped = false;
  let active: Promise<void> | undefined;
  const tick = () => {
    if (active || stopped) return;
    active = runSchedulerTick()
      .catch((error) => logger.error({ code: error?.code }, 'Scheduler tick failed'))
      .finally(() => {
        active = undefined;
      });
  };
  const timer = setInterval(tick, 60000);
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await active;
  };
}
