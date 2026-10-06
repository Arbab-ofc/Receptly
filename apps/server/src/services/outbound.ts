import { createHash } from 'node:crypto';
import type { Conversation, StoredMessage } from '@receptly/shared';
import { store, path, key } from './store.js';
import { withLock } from './locks.js';
import { monitoring } from './monitoring.js';
import { env } from '../config/env.js';
export type SendRequest = {
  status: 'prepared' | 'sending' | 'completed' | 'failed' | 'uncertain';
  fingerprint: string;
  conversationId: string;
  timestamp: number;
  result?: StoredMessage;
  errorCode?: string;
};
export const sendError = (code: string, message: string, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });
export async function sendOnce(
  uid: string,
  conversation: Conversation,
  text: string,
  requestId: string,
  send: (uid: string, chatId: string, text: string) => Promise<string>,
  options: {
    source: 'manual' | 'receptly';
    ruleId?: string;
    pauseMinutes?: number;
    cooldownReason?: string;
    originalText?: string;
  },
) {
  return withLock(`send:${uid}:${requestId}`, async () => {
    if (await store.get(path('accountDeletion', uid)))
      throw sendError('ACCOUNT_DELETING', 'Account deletion is in progress.');
    const requestPath = path('sendRequests', uid, requestId);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([conversation.id, options.originalText || text, options.source]))
      .digest('hex');
    const existing = await store.get<SendRequest>(requestPath);
    if (existing) {
      if (!existing.fingerprint)
        throw sendError(
          'DUPLICATE_REQUEST',
          'This legacy request was already submitted. Check message history.',
        );
      if (existing.fingerprint !== fingerprint)
        throw sendError(
          'REQUEST_ID_REUSED',
          'Use the same requestId only for the same conversation and message.',
        );
      if (existing.status === 'completed' && existing.result) return existing.result;
      if (['sending', 'uncertain'].includes(existing.status)) {
        await store.patch(requestPath, { status: 'uncertain', timestamp: Date.now() });
        await store.patch(path(`messages/${uid}`, conversation.id, requestId), {
          sendStatus: 'uncertain',
        });
        throw sendError(
          'DELIVERY_UNCERTAIN',
          'Delivery could not be confirmed. Check message history before sending again.',
        );
      }
    }
    const now = Date.now();
    const entry: StoredMessage = {
      id: requestId,
      conversationId: conversation.id,
      text,
      direction: 'outgoing',
      type: 'text',
      source: options.source,
      timestamp: now,
      sendStatus: 'pending',
      ...(options.source === 'receptly' ? { autoReply: true } : {}),
      ...(options.ruleId ? { ruleId: options.ruleId } : {}),
    };
    await store.update({
      [requestPath]: {
        id: requestId,
        fingerprint,
        conversationId: conversation.id,
        status: 'prepared',
        timestamp: now,
      },
      [path(`messages/${uid}`, conversation.id, requestId)]: entry,
    });
    // Once this marker is durable, any crash must be treated as uncertain delivery.
    await store.patch(requestPath, { status: 'sending', timestamp: Date.now() });
    let transportId: string;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      transportId = await Promise.race([
        send(uid, conversation.chatId, text),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(sendError('TRANSPORT_TIMEOUT', 'Delivery could not be confirmed.')),
            env.SEND_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      const code = (error as { code?: string }).code || 'TRANSPORT_UNCERTAIN';
      const safeFailure = code === 'WHATSAPP_DISCONNECTED';
      await store.update({
        [`${requestPath}/status`]: safeFailure ? 'failed' : 'uncertain',
        [`${requestPath}/errorCode`]: code,
        [`${requestPath}/timestamp`]: Date.now(),
        [`${path(`messages/${uid}`, conversation.id, requestId)}/sendStatus`]: safeFailure
          ? 'failed'
          : 'uncertain',
      });
      monitoring.alert(safeFailure ? 'send_disconnected' : 'delivery_uncertain');
      if (!safeFailure)
        throw sendError(
          'DELIVERY_UNCERTAIN',
          'Delivery could not be confirmed. Check message history before sending again.',
        );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const result: StoredMessage = { ...entry, id: key(transportId), sendStatus: 'sent' };
    const conversationPath = path('conversations', uid, conversation.id);
    const writes: Record<string, unknown> = {
      [path(`messages/${uid}`, conversation.id, result.id)]: result,
      [path(`messages/${uid}`, conversation.id, requestId)]: null,
      [requestPath]: {
        id: requestId,
        fingerprint,
        conversationId: conversation.id,
        status: 'completed',
        timestamp: Date.now(),
        result,
      },
      [`${conversationPath}/lastMessageText`]: text,
      [`${conversationPath}/lastMessageAt`]: now,
      ...store.metricUpdates(
        uid,
        options.source === 'manual' ? ['outgoing', 'manualReplies'] : ['outgoing', 'autoReplies'],
      ),
    };
    if (options.source === 'manual') {
      writes[`${conversationPath}/lastManualReplyAt`] = now;
      writes[`${conversationPath}/pauseUntil`] = now + (options.pauseMinutes || 0) * 60000;
    } else {
      // Menu greetings and selections must not delay the next normal keyword reply.
      if (!['menu', 'menu_stop'].includes(options.cooldownReason || ''))
        writes[`${conversationPath}/lastAutoReplyAt`] = now;
      if (options.cooldownReason)
        writes[`${conversationPath}/cooldowns/${key(options.cooldownReason)}`] = now;
    }
    try {
      await store.update(writes);
    } catch {
      monitoring.alert('send_confirmation_persistence_failed');
      throw sendError(
        'DELIVERY_UNCERTAIN',
        'The message was sent but its result could not be saved. Check message history.',
      );
    }
    monitoring.increment('messages.sent');
    return result;
  });
}
