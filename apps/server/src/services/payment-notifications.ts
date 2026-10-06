import type { ManualPayment } from '@receptly/shared';
import { env } from '../config/env.js';
import { firebase } from '../config/firebase.js';
import { paymentWhatsapp, paymentSenderSessionId } from '../modules/whatsapp/payment-sender.js';
import { store, path } from './store.js';
import { withLock } from './locks.js';
import { acquire, backoff, leaseMs, type Operation } from './operations.js';

interface Notification extends Operation {
  id: string;
  userId: string;
  phase: 'queued' | 'preparing' | 'sending';
  scheduledFor: number;
  createdAt: number;
  messageId?: string;
}
// Narrow adapter allows tests to verify identity inclusion without live Firebase or WhatsApp.
export const paymentNotificationIdentity = { get: (uid: string) => firebase().auth.getUser(uid) };
export function paymentNotificationsConfigured() {
  return !!env.PAYMENT_NOTIFY_WHATSAPP_NUMBER;
}
const clean = (value: string | undefined) =>
  (value || 'Not provided').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
export function paymentNotificationText(
  payment: ManualPayment,
  user: { displayName?: string; email?: string },
) {
  const submitted = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(payment.submittedAt || payment.createdAt));
  return [
    '*Receptly | Subscription Payment Review*',
    'Status: Awaiting bank verification',
    '',
    '*Customer details*',
    `Name: ${clean(user.displayName)}`,
    `Email: ${clean(user.email)}`,
    `User ID: ${clean(payment.userId)}`,
    '',
    '*Payment details*',
    `Plan: ${payment.planId === 'yearly' ? 'Yearly (12 months)' : 'Monthly (1 month)'}`,
    `Amount: ₹${(payment.amountPaise / 100).toFixed(2)} INR`,
    `UTR / Reference: ${clean(payment.reference)}`,
    `Payment ID: ${clean(payment.id)}`,
    `Submitted: ${submitted} IST`,
    '',
    '*Action required*',
    'Verify the UTR, recipient and amount against the credit in your bank account.',
    'Review and approve or reject in Admin panel → Subscription payments.',
    '',
    'This is a payment submission notice. Bank credit is unverified; subscription access changes only after approval.',
    'For an existing subscription, the approved next plan starts after the current plan ends.',
  ].join('\n');
}
async function archive(
  job: Notification,
  status: Operation['status'] | 'cancelled',
  now: number,
  extra: object = {},
) {
  await store.update({
    [`paymentNotifications/${job.id}`]: null,
    [`paymentNotificationHistory/${job.id}`]: { ...job, status, updatedAt: now, ...extra },
  });
}
export async function runPaymentNotifications(now = Date.now()) {
  if (!paymentNotificationsConfigured()) return;
  const sender = paymentSenderSessionId;
  const recipient = env.PAYMENT_NOTIFY_WHATSAPP_NUMBER;
  const jobs = await store.due<Notification>('paymentNotifications', now);
  for (const candidate of jobs) {
    await withLock(`payment-notification:${candidate.id}`, () =>
      withLock(`workspace:${candidate.userId}`, async () => {
        const p = `paymentNotifications/${candidate.id}`;
        let job = await store.get<Notification>(p);
        if (!job) return;
        if (['completed', 'uncertain'].includes(job.status)) {
          await archive(job, job.status, now);
          return;
        }
        // Once dispatch begins, a crash or lost acknowledgement must never blindly resend.
        if (
          job.status === 'processing' &&
          (job.leaseUntil || 0) <= now &&
          job.phase === 'sending'
        ) {
          await archive(job, 'uncertain', now, { errorCode: 'DELIVERY_UNCERTAIN' });
          return;
        }
        if (job.attempts >= 5) {
          await archive(job, 'failed', now);
          return;
        }
        const payment = await store.get<ManualPayment>(path('manualPayments', job.userId, job.id));
        if (
          (await store.get(path('accountDeletion', job.userId))) ||
          !payment ||
          payment.status !== 'submitted'
        ) {
          await archive(job, 'cancelled', now);
          return;
        }
        if (paymentWhatsapp.getStatus(sender).status !== 'connected') return;
        const claim = await acquire(p, now);
        if (!claim) return;
        job = {
          ...job,
          owner: claim.owner,
          attempts: claim.attempts,
          status: 'processing',
          phase: 'preparing',
          leaseUntil: now + leaseMs,
        };
        let dispatchStarted = false;
        try {
          await store.patch(p, { phase: 'preparing' });
          const user = await paymentNotificationIdentity.get(job.userId);
          await store.patch(p, { phase: 'sending' });
          dispatchStarted = true;
          const send = paymentWhatsapp.sendMessage(
            sender,
            `${recipient}@s.whatsapp.net`,
            paymentNotificationText(payment, user),
          );
          let timer: ReturnType<typeof setTimeout> | undefined;
          let messageId: string;
          try {
            messageId = await Promise.race([
              send,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      Object.assign(new Error('Dispatch timed out'), {
                        code: 'DELIVERY_UNCERTAIN',
                      }),
                    ),
                  15000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          await archive({ ...job, phase: 'sending' }, 'completed', now, { messageId });
        } catch (error) {
          const code = (error as { code?: string }).code || 'NOTIFICATION_FAILED';
          const uncertain = dispatchStarted && code !== 'WHATSAPP_DISCONNECTED';
          if (uncertain) {
            await archive({ ...job, phase: 'sending' }, 'uncertain', now, {
              errorCode: 'DELIVERY_UNCERTAIN',
            });
          } else {
            await store.patch(p, {
              status: 'failed',
              phase: 'queued',
              leaseUntil: 0,
              errorCode: code,
              nextAttemptAt: now + backoff(claim.attempts),
              scheduledFor: now + backoff(claim.attempts),
            });
          }
        }
      }),
    );
  }
}
