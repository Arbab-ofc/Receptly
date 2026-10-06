import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ArrowUpRight, CreditCard } from 'lucide-react';
import {
  type BillingSummary,
  type ManualPayment,
  type PlanId,
  paymentReferenceSchema,
  subscriptionActive,
} from '@receptly/shared';
import { api, type Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PlanChoices } from './Pricing';
import {
  PageHeader,
  Section,
  Button,
  Badge,
  Field,
  Skeleton,
  ErrorState,
  ConfirmDialog,
  toast,
} from '../components/ui';
const date = (value: number) => new Date(value).toLocaleString();
const statusLabels: Record<ManualPayment['status'], string> = {
  pending: 'Awaiting payment',
  submitted: 'Awaiting verification',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
export default function Billing() {
  const uid = useAuth((s) => s.user?.uid);
  const [params] = useSearchParams();
  const [plan, setPlan] = useState<PlanId>(params.get('plan') === 'yearly' ? 'yearly' : 'monthly');
  const [cancelling, setCancelling] = useState<ManualPayment | null>(null);
  const requestId = useRef<string | null>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['billing', uid],
    queryFn: () => api<BillingSummary>('billing'),
    refetchInterval: 30000,
  });
  const history = useInfiniteQuery({
    queryKey: ['billing-history', uid],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page<ManualPayment>>(
        `billing/payments?limit=25${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 30000,
  });
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ['billing'] });
    void client.invalidateQueries({ queryKey: ['billing-history'] });
    void client.invalidateQueries({ queryKey: ['receptionist'] });
  };
  const create = useMutation({
    mutationFn: () => {
      requestId.current ||= crypto.randomUUID();
      return api<ManualPayment>('billing/payments', 'POST', {
        planId: plan,
        requestId: requestId.current,
      });
    },
    onSuccess: () => {
      requestId.current = null;
      invalidate();
      toast('Payment request created');
    },
    onError: (error) => toast(error.message, 'error'),
  });
  const pending = query.data?.payments.find((payment) =>
    ['pending', 'submitted'].includes(payment.status),
  );
  const current = query.data?.subscription;
  const paidActive = subscriptionActive(current || null);
  const scheduled = paidActive ? current?.scheduledPlan : undefined;
  const blocked = !!scheduled || (paidActive && current?.planId === plan);
  return (
    <>
      <PageHeader
        title="Billing & subscription"
        eyebrow="YOUR PLAN"
        description="Manage your plan, submit a payment reference and track approval."
      />
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="billing-subscription">
            <CreditCard size={24} />
            <div>
              <h2>
                {query.data.active
                  ? ['admin', 'platform_admin'].includes(query.data.access?.source || '')
                    ? 'Your Pro access is active'
                    : 'Your subscription is active'
                  : query.data.subscription
                    ? 'Your subscription has expired'
                    : 'Choose your first subscription'}
              </h2>
              <p>
                {['admin', 'platform_admin'].includes(query.data.access?.source || '')
                  ? query.data.access?.source === 'platform_admin'
                    ? 'Your admin account always includes Pro. No payment or renewal required.'
                    : 'Pro granted by an admin. No payment required; available until revoked.'
                  : query.data.subscription
                    ? `${query.data.subscription.planId === 'yearly' ? 'Yearly' : 'Monthly'} plan · ${query.data.active ? 'Access until' : 'Expired'} ${date(query.data.subscription.scheduledPlan?.startsAt || query.data.subscription.expiresAt)}`
                    : '₹59 monthly or ₹650 yearly. Both plans include the same features.'}
              </p>
            </div>
            <Badge tone={query.data.active ? 'green' : 'neutral'}>
              {query.data.active ? 'Pro' : 'Free'}
            </Badge>
          </div>
          {scheduled && (
            <p className="billing-notice" role="status">
              Upcoming {scheduled.planId === 'yearly' ? 'Yearly' : 'Monthly'} plan:{' '}
              {date(scheduled.startsAt)} to {date(scheduled.expiresAt)}. Your current plan continues
              until then.
            </p>
          )}
          {pending ? (
            <PaymentInstructions
              key={pending.id}
              payment={pending}
              onSaved={invalidate}
              onCancel={() => setCancelling(pending)}
            />
          ) : ['admin', 'platform_admin'].includes(query.data.access?.source || '') ? null : (
            <Section title={paidActive ? 'Schedule your next plan' : 'Choose your plan'}>
              <PlanChoices
                disabledPlans={
                  scheduled ? ['monthly', 'yearly'] : paidActive ? [current!.planId] : []
                }
                selected={plan}
                onSelect={(value) => {
                  setPlan(value);
                  requestId.current = null;
                }}
              />
              <p className="billing-note">
                {scheduled
                  ? 'Your next plan is already booked. Further purchases are available after it expires.'
                  : paidActive
                    ? 'Your current plan can be purchased again after expiry. Choose the other plan to schedule it after your current plan ends, subject to payment approval.'
                    : 'Pay once for your selected period. No automatic renewals.'}
              </p>
              {!query.data.paymentConfigured && (
                <p role="status" className="billing-notice">
                  Payment details are being set up. Please contact support before sending any money.
                </p>
              )}
              <Button
                disabled={!query.data.paymentConfigured || create.isPending || blocked}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Creating request…' : 'Continue to payment'}
                <ArrowUpRight size={16} />
              </Button>
            </Section>
          )}
          <Section title="Payment history">
            {history.isPending ? (
              <Skeleton />
            ) : history.isError ? (
              <ErrorState error={history.error} retry={() => void history.refetch()} />
            ) : !history.data?.pages.some((page) => page.items.length) ? (
              <p>No payment requests yet.</p>
            ) : (
              <div className="billing-history">
                {history.data.pages
                  .flatMap((page) => page.items)
                  .map((payment) => (
                    <article key={payment.id}>
                      <div>
                        <h3>
                          {payment.planId === 'yearly' ? 'Yearly' : 'Monthly'} subscription · ₹
                          {payment.amountPaise / 100}
                        </h3>
                        <p>
                          {date(payment.createdAt)}
                          {payment.reference ? ` · Reference: ${payment.reference}` : ''}
                        </p>
                        {payment.reviewNote && <p>{payment.reviewNote}</p>}
                        {payment.periodEnd && <p>Access added through {date(payment.periodEnd)}</p>}
                      </div>
                      <Badge tone={payment.status === 'approved' ? 'green' : 'neutral'}>
                        {statusLabels[payment.status]}
                      </Badge>
                    </article>
                  ))}
              </div>
            )}
            {history.hasNextPage && (
              <Button
                variant="outline"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                Load older payments
              </Button>
            )}
          </Section>
        </>
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancel this payment request?"
          description="Cancel only if you have not paid. If you already paid, submit the transaction reference or contact support."
          onClose={() => setCancelling(null)}
          onConfirm={async () => {
            await api(`billing/payments/${cancelling.id}`, 'PATCH', {
              action: 'cancel',
              expectedVersion: cancelling.version,
            });
            invalidate();
          }}
        />
      )}
    </>
  );
}
function PaymentInstructions({
  payment,
  onSaved,
  onCancel,
}: {
  payment: ManualPayment;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const client = useQueryClient();
  const details = useQuery({
    queryKey: ['billing-payment', payment.id],
    queryFn: () =>
      api<ManualPayment & { qrDataUrl: string; upiLink: string }>(`billing/payments/${payment.id}`),
    enabled: payment.status === 'pending',
  });
  const submit = useMutation({
    mutationFn: () => {
      const parsed = paymentReferenceSchema.safeParse(reference);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      return api(`billing/payments/${payment.id}`, 'PATCH', {
        action: 'submit',
        reference: parsed.data,
        expectedVersion: payment.version,
      });
    },
    onSuccess: () => {
      onSaved();
      void client.invalidateQueries({ queryKey: ['billing-payment', payment.id] });
      toast('Payment reference submitted for verification');
    },
    onError: (error) => setError(error.message),
  });
  if (payment.status === 'submitted')
    return (
      <Section title="Payment submitted">
        <div className="billing-pending">
          <Check size={24} />
          <div>
            <h3>Awaiting bank verification</h3>
            <p>Reference: {payment.reference}</p>
            <p>
              Your ₹{payment.amountPaise / 100} {payment.planId} payment is in the admin review
              queue. Access activates after approval. Please do not pay again for this request.
            </p>
          </div>
        </div>
      </Section>
    );
  return (
    <Section title={`Pay ₹${payment.amountPaise / 100} for your ${payment.planId} plan`}>
      <div className="billing-payment-grid">
        <div className="billing-qr">
          {details.isPending ? (
            <Skeleton />
          ) : details.isError ? (
            <ErrorState error={details.error} retry={() => void details.refetch()} />
          ) : (
            <>
              <img
                src={details.data.qrDataUrl}
                width="256"
                height="256"
                alt={`Scan to pay ₹${payment.amountPaise / 100} to ${payment.payeeName}`}
              />
              <a href={details.data.upiLink} className="button button--outline">
                Open UPI app
                <ArrowUpRight size={16} />
              </a>
            </>
          )}
          <p>Check the recipient and amount in your payment app before paying.</p>
        </div>
        <div>
          <dl className="billing-payee">
            <div>
              <dt>Pay to</dt>
              <dd>{payment.payeeName}</dd>
            </div>
            <div>
              <dt>UPI ID</dt>
              <dd>
                {payment.upiId}
                <Button
                  variant="ghost"
                  aria-label="Copy UPI ID"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(payment.upiId)
                      .then(() => toast('UPI ID copied'))
                      .catch(() => toast('Copy the UPI ID manually', 'error'))
                  }
                >
                  <Copy size={15} />
                </Button>
              </dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>₹{payment.amountPaise / 100}</dd>
            </div>
          </dl>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError('');
              submit.mutate();
            }}
          >
            <Field
              label="Transaction reference / UTR"
              hint="Pay first, then copy the transaction reference from your payment app."
              error={error}
            >
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                maxLength={64}
                required
                autoComplete="off"
              />
            </Field>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'I have paid — submit reference'}
            </Button>
          </form>
          <Button
            className="billing-cancel"
            variant="ghost"
            disabled={submit.isPending}
            onClick={onCancel}
          >
            Cancel unpaid request
          </Button>
        </div>
      </div>
    </Section>
  );
}
