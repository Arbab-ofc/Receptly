import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Copy,
  Pencil,
  Trash2,
  ArrowUpRight,
  Zap,
  FileText,
  BookOpen,
  Users,
  ContactRound,
  ShoppingBag,
  CalendarDays,
} from 'lucide-react';
import {
  ruleSchema,
  templateSchema,
  faqSchema,
  catalogSchema,
  holidaySchema,
  catalogItemLabel,
  type CatalogItem,
  contactSchema,
  leadSchema,
  categories,
  matchTypes,
  leadStatuses,
  matches,
  type Rule,
  type Conversation,
  type Template,
  type Settings,
  type Hours,
  defaultSettings,
  defaultHours,
  renderTemplate,
} from '@receptly/shared';
import { api, apiPage } from '../lib/api';
import { useUnsavedChanges } from '../components/UnsavedChanges';
import {
  PageHeader,
  Button,
  Badge,
  Dialog,
  ConfirmDialog,
  Field,
  Toggle,
  SearchInput,
  Empty,
  Skeleton,
  ErrorState,
  toast,
} from '../components/ui';
type RecordData = Record<string, unknown> & { id: string };
type FieldConfig = {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'number' | 'checkbox' | 'date' | 'time';
  defaultValue?: string;
  options?: readonly string[];
  hint?: string;
  required?: boolean;
};
type Config = {
  endpoint: string;
  title: string;
  singular: string;
  description: string;
  schema: z.ZodType;
  fields: FieldConfig[];
  icon: typeof Zap;
};
const configs: Record<string, Config> = {
  rules: {
    endpoint: 'rules',
    title: 'Auto reply rules',
    singular: 'rule',
    description: 'Thoughtful replies for your most common customer questions.',
    schema: ruleSchema,
    icon: Zap,
    fields: [
      { name: 'name', label: 'Rule name', required: true },
      { name: 'enabled', label: 'Enable this rule', type: 'checkbox' },
      { name: 'scope', label: 'Conversation scope', type: 'select', options: ['direct', 'group'] },
      { name: 'matchType', label: 'Match type', type: 'select', options: matchTypes },
      {
        name: 'patterns',
        label: 'Keywords or patterns',
        hint: 'Separate each phrase with a comma.',
        required: true,
      },
      { name: 'caseSensitive', label: 'Case sensitive', type: 'checkbox' },
      { name: 'replyTemplateId', label: 'Reply template', type: 'select' },
      {
        name: 'response',
        label: 'Reply message',
        type: 'textarea',
        hint: 'Write a reply, or select a template above. Safe variables: {{name}}, {{business_name}}, {{current_time}}, {{business_hours}}.',
      },
      { name: 'priority', label: 'Priority', type: 'number', hint: '1 is highest priority.' },
      {
        name: 'cooldownMinutes',
        label: 'Cooldown override (minutes)',
        type: 'number',
        hint: 'Leave blank to use your default cooldown.',
      },
      { name: 'stopProcessing', label: 'Stop after this rule matches', type: 'checkbox' },
    ],
  },
  templates: {
    endpoint: 'templates',
    title: 'Message templates',
    singular: 'template',
    description: 'The right words, ready when you need them.',
    schema: templateSchema,
    icon: FileText,
    fields: [
      { name: 'name', label: 'Template name', required: true },
      { name: 'category', label: 'Category', type: 'select', options: categories },
      {
        name: 'content',
        label: 'Message',
        type: 'textarea',
        required: true,
        hint: 'Supports {{name}}, {{business_name}}, {{current_time}}, and {{business_hours}}.',
      },
      { name: 'enabled', label: 'Enable template', type: 'checkbox' },
    ],
  },
  'knowledge-base': {
    endpoint: 'knowledgeBase',
    title: 'Knowledge base',
    singular: 'answer',
    description: 'Give your receptionist clear answers to everyday questions.',
    schema: faqSchema,
    icon: BookOpen,
    fields: [
      { name: 'question', label: 'Customer question', required: true },
      { name: 'answer', label: 'Answer', type: 'textarea', required: true },
      {
        name: 'keywords',
        label: 'Keywords',
        required: true,
        hint: 'Separate keywords with commas.',
      },
      { name: 'enabled', label: 'Enable answer', type: 'checkbox' },
    ],
  },
  catalog: {
    endpoint: 'catalog',
    title: 'Products and services',
    singular: 'catalog item',
    icon: ShoppingBag,
    description:
      'Answer enquiries with your prices and availability. Item names and keywords match customer messages; reply rules take priority.',
    schema: catalogSchema,
    fields: [
      { name: 'name', label: 'Item name', required: true },
      { name: 'kind', label: 'Type', type: 'select', options: ['Product', 'Service'] },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'category', label: 'Category' },
      {
        name: 'price',
        label: 'Price',
        type: 'number',
        hint: 'Leave blank to ask customers to contact you for pricing. Zero means free.',
      },
      {
        name: 'currency',
        label: 'Currency code',
        defaultValue: 'INR',
        hint: 'Three-letter code, such as INR, USD or EUR.',
      },
      {
        name: 'availability',
        label: 'Availability',
        type: 'select',
        options: ['Available', 'Unavailable'],
      },
      {
        name: 'keywords',
        label: 'Additional matching keywords',
        hint: 'Separate phrases with commas. The item name also matches automatically.',
      },
      { name: 'enabled', label: 'Include in catalog replies', type: 'checkbox' },
    ],
  },
  holidays: {
    endpoint: 'holidays',
    title: 'Holiday schedules',
    singular: 'holiday schedule',
    icon: CalendarDays,
    description:
      'Override weekly hours on a specific date in your business timezone. Closures also pause automated follow-ups. Each date has one entry.',
    schema: holidaySchema,
    fields: [
      { name: 'name', label: 'Holiday or occasion', required: true },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'closed', label: 'Closed all day', type: 'checkbox' },
      { name: 'open', label: 'Opening time', type: 'time', defaultValue: '10:00' },
      {
        name: 'close',
        label: 'Closing time',
        type: 'time',
        defaultValue: '20:00',
        hint: 'A closing time before opening continues into the next day.',
      },
      {
        name: 'response',
        label: 'Closed-hours reply (optional)',
        type: 'textarea',
        hint: 'Used outside these hours when closed-hours replies are enabled. Leave blank to use your default reply. Supports template variables.',
      },
      { name: 'enabled', label: 'Apply this date override', type: 'checkbox' },
    ],
  },
  contacts: {
    endpoint: 'contacts',
    title: 'Contacts',
    singular: 'contact',
    description: 'WhatsApp contacts sync as they are shared by your linked device. Set a contact to Ignore to exclude it from automatic replies.',
    schema: contactSchema,
    icon: ContactRound,
    fields: [
      { name: 'name', label: 'Contact name' },
      { name: 'number', label: 'International phone number', required: true },
      {
        name: 'type',
        label: 'Contact preference',
        type: 'select',
        options: ['Normal', 'VIP', 'Ignore', 'Blocked'],
        hint: 'Choose Ignore to stop automated replies for this contact.',
      },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  leads: {
    endpoint: 'leads',
    title: 'Leads',
    singular: 'lead',
    description: 'Turn promising conversations into your next opportunity.',
    schema: leadSchema,
    icon: Users,
    fields: [
      { name: 'conversationId', label: 'Conversation', type: 'select', required: true },
      { name: 'status', label: 'Lead status', type: 'select', options: leadStatuses },
      { name: 'interest', label: 'Interest' },
      { name: 'value', label: 'Potential value', type: 'number' },
      { name: 'tags', label: 'Tags', hint: 'Separate tags with commas.' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
};
const starterRules = [
  {
    name: 'Opening hours',
    patterns: ['hours', 'open', 'close'],
    response: 'Hi {{name}}! Our business hours are {{business_hours}}. How can we help?',
  },
  {
    name: 'Location enquiry',
    patterns: ['location', 'address', 'directions'],
    response:
      'Thanks for contacting {{business_name}}. Find us at [add your address before enabling this rule].',
  },
  {
    name: 'Appointment enquiry',
    patterns: ['appointment', 'book', 'booking'],
    response:
      'Hi {{name}}! Please share your preferred day and time. Our team will confirm availability.',
  },
];
const advancedRuleFields = new Set([
  'scope',
  'caseSensitive',
  'priority',
  'cooldownMinutes',
  'stopProcessing',
]);
export default function Resources({ kind }: { kind: string }) {
  const config = configs[kind];
  const [params] = useSearchParams();
  const [starter, setStarter] = useState<Record<string, unknown> | undefined>();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [editing, setEditing] = useState<RecordData | true | null>(null);
  const [removing, setRemoving] = useState<RecordData | null>(null);
  const list = useInfiniteQuery({
    queryKey: [config.endpoint, 'library'],
    initialPageParam: undefined as string | number | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<RecordData>(
        `${config.endpoint}?limit=200&page=true${pageParam ? (typeof pageParam === 'number' ? `&before=${pageParam}` : `&cursor=${encodeURIComponent(pageParam)}`) : ''}`,
        kind === 'rules' ? 'priority' : 'createdAt',
        200,
      ),
    getNextPageParam: (last) => last.nextCursor || last.legacyBefore || undefined,
    refetchInterval: kind === 'contacts' ? 15000 : false,
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('settings'),
    enabled: kind === 'holidays',
  });
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api<Template[]>('templates?limit=200'),
    enabled: kind === 'rules',
  });
  const conversations = useQuery({
    queryKey: ['conversations', 'lead-picker'],
    queryFn: () => api<Conversation[]>('conversations?limit=200'),
    enabled: kind === 'leads',
  });
  const mutation = useMutation({
    mutationFn: ({ id, body, action }: { id: string; body?: unknown; action?: string }) =>
      api(
        `${config.endpoint}/${id}${action ? `/${action}` : ''}`,
        action === 'duplicate' ? 'POST' : 'PATCH',
        body,
        (() => {
          const record = list.data?.pages
            .flatMap((page) => page.items)
            .find((item) => item.id === id);
          return record?.version === undefined ? undefined : { 'If-Match': `"${record.version}"` };
        })(),
      ),
    onSuccess: () => {
      void client.invalidateQueries();
      toast('Changes saved');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const records = (list.data?.pages.flatMap((page) => page.items) || [])
    .filter((r) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
    .filter(
      (r) =>
        kind !== 'leads' ||
        dateRange === 'all' ||
        Number(r.createdAt) >= Date.now() - Number(dateRange) * 86400000,
    )
    .filter(
      (r) =>
        filter === 'all' ||
        (filter === 'active'
          ? r.enabled
          : filter === 'inactive'
            ? !r.enabled
            : r.status === filter),
    );
  return (
    <>
      <PageHeader
        eyebrow={kind === 'leads' ? 'CUSTOMER RELATIONSHIPS' : 'YOUR RECEPTIONIST'}
        title={config.title}
        description={
          kind === 'holidays'
            ? `${config.description} Timezone: ${settings.data?.timezone || 'your business timezone'}.`
            : config.description
        }
        action={
          <Button
            onClick={() => {
              setStarter(undefined);
              setEditing(true);
            }}
          >
            <Plus size={16} />
            Create {config.singular}
          </Button>
        }
      />
      {kind === 'rules' &&
        (!list.data?.pages.flatMap((page) => page.items).length || params.has('starter')) &&
        !list.isLoading &&
        !list.isError && (
          <div className="starter-rules">
            <div>
              <h2>Start with a common question</h2>
              <p>Choose a starting point, personalize the reply, then enable it after reviewing.</p>
            </div>
            <div className="starter-rule-buttons">
              {starterRules.map((preset) => (
                <Button
                  key={preset.name}
                  variant="outline"
                  onClick={() => {
                    setStarter({
                      ...preset,
                      enabled: false,
                      matchType: 'contains',
                      scope: 'direct',
                      caseSensitive: false,
                      priority: 10,
                      stopProcessing: true,
                      cooldownMinutes: null,
                      replyTemplateId: '',
                    });
                    setEditing(true);
                  }}
                >
                  {preset.name} <ArrowUpRight size={15} />
                </Button>
              ))}
            </div>
          </div>
        )}
      <div className="filter-bar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={`Search ${config.title.toLowerCase()}`}
        />
        {['rules', 'templates', 'knowledge-base', 'catalog', 'holidays', 'leads'].includes(
          kind,
        ) && (
          <select
            aria-label="Filter records"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All {config.title.toLowerCase()}</option>
            {(kind === 'leads' ? leadStatuses : ['active', 'inactive']).map((f) => (
              <option key={f} value={f}>
                {f[0].toUpperCase() + f.slice(1)}
              </option>
            ))}
          </select>
        )}
        {kind === 'leads' && (
          <select
            aria-label="Lead date range"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          >
            <option value="all">All dates</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        )}
        <span>
          {records.length} {records.length === 1 ? config.singular : config.title.toLowerCase()}
        </span>
      </div>
      {list.isLoading ? (
        <Skeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      ) : !records.length ? (
        <Empty
          title={`No ${config.title.toLowerCase()} ${search || filter !== 'all' || dateRange !== 'all' ? 'found' : 'yet'}.`}
          description={
            search || filter !== 'all' || dateRange !== 'all'
              ? 'Try another search or filter.'
              : `Create your first ${config.singular} to get started.`
          }
          action={
            search || filter !== 'all' || dateRange !== 'all' ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('');
                  setFilter('all');
                  setDateRange('all');
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Plus size={16} />
                Create {config.singular}
              </Button>
            )
          }
        />
      ) : kind === 'leads' ? (
        <div className="lead-table-wrap">
          <table className="lead-table">
            <caption className="sr-only">Loaded customer leads</caption>
            <thead>
              <tr>
                {[
                  'Customer',
                  'Interest',
                  'Status',
                  'Potential value',
                  'Last activity',
                  'Actions',
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const customer = conversations.data?.find((c) => c.id === r.conversationId);
                return (
                  <tr key={r.id}>
                    <td data-label="Customer">
                      <strong>{customer?.name || 'WhatsApp customer'}</strong>
                      <small>{customer?.number || 'Open conversation for details'}</small>
                    </td>
                    <td data-label="Interest">{String(r.interest || 'Not specified')}</td>
                    <td data-label="Status">
                      <select
                        aria-label={`Status for ${customer?.name || 'lead'}`}
                        value={String(r.status)}
                        disabled={mutation.isPending}
                        onChange={(e) =>
                          mutation.mutate({ id: r.id, body: { status: e.target.value } })
                        }
                      >
                        {leadStatuses.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Potential value">{Number(r.value || 0).toLocaleString()}</td>
                    <td data-label="Last activity">
                      <time
                        dateTime={new Date(
                          Number(r.lastInteractionAt || r.updatedAt || r.createdAt),
                        ).toISOString()}
                      >
                        {new Date(
                          Number(r.lastInteractionAt || r.updatedAt || r.createdAt),
                        ).toLocaleDateString()}
                      </time>
                    </td>
                    <td data-label="Actions">
                      <div className="lead-table-actions">
                        <Link
                          className="text-link"
                          to={`/dashboard/inbox?chat=${encodeURIComponent(String(r.conversationId))}`}
                        >
                          Open chat <ArrowUpRight size={14} />
                        </Link>
                        <Button
                          variant="ghost"
                          aria-label={`Edit ${customer?.name || 'lead'}`}
                          onClick={() => setEditing(r)}
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Delete ${customer?.name || 'lead'}`}
                          onClick={() => setRemoving(r)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="table-scope-note">
            Showing loaded leads. Potential values use the units entered by your business.
          </p>
        </div>
      ) : (
        <div
          className={`resource-list ${kind === 'templates' || kind === 'knowledge-base' ? 'resource-grid' : ''}`}
        >
          {records.map((r) => (
            <article className="resource-row" key={r.id}>
              <div className="resource-icon">
                <config.icon size={19} />
              </div>
              <div className="resource-main">
                <div className="resource-title">
                  <h3>{String(r.name || r.question || r.interest || 'WhatsApp lead')}</h3>
                  {r.enabled !== undefined ? (
                    <Badge tone={r.enabled ? 'green' : 'neutral'}>
                      {r.enabled ? 'Active' : 'Inactive'}
                    </Badge>
                  ) : (
                    <Badge tone={r.status === 'Converted' ? 'green' : 'neutral'}>
                      {String(r.status || r.type || 'Normal')}
                    </Badge>
                  )}
                </div>
                <p>
                  {String(
                    (kind === 'catalog'
                      ? catalogItemLabel(r as unknown as CatalogItem)
                      : kind === 'holidays'
                        ? `${r.date} · ${r.closed ? 'Closed all day' : `${r.open}–${r.close}${String(r.open) > String(r.close) ? ' (next day)' : ''}`}${r.response ? ` · ${r.response}` : ''}`
                        : '') ||
                      r.description ||
                      r.content ||
                      r.answer ||
                      r.response ||
                      r.number ||
                      r.notes ||
                      'Open the conversation to learn more.',
                  )}
                </p>
                {r.patterns !== undefined && (
                  <div className="resource-keywords">
                    {(r.patterns as string[]).map((p) => (
                      <Badge key={p}>{p}</Badge>
                    ))}
                  </div>
                )}
                <div className="resource-meta">
                  {kind === 'rules' ? (
                    <>
                      <span>Priority {String(r.priority)}</span>
                      <span>{String(r.triggerCount || 0)} replies sent</span>
                      <span>{String(r.matchType).replaceAll('_', ' ')}</span>
                    </>
                  ) : kind === 'catalog' ? (
                    <>
                      <span>{String(r.kind)}</span>
                      <span>{String(r.category || 'Uncategorized')}</span>
                    </>
                  ) : kind === 'holidays' ? (
                    <span>Overrides weekly hours in your business timezone</span>
                  ) : kind === 'templates' ? (
                    <>
                      <span>{String(r.category)}</span>
                      <span>{String(r.usageCount || 0)} uses</span>
                    </>
                  ) : (
                    <span>
                      Updated {new Date(Number(r.updatedAt || r.createdAt)).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {kind === 'leads' && (
                  <div className="lead-actions">
                    <select
                      aria-label="Lead status"
                      value={String(r.status)}
                      onChange={(e) =>
                        mutation.mutate({ id: r.id, body: { status: e.target.value } })
                      }
                    >
                      {leadStatuses.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <Link className="text-link" to={`/dashboard/inbox?chat=${r.conversationId}`}>
                      Open conversation <ArrowUpRight size={14} />
                    </Link>
                  </div>
                )}
              </div>
              <div className="resource-actions">
                {r.enabled !== undefined && (
                  <Toggle
                    label={`Enable ${r.name || r.question}`}
                    checked={!!r.enabled}
                    disabled={mutation.isPending}
                    onChange={(enabled) =>
                      mutation.mutate({ id: r.id, body: { enabled }, action: 'toggle' })
                    }
                  />
                )}
                <Button
                  variant="ghost"
                  aria-label={`Edit ${r.name || config.singular}`}
                  onClick={() => setEditing(r)}
                >
                  <Pencil size={16} />
                </Button>
                {['rules', 'templates', 'knowledge-base', 'catalog'].includes(kind) && (
                  <Button
                    variant="ghost"
                    aria-label="Duplicate record"
                    onClick={() => mutation.mutate({ id: r.id, action: 'duplicate' })}
                  >
                    <Copy size={16} />
                  </Button>
                )}
                <Button variant="ghost" aria-label="Delete record" onClick={() => setRemoving(r)}>
                  <Trash2 size={16} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {list.hasNextPage && (
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Load earlier {config.title.toLowerCase()}
          </Button>
        </div>
      )}
      {editing && (
        <Editor
          key={typeof editing === 'object' ? editing.id : 'new'}
          config={config}
          record={typeof editing === 'object' ? editing : undefined}
          initial={typeof editing === 'object' ? undefined : starter}
          templates={templates.data || []}
          conversations={conversations.data || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void client.invalidateQueries();
            setEditing(null);
            toast(`${config.singular[0].toUpperCase() + config.singular.slice(1)} saved`);
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Delete this ${config.singular}?`}
          description="This action cannot be undone."
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(
              `${config.endpoint}/${removing.id}`,
              'DELETE',
              undefined,
              removing.version === undefined ? undefined : { 'If-Match': `"${removing.version}"` },
            );
            void client.invalidateQueries();
            toast('Record deleted');
          }}
        />
      )}
    </>
  );
}
function Editor({
  config,
  record,
  initial,
  templates,
  conversations,
  onClose,
  onSaved,
}: {
  config: Config;
  record?: RecordData;
  initial?: Record<string, unknown>;
  templates: Template[];
  conversations: Conversation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaults: Record<string, string | boolean> = Object.fromEntries(
    config.fields.map((f) => {
      const v = record?.[f.name] ?? initial?.[f.name] ?? f.defaultValue;
      return [
        f.name,
        Array.isArray(v)
          ? v.join(', ')
          : v !== undefined && v !== null
            ? f.type === 'checkbox'
              ? Boolean(v)
              : String(v)
            : f.type === 'checkbox'
              ? true
              : f.type === 'select'
                ? f.options?.[0] || ''
                : f.type === 'number'
                  ? f.name === 'priority'
                    ? '10'
                    : f.name === 'value'
                      ? '0'
                      : ''
                  : '',
      ];
    }),
  );
  const transform = (values: Record<string, unknown>) => {
    const result = { ...values };
    for (const f of config.fields) {
      if (['patterns', 'keywords', 'tags'].includes(f.name))
        result[f.name] = String(values[f.name] || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      if (f.type === 'number')
        result[f.name] = values[f.name] === '' ? null : Number(values[f.name]);
    }
    if (config.endpoint === 'leads') {
      const c = conversations.find((c) => c.id === result.conversationId);
      result.contactId = c?.contactId || record?.contactId;
    }
    return result;
  };
  const validation = z.record(z.string(), z.unknown()).superRefine((v, ctx) => {
    const parsed = config.schema.safeParse(transform(v));
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(validation),
    defaultValues: defaults,
  });
  const [error, setError] = useState('');
  const { guard, confirmClose } = useUnsavedChanges(
    form.formState.isDirty,
    form.formState.isSubmitting,
  );
  const close = () => confirmClose(onClose);
  const watch = form.watch();
  const [sample, setSample] = useState(
    initial?.patterns
      ? `Hi, what are your ${(initial.patterns as string[])[0]}?`
      : 'Hi, what is the price?',
  );
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('settings'),
    enabled: config.endpoint === 'rules',
  });
  const schedule = useQuery({
    queryKey: ['schedule'],
    queryFn: () => api<Hours>('schedule'),
    enabled: config.endpoint === 'rules',
  });
  const previewMatch =
    config.endpoint === 'rules' &&
    matches(sample, {
      caseSensitive: Boolean(watch.caseSensitive),
      matchType: String(watch.matchType || 'contains') as Rule['matchType'],
      patterns: String(watch.patterns || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    });
  const renderFields = (fields: FieldConfig[]) =>
    fields
      .filter(
        (f) =>
          !(config.endpoint === 'holidays' && watch.closed && ['open', 'close'].includes(f.name)),
      )
      .map((f) =>
        f.type === 'checkbox' ? (
          <div className="toggle-field" key={f.name}>
            <span>{f.label}</span>
            <Toggle
              label={f.label}
              checked={!!watch[f.name]}
              onChange={(v) =>
                form.setValue(f.name, v, { shouldValidate: true, shouldDirty: true })
              }
            />
          </div>
        ) : (
          <Field
            label={f.label}
            key={f.name}
            hint={f.hint}
            error={String(form.formState.errors[f.name]?.message || '')}
          >
            {f.type === 'textarea' ? (
              <textarea rows={4} {...form.register(f.name)} />
            ) : f.type === 'select' ? (
              <select {...form.register(f.name)}>
                {f.name === 'replyTemplateId' ? (
                  <>
                    <option value="">Write my own response</option>
                    {templates
                      .filter((t) => t.enabled)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </>
                ) : f.name === 'conversationId' ? (
                  <>
                    <option value="">Select a conversation</option>
                    {conversations.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.number}
                      </option>
                    ))}
                  </>
                ) : (
                  f.options?.map((v) => (
                    <option key={v} value={v}>
                      {v.replaceAll('_', ' ')}
                    </option>
                  ))
                )}
              </select>
            ) : (
              <input
                type={f.type || 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                {...form.register(f.name)}
              />
            )}
          </Field>
        ),
      );
  return (
    <Dialog title={`${record ? 'Edit' : 'Create'} ${config.singular}`} onClose={close}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          setError('');
          try {
            const body = config.schema.parse(transform(values));
            await api(
              `${config.endpoint}${record ? `/${record.id}` : ''}`,
              record ? 'PATCH' : 'POST',
              body,
              record?.version === undefined ? undefined : { 'If-Match': `"${record.version}"` },
            );
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          }
        })}
      >
        <div className="editor-fields">
          {renderFields(
            config.fields.filter(
              (f) => config.endpoint !== 'rules' || !advancedRuleFields.has(f.name),
            ),
          )}
          {config.endpoint === 'rules' && (
            <details className="advanced-rule-options">
              <summary>Advanced options</summary>
              <p>Adjust matching scope, priority, and how often this rule can reply.</p>
              {renderFields(config.fields.filter((f) => advancedRuleFields.has(f.name)))}
            </details>
          )}
        </div>
        {config.endpoint === 'rules' && (
          <div className="rule-preview">
            <span className="eyebrow">REPLY PREVIEW</span>
            <Field label="Try a customer message">
              <input value={sample} onChange={(e) => setSample(e.target.value)} />
            </Field>
            <Badge tone={previewMatch ? 'green' : 'neutral'}>
              {previewMatch ? 'Rule matched' : 'No match'}
            </Badge>
            <div className="demo-bubble demo-reply">
              <span>Example reply to Alex</span>
              <p>
                {renderTemplate(
                  templates.find((t) => t.id === watch.replyTemplateId)?.content ||
                    String(watch.response || 'Your reply will appear here.'),
                  settings.data || defaultSettings,
                  schedule.data || defaultHours,
                  'Alex',
                )}
              </p>
            </div>
            <small>
              Preview checks this rule’s text matching only. Business hours, contact preferences,
              priority, and cooldowns still apply when live.
            </small>
            {(settings.isError || schedule.isError) && (
              <p className="field-error">
                Business details could not be loaded; the preview uses sample defaults.
              </p>
            )}
          </div>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions editor-actions">
          <span className="save-state">
            {form.formState.isDirty ? 'Unsaved changes' : 'No unsaved changes'}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={form.formState.isSubmitting}
          >
            Cancel
          </Button>
          <Button disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
      {guard}
    </Dialog>
  );
}
