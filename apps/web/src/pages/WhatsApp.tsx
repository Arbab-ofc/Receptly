import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { WhatsAppStatus } from '@receptly/shared';
import { Smartphone, RefreshCw, Link2, ShieldCheck, LogOut, Wifi, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import {
  PageHeader,
  Section,
  ConnectionStatus,
  Button,
  ConfirmDialog,
  Skeleton,
  ErrorState,
  toast,
} from '../components/ui';
export default function WhatsApp() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['whatsapp'],
    queryFn: () => api<WhatsAppStatus>('whatsapp/status'),
    refetchInterval: 5000,
  });
  const [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const mutation = useMutation({
    mutationFn: (action: string) => api<WhatsAppStatus>(`whatsapp/${action}`, 'POST'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['whatsapp'] });
      toast('Connection updated');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const status = query.data;
  return (
    <>
      <PageHeader
        eyebrow="YOUR NUMBER, CONNECTED"
        title="WhatsApp connection"
        description="Link your WhatsApp and let your receptionist take it from here."
      />
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className="connection-layout">
          <Section
            title="Your WhatsApp account"
            action={<ConnectionStatus status={status?.status} failed={query.isError} />}
          >
            <div className="connection-state">
              {status?.status === 'connected' ? (
                <>
                  <span className="connection-icon connected">
                    <Wifi size={34} />
                  </span>
                  <h2>You’re connected.</h2>
                  <p>Your receptionist runs on your server, even when you close this dashboard.</p>
                  <div className="connection-details">
                    <div>
                      <span>Account</span>
                      <strong>{status.displayName || 'WhatsApp account'}</strong>
                    </div>
                    <div>
                      <span>Number</span>
                      <strong>{status.phoneNumber || 'Linked device'}</strong>
                    </div>
                    <div>
                      <span>Connected since</span>
                      <strong>
                        {status.connectedAt ? new Date(status.connectedAt).toLocaleString() : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>Last activity</span>
                      <strong>
                        {status.lastActivityAt
                          ? new Date(status.lastActivityAt).toLocaleString()
                          : 'Waiting for activity'}
                      </strong>
                    </div>
                  </div>
                  <div className="connection-actions">
                    <Button
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate('reconnect')}
                    >
                      <RefreshCw size={16} />
                      Reconnect
                    </Button>
                    <Button
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate('disconnect')}
                    >
                      Disconnect
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirm(true)}>
                      <LogOut size={16} />
                      Unlink account
                    </Button>
                  </div>
                </>
              ) : status?.status === 'qr_required' ? (
                <>
                  <h2>Scan. Connect. Done.</h2>
                  <p>Use Linked Devices in WhatsApp to scan this code.</p>
                  {status.qr && (
                    <img
                      className="qr-image"
                      src={status.qr}
                      alt="Scan this QR code with WhatsApp Linked Devices"
                    />
                  )}
                  <span className="qr-countdown">
                    {Math.max(0, Math.ceil(((status.qrExpiresAt || 0) - now) / 1000)) > 0
                      ? `Refreshing in ${Math.max(0, Math.ceil(((status.qrExpiresAt || 0) - now) / 1000))} seconds`
                      : 'Waiting for a fresh QR code…'}
                  </span>
                  <Button
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate('reconnect')}
                  >
                    <RefreshCw size={15} />
                    Get a new code
                  </Button>
                </>
              ) : ['connecting', 'reconnecting'].includes(status?.status || '') ? (
                <>
                  <span className="connection-icon connecting">
                    <Link2 size={34} />
                  </span>
                  <h2>
                    {status?.status === 'reconnecting'
                      ? 'Finding your connection.'
                      : 'Getting ready to connect.'}
                  </h2>
                  <p>Keep this page open while we prepare your session.</p>
                  <div className="progress-track">
                    <span />
                  </div>
                  <Button
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate('reconnect')}
                  >
                    Retry connection
                  </Button>
                </>
              ) : (
                <>
                  <span className="connection-icon">
                    <Smartphone size={36} />
                  </span>
                  <h2>Your front desk starts here.</h2>
                  <p>
                    Connect your existing WhatsApp account.
                    <br />
                    One QR scan. No new phone number.
                  </p>
                  {status?.error && <p className="field-error">{status.error}</p>}
                  <Button disabled={mutation.isPending} onClick={() => mutation.mutate('connect')}>
                    {mutation.isPending ? 'Connecting…' : 'Connect WhatsApp'}
                    <ArrowRight size={16} />
                  </Button>
                  {status?.error && (
                    <Button variant="ghost" onClick={() => setConfirm(true)}>
                      Reset and relink
                    </Button>
                  )}
                </>
              )}
            </div>
          </Section>
          <div>
            <Section title="How to link your account">
              <ol className="connection-steps">
                {[
                  'Open WhatsApp on your phone.',
                  'Open Settings or the menu.',
                  'Choose Linked Devices.',
                  'Tap Link a Device.',
                  'Scan the QR code shown here.',
                ].map((step, i) => (
                  <li key={step}>
                    <span>{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </Section>
            <div className="security-note">
              <ShieldCheck size={23} />
              <div>
                <strong>A separate session, just for you.</strong>
                <p>
                  Your linked-device credentials stay on the server. They’re never shared with your
                  dashboard or other users.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title="Unlink your WhatsApp account?"
          description="Your server session will be removed. You’ll need to scan a new QR code to connect again. Conversations remain in your workspace."
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await api('whatsapp/logout', 'POST');
            void client.invalidateQueries({ queryKey: ['whatsapp'] });
            toast('WhatsApp unlinked');
          }}
        />
      )}
    </>
  );
}
