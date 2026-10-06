import type { AccessProfile } from '@receptly/shared';
import AdminPayments from './AdminPayments';
import { useState } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api, type Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PageHeader,
  Button,
  Badge,
  Section,
  Dialog,
  ConfirmDialog,
  SearchInput,
  Skeleton,
  ErrorState,
  Empty,
  toast,
  Toggle,
} from '../components/ui';

type Workspace = {
  businessName: string;
  timezone: string;
  automationEnabled: boolean;
  mode: string;
  version: number;
  connectionStatus: string;
  deletionStatus: string | null;
  access: AccessProfile;
};
type Account = {
  uid: string;
  email: string;
  displayName: string;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  admin: boolean;
  workspace: Workspace;
};
type Enquiry = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'new' | 'resolved';
  createdAt: number;
  version: number;
};
type Audit = {
  id: string;
  actorId: string;
  targetId: string;
  action: string;
  createdAt: number;
  details: Record<string, unknown>;
};
type System = {
  ready: boolean;
  uptimeSeconds: number;
  lastSchedulerAt: number;
  activeStreams: number;
  counters: Record<string, number>;
};
const date = (value: string | number | null) =>
  value ? new Date(value).toLocaleString() : 'Never';

export default function Admin() {
  const uid = useAuth((s) => s.user?.uid);
  const access = useQuery({
    queryKey: ['account', 'access', uid],
    queryFn: () => api<{ admin: boolean }>('account/access'),
    retry: false,
  });
  if (access.isPending) return <Skeleton />;
  if (access.isError)
    return <ErrorState error={access.error} retry={() => void access.refetch()} />;
  if (!access.data.admin)
    return (
      <Empty
        title="Administrator access required"
        description="Your account has access to its own workspace. Platform administration is available to configured administrators."
      />
    );
  return <AdminWorkspace />;
}
function AdminWorkspace() {
  const client = useQueryClient();
  const [tab, setTab] = useState('users');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Account | null>(null);
  const [action, setAction] = useState<Account | null>(null);
  const users = useInfiniteQuery({
    queryKey: ['admin', 'users'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page<Account>>(
        `admin/users?limit=25${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const enquiries = useInfiniteQuery({
    queryKey: ['admin', 'enquiries'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page<Enquiry>>(
        `admin/enquiries?limit=25${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
    enabled: tab === 'enquiries',
  });
  const audit = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page<Audit>>(
        `admin/audit?limit=25${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
    enabled: tab === 'audit',
  });
  const system = useQuery({
    queryKey: ['admin', 'system'],
    queryFn: () => api<System>('admin/system'),
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: ({ resource, body }: { resource: string; body: unknown }) =>
      api(resource, 'PATCH', body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin'] });
      void client.invalidateQueries({ queryKey: ['settings'] });
      void client.invalidateQueries({ queryKey: ['billing'] });
      void client.invalidateQueries({ queryKey: ['account', 'access'] });
      void client.invalidateQueries({ queryKey: ['receptionist'] });
      setAction(null);
      toast('Admin change saved');
    },
    onError: (error) => toast(error.message, 'error'),
  });
  const accounts = users.data?.pages.flatMap((page) => page.items) || [];
  const filtered = accounts.filter((user) =>
    `${user.uid} ${user.email} ${user.displayName} ${user.workspace.businessName}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="PLATFORM ADMINISTRATION"
        title="Admin panel"
        description="Manage workspaces, review support enquiries and monitor platform operations."
        action={
          <Button
            variant="outline"
            onClick={() => void client.invalidateQueries({ queryKey: ['admin'] })}
          >
            <RefreshCw size={16} /> Refresh
          </Button>
        }
      />
      <div className="admin-status-strip">
        <span>
          Service{' '}
          <Badge tone={system.data?.ready ? 'green' : 'neutral'}>
            {system.isError
              ? 'Unavailable'
              : system.isPending
                ? 'Checking'
                : system.data?.ready
                  ? 'Ready'
                  : 'Not ready'}
          </Badge>
        </span>
        <span>
          Loaded users <strong>{accounts.length}</strong>
        </span>
        <span>
          Automation active{' '}
          <strong>{accounts.filter((user) => user.workspace.automationEnabled).length}</strong>
          <small> in loaded users</small>
        </span>
        <span>
          Active event streams <strong>{system.data?.activeStreams ?? '—'}</strong>
        </span>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="Administration sections">
        {[
          ['users', 'Users & workspaces'],
          ['payments', 'Subscription payments'],
          ['enquiries', 'Support enquiries'],
          ['audit', 'Audit log'],
          ['system', 'System health'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setSearch('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'payments' && <AdminPayments />}
      {tab === 'users' && (
        <Section title="Users & workspaces">
          <p className="admin-section-description">
            Search the loaded users by name, email, business name or UID. Load more to browse
            additional accounts. Pro access enables automation. Grant Pro without payment, or switch
            to Free to revoke all current Pro access.
          </p>
          <SearchInput value={search} onChange={setSearch} placeholder="Search loaded users" />
          {users.isPending ? (
            <Skeleton />
          ) : users.isError ? (
            <ErrorState error={users.error} retry={() => void users.refetch()} />
          ) : !filtered.length ? (
            <Empty
              title="No matching users"
              description="Try a different search or load the next page."
            />
          ) : (
            <div className="admin-list">
              {filtered.map((user) => (
                <article className="admin-row" key={user.uid}>
                  <div className="admin-row-main">
                    <h3>{user.workspace.businessName}</h3>
                    <p>{user.displayName || user.email || user.uid}</p>
                    <p>{user.email}</p>
                    <small>{user.uid}</small>
                  </div>
                  <div className="admin-row-status">
                    <Badge tone={user.workspace.access?.tier === 'pro' ? 'green' : 'neutral'}>
                      {user.workspace.access?.tier === 'pro' ? 'Pro' : 'Free'}
                    </Badge>
                    <Badge
                      tone={
                        user.workspace.automationEnabled && user.workspace.access?.tier === 'pro'
                          ? 'green'
                          : 'neutral'
                      }
                    >
                      {user.workspace.automationEnabled && user.workspace.access?.tier === 'pro'
                        ? 'Automation active'
                        : 'Automation paused'}
                    </Badge>
                    <Badge>{user.workspace.connectionStatus}</Badge>
                    {user.admin && <Badge>Admin</Badge>}
                    {user.disabled && <Badge>Login disabled</Badge>}
                    {user.workspace.deletionStatus && <Badge>Account deleting</Badge>}
                  </div>
                  <div className="admin-row-actions">
                    <div className="admin-plan-control">
                      <span>{user.admin ? 'Admin · always Pro' : 'Pro access'}</span>
                      <Toggle
                        label={`Pro access for ${user.email || user.uid}`}
                        checked={user.workspace.access?.tier === 'pro'}
                        disabled={
                          user.admin || mutation.isPending || !!user.workspace.deletionStatus
                        }
                        onChange={(enabled) =>
                          mutation.mutate({
                            resource: `admin/users/${user.uid}/plan`,
                            body: {
                              tier: enabled ? 'pro' : 'free',
                              expectedVersion: user.workspace.access?.version || 0,
                            },
                          })
                        }
                      />
                    </div>
                    <Button variant="outline" onClick={() => setSelected(user)}>
                      View details
                    </Button>
                    <Button
                      variant="outline"
                      disabled={mutation.isPending || !!user.workspace.deletionStatus}
                      onClick={() => setAction(user)}
                    >
                      {user.workspace.automationEnabled ? 'Pause automation' : 'Enable automation'}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {users.hasNextPage && (
            <Button
              variant="outline"
              disabled={users.isFetchingNextPage}
              onClick={() => void users.fetchNextPage()}
            >
              Load more users
            </Button>
          )}
        </Section>
      )}
      {tab === 'enquiries' && (
        <Section title="Support enquiries">
          <p className="admin-section-description">
            Review requests submitted through the public contact form. Resolving a request does not
            send a reply.
          </p>
          {enquiries.isPending ? (
            <Skeleton />
          ) : enquiries.isError ? (
            <ErrorState error={enquiries.error} retry={() => void enquiries.refetch()} />
          ) : !enquiries.data?.pages.some((page) => page.items.length) ? (
            <Empty
              title="No support enquiries"
              description="Contact form submissions will appear here."
            />
          ) : (
            <div className="admin-list">
              {enquiries.data.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <article className="admin-row" key={item.id}>
                    <div className="admin-row-main">
                      <h3>{item.subject}</h3>
                      <p>
                        {item.name} · {item.email}
                      </p>
                      <p className="admin-message">{item.message}</p>
                      <small>{date(item.createdAt)}</small>
                    </div>
                    <Badge tone={item.status === 'resolved' ? 'green' : 'neutral'}>
                      {item.status}
                    </Badge>
                    <Button
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          resource: `admin/enquiries/${item.id}`,
                          body: {
                            status: item.status === 'new' ? 'resolved' : 'new',
                            expectedVersion: item.version,
                          },
                        })
                      }
                    >
                      {item.status === 'new' ? 'Mark resolved' : 'Reopen'}
                    </Button>
                  </article>
                ))}
            </div>
          )}
          {enquiries.hasNextPage && (
            <Button
              variant="outline"
              disabled={enquiries.isFetchingNextPage}
              onClick={() => void enquiries.fetchNextPage()}
            >
              Load more enquiries
            </Button>
          )}
        </Section>
      )}
      {tab === 'audit' && (
        <Section title="Admin audit log">
          <p className="admin-section-description">
            Recorded platform changes show the administrator, target and time.
          </p>
          {audit.isPending ? (
            <Skeleton />
          ) : audit.isError ? (
            <ErrorState error={audit.error} retry={() => void audit.refetch()} />
          ) : !audit.data?.pages.some((page) => page.items.length) ? (
            <Empty
              title="No admin changes yet"
              description="Automation changes and enquiry updates are recorded here."
            />
          ) : (
            <div className="admin-list">
              {audit.data.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <article className="admin-row" key={item.id}>
                    <div className="admin-row-main">
                      <h3>{item.action.replaceAll('_', ' ')}</h3>
                      <p>Administrator: {item.actorId}</p>
                      <p>Target: {item.targetId}</p>
                    </div>
                    <small>{date(item.createdAt)}</small>
                  </article>
                ))}
            </div>
          )}
          {audit.hasNextPage && (
            <Button
              variant="outline"
              disabled={audit.isFetchingNextPage}
              onClick={() => void audit.fetchNextPage()}
            >
              Load more audit records
            </Button>
          )}
        </Section>
      )}
      {tab === 'system' && (
        <Section title="System health">
          <p className="admin-section-description">
            Live process metrics refresh every 30 seconds.
          </p>
          {system.isPending ? (
            <Skeleton />
          ) : system.isError ? (
            <ErrorState error={system.error} retry={() => void system.refetch()} />
          ) : (
            <>
              <dl className="admin-detail-grid">
                <div>
                  <dt>Service</dt>
                  <dd>{system.data.ready ? 'Ready' : 'Not ready'}</dd>
                </div>
                <div>
                  <dt>Uptime</dt>
                  <dd>{Math.floor(system.data.uptimeSeconds / 60)} minutes</dd>
                </div>
                <div>
                  <dt>Last scheduler tick</dt>
                  <dd>
                    {system.data.lastSchedulerAt
                      ? date(system.data.lastSchedulerAt)
                      : 'No tick recorded'}
                  </dd>
                </div>
                <div>
                  <dt>Active event streams</dt>
                  <dd>{system.data.activeStreams}</dd>
                </div>
              </dl>
              <div className="admin-counter-list">
                {Object.entries(system.data.counters)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, value]) => (
                    <div key={name}>
                      <span>{name}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
              </div>
            </>
          )}
        </Section>
      )}
      {selected && <UserDetails user={selected} onClose={() => setSelected(null)} />}
      {action && (
        <ConfirmDialog
          title={
            action.workspace.automationEnabled
              ? 'Pause workspace automation?'
              : 'Enable workspace automation?'
          }
          description={`${action.workspace.businessName} (${action.email || action.uid}): ${action.workspace.automationEnabled ? 'automated replies and follow-ups will pause. Incoming messages remain available.' : 'configured automated replies and follow-ups can run when their existing conditions are met.'}`}
          onClose={() => !mutation.isPending && setAction(null)}
          onConfirm={async () => {
            await mutation.mutateAsync({
              resource: `admin/users/${action.uid}/automation`,
              body: {
                enabled: !action.workspace.automationEnabled,
                expectedVersion: action.workspace.version,
              },
            });
          }}
        />
      )}
    </>
  );
}
function UserDetails({ user, onClose }: { user: Account; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['admin', 'user', user.uid],
    queryFn: () =>
      api<
        Account & {
          analytics: {
            date: string;
            incoming?: number;
            autoReplies?: number;
            manualReplies?: number;
            leads?: number;
          }[];
        }
      >(`admin/users/${user.uid}`),
  });
  return (
    <Dialog title="Workspace details" onClose={onClose}>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <dl className="admin-detail-grid">
            {[
              ['Business', query.data.workspace.businessName],
              ['User', query.data.displayName || query.data.email || query.data.uid],
              ['Email', query.data.email || 'Not provided'],
              ['Firebase UID', query.data.uid],
              ['Timezone', query.data.workspace.timezone],
              ['Mode', query.data.workspace.mode],
              ['Plan', query.data.workspace.access?.tier === 'pro' ? 'Pro' : 'Free'],
              [
                'Pro access',
                query.data.workspace.access?.source === 'platform_admin'
                  ? 'Admin · always Pro'
                  : query.data.workspace.access?.source === 'admin'
                    ? 'Granted by admin · until revoked'
                    : query.data.workspace.access?.expiresAt
                      ? `Paid · until ${date(query.data.workspace.access.expiresAt)}`
                      : 'No active subscription',
              ],
              ['Created', date(query.data.createdAt)],
              ['Last sign-in', date(query.data.lastSignInAt)],
              ['Email verified', query.data.emailVerified ? 'Yes' : 'No'],
              ['Account access', query.data.disabled ? 'Disabled' : 'Enabled'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>Recent activity · UTC days</h3>
          {!query.data.analytics.length ? (
            <p>No daily activity recorded.</p>
          ) : (
            <div className="admin-activity-list">
              {query.data.analytics.map((day) => (
                <div key={day.date}>
                  <strong>{day.date}</strong>
                  <span>
                    {day.incoming || 0} incoming · {day.autoReplies || 0} auto replies ·{' '}
                    {day.leads || 0} leads
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
