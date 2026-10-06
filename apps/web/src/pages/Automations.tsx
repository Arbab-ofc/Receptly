import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Hand, Users, MessageSquare, CalendarClock, ArrowUpRight } from 'lucide-react';
import type { Settings, ActivityLog } from '@receptly/shared';
import { api } from '../lib/api';
import { PageHeader, Toggle, Badge, Skeleton, ErrorState, toast } from '../components/ui';
export default function Automations() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('settings') });
  const logs = useQuery({
    queryKey: ['logs', 'automations'],
    queryFn: () => api<ActivityLog[]>('logs?limit=100'),
  });
  const mutation = useMutation({
    mutationFn: (patch: Partial<Settings>) => api('settings', 'PATCH', patch),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['settings'] });
      toast('Automation updated');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const cards = [
    {
      title: 'Out-of-hours reply',
      description: 'A helpful reply when your business is closed.',
      key: 'outOfHoursEnabled',
      icon: Clock,
      event: 'auto_reply_sent',
    },
    {
      title: 'Welcome new contacts',
      description: 'Make a great first impression with a warm welcome.',
      key: 'welcomeEnabled',
      icon: MessageSquare,
      event: 'auto_reply_sent',
    },
    {
      title: 'Human takeover',
      description: 'Pause a conversation when someone asks for a person.',
      key: 'human',
      icon: Hand,
      event: 'human_takeover',
    },
    {
      title: 'Lead detection',
      description: 'Capture interest in pricing, appointments, and purchases.',
      key: 'leadDetectionEnabled',
      icon: Users,
      event: 'lead_created',
    },
    {
      title: 'Follow-up reminder',
      description: 'One thoughtful check-in after a customer goes quiet.',
      key: 'followUpEnabled',
      icon: CalendarClock,
      event: 'auto_reply_sent',
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="LESS REPETITION, MORE CONNECTION"
        title="Automations"
        description="Simple behaviors that keep your front desk running smoothly."
      />
      {settings.isLoading ? (
        <Skeleton />
      ) : settings.isError ? (
        <ErrorState error={settings.error} retry={() => void settings.refetch()} />
      ) : (
        <div className="automation-list">
          {cards.map((c) => {
            const enabled = c.key === 'human' || Boolean(settings.data?.[c.key as keyof Settings]);
            const last = logs.data?.find((l) => l.type === c.event);
            return (
              <article key={c.key}>
                <span className="automation-icon">
                  <c.icon size={23} />
                </span>
                <div>
                  <h3>
                    {c.title}
                    <Badge tone={enabled ? 'green' : 'neutral'}>
                      {enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </h3>
                  <p>{c.description}</p>
                  <small>
                    {last
                      ? `Related activity: ${new Date(last.timestamp).toLocaleString()}`
                      : 'No recorded activity yet'}
                  </small>
                </div>
                <Link
                  className="text-link"
                  to={`/dashboard/settings?section=${c.key === 'outOfHoursEnabled' ? 'hours' : c.key === 'human' ? 'handover' : 'followups'}${c.key === 'welcomeEnabled' ? '#welcome' : c.key === 'leadDetectionEnabled' ? '#leads' : c.key === 'followUpEnabled' ? '#followup' : ''}`}
                >
                  Configure <ArrowUpRight size={14} />
                </Link>
                {c.key !== 'human' && (
                  <Toggle
                    checked={enabled}
                    label={c.title}
                    disabled={mutation.isPending}
                    onChange={(value) => mutation.mutate({ [c.key]: value })}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
