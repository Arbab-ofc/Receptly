import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { UserRecord } from 'firebase-admin/auth';
import { buildApp } from '../apps/server/src/app.js';
import { adminIdentity } from '../apps/server/src/services/admin.js';
import { env } from '../apps/server/src/config/env.js';
import { store, path } from '../apps/server/src/services/store.js';
import { defaultSettings } from '@receptly/shared';
import { memoryStore } from './memory.js';
let app: ReturnType<typeof buildApp>;
const headers = { authorization: 'Bearer admin' };
const originalAdmins = env.ADMIN_UIDS;
const user = (uid: string) =>
  ({
    uid,
    email: `${uid}@example.test`,
    displayName: uid,
    disabled: false,
    emailVerified: true,
    metadata: { creationTime: '2026-10-01T00:00:00Z', lastSignInTime: '2026-10-06T00:00:00Z' },
    passwordHash: 'private-password-hash',
  }) as UserRecord;
beforeEach(async () => {
  memoryStore();
  env.ADMIN_UIDS = 'admin';
  mock.method(adminIdentity, 'list', async () => ({
    users: [user('alice')],
    pageToken: 'next-page',
  }));
  mock.method(adminIdentity, 'get', async (uid: string) => {
    if (uid === 'missing')
      throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
    return user(uid);
  });
  app = buildApp(async (token) => token);
  await store.set(path('settings', 'alice'), {
    ...defaultSettings,
    businessName: 'Alice Studio',
    automationEnabled: true,
    version: 3,
  });
});
afterEach(async () => {
  await app.close();
  mock.restoreAll();
  env.ADMIN_UIDS = originalAdmins;
});

test('admin routes require verified allowlisted identity; ordinary users cannot read or mutate other workspaces', async () => {
  for (const url of [
    '/admin/users',
    '/admin/system',
    '/admin/enquiries',
    '/admin/audit',
    '/admin/users/alice',
  ]) {
    assert.equal((await app.inject({ url: `/api/v1${url}` })).statusCode, 401);
    assert.equal(
      (await app.inject({ url: `/api/v1${url}`, headers: { authorization: 'Bearer bob' } }))
        .statusCode,
      403,
    );
  }
  const denied = await app.inject({
    method: 'PATCH',
    url: '/api/v1/admin/users/alice/automation',
    headers: { authorization: 'Bearer bob' },
    payload: { enabled: false, expectedVersion: 3 },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(
    (await app.inject({ url: '/api/v1/account/access', headers })).json().data.admin,
    true,
  );
  assert.equal(
    (
      await app.inject({ url: '/api/v1/account/access', headers: { authorization: 'Bearer bob' } })
    ).json().data.admin,
    false,
  );
});
test('user directory pagination is passed to Firebase and private credentials are omitted', async () => {
  const response = await app.inject({
    url: '/api/v1/admin/users?limit=10&cursor=test-cursor',
    headers,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.nextCursor, 'next-page');
  assert.equal(response.json().data.items[0].workspace.businessName, 'Alice Studio');
  assert.equal(JSON.stringify(response.json()).includes('private-password-hash'), false);
  assert.equal(
    (adminIdentity.list as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls[0]
      .arguments[0],
    10,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/admin/users?limit=101', headers })).statusCode,
    400,
  );
});
test('automation changes preserve settings, reject stale concurrent editors and atomically record actor', async () => {
  const responses = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/users/alice/automation',
        headers,
        payload: { enabled: false, expectedVersion: 3 },
      }),
    ),
  );
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409]);
  const settings = await store.get<{
    automationEnabled: boolean;
    businessName: string;
    version: number;
  }>(path('settings', 'alice'));
  assert.equal(settings?.automationEnabled, false);
  assert.equal(settings?.businessName, 'Alice Studio');
  assert.equal(settings?.version, 4);
  const audit = await store.list<{ actorId: string; targetId: string; action: string }>(
    'adminAudit',
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actorId, 'admin');
  assert.equal(audit[0].targetId, 'alice');
  assert.equal(audit[0].action, 'automation_paused');
});
test('admin actions reject missing users and accounts being deleted', async () => {
  await store.set('accountDeletion/alice', { status: 'deleting' });
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/users/alice/automation',
        headers,
        payload: { enabled: true, expectedVersion: 3 },
      })
    ).statusCode,
    409,
  );
  assert.equal((await app.inject({ url: '/api/v1/admin/users/missing', headers })).statusCode, 404);
});
test('support enquiries can be resolved and reopened with versions and an audit trail', async () => {
  await store.set('contactRequests/enquiry', {
    id: 'enquiry',
    name: 'Customer',
    email: 'customer@example.test',
    subject: 'Setup',
    message: 'Please help',
    status: 'new',
    createdAt: 1,
  });
  const list = await app.inject({ url: '/api/v1/admin/enquiries?limit=25', headers });
  assert.equal(list.json().data.items[0].version, 0);
  const url = '/api/v1/admin/enquiries/enquiry';
  const resolved = await app.inject({
    method: 'PATCH',
    url,
    headers,
    payload: { status: 'resolved', expectedVersion: 0 },
  });
  assert.equal(resolved.json().data.version, 1);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url,
        headers,
        payload: { status: 'new', expectedVersion: 0 },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url,
        headers,
        payload: { status: 'new', expectedVersion: 1 },
      })
    ).statusCode,
    200,
  );
  assert.equal((await store.list('adminAudit')).length, 2);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url,
        headers,
        payload: { status: 'other', expectedVersion: 2 },
      })
    ).statusCode,
    400,
  );
});
