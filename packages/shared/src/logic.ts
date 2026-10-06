import type { Hours, Rule, Settings, Holiday, CatalogItem } from './index.js';
export function matches(
  text: string,
  rule: Pick<Rule, 'caseSensitive' | 'matchType' | 'patterns'>,
) {
  const input = rule.caseSensitive ? text : text.toLocaleLowerCase();
  const patterns = rule.patterns.map((p) => (rule.caseSensitive ? p : p.toLocaleLowerCase()));
  const word = (p: string) =>
    new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`,
      'u',
    ).test(input);
  switch (rule.matchType) {
    case 'exact':
      return patterns.some((p) => input.trim() === p);
    case 'contains':
      return patterns.some((p) => input.includes(p));
    case 'starts_with':
      return patterns.some((p) => input.startsWith(p));
    case 'keyword':
    case 'any_keyword':
      return patterns.some(word);
    case 'all_keywords':
      return patterns.every(word);
  }
}
export function cooldownAllows(last: number | undefined, minutes: number, now = Date.now()) {
  return !last || now - last >= minutes * 60000;
}
export function localDate(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function holidayForDate(holidays: Holiday[], timeZone: string, now = new Date()) {
  return holidays.find((h) => h.enabled && h.date === localDate(timeZone, now));
}
export function businessOpen(
  hours: Hours,
  timeZone: string,
  now = new Date(),
  holidays: Holiday[] = [],
) {
  const date = localDate(timeZone, now);
  const calendar = new Date(`${date}T00:00:00Z`);
  const day = calendar.getUTCDay();
  calendar.setUTCDate(calendar.getUTCDate() - 1);
  const previousDate = calendar.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const minute =
    Number(parts.find((p) => p.type === 'hour')?.value) * 60 +
    Number(parts.find((p) => p.type === 'minute')?.value);
  const toMinutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const holiday = holidays.find((h) => h.enabled && h.date === date);
  const previousHoliday = holidays.find((h) => h.enabled && h.date === previousDate);
  const current = holiday
    ? { ...holiday, enabled: !holiday.closed }
    : hours.find((h) => h.day === day);
  const previous = previousHoliday
    ? { ...previousHoliday, enabled: !previousHoliday.closed }
    : hours.find((h) => h.day === (day + 6) % 7);
  // A date override replaces the entire date, including incoming overnight hours.
  if (
    !holiday &&
    previous?.enabled &&
    toMinutes(previous.open) > toMinutes(previous.close) &&
    minute < toMinutes(previous.close)
  )
    return true;
  if (!current?.enabled) return false;
  const open = toMinutes(current.open),
    close = toMinutes(current.close);
  return open < close ? minute >= open && minute < close : open > close && minute >= open;
}
export function catalogItemLabel(item: CatalogItem) {
  const price =
    item.price === null
      ? 'Contact us for pricing'
      : new Intl.NumberFormat('en', { style: 'currency', currency: item.currency }).format(
          item.price,
        );
  return `${item.name} — ${price} · ${item.availability}${item.description ? `\n${item.description}` : ''}`;
}
export function catalogReply(input: string, catalog: CatalogItem[]) {
  const items = catalog
    .filter((item) => item.enabled)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const match = (patterns: string[]) =>
    matches(input, { caseSensitive: false, matchType: 'any_keyword', patterns });
  const specific = items.filter((item) => match([item.name, ...item.keywords]));
  if (specific.length)
    return specific.slice(0, 3).map(catalogItemLabel).join('\n\n').slice(0, 10000);
  if (!match(['catalog', 'catalogue', 'products', 'services'])) return null;
  const filtered = items.filter(
    (item) =>
      match(['catalog', 'catalogue']) || match([item.kind === 'Product' ? 'products' : 'services']),
  );
  if (!filtered.length) return null;
  return `Our catalog:\n${filtered
    .slice(0, 20)
    .map((item) => catalogItemLabel({ ...item, description: '' }))
    .join(
      '\n',
    )}\n${filtered.length > 20 ? 'More items are available. ' : ''}Ask about an item for details.`.slice(
    0,
    10000,
  );
}
export function formatClockTime(value: string) {
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return value;
  }
  const period = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`;
}
export function hoursLabel(hours: Hours) {
  return (
    hours
      .filter((h) => h.enabled)
      .map(
        (h) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][h.day]} ${formatClockTime(h.open)}–${formatClockTime(h.close)}`,
      )
      .join(', ') || 'Please contact us for our business hours'
  );
}
export function renderTemplate(
  content: string,
  settings: Settings,
  hours: Hours,
  name?: string,
  now = new Date(),
  holidays: Holiday[] = [],
) {
  const variables: Record<string, string> = {
    name: name || 'there',
    business_name: settings.businessName || 'our business',
    current_time: new Intl.DateTimeFormat('en', {
      timeZone: settings.timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(now),
    business_hours: (() => {
      const holiday = holidayForDate(holidays, settings.timezone, now);
      return holiday
        ? `${holiday.name} (${holiday.date}): ${holiday.closed ? 'closed' : `${formatClockTime(holiday.open)}–${formatClockTime(holiday.close)}${holiday.open > holiday.close ? ' (next day)' : ''}`}`
        : hoursLabel(hours);
    })(),
  };
  return content.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, v: string) => variables[v] || '');
}
export function humanIntent(text: string, keywords: string[]) {
  return matches(text, { caseSensitive: false, matchType: 'any_keyword', patterns: keywords });
}
export interface FallbackResponder {
  generate(text: string, context: { userId: string; chatId: string }): Promise<string | null>;
}
export class DisabledFallbackResponder implements FallbackResponder {
  async generate() {
    return null;
  }
}
