import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { defaultSettings, defaultHours } from '@receptly/shared';
import QRCode from 'qrcode';
const now = Date.now();
const conversations = [
  {
    id: 'chat-one',
    contactId: 'contact-one',
    chatId: '919999999999@s.whatsapp.net',
    name: 'Ananya Sharma',
    number: '919999999999',
    lastMessageText: 'Can I book an appointment?',
    lastMessageAt: now,
    unreadCount: 2,
    automationEnabled: true,
    needsHuman: false,
    createdAt: now - 86400000,
    updatedAt: now,
  },
  {
    id: 'chat-two',
    contactId: 'contact-two',
    chatId: '918888888888@s.whatsapp.net',
    name: 'Rahul Mehta',
    number: '918888888888',
    lastMessageText: 'Can I speak to a human?',
    lastMessageAt: now - 60000,
    unreadCount: 1,
    automationEnabled: false,
    needsHuman: true,
    createdAt: now - 86400000,
    updatedAt: now,
  },
];
const fixtures = {
  settings: { ...defaultSettings, businessName: 'Studio & Co.', automationEnabled: true },
  schedule: defaultHours,
  onboarding: { scheduleConfigured: true, hasRules: true },
  conversations,
  templates: [
    {
      id: 'template-one',
      name: 'Pricing',
      category: 'Pricing',
      content: 'Our packages start at ₹499. Would you like to know more?',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      usageCount: 12,
    },
  ],
  rules: [
    {
      id: 'rule-one',
      name: 'Pricing enquiries',
      matchType: 'contains',
      patterns: ['price', 'cost', 'rate'],
      response: 'Our pricing starts from ₹499.',
      replyTemplateId: '',
      enabled: true,
      priority: 1,
      caseSensitive: false,
      stopProcessing: true,
      cooldownMinutes: null,
      createdAt: now,
      updatedAt: now,
      triggerCount: 12,
    },
  ],
  knowledgeBase: [
    {
      id: 'faq-one',
      question: 'Do you accept COD?',
      answer: 'Yes, cash on delivery is available for eligible orders.',
      keywords: ['cod', 'cash on delivery'],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  contacts: [
    {
      id: 'contact-one',
      name: 'Ananya Sharma',
      number: '919999999999',
      type: 'Normal',
      notes: 'Appointment enquiry',
      createdAt: now,
    },
  ],
  leads: [
    {
      id: 'lead-one',
      conversationId: 'chat-one',
      contactId: 'contact-one',
      status: 'New',
      interest: 'Appointment',
      notes: '',
      value: 499,
      tags: ['Appointment'],
      createdAt: now,
      updatedAt: now,
    },
  ],
  logs: [
    {
      id: 'log-one',
      type: 'whatsapp_connected',
      message: 'WhatsApp connected.',
      severity: 'success',
      timestamp: now,
    },
    {
      id: 'log-two',
      type: 'human_takeover',
      message: 'A conversation needs human attention.',
      severity: 'warning',
      timestamp: now - 60000,
    },
  ],
  analytics: {
    totals: {
      incoming: 128,
      autoReplies: 96,
      manualReplies: 18,
      outgoing: 114,
      leads: 12,
      humanTakeovers: 3,
      newContacts: 14,
      rulesTriggered: 25,
    },
    daily: {
      [new Date(now).toISOString().slice(0, 10)]: {
        incoming: 128,
        autoReplies: 96,
        manualReplies: 18,
        leads: 12,
        humanTakeovers: 3,
        rules: { 'rule-one': 12 },
      },
    },
  },
  whatsapp: {
    status: 'connected',
    displayName: 'Studio & Co.',
    phoneNumber: '919999999999',
    connectedAt: now - 3600000,
    lastActivityAt: now,
  },
  messages: [
    {
      id: 'incoming-one',
      conversationId: 'chat-one',
      direction: 'incoming',
      source: 'customer',
      type: 'text',
      text: 'Hi, what is the price?',
      timestamp: now - 120000,
    },
    {
      id: 'reply-one',
      conversationId: 'chat-one',
      direction: 'outgoing',
      source: 'receptly',
      autoReply: true,
      type: 'text',
      text: 'Our pricing starts from ₹499.',
      timestamp: now - 110000,
      sendStatus: 'sent',
    },
    {
      id: 'incoming-two',
      conversationId: 'chat-one',
      direction: 'incoming',
      source: 'customer',
      type: 'text',
      text: 'Can I book an appointment?',
      timestamp: now,
    },
  ],
};
await mkdir('output/playwright', { recursive: true });
const mode = process.argv[2] || 'public';
if (mode === 'billing')
  fixtures.billingQr = await QRCode.toDataURL('upi://pay?pa=qa%40upi&pn=QA&am=650.00&cu=INR');
const source = (await readFile(`tests/browser-${mode}.mjs`, 'utf8'))
  .replace('export default ', '')
  .trim()
  .replace(/;$/, '')
  .replace('/*FIXTURE*/ {}', JSON.stringify(fixtures));
const session = `receptly-${mode}`;
const browser = spawnSync(
  'npx',
  [
    '--yes',
    '--package',
    '@playwright/cli',
    'playwright-cli',
    '--session',
    session,
    'open',
    'http://localhost:5173',
  ],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 },
);
if (browser.status !== 0 || browser.stdout.includes('### Error'))
  throw new Error(browser.stdout || browser.stderr);
const result = spawnSync(
  'npx',
  [
    '--yes',
    '--package',
    '@playwright/cli',
    'playwright-cli',
    '--session',
    session,
    'run-code',
    source,
  ],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
await writeFile(`output/playwright/${mode}-results.txt`, result.stdout || result.stderr || '');
if (
  result.status !== 0 ||
  result.stdout.includes('"pass":false') ||
  result.stdout.includes('### Error')
)
  process.exitCode = 1;
