import { readdir, readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { encryptBackup, type Backup } from '../services/backup.js';
import { firebase } from '../config/firebase.js';
import { env } from '../config/env.js';
import { deleteApp, getApps } from 'firebase-admin/app';
process.umask(0o077);
try {
  const args = process.argv.slice(2);
  const output = args[args.indexOf('--output') + 1];
  if (!args.includes('--offline') || !args.includes('--output') || !output)
    throw new Error('Stop Receptly, then pass --offline --output <new-file>.');
  const sessions: Backup['sessions'] = [];
  const root = resolve(env.WHATSAPP_SESSION_DIR);
  for (const directory of await readdir(root).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    if (
      !/^(?:user|payment)_[a-f0-9]{64}$/.test(directory) ||
      !(await lstat(join(root, directory))).isDirectory()
    )
      continue;
    for (const name of await readdir(join(root, directory))) {
      const file = join(root, directory, name);
      if (!(await lstat(file)).isFile())
        throw new Error('Session backup accepts regular files only.');
      sessions.push({ directory, name, contents: (await readFile(file)).toString('base64') });
    }
  }
  const database = (await firebase().db.ref().get()).val() || {};
  const blob = encryptBackup(
    { format: 'receptly-backup-v1', createdAt: new Date().toISOString(), database, sessions },
    process.env.BACKUP_ENCRYPTION_KEY || '',
  );
  await mkdir(resolve(output, '..'), { recursive: true, mode: 0o700 });
  await writeFile(output, blob, { flag: 'wx', mode: 0o600 });
  console.log('Encrypted backup created. Verify it with the restore dry run.');
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  for (const app of getApps()) await deleteApp(app);
}
