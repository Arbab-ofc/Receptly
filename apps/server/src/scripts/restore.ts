import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { decryptBackup } from '../services/backup.js';
import { firebase } from '../config/firebase.js';
import { env } from '../config/env.js';
import { deleteApp, getApps } from 'firebase-admin/app';
import { accountCollections } from '../services/accounts.js';
import { stableKey } from '../services/store.js';
process.umask(0o077);
try {
  const args = process.argv.slice(2);
  const input = args[args.indexOf('--input') + 1];
  if (!args.includes('--input') || !input)
    throw new Error('Pass --input <backup-file>. Validation without --apply does not change data.');
  const backup = decryptBackup(await readFile(input), process.env.BACKUP_ENCRYPTION_KEY || '');
  if (args.includes('--apply')) {
    if (!args.includes('--offline') || !args.includes('--replace-database'))
      throw new Error(
        'Applying a restore requires --offline --replace-database. This replaces the database.',
      );
    const root = resolve(env.WHATSAPP_SESSION_DIR);
    const deleted = {
      ...((backup.database.accountDeletion as Record<string, unknown>) || {}),
      ...((await firebase().db.ref('accountDeletion').get()).val() || {}),
    };
    // Existing deletion markers must not be erased by an older database snapshot.
    backup.database.accountDeletion = deleted;
    const excludedSessions = new Set(Object.keys(deleted).map((uid) => `user_${stableKey(uid)}`));
    for (const uid of Object.keys(deleted))
      for (const collection of accountCollections) {
        const records = backup.database[collection];
        if (records && typeof records === 'object')
          delete (records as Record<string, unknown>)[uid];
      }
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink())
      throw new Error('Session directory must not be a symlink.');
    for (const file of backup.sessions) {
      if (excludedSessions.has(file.directory)) continue;
      const directory = join(root, file.directory);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await lstat(directory)).isSymbolicLink())
        throw new Error('Session directory must not be a symlink.');
      // Restore into an empty session directory to avoid mixing old and restored keys.
      await writeFile(join(directory, file.name), Buffer.from(file.contents, 'base64'), {
        flag: 'wx',
        mode: 0o600,
      });
    }
    await firebase().db.ref().set(backup.database);
    console.log('Database and session files restored. Verify the service before reopening access.');
  } else
    console.log(
      JSON.stringify({
        valid: true,
        createdAt: backup.createdAt,
        collections: Object.keys(backup.database).length,
        sessionFiles: backup.sessions.length,
      }),
    );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  for (const app of getApps()) await deleteApp(app);
}
