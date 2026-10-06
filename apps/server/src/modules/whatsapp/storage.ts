import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { mkdir, chmod, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
export type SessionAuth = Awaited<ReturnType<typeof useMultiFileAuthState>>;
export interface SessionStorage {
  load(uid: string): Promise<SessionAuth>;
  destroy(uid: string): Promise<void>;
  flush(): Promise<void>;
}
/** Single-server filesystem adapter. Replace this interface for encrypted remote auth storage. */
export class FilesystemSessionStorage implements SessionStorage {
  private pending = new Set<Promise<void>>();
  private writes = new Map<string, Promise<void>>();
  constructor(
    private root: string,
    private namespace: 'user' | 'payment' = 'user',
  ) {}
  private directory(uid: string) {
    return join(
      resolve(this.root),
      `${this.namespace}_${createHash('sha256').update(uid).digest('hex')}`,
    );
  }
  async load(uid: string): Promise<SessionAuth> {
    const directory = this.directory(uid);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const auth = await useMultiFileAuthState(directory);
    return {
      state: auth.state,
      saveCreds: () => {
        const write = (this.writes.get(uid) || Promise.resolve())
          .catch(() => {})
          .then(async () => {
            await auth.saveCreds();
            for (const file of await readdir(directory)) await chmod(join(directory, file), 0o600);
          });
        this.writes.set(uid, write);
        this.pending.add(write);
        void write.then(
          () => this.pending.delete(write),
          () => this.pending.delete(write),
        );
        return write;
      },
    };
  }
  async destroy(uid: string) {
    await this.writes.get(uid)?.catch(() => {});
    await rm(this.directory(uid), { recursive: true, force: true });
    this.writes.delete(uid);
  }
  async flush() {
    await Promise.allSettled(this.pending);
  }
}
