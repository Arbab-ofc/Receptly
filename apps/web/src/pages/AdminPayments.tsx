import PaymentWhatsApp from './PaymentWhatsApp';
import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ManualPayment, type PaymentStatus } from '@receptly/shared';
import { api, type Page } from '../lib/api';
import {
  Section,
  Badge,
  Button,
  Dialog,
  Field,
  Toggle,
  Skeleton,
  ErrorState,
} from '../components/ui';
export default function AdminPayments() {
  const [filter, setFilter] = useState<PaymentStatus | 'all'>('submitted');
  const [review, setReview] = useState<ManualPayment | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['admin', 'payments', filter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page<ManualPayment & { notificationStatus?: string | null }>>(
        `admin/payments?limit=25${filter !== 'all' ? `&paymentStatus=${filter}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 30000,
  });
  return (
    <>
      <PaymentWhatsApp />
      <Section title="Subscription payments">
        <p className="admin-section-description">
          Approve only after verifying the actual credit in your bank account. A submitted reference
          is not proof of payment.
        </p>
        <Field label="Payment status">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
          >
            <option value="submitted">Awaiting verification</option>
            <option value="pending">Awaiting payment</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All payments</option>
          </select>
        </Field>
        {query.isPending ? (
          <Skeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : !query.data?.pages.some((page) => page.items.length) ? (
          <p>No payments in this view.</p>
        ) : (
          <div className="admin-list">
            {query.data.pages
              .flatMap((page) => page.items)
              .map((payment) => (
                <article className="admin-row" key={payment.id}>
                  <div className="admin-row-main">
                    <h3>
                      ₹{payment.amountPaise / 100} ·{' '}
                      {payment.planId === 'yearly' ? 'Yearly' : 'Monthly'} subscription
                    </h3>
                    <p>Workspace UID: {payment.userId}</p>
                    <p>
                      {payment.reference
                        ? `Reference: ${payment.reference}`
                        : 'No transaction reference submitted'}
                    </p>
                    <small>{new Date(payment.createdAt).toLocaleString()}</small>
                    {payment.reviewNote && <p>{payment.reviewNote}</p>}
                    {payment.notificationStatus && (
                      <p>
                        WhatsApp alert:{' '}
                        {payment.notificationStatus === 'completed'
                          ? 'Sent'
                          : payment.notificationStatus === 'uncertain'
                            ? 'Delivery uncertain — check WhatsApp'
                            : payment.notificationStatus === 'failed'
                              ? 'Send failed — check sender connection'
                              : payment.notificationStatus === 'cancelled'
                                ? 'Cancelled'
                                : 'Queued'}
                      </p>
                    )}
                  </div>
                  <Badge tone={payment.status === 'approved' ? 'green' : 'neutral'}>
                    {payment.status}
                  </Badge>
                  {payment.status === 'submitted' && (
                    <Button variant="outline" onClick={() => setReview(payment)}>
                      Review payment
                    </Button>
                  )}
                </article>
              ))}
          </div>
        )}
        {query.hasNextPage && (
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more payments
          </Button>
        )}
        {review && <ReviewPayment payment={review} onClose={() => setReview(null)} />}
      </Section>
    </>
  );
}
function ReviewPayment({ payment, onClose }: { payment: ManualPayment; onClose: () => void }) {
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [verified, setVerified] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api(`admin/payments/${payment.id}`, 'PATCH', {
        decision,
        expectedVersion: payment.version,
        note,
        ...(decision === 'approve'
          ? { bankCreditVerified: verified, verifiedAmountPaise: Math.round(Number(amount) * 100) }
          : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin'] });
      void client.invalidateQueries({ queryKey: ['billing'] });
      void client.invalidateQueries({ queryKey: ['billing-history'] });
      onClose();
    },
  });
  return (
    <Dialog title="Review subscription payment" onClose={() => !mutation.isPending && onClose()}>
      <p className="billing-note">
        {payment.userId} · {payment.planId} · ₹{payment.amountPaise / 100}
      </p>
      <dl className="billing-payee">
        <div>
          <dt>Transaction reference</dt>
          <dd>{payment.reference}</dd>
        </div>
        <div>
          <dt>Requested recipient</dt>
          <dd>
            {payment.payeeName} · {payment.upiId}
          </dd>
        </div>
      </dl>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="Decision">
          <select
            value={decision}
            onChange={(event) => setDecision(event.target.value as typeof decision)}
            disabled={mutation.isPending}
          >
            <option value="approve">Approve payment & activate access</option>
            <option value="reject">Reject payment request</option>
          </select>
        </Field>
        {decision === 'approve' && (
          <>
            <Field
              label="Amount received in bank (INR)"
              hint={`Enter the amount actually credited. Expected: ₹${payment.amountPaise / 100}.`}
            >
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                disabled={mutation.isPending}
              />
            </Field>
            <div className="toggle-field">
              <span>I verified this credit in the bank account</span>
              <Toggle label="Bank credit verified" checked={verified} onChange={setVerified} />
            </div>
            <p className="billing-note">
              Approval starts a new calendar period or extends an active subscription from its
              current expiry.
            </p>
          </>
        )}
        <Field label={decision === 'reject' ? 'Reason for rejection' : 'Review note (optional)'}>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required={decision === 'reject'}
            maxLength={1000}
            disabled={mutation.isPending}
          />
        </Field>
        {mutation.isError && (
          <p role="alert" className="field-error">
            {mutation.error.message}
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending || (decision === 'approve' && !verified)}
          >
            {mutation.isPending
              ? 'Saving…'
              : decision === 'approve'
                ? 'Approve & activate'
                : 'Reject request'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
