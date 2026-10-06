import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import type { Contact, WhatsAppStatus } from '@receptly/shared';
import { env } from '../../config/env.js';
import { store, path, key } from '../../services/store.js';
import { monitoring } from '../../services/monitoring.js';
import { withLock } from '../../services/locks.js';
import { events } from '../../services/events.js';
import { FilesystemSessionStorage, type SessionStorage } from './storage.js';
import { normalize } from './normalize.js';
import { ReceptionistEngine } from '../receptionist/engine.js';
interface Context {
  socket?: WASocket;
  status: WhatsAppStatus;
  retry: number;
  timer?: NodeJS.Timeout;
  stopped: boolean;
  generation: number;
  opening?: Promise<void>;
}
export class WhatsAppConnectionManager {
  private contexts = new Map<string, Context>();
  private stopping = false;
  private logger = pino({ level: 'warn', redact: ['creds', 'auth', 'message', 'qr'] });
  readonly engine = new ReceptionistEngine((uid, jid, text) => this.sendMessage(uid, jid, text));
  constructor(
    private storage: SessionStorage = new FilesystemSessionStorage(env.WHATSAPP_SESSION_DIR),
    private purpose: 'automation' | 'payment-notifications' = 'automation',
    private socketFactory = makeWASocket,
  ) {}
  private metadataPath(uid: string) {
    return path(this.purpose === 'automation' ? 'whatsapp' : 'paymentWhatsApp', uid);
  }
  private lockName(uid: string) {
    return this.purpose === 'automation' ? `workspace:${uid}` : 'payment-whatsapp';
  }
  private async deleted(uid: string) {
    return this.purpose === 'automation' ? await store.get(path('accountDeletion', uid)) : false;
  }
  private async log(
    uid: string,
    type: string,
    message: string,
    severity: 'success' | 'warning' | 'error',
    details?: Record<string, unknown>,
  ) {
    if (this.purpose === 'automation') await store.log(uid, type, message, severity, details);
  }
  getStatus(uid: string) {
    return this.contexts.get(uid)?.status || ({ status: 'disconnected' } as WhatsAppStatus);
  }
  private async update(uid: string, c: Context, status: Partial<WhatsAppStatus>) {
    await withLock(this.lockName(uid), async () => {
      c.status = { ...c.status, ...status };
      if (await this.deleted(uid)) return;
      const { qr: _, qrExpiresAt: __, ...metadata } = c.status;
      await store.set(this.metadataPath(uid), metadata);
      if (this.purpose === 'automation') events.emit(uid, { type: 'whatsapp', data: c.status });
    });
  }
  async connect(uid: string) {
    if (await this.deleted(uid))
      throw Object.assign(new Error('Account deletion is in progress.'), {
        code: 'ACCOUNT_DELETING',
        statusCode: 409,
      });
    let c = this.contexts.get(uid);
    if (c?.opening) return c.opening;
    if (c?.socket || c?.timer) return;
    if (!c) {
      c = { status: { status: 'disconnected' }, retry: 0, stopped: false, generation: 0 };
      this.contexts.set(uid, c);
    }
    c.stopped = false;
    const promise = this.open(uid, c);
    c.opening = promise;
    try {
      await promise;
    } finally {
      c.opening = undefined;
    }
  }
  private async open(uid: string, c: Context) {
    if (this.stopping || c.stopped) return;
    const generation = ++c.generation;
    const { state, saveCreds } = await this.storage.load(uid);
    if (c.stopped || c.generation !== generation || this.stopping) return;
    await this.update(uid, c, {
      status: c.retry ? 'reconnecting' : 'connecting',
      qr: undefined,
      error: undefined,
    });
    const socket = this.socketFactory({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, this.logger) },
      logger: this.logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      browser: [
        this.purpose === 'automation' ? 'Receptly' : 'Receptly Payments',
        'Chrome',
        '1.0.0',
      ],
      getMessage: async (messageKey) => {
        if (this.purpose !== 'automation') return undefined;
        if (!messageKey.id || !messageKey.remoteJid) return undefined;
        try {
          const stored = await store.get<{ type: string; text?: string }>(
            path(`messages/${uid}`, key(messageKey.remoteJid), key(messageKey.id)),
          );
          return stored?.type === 'text' && stored.text ? { conversation: stored.text } : undefined;
        } catch {
          return undefined;
        }
      },
    });
    c.socket = socket;
    const guarded = (fn: () => Promise<void>) =>
      void fn().catch((error) => {
        monitoring.alert('whatsapp_event_failed', { code: error?.code || 'UNKNOWN' });
        this.logger.error(
          {
            operation: 'whatsapp_event',
            uid,
            errorCode: error?.code,
            errorName: error?.name,
            errorMessage: error?.message,
          },
          'WhatsApp event failed',
        );
      });
    socket.ev.on('creds.update', () =>
      guarded(async () => {
        if (c.generation === generation) await saveCreds();
      }),
    );
    socket.ev.on('connection.update', (update) =>
      guarded(async () => {
        if (c.generation !== generation || c.stopped) return;
        if (update.qr)
          await this.update(uid, c, {
            status: 'qr_required',
            qr: await QRCode.toDataURL(update.qr, { margin: 2, width: 320 }),
            qrExpiresAt: Date.now() + 60000,
          });
        if (update.connection === 'open') {
          c.retry = 0;
          await this.update(uid, c, {
            status: 'connected',
            qr: undefined,
            qrExpiresAt: undefined,
            phoneNumber: socket.user?.id.split(':')[0].split('@')[0],
            displayName: socket.user?.name,
            connectedAt: Date.now(),
            lastActivityAt: Date.now(),
          });
          await this.log(uid, 'whatsapp_connected', 'WhatsApp connected.', 'success');
        }
        if (update.connection === 'close') {
          c.socket = undefined;
          const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } })
            ?.output?.statusCode;
          const terminal = [
            DisconnectReason.loggedOut,
            DisconnectReason.badSession,
            DisconnectReason.connectionReplaced,
            DisconnectReason.multideviceMismatch,
            DisconnectReason.forbidden,
          ].includes(code as DisconnectReason);
          await this.update(uid, c, {
            status: terminal ? 'disconnected' : 'reconnecting',
            qr: undefined,
            qrExpiresAt: undefined,
            error: terminal ? 'Session ended. Reconnect or relink your account.' : undefined,
          });
          await this.log(uid, 'whatsapp_disconnected', 'WhatsApp disconnected.', 'warning', {
            reason: code || 0,
          });
          if (!terminal && !c.stopped && !this.stopping && c.retry < 8) {
            const delay =
              code === DisconnectReason.restartRequired
                ? 1000
                : Math.min(60000, 1000 * 2 ** c.retry) + Math.random() * 1000;
            c.retry++;
            c.timer = setTimeout(() => {
              c.timer = undefined;
              guarded(() => this.connect(uid));
            }, delay);
          } else if (!terminal) {
            monitoring.alert('whatsapp_reconnect_exhausted');
            await this.update(uid, c, {
              status: 'error',
              error: 'Reconnect attempts exhausted. Reconnect from your dashboard.',
            });
          }
        }
      }),
    );
    socket.ev.on('messages.upsert', (event) => {
      if (this.purpose !== 'automation') return;
      // Baileys uses append for offline delivery as well as notify for live delivery.
      // Both contain real messages; the engine persists and deduplicates each message ID.
      if (c.stopped || c.generation !== generation || this.stopping) return;
      for (const message of event.messages) {
        const normalized = normalize(uid, message);
        if (normalized)
          guarded(async () => {
            await this.engine.handle(normalized);
            await this.update(uid, c, { lastActivityAt: Date.now() });
          });
      }
    });
    socket.ev.on('contacts.upsert', (contacts) =>
      guarded(async () => {
        if (this.purpose !== 'automation') return;
        const writes: Record<string, unknown> = {};
        for (const contact of contacts) {
          const jid = contact.id;
          // Only phone-number WhatsApp JIDs can be used for replies and contact preferences.
          if (!jid?.endsWith('@s.whatsapp.net')) continue;
          const number = jid.slice(0, jid.indexOf('@')).split(':')[0];
          if (!/^\d{6,18}$/.test(number)) continue;
          const id = key(jid);
          const existing =
            (await store.get<Contact>(path('contacts', uid, id))) ||
            (await store.find<Contact>(path('contacts', uid), 'number', number));
          const now = Date.now();
          const record: Contact = {
            id: existing?.id || id,
            name: existing?.name || contact.name || contact.notify || contact.verifiedName || '',
            number,
            type: existing?.type || 'Normal',
            notes: existing?.notes || '',
            firstSeenAt: existing?.firstSeenAt || now,
            lastSeenAt: existing?.lastSeenAt,
            messageCount: existing?.messageCount || 0,
            createdAt: existing?.createdAt || now,
          };
          writes[path('contacts', uid, record.id)] = record;
        }
        if (Object.keys(writes).length) {
          await store.update(writes);
          events.emit(uid, { type: 'contacts' });
        }
      }),
    );
    socket.ev.on('messages.update', (updates) =>
      guarded(async () => {
        if (this.purpose !== 'automation') return;
        for (const u of updates) {
          if (u.update.status && u.key.remoteJid && u.key.id) {
            const p = path(`messages/${uid}`, key(u.key.remoteJid), key(u.key.id));
            if (await store.get(p))
              await store.patch(p, {
                sendStatus:
                  u.update.status >= 4 ? 'read' : u.update.status >= 3 ? 'delivered' : 'sent',
              });
          }
        }
        events.emit(uid, { type: 'message' });
      }),
    );
  }
  async sendMessage(uid: string, jid: string, text: string) {
    const c = this.contexts.get(uid);
    if (!c?.socket || c.status.status !== 'connected')
      throw Object.assign(new Error('Connect WhatsApp before sending messages.'), {
        statusCode: 409,
        code: 'WHATSAPP_DISCONNECTED',
      });
    const message = await c.socket.sendMessage(jid, { text });
    if (!message?.key.id) throw new Error('WhatsApp did not return a message ID.');
    return message.key.id;
  }
  async disconnect(uid: string) {
    const c = this.contexts.get(uid);
    if (!c) return;
    c.stopped = true;
    c.generation++;
    if (c.timer) clearTimeout(c.timer);
    c.timer = undefined;
    c.socket?.end(undefined);
    c.socket = undefined;
    await this.update(uid, c, { status: 'disconnected', qr: undefined, qrExpiresAt: undefined });
  }
  async reconnect(uid: string) {
    await this.disconnect(uid);
    const c = this.contexts.get(uid);
    if (c) c.retry = 0;
    await this.connect(uid);
  }
  async logout(uid: string) {
    const c = this.contexts.get(uid);
    if (c) {
      c.stopped = true;
      if (c.timer) clearTimeout(c.timer);
      try {
        await c.socket?.logout();
      } finally {
        await this.disconnect(uid);
      }
    }
    await this.storage.destroy(uid);
    await withLock(this.lockName(uid), async () => {
      if (!(await this.deleted(uid)))
        await store.set(this.metadataPath(uid), { status: 'disconnected' });
    });
    this.contexts.delete(uid);
    if (this.purpose === 'automation') events.emit(uid, { type: 'whatsapp' });
  }
  async restore() {
    if (this.purpose === 'payment-notifications') {
      const state = await store.get<WhatsAppStatus>(this.metadataPath('sender'));
      if (state && ['connected', 'connecting', 'reconnecting'].includes(state.status)) {
        try {
          await this.connect('sender');
        } catch {
          const context = this.contexts.get('sender');
          if (context)
            await this.update('sender', context, {
              status: 'error',
              error: 'Payment session restoration failed. Reconnect from the admin panel.',
            });
        }
      }
      return;
    }

    const { firebase } = await import('../../config/firebase.js');
    const snapshot = await firebase()
      .db.ref('whatsapp')
      .orderByChild('status')
      .equalTo('connected')
      .get();
    const ids: string[] = [];
    snapshot.forEach((c) => {
      ids.push(c.key!);
    });
    const reconnecting = await firebase()
      .db.ref('whatsapp')
      .orderByChild('status')
      .equalTo('reconnecting')
      .get();
    reconnecting.forEach((c) => {
      ids.push(c.key!);
    });
    const connecting = await firebase()
      .db.ref('whatsapp')
      .orderByChild('status')
      .equalTo('connecting')
      .get();
    connecting.forEach((c) => {
      ids.push(c.key!);
    });
    for (const uid of ids) {
      try {
        await this.connect(uid);
      } catch {
        await this.log(
          uid,
          'restore_failed',
          'Session restoration failed. Reconnect in the dashboard.',
          'error',
        );
      }
    }
  }
  async shutdown() {
    this.stopping = true;
    for (const c of this.contexts.values()) c.stopped = true;
    await Promise.allSettled([...this.contexts.values()].map((c) => c.opening));
    await this.engine.drain();
    for (const c of this.contexts.values()) {
      c.stopped = true;
      if (c.timer) clearTimeout(c.timer);
      c.socket?.end(undefined);
    }
    await this.storage.flush();
  }
}
export const whatsapp = new WhatsAppConnectionManager();
