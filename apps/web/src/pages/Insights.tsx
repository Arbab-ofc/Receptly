import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { Rule, Lead, ActivityLog } from '@receptly/shared';
import { api } from '../lib/api';
import type { AnalyticsData } from '../lib/analytics';
const ActivityChart = lazy(() => import('../components/ActivityChart'));
import {
  PageHeader,
  Section,
  Badge,
  SearchInput,
  Empty,
  Skeleton,
  ErrorState,
  Button,
} from '../components/ui';
export function Analytics() {
  const [range, setRange] = useState('7d');
  const query = useQuery({
    queryKey: ['analytics', range],
    queryFn: () => api<AnalyticsData>(`analytics?range=${range}`),
  });
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => api<Rule[]>('rules?limit=200') });
  const leads = useQuery({ queryKey: ['leads'], queryFn: () => api<Lead[]>('leads?limit=200') });
  const topRules = Object.entries(query.data?.daily || {}).reduce<Record<string, number>>(
    (out, [, day]) => {
      for (const [id, value] of Object.entries(day.rules || {})) out[id] = (out[id] || 0) + value;
      return out;
    },
    {},
  );
  const ruleData = Object.entries(topRules)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({
      name: rules.data?.find((r) => r.id === id)?.name || 'Deleted rule',
      count,
    }));
  const hourly = Object.values(query.data?.daily || {}).reduce<Record<string, number>>(
    (out, day) => {
      for (const [hour, counts] of Object.entries(day.hours || {}))
        out[hour] = (out[hour] || 0) + counts.incoming;
      return out;
    },
    {},
  );
  const busiest = Object.entries(hourly).sort((a, b) => b[1] - a[1])[0];
  const replyData = [
    { name: 'Automatic', count: query.data?.totals.autoReplies || 0 },
    { name: 'Manual', count: query.data?.totals.manualReplies || 0 },
  ];
  return (
    <>
      <PageHeader
        eyebrow="UNDERSTAND YOUR FRONT DESK"
        title="Analytics"
        description="Useful signals from real customer conversations."
        action={
          <select
            aria-label="Analytics range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="1d">Today (UTC)</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        }
      />
      <p className="analytics-timezone-note">
        Reports use UTC calendar days and hourly buckets. Business hours follow the timezone saved
        in Settings.
      </p>
      {query.isLoading ? (
        <Skeleton variant="dashboard" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="metrics-grid">
            {[
              ['Incoming messages', 'incoming'],
              ['Automatic replies', 'autoReplies'],
              ['Manual replies', 'manualReplies'],
              ['New contacts', 'newContacts'],
              ['Leads captured', 'leads'],
              ['Human takeovers', 'humanTakeovers'],
              ['Rules triggered', 'rulesTriggered'],
              ['Outgoing messages', 'outgoing'],
            ].map(([label, key]) => (
              <div className="metric" key={key}>
                <span>{label}</span>
                <strong>{query.data?.totals[key] || 0}</strong>
                <small>Selected period</small>
              </div>
            ))}
          </div>
          <Section
            title="Message activity"
            action={
              busiest && busiest[1] > 0 ? (
                <Badge>Busiest hour: {busiest[0].padStart(2, '0')}:00 UTC</Badge>
              ) : undefined
            }
          >
            <Suspense fallback={<Skeleton variant="chart" />}>
              <ActivityChart data={query.data} range={range} />
            </Suspense>
          </Section>
          <Section title="Automatic vs. manual replies">
            {replyData.some((d) => d.count > 0) ? (
              <div className="chart-container" style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={replyData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis dataKey="name" type="category" width={85} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      name="Replies"
                      fill="#427b67"
                      isAnimationActive={false}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty
                title="No replies recorded yet."
                description="Your reply mix will appear as your conversations get going."
              />
            )}
          </Section>
          <div className="insights-grid">
            <Section title="Most helpful rules">
              {ruleData.length ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ruleData} layout="vertical" margin={{ left: 20, right: 20 }}>
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" name="Replies" fill="#427b67" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty
                  title="No rules triggered yet."
                  description="Your most useful rules appear here as messages arrive."
                />
              )}
            </Section>
            <Section title="Lead status">
              <p className="muted">Current status of your most recent 200 leads.</p>
              {leads.isLoading ? (
                <Skeleton />
              ) : leads.isError ? (
                <ErrorState error={leads.error} retry={() => void leads.refetch()} />
              ) : (
                <>
                  {['New', 'Interested', 'Follow Up', 'Converted', 'Closed'].map((status) => (
                    <div className="lead-status-line" key={status}>
                      <Badge tone={status === 'Converted' ? 'green' : 'neutral'}>{status}</Badge>
                      <strong>{leads.data?.filter((l) => l.status === status).length || 0}</strong>
                    </div>
                  ))}
                </>
              )}
            </Section>
          </div>
        </>
      )}
    </>
  );
}
export function Logs() {
  const [before, setBefore] = useState<number>();
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('all');
  const query = useQuery({
    queryKey: ['logs', before],
    queryFn: () => api<ActivityLog[]>(`logs?limit=100${before ? `&before=${before}` : ''}`),
  });
  const filtered = query.data?.filter(
    (l) =>
      l.message.toLowerCase().includes(search.toLowerCase()) &&
      (severity === 'all' || l.severity === severity),
  );
  return (
    <>
      <PageHeader
        eyebrow="A CLEAR RECORD"
        title="Activity logs"
        description="Connection events, receptionist actions, and things that need attention."
      />
      <div className="filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search activity" />
        <select
          aria-label="Filter severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          <option value="all">All activity</option>
          {['info', 'success', 'warning', 'error'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </div>
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !filtered?.length ? (
        <Empty
          title="A fresh start."
          description="Your receptionist activity will be recorded here."
        />
      ) : (
        <div className="log-list">
          {filtered.map((l) => (
            <div key={l.id}>
              <span className={`log-dot ${l.severity}`} />
              <div>
                <strong>{l.message}</strong>
                <small>{l.type.replaceAll('_', ' ')}</small>
              </div>
              <Badge
                tone={
                  l.severity === 'error'
                    ? 'red'
                    : l.severity === 'warning'
                      ? 'warm'
                      : l.severity === 'success'
                        ? 'green'
                        : 'neutral'
                }
              >
                {l.severity}
              </Badge>
              <time>{new Date(l.timestamp).toLocaleString()}</time>
            </div>
          ))}
        </div>
      )}
      <div className="form-actions">
        {before && (
          <Button variant="outline" onClick={() => setBefore(undefined)}>
            Newest activity
          </Button>
        )}
        {query.data?.length === 100 && (
          <Button variant="outline" onClick={() => setBefore(query.data?.at(-1)?.timestamp)}>
            Earlier activity
          </Button>
        )}
      </div>
    </>
  );
}
