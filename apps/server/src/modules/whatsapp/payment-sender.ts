import { env } from '../../config/env.js';
import { WhatsAppConnectionManager } from './manager.js';
import { FilesystemSessionStorage } from './storage.js';
export const paymentSenderSessionId = 'sender';
export const paymentWhatsapp = new WhatsAppConnectionManager(
  new FilesystemSessionStorage(env.WHATSAPP_SESSION_DIR, 'payment'),
  'payment-notifications',
);
