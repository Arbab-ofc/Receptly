import { z } from 'zod';
export const subscriptionPlans = [
  { id: 'monthly', name: 'Monthly', amountPaise: 5900, currency: 'INR', months: 1 },
  { id: 'yearly', name: 'Yearly', amountPaise: 65000, currency: 'INR', months: 12 },
] as const;
export const planIdSchema = z.enum(['monthly', 'yearly']);
export type PlanId = z.infer<typeof planIdSchema>;
export type PaymentStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'cancelled';
export interface ManualPayment {
  id: string;
  userId: string;
  planId: PlanId;
  amountPaise: number;
  currency: 'INR';
  status: PaymentStatus;
  payeeName: string;
  upiId: string;
  reference?: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  submittedAt?: number;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  periodStart?: number;
  periodEnd?: number;
}
export interface Subscription {
  scheduledPlan?: { planId: PlanId; startsAt: number; expiresAt: number; paymentId: string };
  planId: PlanId;
  startsAt: number;
  expiresAt: number;
  lastPaymentId: string;
  updatedAt: number;
  version: number;
}
export interface AccessProfile {
  tier: 'free' | 'pro';
  source: 'platform_admin' | 'admin' | 'payment' | 'none';
  expiresAt: number | null;
  version: number;
}
export interface BillingSummary {
  access: AccessProfile;
  plans: typeof subscriptionPlans;
  paymentConfigured: boolean;
  enforcementEnabled: boolean;
  subscription: Subscription | null;
  active: boolean;
  payments: ManualPayment[];
}
export const paymentReferenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9-]{6,64}$/,
    'Enter the transaction reference from your payment app (6–64 letters, digits or hyphens).',
  );
// Calendar periods clamp month-end dates rather than overflowing into a later month.
export function subscriptionEnd(startsAt: number, months: number) {
  const start = new Date(startsAt);
  const end = new Date(startsAt);
  const day = start.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end.getTime();
}
export function subscriptionActive(subscription: Subscription | null, now = Date.now()) {
  return !!subscription && subscription.startsAt <= now && subscription.expiresAt > now;
}
export function paymentUpiLink(payment: ManualPayment) {
  const params = new URLSearchParams({
    pa: payment.upiId,
    pn: payment.payeeName,
    am: (payment.amountPaise / 100).toFixed(2),
    cu: payment.currency,
    tn: `Receptly ${payment.planId} ${payment.id.slice(0, 8)}`,
  });
  return `upi://pay?${params.toString()}`;
}

// Resolve a prepaid next period without depending on a background job at the boundary.
export function effectiveSubscription(
  subscription: Subscription | null,
  now = Date.now(),
): Subscription | null {
  if (
    !subscription?.scheduledPlan ||
    now < subscription.scheduledPlan.startsAt ||
    now >= subscription.expiresAt
  )
    return subscription;
  const { scheduledPlan, ...current } = subscription;
  return {
    ...current,
    planId: scheduledPlan.planId,
    startsAt: scheduledPlan.startsAt,
    lastPaymentId: scheduledPlan.paymentId,
  };
}
