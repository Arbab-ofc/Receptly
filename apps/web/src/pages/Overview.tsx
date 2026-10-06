import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Zap,
  Users,
  Hand,
  ArrowUpRight,
  Check,
  ArrowRight,
  Pause,
  Play,
} from 'lucide-react';
import type { Settings, Conversation, WhatsAppStatus } from '@receptly/shared';
import { lazy, Suspense, useState } from 'react';
import type { AnalyticsData } from '../lib/analytics';
const ActivityChart = lazy(() => import('../components/ActivityChart'));
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader,
  Section,
  Button,
  Status,
  ConnectionStatus,
  Empty,
  Avatar,
  Badge,
  Skeleton,
  ErrorState,
  toast,
} from '../components/ui';
export default function Overview() {
  const user = useAuth((s) => s.user);
  const client = useQueryClient();
  const [range, setRange] = useState('7d');
  const analytics = useQuery({
    queryKey: ['analytics', range],
    queryFn: () => api<AnalyticsData>(`analytics?range=${range}`),
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('settings') });
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<Conversation[]>('conversations?limit=5'),
  });
  const whatsapp = useQuery({
    queryKey: ['whatsapp'],
    queryFn: () => api<WhatsAppStatus>('whatsapp/status'),
  });
  const receptionist = useQuery({
    queryKey: ['receptionist'],
    queryFn: () =>
      api<{ businessOpen: boolean; subscriptionRequired: boolean }>('receptionist/status'),
    refetchInterval: 60000,
  });
  const onboarding = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => api<{ scheduleConfigured: boolean; hasRules: boolean }>('onboarding'),
  });
  const mutation = useMutation({
    mutationFn: (body: Partial<Settings>) => api('settings', 'PATCH', body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['settings'] });
      toast('Receptionist updated');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const items = [
    {
      title: 'Add your business details',
      description: 'Save your business name and timezone.',
      done: !!settings.data?.businessName.trim() && settings.data.businessName !== 'My business',
      url: 'settings?section=business&onboarding=1',
    },
    {
      title: 'Connect WhatsApp',
      description: 'Link your existing number with a QR code.',
      done: whatsapp.data?.status === 'connected',
      url: 'whatsapp',
    },
    {
      title: 'Set business hours',
      description: 'Choose when you are open and review your closed-hours reply.',
      done: onboarding.data?.scheduleConfigured,
      url: 'schedule',
    },
    {
      title: 'Create your first reply rule',
      description: 'Personalize a starter reply and test a customer message.',
      done: onboarding.data?.hasRules,
      url: 'rules?starter=1',
    },
    {
      title: 'Enable your receptionist',
      description: 'Review your setup, then turn on automatic replies.',
      done: settings.data?.automationEnabled,
      url: 'settings?section=behavior',
    },
  ];
  const nextStep = items.findIndex((item) => !item.done);
  const setupError = settings.error || whatsapp.error || onboarding.error;
  const hour = new Date().getHours();
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE, AT A GLANCE"
        title={`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${user?.displayName?.split(' ')[0] || 'there'}.`}
        description="Here’s what’s happening with your receptionist."
        action={
          <Link className="button button--outline" to="/dashboard/whatsapp">
            <ConnectionStatus status={whatsapp.data?.status} failed={whatsapp.isError} />
            <ArrowUpRight size={15} />
          </Link>
        }
      />
      {receptionist.data?.subscriptionRequired && (
        <Section title="Activate your subscription">
          <p>
            Automatic replies and follow-ups are paused until your payment is approved. Incoming
            messages continue to appear in your inbox.
          </p>
          <Link className="button button--primary" to="/dashboard/billing">
            Choose or renew your plan <ArrowRight size={16} />
          </Link>
        </Section>
      )}
      {nextStep !== -1 && (
        <Section
          title="Get Receptly ready"
          action={
            <Badge>
              {items.filter((item) => item.done).length} of {items.length} complete
            </Badge>
          }
        >
          {settings.isLoading || whatsapp.isLoading || onboarding.isLoading ? (
            <Skeleton />
          ) : setupError ? (
            <ErrorState
              error={setupError}
              retry={() => {
                void settings.refetch();
                void whatsapp.refetch();
                void onboarding.refetch();
              }}
            />
          ) : (
            <>
              <div className="setup-next">
                <span className="eyebrow">YOUR NEXT STEP</span>
                <h3>{items[nextStep].title}</h3>
                <p>{items[nextStep].description}</p>
                <Link className="button button--primary" to={`/dashboard/${items[nextStep].url}`}>
                  Continue setup <ArrowRight size={16} />
                </Link>
              </div>
              <div className="onboarding-list">
                {items.map((item, i) => (
                  <Link
                    key={item.title}
                    className={i === nextStep ? 'next-setup-step' : ''}
                    to={`/dashboard/${item.url}`}
                    aria-current={i === nextStep ? 'step' : undefined}
                  >
                    <span className={item.done ? 'complete' : ''}>
                      {item.done ? <Check size={16} /> : i + 1}
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.done ? 'Complete' : i === nextStep ? 'Next' : 'To do'}</small>
                    <ArrowUpRight size={15} />
                  </Link>
                ))}
              </div>
            </>
          )}
        </Section>
      )}
      {analytics.isLoading ? (
        <Skeleton variant="dashboard" />
      ) : analytics.isError ? (
        <ErrorState error={analytics.error} retry={() => void analytics.refetch()} />
      ) : (
        <div className="metrics-grid">
          {[
            ['Incoming messages', 'incoming', MessageSquare],
            ['Automatic replies', 'autoReplies', Zap],
            ['New leads', 'leads', Users],
            ['Human takeovers', 'humanTakeovers', Hand],
          ].map(([label, metric, Icon]) => {
            const I = Icon as typeof Zap;
            return (
              <div className="metric" key={String(metric)}>
                <div>
                  <span>{String(label)}</span>
                  <I size={18} />
                </div>
                <strong>
                  {analytics.isLoading ? '—' : analytics.data?.totals[String(metric)] || 0}
                </strong>
                <small>
                  In the last {range.slice(0, -1)} {range === '1d' ? 'day' : 'days'}
                </small>
              </div>
            );
          })}
        </div>
      )}
      <div className="overview-grid">
        <Section
          title="Message activity"
          action={
            <select
              aria-label="Chart range"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              <option value="1d">Today (UTC)</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          }
        >
          {analytics.isLoading ? (
            <Skeleton variant="chart" />
          ) : analytics.isError ? (
            <ErrorState error={analytics.error} retry={() => void analytics.refetch()} />
          ) : (
            <Suspense fallback={<Skeleton variant="chart" />}>
              <ActivityChart data={analytics.data} range={range} />
            </Suspense>
          )}
        </Section>
        <Section title="Your receptionist" action={<Zap size={18} />}>
          <div className="receptionist-status">
            <Status
              active={settings.data?.automationEnabled && !receptionist.data?.subscriptionRequired}
              label={
                receptionist.data?.subscriptionRequired
                  ? 'Subscription required'
                  : settings.data?.automationEnabled
                    ? 'Active'
                    : 'Paused'
              }
            />
            <p>
              {receptionist.data?.subscriptionRequired
                ? 'Choose or renew your plan in Billing to resume automatic replies.'
                : settings.data?.automationEnabled
                  ? receptionist.data?.businessOpen === false
                    ? 'Outside business hours. Following your closed-hours settings.'
                    : settings.data?.mode !== 'Available'
                      ? `Responding with your ${settings.data?.mode?.toLowerCase()} reply.`
                      : 'Ready to respond, so you don’t have to be.'
                  : 'Enable your receptionist when you’re ready.'}
            </p>
          </div>
          <div className="detail-line">
            <span>Mode</span>
            <select
              aria-label="Receptionist mode"
              value={settings.data?.mode || 'Available'}
              onChange={(e) => mutation.mutate({ mode: e.target.value as Settings['mode'] })}
            >
              {['Available', 'Busy', 'Away', 'Meeting', 'Vacation', 'Offline'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="detail-line">
            <span>Business hours</span>
            <Link to="/dashboard/schedule">
              View schedule <ArrowUpRight size={13} />
            </Link>
          </div>
          <div className="detail-line">
            <span>Timezone</span>
            <strong>{settings.data?.timezone || 'Asia/Kolkata'}</strong>
          </div>
          <Button
            className="full-width"
            variant={settings.data?.automationEnabled ? 'outline' : 'primary'}
            disabled={!settings.data || mutation.isPending}
            onClick={() =>
              mutation.mutate({ automationEnabled: !settings.data?.automationEnabled })
            }
          >
            {settings.data?.automationEnabled ? <Pause size={16} /> : <Play size={16} />}{' '}
            {settings.data?.automationEnabled ? 'Pause receptionist' : 'Enable receptionist'}
          </Button>
        </Section>
      </div>
      <Section
        title="Recent conversations"
        action={
          <Link className="text-link" to="/dashboard/inbox">
            View inbox <ArrowUpRight size={15} />
          </Link>
        }
      >
        {conversations.isError ? (
          <ErrorState error={conversations.error} retry={() => void conversations.refetch()} />
        ) : conversations.isLoading ? (
          <Skeleton />
        ) : !conversations.data?.length ? (
          <Empty
            title="Your next conversation starts here."
            description="Connect WhatsApp and new customer messages will appear in your inbox."
            action={
              <Link className="button button--outline" to="/dashboard/whatsapp">
                Connect WhatsApp <ArrowRight size={15} />
              </Link>
            }
          />
        ) : (
          conversations.data.map((c) => (
            <Link to={`/dashboard/inbox?chat=${c.id}`} className="conversation-row" key={c.id}>
              <Avatar name={c.name} />
              <div>
                <strong>{c.name}</strong>
                <p>{c.lastMessageText}</p>
              </div>
              <Badge tone={c.needsHuman ? 'warm' : 'green'}>
                {c.needsHuman ? 'Needs human' : c.automationEnabled ? 'Automation on' : 'Paused'}
              </Badge>
              <small>
                {new Date(c.lastMessageAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            </Link>
          ))
        )}
      </Section>
    </>
  );
}
