import { normalizeMessageContent, type WAMessage } from '@whiskeysockets/baileys';
import type { NormalizedMessage } from '@receptly/shared';
export function normalize(uid: string, m: WAMessage): NormalizedMessage | null {
  const chat = m.key.remoteJid;
  if (!chat || !m.key.id || chat === 'status@broadcast' || chat.endsWith('@broadcast')) return null;
  const c = normalizeMessageContent(m.message);
  if (!c || c.protocolMessage || c.senderKeyDistributionMessage) return null;
  let type: NormalizedMessage['type'] = 'unknown';
  let text: string | undefined;
  let mediaName: string | undefined;
  let mimeType: string | undefined;
  if (c.conversation || c.extendedTextMessage) {
    type = 'text';
    text = c.conversation || c.extendedTextMessage?.text || '';
  } else if (c.imageMessage) {
    type = 'image';
    text = c.imageMessage.caption || undefined;
    mimeType = c.imageMessage.mimetype || undefined;
  } else if (c.documentMessage) {
    type = 'document';
    mediaName = c.documentMessage.fileName || undefined;
    mimeType = c.documentMessage.mimetype || undefined;
  } else if (c.audioMessage) {
    type = 'audio';
    mimeType = c.audioMessage.mimetype || undefined;
  } else if (c.videoMessage) {
    type = 'video';
    text = c.videoMessage.caption || undefined;
    mimeType = c.videoMessage.mimetype || undefined;
  }
  if (type === 'unknown') return null;
  const sender = m.key.participantAlt || m.key.participant || m.key.remoteJidAlt || chat;
  return {
    id: m.key.id,
    userId: uid,
    chatId: chat,
    senderJid: sender,
    senderNumber: sender.split('@')[0].split(':')[0],
    senderName: m.pushName || undefined,
    type,
    text,
    mediaName,
    mimeType,
    timestamp: Number(m.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000,
    fromMe: !!m.key.fromMe,
    isGroup: chat.endsWith('@g.us'),
  };
}
