import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityPoints, type AnalyticsData } from '../apps/web/src/lib/analytics';

test('today does not show a previous day’s hourly activity', () => {
  const data = {
    totals: {},
    daily: { '2026-10-05': { hours: { '10': { incoming: 12 } } } },
    hourTimezone: 'UTC',
  } as unknown as AnalyticsData;
  assert.equal(activityPoints(data, '1d', new Date('2026-10-06T00:30:00Z'))[10].incoming, 0);
  assert.equal(activityPoints(data, '1d', new Date('2026-10-05T23:30:00Z'))[10].incoming, 12);
});
test('report dates stay on UTC calendar days across a month boundary', () => {
  const points = activityPoints(undefined, '7d', new Date('2026-03-01T00:30:00Z'));
  assert.equal(points[0].name, 'Feb 23');
  assert.equal(points.at(-1)?.name, 'Mar 1');
  assert.equal(points.length, 7);
  assert.equal(activityPoints(undefined, '30d').length, 30);
});
