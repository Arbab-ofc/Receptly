import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../apps/server/src/app.js';
import { store, path } from '../apps/server/src/services/store.js';
import { memoryStore } from './memory.js';
import { defaultHours } from '@receptly/shared';
let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  memoryStore();
  app = buildApp(async (token) => {
    if (token === 'alice' || token === 'bob') return token;
    throw new Error('invalid');
  });
});
afterEach(async () => {
  await app.close();
});
const headers = { authorization: 'Bearer alice' };
test('schedule reads and saves expose versions and reject an old editor', async () => {
  const read = await app.inject({ url: '/api/v1/schedule', headers });
  assert.equal(read.headers.etag, '"0"');
  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/v1/schedule',
    headers: { ...headers, 'if-match': read.headers.etag as string },
    payload: defaultHours,
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.headers.etag, '"1"');
  const stale = await app.inject({
    method: 'PATCH',
    url: '/api/v1/schedule',
    headers: { ...headers, 'if-match': '"0"' },
    payload: defaultHours.map((day) => ({ ...day, enabled: false })),
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'VERSION_CONFLICT');
  assert.deepEqual(
    (await app.inject({ url: '/api/v1/schedule', headers })).json().data,
    defaultHours,
  );
});
test('concurrent settings changes merge and stale record versions are rejected', async () => {
  const responses = await Promise.all([
    app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers,
      payload: { businessName: 'Example' },
    }),
    app.inject({ method: 'PATCH', url: '/api/v1/settings', headers, payload: { timezone: 'UTC' } }),
  ]);
  assert.ok(responses.every((r) => r.statusCode === 200));
  const current = (await app.inject({ url: '/api/v1/settings', headers })).json().data;
  assert.equal(current.businessName, 'Example');
  assert.equal(current.timezone, 'UTC');
  assert.equal(current.version, 2);
  const stale = await app.inject({
    method: 'PATCH',
    url: '/api/v1/settings',
    headers: { ...headers, 'if-match': '"1"' },
    payload: { businessName: 'Stale' },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'VERSION_CONFLICT');
  assert.ok(stale.json().error.requestId);
});
test('simultaneous contact creation reserves one normalized phone number', async () => {
  const result = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url: '/api/v1/contacts',
        headers,
        payload: { number: '+15555550123' },
      }),
    ),
  );
  assert.deepEqual(result.map((r) => r.statusCode).sort(), [200, 409]);
});
test('lead updates validate references and atomically move their conversation link', async () => {
  await store.set(path('conversations', 'alice', 'one'), { id: 'one', contactId: 'customer-one' });
  await store.set(path('conversations', 'alice', 'two'), { id: 'two', contactId: 'customer-two' });
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/leads',
    headers,
    payload: { conversationId: 'one', contactId: 'customer-one' },
  });
  const lead = created.json().data;
  const rejected = await app.inject({
    method: 'PATCH',
    url: `/api/v1/leads/${lead.id}`,
    headers,
    payload: { conversationId: 'two' },
  });
  assert.equal(rejected.statusCode, 400);
  const updated = await app.inject({
    method: 'PATCH',
    url: `/api/v1/leads/${lead.id}`,
    headers,
    payload: { conversationId: 'two', contactId: 'customer-two' },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(await store.get('conversations/alice/one/leadId'), null);
  assert.equal(await store.get('conversations/alice/two/leadId'), lead.id);
});
test('duplication respects the library limit and schema lengths', async () => {
  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/templates',
    headers,
    payload: { name: 'x'.repeat(120), content: 'Hello' },
  });
  const clone = await app.inject({
    method: 'POST',
    url: `/api/v1/templates/${first.json().data.id}/duplicate`,
    headers,
  });
  assert.equal(clone.statusCode, 200);
  assert.equal(clone.json().data.name.length, 120);
  assert.equal(clone.json().data.enabled, false);
  for (let i = 2; i < 200; i++)
    await store.set(path('templates', 'alice', `template-${i}`), {
      id: `template-${i}`,
      name: 'Test',
      content: 'Hello',
      createdAt: i,
    });
  const rejected = await app.inject({
    method: 'POST',
    url: `/api/v1/templates/${first.json().data.id}/duplicate`,
    headers,
  });
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.json().error.code, 'LIBRARY_LIMIT');
});
test('cursor pages retain equal timestamps and filters are scoped to their cursor', async () => {
  for (let i = 0; i < 75; i++)
    await store.set(path('conversations', 'alice', `chat-${String(i).padStart(3, '0')}`), {
      id: `chat-${String(i).padStart(3, '0')}`,
      lastMessageAt: 100,
      unreadCount: i % 2,
      needsHuman: i % 3 === 0,
      name: 'Example',
    });
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const response = await app.inject({
      url: `/api/v1/conversations?page=true&limit=20${cursor ? `&cursor=${cursor}` : ''}`,
      headers,
    });
    assert.equal(response.statusCode, 200);
    seen.push(...response.json().data.items.map((c: { id: string }) => c.id));
    cursor = response.json().data.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 75);
  assert.equal(new Set(seen).size, 75);
  const unread = await app.inject({
    url: '/api/v1/conversations?page=true&filter=unread&limit=5',
    headers,
  });
  assert.ok(unread.json().data.items.every((c: { unreadCount: number }) => c.unreadCount > 0));
  const invalid = await app.inject({
    url: `/api/v1/conversations?page=true&filter=human&cursor=${unread.json().data.nextCursor}`,
    headers,
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_CURSOR');
});
test('private monitoring requires an operator token and readiness differs from liveness', async () => {
  assert.equal((await app.inject({ url: '/api/health/live' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/health/ready' })).statusCode, 503);
  assert.equal((await app.inject({ url: '/api/operations', headers })).statusCode, 404);
});
test('SSE limits active connections and releases slots when clients disconnect', async () => {
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const controllers: AbortController[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const controller = new AbortController();
      controllers.push(controller);
      const r = await fetch(`${address}/api/v1/events`, { headers, signal: controller.signal });
      assert.equal(r.status, 200);
    }
    const blocked = await fetch(`${address}/api/v1/events`, { headers });
    assert.equal(blocked.status, 429);
    await blocked.body?.cancel();
  } finally {
    for (const controller of controllers) controller.abort();
  }
});
test('authenticated event streams retain CORS headers on the actual response', async () => {
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  for (const origin of ['http://localhost:5174', 'https://unrelated.example']) {
    const controller = new AbortController();
    try {
      const response = await fetch(`${address}/api/v1/events`, {
        headers: { ...headers, origin },
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get('access-control-allow-origin'),
        origin === 'http://localhost:5174' ? origin : null,
      );
      assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
      const reader = response.body!.getReader();
      const chunk = await reader.read();
      assert.match(new TextDecoder().decode(chunk.value), /event: ready\ndata: \{\}/);
      await reader.cancel();
    } finally {
      controller.abort();
    }
  }
});
test('local previews pass CORS preflight while unrelated origins remain blocked', async () => {
  for (const origin of ['http://localhost:5174', 'http://127.0.0.1:5174']) {
    for (const url of ['/api/v1/whatsapp/status', '/api/v1/events', '/api/v1/settings']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url,
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      assert.equal(response.statusCode, 204);
      assert.equal(response.headers['access-control-allow-origin'], origin);
      assert.match(String(response.headers['access-control-allow-headers']), /authorization/i);
    }
  }
  const blocked = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/settings',
    headers: { origin: 'https://unrelated.example', 'access-control-request-method': 'GET' },
  });
  assert.equal(blocked.headers['access-control-allow-origin'], undefined);
});
test('auth guard rejects missing and invalid tokens and ignores userId headers', async () => {
  for (const h of [{}, { authorization: 'Bearer invalid' }, { 'user-id': 'alice' }]) {
    const r = await app.inject({ url: '/api/v1/settings', headers: h });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().success, false);
  }
});
test('rules CRUD validates input and isolates tenants', async () => {
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/v1/rules',
    headers,
    payload: { name: 'bad' },
  });
  assert.equal(invalid.statusCode, 400);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/rules',
    headers,
    payload: { name: 'Pricing', patterns: ['price'], response: '₹499' },
  });
  assert.equal(created.statusCode, 200);
  const id = created.json().data.id;
  const other = await app.inject({
    url: `/api/v1/rules/${id}`,
    headers: { authorization: 'Bearer bob' },
  });
  assert.equal(other.statusCode, 404);
  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/v1/rules/${id}`,
    headers,
    payload: { priority: 1 },
  });
  assert.equal(patched.json().data.priority, 1);
  const dupe = await app.inject({ method: 'POST', url: `/api/v1/rules/${id}/duplicate`, headers });
  assert.equal(dupe.json().data.enabled, false);
  const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/rules/${id}`, headers });
  assert.equal(deleted.json().data.deleted, true);
});
test('settings API validates timezone and preserves unrelated fields', async () => {
  const initial = await app.inject({ url: '/api/v1/settings', headers });
  assert.equal(initial.json().data.automationEnabled, false);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { timezone: 'invalid' },
      })
    ).statusCode,
    400,
  );
  const result = await app.inject({
    method: 'PATCH',
    url: '/api/v1/settings',
    headers,
    payload: { businessName: 'Studio' },
  });
  assert.equal(result.json().data.businessName, 'Studio');
  assert.equal(result.json().data.defaultCooldownMinutes, 30);
});
test('conversation guard and pause/resume actions are scoped', async () => {
  await store.set(path('conversations', 'alice', 'chat'), {
    id: 'chat',
    chatId: '123@s.whatsapp.net',
    automationEnabled: true,
    needsHuman: false,
    unreadCount: 3,
    createdAt: 1,
    lastMessageAt: 1,
  });
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/conversations/chat',
        headers: { authorization: 'Bearer bob' },
      })
    ).statusCode,
    404,
  );
  const pause = await app.inject({
    url: '/api/v1/conversations/chat/pause-automation',
    method: 'POST',
    headers,
  });
  assert.equal(pause.json().data.automationEnabled, false);
  const resume = await app.inject({
    url: '/api/v1/conversations/chat/resume-automation',
    method: 'POST',
    headers,
  });
  assert.equal(resume.json().data.automationEnabled, true);
});
test('contact form validates and persists a real request', async () => {
  const result = await app.inject({
    url: '/api/v1/contact',
    method: 'POST',
    payload: {
      name: 'Jane',
      email: 'jane@example.com',
      subject: 'Support',
      message: 'Help with setup',
    },
  });
  assert.equal(result.statusCode, 200);
  assert.ok(await store.get(`contactRequests/${result.json().data.id}`));
  assert.equal(
    (await app.inject({ url: '/api/v1/contact', method: 'POST', payload: { email: 'invalid' } }))
      .statusCode,
    400,
  );
});

test('contact preferences use normalized unique phone numbers', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    headers,
    payload: { name: 'Customer', number: '+919999999999', type: 'VIP' },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().data.number, '919999999999');
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    headers,
    payload: { name: 'Duplicate', number: '919999999999' },
  });
  assert.equal(duplicate.statusCode, 409);
});

test('manual send resolves safe variables, persists, pauses automation, and deduplicates requests', async () => {
  const { whatsapp } = await import('../apps/server/src/modules/whatsapp/manager.js');
  const { key } = await import('../apps/server/src/services/store.js');
  const { mock } = await import('node:test');
  let count = 0;
  const mocked = mock.method(
    whatsapp,
    'sendMessage',
    async (_uid: string, _jid: string, text: string) => {
      count++;
      assert.equal(text, 'Hi Customer, welcome to My business.');
      return 'outgoing-test';
    },
  );
  try {
    await store.set(path('conversations', 'alice', 'chat'), {
      id: 'chat',
      chatId: '123@s.whatsapp.net',
      name: 'Customer',
      contactId: 'customer',
      automationEnabled: true,
      needsHuman: false,
      createdAt: 1,
      lastMessageAt: 1,
    });
    const payload = {
      text: 'Hi {{name}}, welcome to {{business_name}}.',
      requestId: '5c498583-5c27-463c-a824-cb3499502369',
    };
    const sent = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/chat/messages',
      headers,
      payload,
    });
    assert.equal(sent.statusCode, 200);
    assert.equal(sent.json().data.source, 'manual');
    assert.equal(
      await store.get(`${path('messages/alice', 'chat', key('outgoing-test'))}/sendStatus`),
      'sent',
    );
    assert.ok(
      Number(await store.get(`${path('conversations', 'alice', 'chat')}/pauseUntil`)) > Date.now(),
    );
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/chat/messages',
      headers,
      payload,
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().data.id, sent.json().data.id);
    assert.equal(count, 1);
  } finally {
    mocked.mock.restore();
  }
});

test('catalog CRUD is scoped, versioned, validated and supports toggles', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/catalog',
    headers,
    payload: { name: 'Haircut', kind: 'Service', price: 499 },
  });
  assert.equal(created.statusCode, 200);
  const item = created.json().data;
  const url = `/api/v1/catalog/${item.id}`;
  assert.equal(
    (await app.inject({ url, headers: { authorization: 'Bearer bob' } })).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url,
        headers: { ...headers, 'if-match': '0' },
        payload: { price: 100 },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await app.inject({ method: 'PATCH', url, headers, payload: { price: -1 } })).statusCode,
    400,
  );
  const toggle = await app.inject({
    method: 'PATCH',
    url: `${url}/toggle`,
    headers: { ...headers, 'if-match': '1' },
    payload: { enabled: false },
  });
  assert.equal(toggle.json().data.enabled, false);
  assert.equal(toggle.json().data.version, 2);
  assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 200);
  assert.equal((await app.inject({ url, headers })).statusCode, 404);
});
test('holiday dates are unique per workspace, including concurrent creates and edits', async () => {
  const payload = { name: 'Festival', date: '2026-10-05' };
  const results = await Promise.all(
    [1, 2].map(() => app.inject({ method: 'POST', url: '/api/v1/holidays', headers, payload })),
  );
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const id = results.find((r) => r.statusCode === 200)!.json().data.id;
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/holidays/${id}/toggle`,
        headers,
        payload: { enabled: false },
      })
    ).statusCode,
    200,
  );
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/holidays',
    headers,
    payload: { ...payload, date: '2026-10-06' },
  });
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/holidays/${second.json().data.id}`,
        headers,
        payload: { date: payload.date },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/holidays',
        headers: { authorization: 'Bearer bob' },
        payload,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/holidays',
        headers,
        payload: { ...payload, date: '2026-02-30' },
      })
    ).statusCode,
    400,
  );
});

test('status polling shares registry initialization while authentication and deletion checks stay per request', async () => {
  let registrations = 0;
  const transaction = store.transaction;
  store.transaction = async (...args: Parameters<typeof store.transaction>) => {
    if (args[0] === 'workspaceRegistry/alice') registrations++;
    return transaction(...args);
  };
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ url: '/api/v1/whatsapp/status', headers })),
    );
    assert.ok(results.every((result) => result.statusCode === 200));
    assert.equal(registrations, 1);
    const invalid = await app.inject({
      url: '/api/v1/whatsapp/status',
      headers: { authorization: 'Bearer invalid' },
    });
    assert.equal(invalid.statusCode, 401);
    await store.set('accountDeletion/alice', { status: 'deleting' });
    assert.equal((await app.inject({ url: '/api/v1/whatsapp/status', headers })).statusCode, 409);
  } finally {
    store.transaction = transaction;
  }
});

test('failed registry initialization can retry and preserve existing creation time', async () => {
  const transaction = store.transaction;
  let first = true;
  store.transaction = async (...args: Parameters<typeof store.transaction>) => {
    if (args[0] === 'workspaceRegistry/alice' && first) {
      first = false;
      throw new Error('Database unavailable');
    }
    return transaction(...args);
  };
  try {
    await store.set('workspaceRegistry/alice', { createdAt: 123 });
    assert.equal((await app.inject({ url: '/api/v1/whatsapp/status', headers })).statusCode, 500);
    assert.equal((await app.inject({ url: '/api/v1/whatsapp/status', headers })).statusCode, 200);
    assert.equal(
      (await store.get<{ createdAt: number }>('workspaceRegistry/alice'))!.createdAt,
      123,
    );
  } finally {
    store.transaction = transaction;
  }
});

test('settings reads restore arrays omitted by Firebase and preserve saved values and version', async () => {
  await store.set('settings/alice', {
    businessName: 'Saved business',
    automationEnabled: true,
    version: 7,
    modeReplies: { Busy: 'Custom busy reply' },
  });
  const response = await app.inject({ url: '/api/v1/settings', headers });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.deepEqual(data.menuOptions, []);
  assert.ok(Array.isArray(data.humanKeywords));
  assert.ok(Array.isArray(data.leadKeywords));
  assert.equal(data.businessName, 'Saved business');
  assert.equal(data.automationEnabled, true);
  assert.equal(data.modeReplies.Busy, 'Custom busy reply');
  assert.ok(data.modeReplies.Away);
  assert.equal(data.version, 7);
  assert.equal((await store.get<{ version: number }>('settings/alice'))!.version, 7);
});
