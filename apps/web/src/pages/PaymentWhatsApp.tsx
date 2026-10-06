import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WhatsAppStatus } from '@receptly/shared';
import { api } from '../lib/api';
import {
  Section,
  Button,
  ConnectionStatus,
  Skeleton,
  ErrorState,
  ConfirmDialog,
  toast,
} from '../components/ui';
export default function PaymentWhatsApp() {
  const client = useQueryClient();
  const [unlink, setUnlink] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const query = useQuery({
    queryKey: ['admin', 'payment-whatsapp'],
    queryFn: () =>
      api<WhatsAppStatus & { recipientNumber: string }>('admin/payment-whatsapp/status'),
    refetchInterval: 3000,
  });
  const mutation = useMutation({
    mutationFn: (action: string) => api<WhatsAppStatus>(`admin/payment-whatsapp/${action}`, 'POST'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'payment-whatsapp'] });
      toast('Payment WhatsApp connection updated');
    },
    onError: (error) => toast(error.message, 'error'),
  });
  const status = query.data;
  const validQr = !!status?.qr && (status.qrExpiresAt || 0) > now;
  return (
    <>
      <Section
        title="Payment notification WhatsApp"
        action={<ConnectionStatus status={status?.status} failed={query.isError} />}
      >
        <p className="billing-note">
          Link your separate payment-alert number here. Its session is independent of the WhatsApp
          connected in your automation workspace. This number sends payment-review alerts and does
          not run receptionist automation.
        </p>
        {query.isPending ? (
          <Skeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <p className="billing-note">
              Receive alerts at:{' '}
              {status?.recipientNumber ||
                'Not configured. Set PAYMENT_NOTIFY_WHATSAPP_NUMBER on the server and restart.'}
            </p>
            {status?.status === 'connected' && (
              <p className="billing-note">
                Sender connected: {status.displayName || 'Payment WhatsApp'} ·{' '}
                {status.phoneNumber || 'Linked device'}
              </p>
            )}
            {status?.error && (
              <p role="alert" className="field-error">
                {status.error}
              </p>
            )}
            {status?.status === 'qr_required' && (
              <div className="billing-qr payment-sender-qr">
                {validQr ? (
                  <>
                    <img
                      src={status.qr}
                      width="256"
                      height="256"
                      alt="Scan to connect the separate payment notification WhatsApp"
                    />
                    <p>
                      On your payment-alert phone, open WhatsApp → Linked Devices → Link a Device
                      and scan this QR.
                    </p>
                  </>
                ) : (
                  <p>QR expired. Get a new QR code to continue.</p>
                )}
              </div>
            )}
            <div className="payment-sender-actions">
              {status?.status === 'disconnected' || status?.status === 'error' ? (
                <Button disabled={mutation.isPending} onClick={() => mutation.mutate('connect')}>
                  Connect payment WhatsApp
                </Button>
              ) : null}
              {status?.status === 'connecting' || status?.status === 'reconnecting' ? (
                <p role="status">Connecting payment WhatsApp…</p>
              ) : null}
              {status?.status === 'connected' || status?.status === 'qr_required' ? (
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate('reconnect')}
                >
                  {status.status === 'qr_required'
                    ? 'Get a new payment QR'
                    : 'Reconnect payment WhatsApp'}
                </Button>
              ) : null}
              {status?.status && status.status !== 'disconnected' && (
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate('disconnect')}
                >
                  Disconnect payment WhatsApp
                </Button>
              )}
              <Button variant="ghost" disabled={mutation.isPending} onClick={() => setUnlink(true)}>
                Unlink payment WhatsApp
              </Button>
            </div>
          </>
        )}
      </Section>
      {unlink && (
        <ConfirmDialog
          title="Unlink payment WhatsApp?"
          description="This removes only the payment-alert session. Pending alerts stay queued until you link a sender again."
          onClose={() => setUnlink(false)}
          onConfirm={async () => {
            await mutation.mutateAsync('logout');
          }}
        />
      )}
    </>
  );
}
