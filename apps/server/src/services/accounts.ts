import { store, path } from './store.js';
import { firebase } from '../config/firebase.js';
import { whatsapp } from '../modules/whatsapp/manager.js';
import { events } from './events.js';
import { withLock } from './locks.js';
export const accountCollections = [
  'workspaceRegistry',
  'accessProfiles',
  'subscriptions',
  'manualPayments',
  'billingRequests',
  'settings',
  'scheduleVersions',
  'businessHours',
  'rules',
  'templates',
  'knowledgeBase',
  'catalog',
  'holidays',
  'contacts',
  'leads',
  'conversations',
  'messages',
  'analytics',
  'logs',
  'jobs',
  'jobHistory',
  'processedMessages',
  'processingInbox',
  'sendRequests',
  'metricClaims',
  'jobClaims',
  'whatsapp',
];
export async function accountExport(uid: string) {
  return withLock(`workspace:${uid}`, async () => {
    const data: Record<string, unknown> = {};
    for (const collection of [
      'accessProfiles',
      'subscriptions',
      'manualPayments',
      'settings',
      'businessHours',
      'rules',
      'templates',
      'knowledgeBase',
      'catalog',
      'holidays',
      'contacts',
      'leads',
      'conversations',
      'messages',
      'analytics',
      'logs',
    ])
      data[collection] = await store.get(path(collection, uid));
    return { formatVersion: 1, exportedAt: new Date().toISOString(), data };
  });
}
export async function deleteAccount(uid: string, confirmation: string) {
  if (confirmation !== 'DELETE MY ACCOUNT') throw new Error('Explicit confirmation required.');
  // Keep a tombstone until every cleanup step succeeds; maintenance can resume interrupted deletion.
  await withLock(`workspace:${uid}`, () =>
    store.set(path('accountDeletion', uid), { status: 'deleting', timestamp: Date.now() }),
  );
  events.emit(`logout:${uid}`);
  await whatsapp.disconnect(uid);
  await whatsapp.engine.drain();
  await whatsapp.logout(uid);
  await firebase()
    .auth.revokeRefreshTokens(uid)
    .catch((error) => {
      if (error?.code !== 'auth/user-not-found') throw error;
    });
  await withLock('billing', () =>
    withLock(`workspace:${uid}`, async () => {
      const payments = await store.get<Record<string, { id: string }>>(path('manualPayments', uid));
      await store.update(
        Object.fromEntries(
          Object.keys(payments || {}).flatMap((id) =>
            ['paymentQueue', 'paymentNotifications', 'paymentNotificationHistory'].map((root) => [
              `${root}/${id}`,
              null,
            ]),
          ),
        ),
      );
      await store.update(
        Object.fromEntries(accountCollections.map((collection) => [path(collection, uid), null])),
      );
      await firebase()
        .auth.deleteUser(uid)
        .catch((error) => {
          if (error?.code !== 'auth/user-not-found') throw error;
        });
      await store.set(path('accountDeletion', uid), { status: 'deleted', timestamp: Date.now() });
    }),
  );
  return { deleted: true };
}
