import type { Conversation } from '@receptly/shared';
import { useAuth } from './auth';

// Drafts stay in memory for the signed-in browser session, never in persistent storage.
const drafts = new Map<string, string>();
const sends = new Map<string, { text: string; requestId: string }>();
useAuth.subscribe((state, previous) => {
  if (state.user?.uid !== previous.user?.uid) {
    drafts.clear();
    sends.clear();
  }
});
export const readDraft = (user: string, chat: string | null) => drafts.get(`${user}:${chat}`) || '';
export function writeDraft(user: string, chat: string, text: string) {
  const key = `${user}:${chat}`;
  if (text) drafts.set(key, text);
  else drafts.delete(key);
}
export function requestForDraft(user: string, chat: string, text: string) {
  const key = `${user}:${chat}`;
  let request = sends.get(key);
  if (!request || request.text !== text) {
    request = { text, requestId: crypto.randomUUID() };
    sends.set(key, request);
  }
  return request.requestId;
}
export const clearSendRequest = (user: string, chat: string) => sends.delete(`${user}:${chat}`);
export function matchesConversationFilter(c: Conversation, filter: string, now = Date.now()) {
  return (
    filter === 'all' ||
    (filter === 'unread' && c.unreadCount > 0) ||
    (filter === 'human' && c.needsHuman) ||
    (filter === 'leads' && !!c.leadId) ||
    (filter === 'paused' && (!c.automationEnabled || (c.pauseUntil || 0) > now))
  );
}
