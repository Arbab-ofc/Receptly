import { store, path } from './store.js';
import { env } from '../config/env.js';
import { monitoring } from './monitoring.js';
export async function cleanupWorkspace(uid: string, now = Date.now()) {
  for (const request of await store.findMany<Record<string, unknown>>(
    path('sendRequests', uid),
    'status',
    'sending',
    100,
  )) {
    if (Number(request.timestamp) < now - 120000 && request.id && request.conversationId) {
      await store.update({
        [`${path('sendRequests', uid, String(request.id))}/status`]: 'uncertain',
        [`${path(`messages/${uid}`, String(request.conversationId), String(request.id))}/sendStatus`]:
          'uncertain',
      });
      monitoring.alert('stale_send_uncertain');
    }
  }
  const removeBefore = async (
    collection: string,
    field: string,
    days: number,
    eligible: (record: Record<string, unknown>) => boolean = () => true,
  ) => {
    if (!days) return;
    const records = await store.due<Record<string, unknown>>(
      path(collection, uid),
      now - days * 86400000,
      500,
      field,
    );
    const writes: Record<string, null> = {};
    for (const record of records)
      if (record.id && Number(record[field]) > 0 && eligible(record))
        writes[path(collection, uid, String(record.id))] = null;
    if (Object.keys(writes).length) {
      await store.update(writes);
      monitoring.increment('retention.removed', Object.keys(writes).length);
    }
  };
  await removeBefore('jobHistory', 'updatedAt', 30);
  await removeBefore('logs', 'timestamp', env.LOG_RETENTION_DAYS);
  for (const collection of ['processedMessages', 'metricClaims', 'jobClaims'])
    await removeBefore(collection, 'timestamp', 7);
  await removeBefore('sendRequests', 'timestamp', 7, (r) =>
    ['completed', 'failed', 'uncertain'].includes(String(r.status)),
  );
  await removeBefore(
    'processingInbox',
    'timestamp',
    30,
    (r) =>
      r.status === 'completed' ||
      r.status === 'uncertain' ||
      (r.status === 'failed' && Number(r.attempts) >= 5),
  );
  if (env.MESSAGE_RETENTION_DAYS) {
    for (const cid of await store.keys(`messages/${uid}`)) {
      const records = await store.due<Record<string, unknown>>(
        `messages/${uid}/${cid}`,
        now - env.MESSAGE_RETENTION_DAYS * 86400000,
        500,
        'timestamp',
      );
      const writes: Record<string, null> = {};
      for (const record of records)
        if (record.id && !['pending', 'uncertain'].includes(String(record.sendStatus)))
          writes[`messages/${uid}/${cid}/${record.id}`] = null;
      if (Object.keys(writes).length) await store.update(writes);
      const conversation = await store.get<{ lastMessageAt?: number }>(
        path('conversations', uid, cid),
      );
      if (Number(conversation?.lastMessageAt) < now - env.MESSAGE_RETENTION_DAYS * 86400000)
        await store.patch(path('conversations', uid, cid), { lastMessageText: null });
    }
  }
  const expiredStates = await store.due<Record<string, unknown>>(
    path('conversations', uid),
    now,
    100,
    'stateExpiresAt',
  );
  for (const record of expiredStates)
    if (Number(record.stateExpiresAt) > 0)
      await store.patch(path('conversations', uid, String(record.id)), {
        state: null,
        stateData: null,
        stateExpiresAt: null,
      });
}
