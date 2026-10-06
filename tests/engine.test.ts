import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ReceptionistEngine } from '../apps/server/src/modules/receptionist/engine.js';
import { store, path, key } from '../apps/server/src/services/store.js';
import {
  defaultSettings,
  defaultHours,
  catalogSchema,
  holidaySchema,
  localDate,
  type NormalizedMessage,
  type Conversation,
} from '@receptly/shared';
import { memoryStore } from './memory.js';
let sent: string[] = [];
let engine: ReceptionistEngine;
const m: NormalizedMessage = {
  id: 'msg1',
  userId: 'alice',
  chatId: '919999999999@s.whatsapp.net',
  senderJid: '919999999999@s.whatsapp.net',
  senderNumber: '919999999999',
  senderName: 'Customer',
  type: 'text',
  text: 'Hi, what is the price?',
  timestamp: Date.now(),
  fromMe: false,
  isGroup: false,
};
beforeEach(async () => {
  memoryStore();
  await store.set('accessProfiles/alice', { tier: 'pro', version: 1 });
  sent = [];
  engine = new ReceptionistEngine(async (_uid, _jid, text) => {
    sent.push(text);
    return `reply${sent.length}`;
  });
  await store.set(path('settings', 'alice'), {
    ...defaultSettings,
    automationEnabled: true,
    timezone: 'UTC',
    defaultCooldownMinutes: 0,
  });
  await store.set(
    path('businessHours', 'alice'),
    defaultHours.map((h) => ({ ...h, enabled: true, open: '00:00', close: '23:59' })),
  );
  await store.set(path('rules', 'alice', 'pricing'), {
    id: 'pricing',
    name: 'Pricing',
    enabled: true,
    priority: 1,
    matchType: 'contains',
    patterns: ['price', 'cost', 'charges'],
    caseSensitive: false,
    response: 'Our pricing starts from ₹499.',
    replyTemplateId: '',
    stopProcessing: true,
    cooldownMinutes: null,
    createdAt: 1,
    updatedAt: 1,
  });
});
test('pricing acceptance: stores contact, conversation, lead, counters and only one reply', async () => {
  await Promise.all([engine.handle(m), engine.handle(m)]);
  assert.deepEqual(sent, ['Our pricing starts from ₹499.']);
  assert.equal(
    (await store.get<Conversation>(path('conversations', 'alice', key(m.chatId))))?.unreadCount,
    1,
  );
  assert.ok(await store.get(path('contacts', 'alice', key(m.senderJid))));
  assert.equal(await store.get(`${path('rules', 'alice', 'pricing')}/triggerCount`), 1);
  assert.equal((await store.list(path('leads', 'alice'))).length, 1);
});
test('paused global automation stores incoming messages but sends nothing', async () => {
  await store.patch(path('settings', 'alice'), { automationEnabled: false });
  await engine.handle(m);
  assert.equal(sent.length, 0);
  assert.ok(await store.get(path('conversations', 'alice', key(m.chatId))));
});
test('closed hours terminate normal rule flow and respect cooldown', async () => {
  await store.set(
    path('businessHours', 'alice'),
    defaultHours.map((h) => ({ ...h, enabled: false })),
  );
  await engine.handle(m);
  await engine.handle({ ...m, id: 'msg2' });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /currently closed/);
  assert.equal(await store.get(`${path('rules', 'alice', 'pricing')}/triggerCount`), null);
});
test('human handover persists and suppresses subsequent automation until resumed', async () => {
  await engine.handle({ ...m, text: 'Can I speak to a human?' });
  await engine.handle({ ...m, id: 'msg2' });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /person/);
  const c = await store.get<Conversation>(path('conversations', 'alice', key(m.chatId)));
  assert.equal(c?.automationEnabled, false);
  assert.equal(c?.needsHuman, true);
});
test('ignored contacts and default groups never receive replies', async () => {
  await store.set(path('contacts', 'alice', key(m.senderJid)), {
    id: key(m.senderJid),
    name: 'VIP',
    number: m.senderNumber,
    type: 'Ignore',
    notes: '',
    createdAt: 1,
  });
  await engine.handle(m);
  await engine.handle({ ...m, id: 'group', chatId: '123@g.us', isGroup: true });
  assert.equal(sent.length, 0);
});
test('deterministic priority selects highest-priority rule', async () => {
  await store.set(path('rules', 'alice', 'first'), {
    id: 'first',
    name: 'First',
    enabled: true,
    priority: 0,
    patterns: ['price'],
    matchType: 'contains',
    response: 'Priority reply',
    stopProcessing: true,
    caseSensitive: false,
  });
  await engine.handle(m);
  assert.deepEqual(sent, ['Priority reply']);
});
test('numbered menu is scoped to active conversation state', async () => {
  await store.patch(path('settings', 'alice'), {
    menuEnabled: true,
    menuOptions: [{ label: 'Location', response: 'Find us at Main Street.' }],
  });
  await engine.handle({ ...m, text: 'hello' });
  await engine.handle({ ...m, id: 'msg2', text: '1' });
  assert.equal(sent[1], 'Find us at Main Street.');
  await engine.handle({
    ...m,
    id: 'msg3',
    text: '1',
    chatId: '911111111111@s.whatsapp.net',
    senderJid: '911111111111@s.whatsapp.net',
  });
  assert.notEqual(sent.at(-1), 'Find us at Main Street.');
});
test('manual reply pauses the conversation', async () => {
  await engine.handle({ ...m, fromMe: true, text: 'Owner reply' });
  await engine.handle({ ...m, id: 'msg2' });
  assert.equal(sent.length, 0);
  assert.ok(
    (await store.get<Conversation>(path('conversations', 'alice', key(m.chatId))))!.pauseUntil! >
      Date.now(),
  );
});
test('send failure remains recorded and duplicate event is not retried', async () => {
  let calls = 0;
  engine = new ReceptionistEngine(async () => {
    calls++;
    throw new Error('transport');
  });
  await assert.rejects(engine.handle(m));
  await engine.handle(m);
  assert.equal(calls, 1);
  const messages = await store.list<{ sendStatus?: string }>(path(`messages/alice`, key(m.chatId)));
  assert.ok(messages.some((m) => m.sendStatus === 'uncertain'));
});

test('manually added contact preferences are matched by normalized phone number', async () => {
  await store.set(path('contacts', 'alice', 'custom-id'), {
    id: 'custom-id',
    name: 'Important customer',
    number: m.senderNumber,
    type: 'VIP',
    notes: '',
    createdAt: 1,
  });
  await engine.handle(m);
  assert.equal(sent.length, 0);
  assert.equal(
    (await store.get<Conversation>(path('conversations', 'alice', key(m.chatId))))?.contactId,
    'custom-id',
  );
});

test('enabled groups require dedicated group rules and never receive direct fallback', async () => {
  await store.patch(path('settings', 'alice'), { groupsEnabled: true });
  const group = { ...m, chatId: '123@g.us', isGroup: true };
  await engine.handle(group);
  assert.equal(sent.length, 0);
  await store.patch(path('rules', 'alice', 'pricing'), { scope: 'group' });
  await engine.handle({ ...group, id: 'group-second' });
  assert.deepEqual(sent, ['Our pricing starts from ₹499.']);
});

test('follow-up jobs persist and customer replies cancel only their own jobs', async () => {
  await store.patch(path('settings', 'alice'), { followUpEnabled: true });
  await engine.handle(m);
  const jobs = await store.list<{
    id: string;
    chatId: string;
    status: string;
    scheduledFor: number;
  }>(path('jobs', 'alice'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'pending');
  assert.ok(jobs[0].scheduledFor > Date.now());
  await engine.handle({ ...m, id: 'msg-follow-up', text: 'Thank you' });
  assert.equal(
    (await store.get<{ status: string }>(path('jobs', 'alice', jobs[0].id)))?.status,
    'cancelled',
  );
});

test('catalog answers precede fallback while explicit rules keep priority', async () => {
  await store.set(path('catalog', 'alice', 'haircut'), {
    ...catalogSchema.parse({ name: 'Haircut', kind: 'Service', price: 499 }),
    id: 'haircut',
  });
  await engine.handle({ ...m, text: 'Tell me about haircut' });
  assert.match(sent[0], /Haircut.*499/);
  await engine.handle({ ...m, id: 'next', text: 'What is the haircut price?' });
  assert.equal(sent[1], 'Our pricing starts from ₹499.');
});
test('holiday closure replies replace normal automation and use holiday template hours', async () => {
  await store.set(path('holidays', 'alice', 'festival'), {
    ...holidaySchema.parse({
      name: 'Festival',
      date: localDate('UTC'),
      response: 'Closed for {{business_hours}}.',
    }),
    id: 'festival',
  });
  await engine.handle(m);
  assert.match(sent[0], /Closed for Festival.*closed/);
  assert.equal(await store.get(`${path('rules', 'alice', 'pricing')}/triggerCount`), null);
});

test('daily menu and option names work immediately despite the normal cooldown, with multiple selections', async () => {
  await store.patch('settings/alice', {
    defaultCooldownMinutes: 30,
    menuEnabled: true,
    fallbackEnabled: false,
    menuOptions: [
      { label: 'Pricing / plans.', response: 'Packages from ₹59.', action: 'custom' },
      { label: 'Opening hours', response: 'We open at 10 AM.', action: 'custom' },
    ],
  });
  await engine.handle({ ...m, text: 'MENU' });
  assert.match(sent[0], /1\. Pricing \/ plans\./);
  await engine.handle({ ...m, id: 'choose-one', text: '1' });
  assert.equal(sent.at(-1), 'Packages from ₹59.');
  await engine.handle({ ...m, id: 'choose-two', text: 'OPENING HOURS' });
  assert.equal(sent.at(-1), 'We open at 10 AM.');
  const beforeRepeat = sent.length;
  await engine.handle({ ...m, id: 'reopen', text: 'menu' });
  assert.equal(sent.length, beforeRepeat);
  const conversation = (await store.get<Conversation>(
    path('conversations', 'alice', key(m.chatId)),
  ))!;
  assert.ok(Object.keys(conversation.stateData!).every((value) => !/[.#$\[\]\/]/.test(value)));
});
test('daily menu takes precedence over rules and dynamic options use catalog and holiday hours', async () => {
  await store.patch('settings/alice', {
    menuEnabled: true,
    menuOptions: [
      { label: 'Pricing', action: 'pricing', response: '' },
      { label: 'Opening hours', action: 'opening_hours', response: '' },
      { label: 'Closing hours', action: 'closing_hours', response: '' },
    ],
  });
  await store.set('catalog/alice/service', {
    ...catalogSchema.parse({ name: 'Consultation', kind: 'Service', price: 499 }),
    id: 'service',
  });
  await store.set('holidays/alice/special', {
    ...holidaySchema.parse({
      name: 'Special hours',
      date: localDate('UTC'),
      closed: false,
      open: '00:01',
      close: '23:59',
    }),
    id: 'special',
  });
  await engine.handle({ ...m, text: 'hello' });
  assert.match(sent[0], /1\. Pricing/);
  await engine.handle({ ...m, id: 'pricing-menu', text: 'Pricing' });
  assert.match(sent.at(-1)!, /Consultation/);
  assert.match(sent.at(-1)!, /499/);
  await engine.handle({ ...m, id: 'open-menu', text: '2' });
  assert.match(sent.at(-1)!, /open at 00:01/);
  await engine.handle({ ...m, id: 'close-menu', text: '3' });
  assert.match(sent.at(-1)!, /close at 23:59/);
});
test('daily menu precedes Busy mode; later messages respect mode and expired selections', async () => {
  await store.patch('settings/alice', {
    menuEnabled: true,
    mode: 'Busy',
    menuOptions: [{ label: 'Pricing', response: 'Custom price' }],
  });
  await engine.handle({ ...m, text: 'menu' });
  assert.match(sent[0], /1\. Pricing/);
  await engine.handle({ ...m, id: 'after-menu-busy', text: 'hello' });
  assert.match(sent.at(-1)!, /busy/);
  await store.patch('settings/alice', { mode: 'Available' });
  await engine.handle({ ...m, id: 'menu-open', text: 'menu' });
  await store.patch(path('conversations', 'alice', key(m.chatId)), {
    stateExpiresAt: Date.now() - 1,
  });
  await engine.handle({ ...m, id: 'late-selection', text: '1' });
  assert.notEqual(sent.at(-1), 'Custom price');
});

test('existing contacts get one daily menu, followed by keyword and no-match replies without menu cooldown', async () => {
  await store.set(path('contacts', 'alice', key(m.senderJid)), {
    id: key(m.senderJid),
    name: 'Existing customer',
    number: m.senderNumber,
    type: 'Normal',
    createdAt: Date.now() - 86400000,
  });
  await store.patch('settings/alice', {
    menuEnabled: true,
    defaultCooldownMinutes: 30,
    menuOptions: [{ label: 'Help', response: 'Help answer' }],
  });
  await engine.handle(m);
  assert.match(sent[0], /1\. Help/);
  await engine.handle({ ...m, id: 'keyword-next', text: 'price' });
  assert.equal(sent[1], 'Our pricing starts from ₹499.');
  // Keep this check independent of the normal reply throttle.
  await store.patch('settings/alice', { defaultCooldownMinutes: 0, fallbackCooldownMinutes: 0 });
  await engine.handle({ ...m, id: 'unknown-next', text: 'Something else entirely' });
  assert.match(sent.at(-1)!, /Thanks for contacting/);
  await engine.handle({ ...m, id: 'menu-command-again', text: 'menu' });
  assert.equal(sent.filter((text) => text.includes('1. Help')).length, 1);
  const conversation = (await store.get<Conversation>(
    path('conversations', 'alice', key(m.chatId)),
  ))!;
  assert.equal(conversation.menuLastSentDate, localDate('UTC'));
});
test('daily menu resets at local midnight, survives a new engine instance and accepts media as the first message', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-06T18:29:00Z') });
  await store.patch('settings/alice', {
    timezone: 'Asia/Kolkata',
    menuEnabled: true,
    menuOptions: [{ label: 'Help', response: 'Help answer' }],
  });
  await engine.handle({ ...m, type: 'image', text: undefined });
  assert.match(sent[0], /1\. Help/);
  const restarted = new ReceptionistEngine(async (_uid, _jid, text) => {
    sent.push(text);
    return 'restart-' + sent.length;
  });
  await restarted.handle({ ...m, id: 'same-day', text: 'menu' });
  assert.equal(sent.filter((text) => text.includes('1. Help')).length, 1);
  t.mock.timers.tick(120000);
  await restarted.handle({ ...m, id: 'next-local-day', text: 'price' });
  assert.equal(sent.filter((text) => text.includes('1. Help')).length, 2);
  const conversation = (await store.get<Conversation>(
    path('conversations', 'alice', key(m.chatId)),
  ))!;
  assert.equal(conversation.menuLastSentDate, '2026-10-07');
});

test('Stop for today pauses only the selected chat, persists across restart and resumes at local midnight', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-06T18:29:00Z') });
  await store.patch('settings/alice', {
    timezone: 'Asia/Kolkata',
    menuEnabled: true,
    menuOptions: [{ label: 'Help', response: 'Help answer' }],
    defaultCooldownMinutes: 30,
  });
  await engine.handle({ ...m, text: 'hello' });
  assert.match(sent[0], /0\. Stop for today/);
  await engine.handle({ ...m, id: 'stop-today', text: '0' });
  assert.match(sent[1], /paused for this chat/);
  assert.match(sent[1], /Asia\/Kolkata/);
  const stopped = (await store.get<Conversation>(path('conversations', 'alice', key(m.chatId))))!;
  assert.equal(stopped.receptionistStoppedDate, '2026-10-06');
  assert.equal(stopped.automationEnabled, true);
  assert.equal(stopped.needsHuman, false);
  const restarted = new ReceptionistEngine(async (_uid, _jid, text) => {
    sent.push(text);
    return 'resumed-' + sent.length;
  });
  await restarted.handle({ ...m, id: 'while-stopped', text: 'price' });
  assert.equal(sent.length, 2);
  assert.equal((await store.list(`messages/alice/${key(m.chatId)}`)).length, 5);
  await restarted.handle({
    ...m,
    id: 'other-chat',
    chatId: '911111111111@s.whatsapp.net',
    senderJid: '911111111111@s.whatsapp.net',
    senderNumber: '911111111111',
  });
  assert.match(sent.at(-1)!, /0\. Stop for today/);
  t.mock.timers.tick(120000);
  await restarted.handle({ ...m, id: 'tomorrow', text: 'hello' });
  assert.match(sent.at(-1)!, /0\. Stop for today/);
  await restarted.handle({ ...m, id: 'tomorrow-rule', text: 'price' });
  assert.equal(sent.at(-1), 'Our pricing starts from ₹499.');
});
test('Stop remains available after menu selection expiry and acknowledges once, even in Busy mode', async () => {
  await store.patch('settings/alice', {
    menuEnabled: true,
    mode: 'Busy',
    menuOptions: [{ label: 'Help', response: 'Help answer' }],
  });
  await engine.handle({ ...m, text: 'hello' });
  await store.patch(path('conversations', 'alice', key(m.chatId)), {
    stateExpiresAt: Date.now() - 1,
  });
  await engine.handle({ ...m, id: 'stop-word', text: 'STOP FOR TODAY' });
  assert.match(sent.at(-1)!, /paused for this chat/);
  await engine.handle({ ...m, id: 'stop-again', text: 'Stop' });
  assert.equal(sent.length, 2);
});
