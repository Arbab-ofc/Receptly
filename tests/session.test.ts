import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemSessionStorage } from '../apps/server/src/modules/whatsapp/storage.js';
test('session credentials persist across adapter restart, are isolated, and have restricted permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'receptly-session-test-'));
  try {
    const storage = new FilesystemSessionStorage(root);
    const auth = await storage.load('alice');
    auth.state.creds.registered = true;
    await auth.saveCreds();
    await storage.flush();
    const restored = await new FilesystemSessionStorage(root).load('alice');
    assert.equal(restored.state.creds.registered, true);
    const bob = await storage.load('bob');
    assert.equal(bob.state.creds.registered, false);
    const directories = await readdir(root);
    assert.equal(directories.length, 2);
    for (const dir of directories) {
      assert.equal((await stat(join(root, dir))).mode & 0o777, 0o700);
      for (const file of await readdir(join(root, dir)))
        assert.equal((await stat(join(root, dir, file))).mode & 0o777, 0o600);
    }
    await storage.destroy('alice');
    assert.equal((await readdir(root)).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('payment and workspace credentials stay isolated even with the same session identifier', async () => {
  const root = await mkdtemp(join(tmpdir(), 'receptly-payment-session-test-'));
  try {
    const workspace = new FilesystemSessionStorage(root);
    const payments = new FilesystemSessionStorage(root, 'payment');
    const auth = await workspace.load('sender');
    auth.state.creds.registered = true;
    await auth.saveCreds();
    const separate = await payments.load('sender');
    assert.equal(separate.state.creds.registered, false);
    separate.state.creds.registered = true;
    await separate.saveCreds();
    assert.equal(
      (await new FilesystemSessionStorage(root, 'payment').load('sender')).state.creds.registered,
      true,
    );
    const directories = await readdir(root);
    assert.ok(directories.some((directory) => directory.startsWith('payment_')));
    assert.ok(directories.some((directory) => directory.startsWith('user_')));
    await payments.destroy('sender');
    assert.equal((await workspace.load('sender')).state.creds.registered, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
