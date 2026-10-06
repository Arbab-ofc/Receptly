import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matches,
  cooldownAllows,
  businessOpen,
  renderTemplate,
  humanIntent,
} from '../apps/server/src/modules/receptionist/logic.js';
import { normalize } from '../apps/server/src/modules/whatsapp/normalize.js';
import {
  defaultSettings,
  defaultHours,
  type Hours,
  holidaySchema,
  catalogSchema,
  catalogReply,
  localDate,
} from '@receptly/shared';
const rule = {
  caseSensitive: false,
  matchType: 'any_keyword' as const,
  patterns: ['price', 'cost', 'rate'],
};
test('multilingual pricing and configured location keywords', () => {
  assert.equal(matches('Price kya hai?', rule), true);
  assert.equal(
    matches('where is your shop?', { ...rule, patterns: ['where is your shop', 'location'] }),
    true,
  );
  assert.equal(matches('corporate', rule), false);
});
test('all rule match types, case sensitivity and escaped regex', () => {
  assert.equal(matches('HELLO', { ...rule, matchType: 'exact', patterns: ['hello'] }), true);
  assert.equal(
    matches('Hello there', { ...rule, matchType: 'starts_with', patterns: ['hello'] }),
    true,
  );
  assert.equal(
    matches('wholesale pricing', { ...rule, matchType: 'contains', patterns: ['pricing'] }),
    true,
  );
  assert.equal(matches('PRICE', { ...rule, caseSensitive: true }), false);
  assert.equal(
    matches('price and cost', { ...rule, matchType: 'all_keywords', patterns: ['price', 'cost'] }),
    true,
  );
  assert.equal(
    matches('price only', { ...rule, matchType: 'all_keywords', patterns: ['price', 'cost'] }),
    false,
  );
  assert.equal(matches('Is c++ available?', { ...rule, patterns: ['c++'] }), true);
});
test('cooldown has exact boundary behavior', () => {
  assert.equal(cooldownAllows(undefined, 30, 100), true);
  assert.equal(cooldownAllows(1000, 30, 1000 + 1799999), false);
  assert.equal(cooldownAllows(1000, 30, 1000 + 1800000), true);
});
const hours: Hours = Array.from({ length: 7 }, (_, day) => ({
  day,
  enabled: day === 1,
  open: '10:00',
  close: '20:00',
}));
for (const [time, expected] of [
  ['09:59', false],
  ['10:00', true],
  ['12:00', true],
  ['20:00', false],
  ['20:01', false],
] as const)
  test(`business hours ${time}`, () =>
    assert.equal(businessOpen(hours, 'UTC', new Date(`2026-10-05T${time}:00Z`)), expected));
test('closed day and timezone conversion', () => {
  assert.equal(businessOpen(hours, 'UTC', new Date('2026-10-04T12:00:00Z')), false);
  assert.equal(businessOpen(hours, 'Asia/Kolkata', new Date('2026-10-05T04:30:00Z')), true);
  assert.equal(businessOpen(hours, 'Asia/Kolkata', new Date('2026-10-05T14:30:00Z')), false);
});
test('overnight hours continue into a disabled following day', () => {
  const h = hours.map((d) => ({ ...d, open: '22:00', close: '02:00' }));
  assert.equal(businessOpen(h, 'UTC', new Date('2026-10-05T22:00:00Z')), true);
  assert.equal(businessOpen(h, 'UTC', new Date('2026-10-06T01:59:00Z')), true);
  assert.equal(businessOpen(h, 'UTC', new Date('2026-10-06T02:00:00Z')), false);
  assert.equal(businessOpen(h, 'UTC', new Date('2026-10-05T01:00:00Z')), false);
});
test('template variables have safe fallbacks and remove unknown markers', () => {
  const text = renderTemplate(
    'Hi {{name}}, welcome to {{business_name}}. {{missing}}',
    defaultSettings,
    defaultHours,
  );
  assert.equal(text, 'Hi there, welcome to My business. ');
  assert.equal(text.includes('{{'), false);
});
test('human intent matches whole words and phrases', () => {
  assert.equal(humanIntent('Can I speak to a human?', ['human']), true);
  assert.equal(humanIntent('humanitarian support', ['human']), false);
  assert.equal(humanIntent('I want to talk to someone', ['talk to someone']), true);
});
test('normalizes text, media, and ignores status/system events', () => {
  const base = {
    key: { remoteJid: '919876543210@s.whatsapp.net', id: 'one' },
    messageTimestamp: 123,
  };
  const text = normalize('alice', { ...base, message: { conversation: 'hello' } });
  assert.equal(text?.text, 'hello');
  assert.equal(text?.timestamp, 123000);
  assert.equal(
    normalize('alice', {
      ...base,
      message: { documentMessage: { fileName: 'brochure.pdf', mimetype: 'application/pdf' } },
    })?.mediaName,
    'brochure.pdf',
  );
  assert.equal(
    normalize('alice', {
      ...base,
      key: { ...base.key, remoteJid: 'status@broadcast' },
      message: { conversation: 'status' },
    }),
    null,
  );
  assert.equal(normalize('alice', { ...base, message: { protocolMessage: { type: 0 } } }), null);
});

test('holiday schema validates dates and special-hour boundaries', () => {
  for (const date of ['2026-02-30', '2025-02-29', '0000-01-01', '2026-13-01'])
    assert.equal(holidaySchema.safeParse({ name: 'Holiday', date }).success, false);
  assert.equal(holidaySchema.safeParse({ name: 'Leap day', date: '2028-02-29' }).success, true);
  assert.equal(
    holidaySchema.safeParse({
      name: 'Special',
      date: '2026-10-05',
      closed: false,
      open: '10:00',
      close: '10:00',
    }).success,
    false,
  );
});
test('holiday dates use business timezone and replace weekly hours', () => {
  const holiday = {
    ...holidaySchema.parse({ name: 'Festival', date: '2026-10-05' }),
    id: 'festival',
  };
  assert.equal(localDate('Asia/Kolkata', new Date('2026-10-04T20:00:00Z')), '2026-10-05');
  assert.equal(businessOpen(hours, 'UTC', new Date('2026-10-05T12:00:00Z'), [holiday]), false);
  assert.equal(
    businessOpen(hours, 'UTC', new Date('2026-10-05T12:00:00Z'), [{ ...holiday, enabled: false }]),
    true,
  );
  const special = { ...holiday, closed: false, open: '11:00', close: '13:00' };
  for (const [time, expected] of [
    ['10:59', false],
    ['11:00', true],
    ['12:59', true],
    ['13:00', false],
  ] as const)
    assert.equal(
      businessOpen(hours, 'UTC', new Date(`2026-10-05T${time}:00Z`), [special]),
      expected,
    );
  assert.match(
    renderTemplate(
      '{{business_hours}}',
      defaultSettings,
      hours,
      undefined,
      new Date('2026-10-05T12:00:00Z'),
      [special],
    ),
    /Festival.*11:00–13:00/,
  );
});
test('holiday closure blocks overnight spill; special overnight hours carry into ordinary dates', () => {
  const h = hours.map((d) => ({ ...d, open: '22:00', close: '02:00' }));
  const closed = { ...holidaySchema.parse({ name: 'Closed', date: '2026-10-06' }), id: 'closed' };
  assert.equal(businessOpen(h, 'UTC', new Date('2026-10-06T01:00:00Z'), [closed]), false);
  const special = { ...closed, date: '2026-10-05', closed: false, open: '21:00', close: '03:00' };
  assert.equal(businessOpen(hours, 'UTC', new Date('2026-10-06T02:59:00Z'), [special]), true);
  assert.equal(businessOpen(hours, 'UTC', new Date('2026-10-06T03:00:00Z'), [special]), false);
  assert.equal(
    businessOpen(h, 'UTC', new Date('2026-10-06T01:00:00Z'), [{ ...special, closed: true }]),
    false,
  );
});
test('catalog replies match names and keywords, respect enabled state and list item types', () => {
  const item = {
    ...catalogSchema.parse({ name: 'Haircut', kind: 'Service', price: 499, keywords: ['trim'] }),
    id: 'haircut',
  };
  const product = {
    ...catalogSchema.parse({ name: 'Shampoo', availability: 'Unavailable' }),
    id: 'shampoo',
  };
  assert.match(catalogReply('Can I get a TRIM?', [item])!, /Haircut.*499/);
  assert.equal(catalogReply('trimming', [item]), null);
  assert.equal(catalogReply('haircut', [{ ...item, enabled: false }]), null);
  assert.match(
    catalogReply('products', [item, product])!,
    /Shampoo.*Contact us for pricing.*Unavailable/,
  );
  assert.equal(catalogReply('products', [item, product])!.includes('Haircut'), false);
  assert.match(catalogReply('catalog', [item, product])!, /Haircut/);
  assert.equal(catalogSchema.safeParse({ name: 'Bad price', price: -1 }).success, false);
});
