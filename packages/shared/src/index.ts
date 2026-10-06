import { z } from 'zod';
export const modes = ['Available', 'Busy', 'Away', 'Meeting', 'Vacation', 'Offline'] as const;
export const matchTypes = [
  'exact',
  'contains',
  'starts_with',
  'keyword',
  'any_keyword',
  'all_keywords',
] as const;
export const leadStatuses = ['New', 'Interested', 'Follow Up', 'Converted', 'Closed'] as const;
export const categories = [
  'Welcome',
  'Pricing',
  'Location',
  'Business Hours',
  'Appointment',
  'Payment',
  'Delivery',
  'Support',
  'Away',
  'Custom',
] as const;
const text = z.string().trim().min(1).max(10000);
export const templateSchema = z.object({
  name: text.max(120),
  category: z.enum(categories).default('Custom'),
  content: text,
  enabled: z.boolean().default(true),
});
export const ruleSchema = z
  .object({
    name: text.max(120),
    enabled: z.boolean().default(true),
    priority: z.number().int().min(1).max(1000).default(10),
    matchType: z.enum(matchTypes).default('contains'),
    scope: z.enum(['direct', 'group']).default('direct'),
    patterns: z.array(text.max(200)).min(1).max(50),
    caseSensitive: z.boolean().default(false),
    replyTemplateId: z.string().max(128).default(''),
    response: z.string().max(10000).default(''),
    stopProcessing: z.boolean().default(true),
    cooldownMinutes: z.number().min(0).max(10080).nullable().default(null),
  })
  .refine((v) => !!v.response || !!v.replyTemplateId, {
    message: 'Write a response or select a template.',
    path: ['response'],
  });
export const faqSchema = z.object({
  question: text.max(500),
  answer: text,
  keywords: z.array(text.max(200)).min(1).max(50),
  enabled: z.boolean().default(true),
});
export const catalogSchema = z.object({
  name: text.max(120),
  kind: z.enum(['Product', 'Service']).default('Product'),
  description: z.string().trim().max(3000).default(''),
  category: z.string().trim().max(120).default(''),
  price: z.number().finite().min(0).max(1e12).nullable().default(null),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.')
    .default('INR'),
  availability: z.enum(['Available', 'Unavailable']).default('Available'),
  keywords: z.array(text.max(200)).max(50).default([]),
  enabled: z.boolean().default(true),
});
const holidayTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm.');
export const holidaySchema = z
  .object({
    name: text.max(120),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((date) => {
        const parsed = new Date(`${date}T00:00:00Z`);
        return (
          !date.startsWith('0000') &&
          !Number.isNaN(parsed.getTime()) &&
          parsed.toISOString().slice(0, 10) === date
        );
      }, 'Select a valid calendar date.'),
    closed: z.boolean().default(true),
    open: holidayTime.default('10:00'),
    close: holidayTime.default('20:00'),
    response: z.string().trim().max(10000).default(''),
    enabled: z.boolean().default(true),
  })
  .refine((v) => v.closed || v.open !== v.close, {
    path: ['close'],
    message: 'Closing time must differ from opening time.',
  });
export type CatalogItem = z.infer<typeof catalogSchema> & { id: string };
export type Holiday = z.infer<typeof holidaySchema> & { id: string };
export const contactSchema = z.object({
  name: z.string().max(120).default(''),
  number: z
    .string()
    .regex(/^\+?\d{6,18}$/, 'Use an international phone number.')
    .transform((v) => v.replace(/^\+/, '')),
  type: z.enum(['Normal', 'VIP', 'Ignore', 'Blocked']).default('Normal'),
  notes: z.string().max(5000).default(''),
});
export const leadSchema = z.object({
  contactId: text.max(128),
  conversationId: text.max(128),
  status: z.enum(leadStatuses).default('New'),
  source: z.string().max(100).default('WhatsApp'),
  interest: z.string().max(500).default(''),
  value: z.number().min(0).default(0),
  notes: z.string().max(5000).default(''),
  tags: z.array(z.string().max(50)).max(20).default([]),
});
export const settingsSchema = z.object({
  businessName: z.string().max(120).default('My business'),
  timezone: z
    .string()
    .refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, 'Select a valid timezone.')
    .default('Asia/Kolkata'),
  automationEnabled: z.boolean().default(false),
  groupsEnabled: z.boolean().default(false),
  unknownContactsOnly: z.boolean().default(false),
  vipBypass: z.boolean().default(true),
  defaultCooldownMinutes: z.number().min(0).max(10080).default(30),
  pauseAfterManualReplyMinutes: z.number().min(0).max(10080).default(120),
  fallbackEnabled: z.boolean().default(true),
  fallbackMessage: z
    .string()
    .max(10000)
    .default(
      "Thanks for contacting {{business_name}}. We've received your message and will get back to you shortly.",
    ),
  fallbackCooldownMinutes: z.number().min(0).max(10080).default(30),
  outOfHoursEnabled: z.boolean().default(true),
  outOfHoursMessage: z
    .string()
    .max(10000)
    .default(
      "Thanks for messaging {{business_name}}. We're currently closed. Our business hours are {{business_hours}}. We'll get back to you when we reopen.",
    ),
  outOfHoursCooldownMinutes: z.number().min(0).max(10080).default(60),
  mode: z.enum(modes).default('Available'),
  modeReplies: z.record(z.string(), z.string().max(10000)).default({
    Busy: "We're busy at the moment. Please leave a message and we'll get back to you.",
    Away: "We're away right now. We'll respond as soon as possible.",
    Meeting: "We're currently in a meeting. Please leave your message.",
    Vacation: "We're on vacation. We've received your message and will respond when we return.",
    Offline: "We're offline right now. Please leave your message.",
  }),
  humanKeywords: z
    .array(text.max(100))
    .max(30)
    .default(['human', 'person', 'agent', 'talk to someone', 'speak to someone']),
  humanAcknowledgement: z
    .string()
    .max(10000)
    .default('Of course. A person will continue the conversation shortly.'),
  leadDetectionEnabled: z.boolean().default(true),
  leadKeywords: z
    .array(text.max(100))
    .max(30)
    .default(['pricing', 'price', 'appointment', 'book', 'buy', 'quote']),
  welcomeEnabled: z.boolean().default(false),
  welcomeMessage: z
    .string()
    .max(10000)
    .default('Welcome to {{business_name}}. How can we help you?'),
  menuEnabled: z.boolean().default(false),
  menuMessage: text.max(10000).default('Welcome to {{business_name}}. How can we help you?'),
  menuOptions: z
    .array(
      z
        .object({
          label: text.max(120),
          response: z.string().max(10000).default(''),
          action: z.enum(['custom', 'pricing', 'opening_hours', 'closing_hours']).default('custom'),
        })
        .refine((option) => option.action !== 'custom' || option.response.trim().length > 0, {
          message: 'Enter a reply for this option.',
          path: ['response'],
        }),
    )
    .max(9)
    .default([]),
  followUpEnabled: z.boolean().default(false),
  followUpHours: z.number().min(1).max(168).default(6),
  followUpMessage: z
    .string()
    .max(10000)
    .default('Just checking in. Is there anything else we can help you with?'),
});
export const hoursSchema = z
  .array(
    z.object({
      day: z.number().int().min(0).max(6),
      enabled: z.boolean(),
      open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
  )
  .length(7)
  .refine((v) => new Set(v.map((d) => d.day)).size === 7, 'Each day must appear once.');
export const contactRequestSchema = z.object({
  name: text.max(120),
  email: z.email().max(254),
  subject: text.max(200),
  message: text.max(5000),
});
export type Settings = z.infer<typeof settingsSchema>;
export type Rule = z.infer<typeof ruleSchema> & {
  id: string;
  triggerCount?: number;
  lastTriggeredAt?: number;
  createdAt: number;
  updatedAt: number;
};
export type Template = z.infer<typeof templateSchema> & {
  id: string;
  usageCount?: number;
  createdAt: number;
  updatedAt: number;
};
export type Hours = z.infer<typeof hoursSchema>;
export type Contact = z.infer<typeof contactSchema> & {
  id: string;
  firstSeenAt?: number;
  lastSeenAt?: number;
  messageCount?: number;
  createdAt: number;
};
export type Lead = z.infer<typeof leadSchema> & {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastInteractionAt?: number;
};
export interface Conversation {
  id: string;
  contactId: string;
  chatId: string;
  name: string;
  number: string;
  lastMessageText?: string;
  lastMessageAt: number;
  unreadCount: number;
  automationEnabled: boolean;
  needsHuman: boolean;
  leadId?: string;
  state?: string;
  stateData?: Record<string, string>;
  stateExpiresAt?: number;
  menuLastSentDate?: string;
  receptionistStoppedDate?: string;
  lastAutoReplyAt?: number;
  lastManualReplyAt?: number;
  pauseUntil?: number;
  cooldowns?: Record<string, number>;
  notes?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}
export interface StoredMessage {
  id: string;
  conversationId: string;
  direction: 'incoming' | 'outgoing';
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'unknown';
  text?: string;
  timestamp: number;
  source: 'customer' | 'receptly' | 'manual';
  autoReply?: boolean;
  ruleId?: string;
  sendStatus?: 'pending' | 'sent' | 'failed' | 'uncertain' | 'delivered' | 'read';
  mediaName?: string;
  mimeType?: string;
}
export interface NormalizedMessage {
  id: string;
  userId: string;
  chatId: string;
  senderJid: string;
  senderNumber: string;
  senderName?: string;
  type: StoredMessage['type'];
  text?: string;
  timestamp: number;
  fromMe: boolean;
  isGroup: boolean;
  mediaName?: string;
  mimeType?: string;
}
export interface WhatsAppStatus {
  status: 'disconnected' | 'connecting' | 'qr_required' | 'connected' | 'reconnecting' | 'error';
  phoneNumber?: string;
  displayName?: string;
  connectedAt?: number;
  lastActivityAt?: number;
  qr?: string;
  qrExpiresAt?: number;
  error?: string;
}
export interface ActivityLog {
  id: string;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
export interface DailyAnalytics {
  incoming: number;
  outgoing: number;
  autoReplies: number;
  manualReplies: number;
  leads: number;
  humanTakeovers: number;
  newContacts: number;
  rulesTriggered: number;
  hours?: Record<string, { incoming: number; autoReplies: number; manualReplies: number }>;
  rules?: Record<string, number>;
}
export const defaultSettings = settingsSchema.parse({});
export const defaultHours: Hours = Array.from({ length: 7 }, (_, day) => ({
  day,
  enabled: day !== 0,
  open: '10:00',
  close: '20:00',
}));

export * from './logic.js';

export * from './billing.js';
