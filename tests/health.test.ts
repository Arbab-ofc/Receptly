import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase, type DataSnapshot } from 'firebase-admin/database';

// This test file runs in an isolated process and never uses live credentials.
Object.assign(process.env, {
  NODE_ENV: 'test',
  FIREBASE_PROJECT_ID: 'receptly-health-test',
  FIREBASE_CLIENT_EMAIL: 'health@example.test',
  FIREBASE_PRIVATE_KEY: 'test-only',
  FIREBASE_DATABASE_URL: 'https://receptly-health-test.firebaseio.com',
});
const firebaseApp = initializeApp({
  projectId: 'receptly-health-test',
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  credential: {
    getAccessToken: async () => ({ access_token: 'test-only', expires_in: 3600 }),
  },
});
const db = getDatabase(firebaseApp);
const reference = db.ref('__healthcheck');
const { buildApp } = await import('../apps/server/src/app.js');
after(async () => {
  await deleteApp(firebaseApp);
});

test('health reports ok after a successful read even when the node does not exist', async () => {
  const app = buildApp();
  const read = mock.method(reference, 'get', async () => ({ exists: () => false }) as DataSnapshot);
  const ref = mock.method(db, 'ref', (path: string) => {
    assert.equal(path, '__healthcheck');
    return reference;
  });
  try {
    const response = await app.inject({ url: '/api/health' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      status: 'ok',
      timestamp: body.timestamp,
      services: { firebase: 'ok' },
    });
    assert.ok(Number.isFinite(Date.parse(body.timestamp)));
    assert.equal(read.mock.callCount(), 1);
    assert.equal(ref.mock.callCount(), 1);
  } finally {
    mock.restoreAll();
    await app.close();
  }
});

test('health reports degraded and logs the original database read error', async () => {
  const app = buildApp();
  const error = new Error('Database unavailable');
  mock.method(db, 'ref', () => reference);
  mock.method(reference, 'get', async () => {
    throw error;
  });
  const logged = mock.method(app.log, 'error', () => {});
  try {
    const response = await app.inject({ url: '/api/health' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      status: 'degraded',
      timestamp: body.timestamp,
      services: { firebase: 'unconfigured_or_unavailable' },
    });
    assert.ok(Number.isFinite(Date.parse(body.timestamp)));
    assert.equal(logged.mock.callCount(), 1);
    assert.deepEqual(logged.mock.calls[0].arguments, [{ error }, 'Firebase health check failed']);
  } finally {
    mock.restoreAll();
    await app.close();
  }
});
