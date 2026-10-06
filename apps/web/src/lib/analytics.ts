import type { DailyAnalytics } from '@receptly/shared';

export interface AnalyticsData {
  totals: Record<string, number>;
  daily: Record<string, DailyAnalytics>;
  hourTimezone: string;
}
export function activityPoints(data: AnalyticsData | undefined, range = '7d', now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (range === '1d')
    return Array.from({ length: 24 }, (_, hour) => ({
      name: `${hour}:00`,
      incoming: data?.daily[today]?.hours?.[String(hour)]?.incoming || 0,
      autoReplies: data?.daily[today]?.hours?.[String(hour)]?.autoReplies || 0,
      manualReplies: data?.daily[today]?.hours?.[String(hour)]?.manualReplies || 0,
    }));
  const days = range === '30d' ? 30 : 7;
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1 + index),
    );
    const day = data?.daily[date.toISOString().slice(0, 10)];
    return {
      name: date.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      incoming: day?.incoming || 0,
      autoReplies: day?.autoReplies || 0,
      manualReplies: day?.manualReplies || 0,
    };
  });
}
