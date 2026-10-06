import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { encryptBackup } from '../apps/server/src/services/backup.js';

test('restore CLI verifies encrypted backups without connecting or changing data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'receptly-backup-test-'));
  const input = join(directory, 'test.enc');
  const encryptionKey = randomBytes(32).toString('hex');
  try {
    await writeFile(
      input,
      encryptBackup(
        {
          format: 'receptly-backup-v1',
          createdAt: '2026-10-06T00:00:00Z',
          database: { settings: { alice: { businessName: 'Test' } } },
          sessions: [],
        },
        encryptionKey,
      ),
    );
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve('apps/server/src/scripts/restore.ts'),
          '--input',
          input,
          ...args,
        ],
        { encoding: 'utf8', env: { ...process.env, BACKUP_ENCRYPTION_KEY: encryptionKey } },
      );
    const result = run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: true,
      createdAt: '2026-10-06T00:00:00Z',
      collections: 1,
      sessionFiles: 0,
    });
    const unsafe = run(['--apply']);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /requires --offline --replace-database/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
