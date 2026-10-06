import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Send, ArrowLeft, Info, Pause, Play, Zap, MessageSquare, ArrowUpRight } from 'lucide-react';
import type { Conversation, StoredMessage, Template } from '@receptly/shared';
import { api, apiPage, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  readDraft,
  writeDraft,
  matchesConversationFilter,
  requestForDraft,
  clearSendRequest,
} from '../lib/inbox-state';
import { ChatHistory } from '../components/ChatHistory';
import {
  Avatar,
  Badge,
  Button,
  SearchInput,
  Empty,
  Skeleton,
  ErrorState,
  Dialog,
  Field,
  toast,
} from '../components/ui';
const detailsSchema = z.object({ notes: z.string().max(5000), tags: z.string().max(1000) });
const composerSchema = z.object({
  text: z.string().trim().min(1, 'Write a message first.').max(10000, 'Message is too long.'),
});
export default function Inbox() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('chat');
  const userId = useAuth((state) => state.user?.uid || '');
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [details, setDetails] = useState(false);
  const [unread, setUnread] = useState<{ id: string; count: number } | null>(null);
  const client = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: ['conversations', 'inbox'],
    initialPageParam: undefined as string | number | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<Conversation>(
        `conversations?limit=50&page=true${pageParam ? (typeof pageParam === 'number' ? `&before=${pageParam}` : `&cursor=${encodeURIComponent(pageParam)}`) : ''}`,
        'lastMessageAt',
        50,
      ),
    getNextPageParam: (last) => last.nextCursor || last.legacyBefore || undefined,
  });
  const conversations = list.data?.pages.flatMap((page) => page.items) || [];
  const conversation = useQuery({
    queryKey: ['conversation', selected],
    queryFn: () => api<Conversation>(`conversations/${selected}`),
    enabled: !!selected,
  });
  const messages = useInfiniteQuery({
    queryKey: ['messages', selected],
    initialPageParam: undefined as string | number | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<StoredMessage>(
        `conversations/${selected}/messages?limit=50&page=true${pageParam ? (typeof pageParam === 'number' ? `&before=${pageParam}` : `&cursor=${encodeURIComponent(pageParam)}`) : ''}`,
        'timestamp',
        50,
      ),
    enabled: !!selected,
    getNextPageParam: (last) => last.nextCursor || last.legacyBefore || undefined,
  });
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api<Template[]>('templates?limit=200'),
  });
  const c = conversation.data;
  const form = useForm<z.infer<typeof composerSchema>>({
    resolver: zodResolver(composerSchema),
    defaultValues: { text: '' },
  });
  const scrollArea = useRef<HTMLDivElement>(null);
  const historyAnchor = useRef<{ chat: string; height: number; top: number; count: number } | null>(
    null,
  );
  const lastVisible = useRef<{ chat: string | null; last: string | undefined }>({
    chat: null,
    last: undefined,
  });
  const nearBottom = useRef(true);
  const rows =
    messages.data?.pages.flatMap((page) => page.items).sort((a, b) => a.timestamp - b.timestamp) ||
    [];
  useLayoutEffect(() => {
    form.reset({ text: readDraft(userId, selected) });
    setDetails(false);
    historyAnchor.current = null;
    nearBottom.current = true;
  }, [selected, userId, form]);
  useEffect(() => {
    if (c && c.id !== unread?.id) setUnread({ id: c.id, count: c.unreadCount });
  }, [c, unread?.id]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () =>
      document.documentElement.style.setProperty(
        '--receptly-viewport-height',
        `${viewport.height}px`,
      );
    resize();
    viewport.addEventListener('resize', resize);
    return () => {
      viewport.removeEventListener('resize', resize);
      document.documentElement.style.removeProperty('--receptly-viewport-height');
    };
  }, []);
  useEffect(() => {
    if (c?.unreadCount)
      void api(`conversations/${c.id}`, 'PATCH', { unreadCount: 0 })
        .then(() => client.invalidateQueries({ queryKey: ['conversations'] }))
        .catch(() => {});
  }, [c?.id, c?.unreadCount, client]);
  const firstMessage = rows[0]?.id;
  const lastMessage = rows.at(-1)?.id;
  useLayoutEffect(() => {
    const area = scrollArea.current;
    if (!area) return;
    const anchor = historyAnchor.current;
    if (anchor && anchor.chat === selected && rows.length > anchor.count) {
      area.scrollTop = anchor.top + area.scrollHeight - anchor.height;
      historyAnchor.current = null;
    } else if (
      rows.length &&
      (lastVisible.current.chat !== selected ||
        !lastVisible.current.last ||
        (lastVisible.current.last !== lastMessage && nearBottom.current))
    ) {
      area.scrollTop = area.scrollHeight;
    }
    lastVisible.current = { chat: selected, last: lastMessage };
  }, [selected, firstMessage, lastMessage, rows.length]);
  async function loadEarlierMessages() {
    const area = scrollArea.current;
    if (selected && area)
      historyAnchor.current = {
        chat: selected,
        height: area.scrollHeight,
        top: area.scrollTop,
        count: rows.length,
      };
    const result = await messages.fetchNextPage();
    if (
      result.isError ||
      (result.data?.pages.flatMap((page) => page.items).length || 0) <= rows.length
    )
      historyAnchor.current = null;
  }
  const pause = useMutation({
    mutationFn: () =>
      api(
        `conversations/${selected}/${c?.automationEnabled ? 'pause' : 'resume'}-automation`,
        'POST',
      ),
    onSuccess: () => {
      void client.invalidateQueries();
      toast('Conversation automation updated');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const filtered = conversations
    .filter((c) =>
      `${c.name} ${c.number} ${c.lastMessageText}`.toLowerCase().includes(search.toLowerCase()),
    )
    .filter((c) => matchesConversationFilter(c, filter));
  const filters = [
    ['all', 'All'],
    ['unread', 'Unread'],
    ['human', 'Needs human'],
    ['leads', 'Leads'],
    ['paused', 'Paused'],
  ];
  const customerDetails = c && <CustomerDetails key={c.id} c={c} />;
  return (
    <div className={`inbox-layout ${selected ? 'has-selected' : ''}`}>
      <section className="conversation-list">
        <div className="inbox-list-heading">
          <h1>
            Inbox <Badge>{conversations.length}</Badge>
          </h1>
          <MessageSquare size={19} />
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search conversations" />
        <div className="inbox-filter-tabs" aria-label="Conversation filters">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>{conversations.filter((c) => matchesConversationFilter(c, value)).length}</span>
            </button>
          ))}
        </div>
        <small className="inbox-count-note">
          Counts cover loaded conversations
          {list.hasNextPage ? ' · load more for earlier chats' : ''}.
        </small>
        <div className="conversation-list-scroll">
          {list.isLoading ? (
            <Skeleton />
          ) : list.isError ? (
            <ErrorState error={list.error} retry={() => void list.refetch()} />
          ) : !filtered.length ? (
            <Empty
              title={
                search || filter !== 'all' ? 'No matching conversations' : 'No conversations yet'
              }
              description={
                search || filter !== 'all'
                  ? 'Try another search or clear your filters.'
                  : 'Connect WhatsApp to receive your first customer message.'
              }
              action={
                search || filter !== 'all' ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('');
                      setFilter('all');
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Link className="button button--outline" to="/dashboard/whatsapp">
                    Connect WhatsApp
                  </Link>
                )
              }
            />
          ) : (
            filtered.map((item) => (
              <button
                className={`inbox-conversation ${item.id === selected ? 'selected' : ''} ${item.unreadCount ? 'is-unread' : ''}`}
                aria-label={`${item.name}, ${item.unreadCount} unread messages`}
                aria-current={item.id === selected ? 'true' : undefined}
                key={item.id}
                onClick={() => setParams({ chat: item.id })}
              >
                <Avatar name={item.name} />
                <div>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {new Date(item.lastMessageAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </small>
                  </div>
                  <p>{item.lastMessageText}</p>
                  <div>
                    <span>
                      {item.needsHuman
                        ? 'Needs human'
                        : item.automationEnabled && (item.pauseUntil || 0) <= Date.now()
                          ? 'Automation on'
                          : 'Paused'}
                    </span>
                    {item.unreadCount > 0 && <b>{item.unreadCount}</b>}
                  </div>
                </div>
              </button>
            ))
          )}
          {list.hasNextPage && (
            <Button
              className="full-width"
              variant="ghost"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Load more conversations
            </Button>
          )}
        </div>
      </section>
      <section className="chat-workspace">
        {!selected ? (
          <Empty
            title="Select a conversation"
            description="Select a conversation to see messages and reply."
          />
        ) : conversation.isLoading ? (
          <Skeleton variant="chat" />
        ) : conversation.isError ? (
          <ErrorState error={conversation.error} retry={() => void conversation.refetch()} />
        ) : (
          c && (
            <>
              <header className="chat-header">
                <Button
                  className="chat-back"
                  variant="ghost"
                  aria-label="Back to conversations"
                  onClick={() => setParams({})}
                >
                  <ArrowLeft size={20} />
                </Button>
                <Avatar name={c.name} />
                <div>
                  <strong>{c.name}</strong>
                  <span>{c.number}</span>
                </div>
                <Badge tone={c.needsHuman ? 'warm' : 'neutral'}>
                  {c.needsHuman
                    ? 'Needs human'
                    : c.automationEnabled && (c.pauseUntil || 0) <= Date.now()
                      ? 'Automation on'
                      : 'Paused'}
                </Badge>
                <Button
                  variant="ghost"
                  aria-label="Customer details"
                  onClick={() => setDetails(true)}
                >
                  <Info size={20} />
                </Button>
              </header>
              <div
                className="chat-messages"
                ref={scrollArea}
                onScroll={() => {
                  const area = scrollArea.current;
                  if (area)
                    nearBottom.current =
                      area.scrollHeight - area.scrollTop - area.clientHeight < 100;
                }}
              >
                {messages.hasNextPage && (
                  <Button
                    variant="ghost"
                    className="full-width"
                    disabled={messages.isFetchingNextPage}
                    onClick={() => void loadEarlierMessages()}
                  >
                    Load earlier messages
                  </Button>
                )}
                {messages.isLoading ? (
                  <Skeleton variant="chat" />
                ) : messages.isError ? (
                  <ErrorState error={messages.error} retry={() => void messages.refetch()} />
                ) : (
                  <ChatHistory
                    messages={rows}
                    unreadCount={unread?.id === selected ? unread.count : 0}
                  />
                )}
              </div>
              <div className="chat-automation-bar">
                <span>
                  <Zap size={14} />
                  {c.needsHuman
                    ? 'Waiting for you to take over'
                    : (c.pauseUntil || 0) > Date.now()
                      ? 'Paused after your manual reply'
                      : c.automationEnabled
                        ? 'Receptionist can respond'
                        : 'Automation is paused'}
                </span>
                <Button variant="ghost" disabled={pause.isPending} onClick={() => pause.mutate()}>
                  {c.automationEnabled ? <Pause size={13} /> : <Play size={13} />}{' '}
                  {c.automationEnabled ? 'Pause' : 'Resume'}
                </Button>
              </div>
              <form
                className="chat-composer"
                onSubmit={form.handleSubmit(async (value) => {
                  const chat = selected!;
                  const requestId = requestForDraft(userId, chat, value.text);
                  try {
                    await api(`conversations/${selected}/messages`, 'POST', {
                      text: value.text,
                      requestId,
                    });
                    clearSendRequest(userId, chat);
                    writeDraft(userId, selected!, '');
                    if (selectedRef.current === selected) form.reset();
                    void client.invalidateQueries();
                    toast('Message sent');
                  } catch (e) {
                    if (e instanceof ApiError && e.code === 'DELIVERY_UNCERTAIN')
                      void client.invalidateQueries({ queryKey: ['messages', chat] });
                    form.setError('text', { message: (e as Error).message });
                  }
                })}
              >
                <div className="composer-template">
                  <select
                    aria-label="Use a message template"
                    defaultValue=""
                    onChange={(e) => {
                      const t = templates.data?.find((t) => t.id === e.target.value);
                      if (t) {
                        const text = t.content.replace(/\{\{name\}\}/g, c.name);
                        form.setValue('text', text, { shouldDirty: true, shouldValidate: true });
                        writeDraft(userId, selected!, text);
                      }
                      e.target.value = '';
                    }}
                  >
                    <option value="">Insert template</option>
                    {templates.data
                      ?.filter((t) => t.enabled)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                  <span>Manual replies pause automation</span>
                </div>
                <div>
                  <textarea
                    aria-label="Message"
                    placeholder="Write your reply…"
                    rows={2}
                    {...form.register('text', {
                      onChange: (event) => writeDraft(userId, selected!, event.target.value),
                    })}
                  />
                  <Button
                    aria-label="Send message"
                    aria-busy={form.formState.isSubmitting}
                    disabled={form.formState.isSubmitting}
                  >
                    <Send size={18} />
                  </Button>
                </div>
                {form.formState.errors.text && (
                  <p className="field-error" role="alert">
                    {form.formState.errors.text.message}
                  </p>
                )}
              </form>
            </>
          )
        )}
      </section>
      {c && <aside className="customer-panel">{customerDetails}</aside>}
      {details && c && (
        <Dialog title="Customer details" onClose={() => setDetails(false)}>
          {customerDetails}
        </Dialog>
      )}
    </div>
  );
}
function CustomerDetails({ c }: { c: Conversation }) {
  const client = useQueryClient();
  const form = useForm<z.infer<typeof detailsSchema>>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { notes: c.notes || '', tags: (c.tags || []).join(', ') },
  });
  const createLead = useMutation({
    mutationFn: () =>
      api('leads', 'POST', {
        conversationId: c.id,
        contactId: c.contactId,
        interest: c.lastMessageText || '',
        status: 'New',
      }),
    onSuccess: () => {
      void client.invalidateQueries();
      toast('Lead created');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  return (
    <div className="customer-details">
      <div className="customer-identity">
        <Avatar name={c.name} />
        <h3>{c.name}</h3>
        <p>{c.number}</p>
        <Badge tone={c.needsHuman ? 'warm' : 'green'}>
          {c.needsHuman
            ? 'Needs human'
            : c.automationEnabled && (c.pauseUntil || 0) <= Date.now()
              ? 'Automation on'
              : 'Paused'}
        </Badge>
      </div>
      <div className="detail-line">
        <span>First contact</span>
        <strong>{new Date(c.createdAt).toLocaleDateString()}</strong>
      </div>
      <div className="detail-line">
        <span>Last activity</span>
        <strong>{new Date(c.lastMessageAt).toLocaleDateString()}</strong>
      </div>
      {c.leadId ? (
        <Link className="button button--outline full-width" to="/dashboard/leads">
          View lead <ArrowUpRight size={15} />
        </Link>
      ) : (
        <Button
          variant="outline"
          className="full-width"
          disabled={createLead.isPending}
          onClick={() => createLead.mutate()}
        >
          Add as a lead
        </Button>
      )}
      <form
        onSubmit={form.handleSubmit(async (value) => {
          try {
            await api(`conversations/${c.id}`, 'PATCH', {
              notes: value.notes,
              tags: value.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            });
            form.reset(value);
            void client.invalidateQueries();
            toast('Customer details saved');
          } catch (e) {
            toast((e as Error).message, 'error');
          }
        })}
      >
        <Field
          label="Tags"
          hint="Separate with commas."
          error={form.formState.errors.tags?.message}
        >
          <input {...form.register('tags')} />
        </Field>
        <Field label="Notes" error={form.formState.errors.notes?.message}>
          <textarea rows={5} {...form.register('notes')} />
        </Field>
        <Button variant="outline" className="full-width" disabled={form.formState.isSubmitting}>
          Save details
        </Button>
      </form>
    </div>
  );
}
