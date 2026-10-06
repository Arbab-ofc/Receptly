import pino from 'pino';
import { env } from '../config/env.js';
const logger = pino({ level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' });
const counts: Record<string, number> = {};
const startedAt = Date.now();
let ready = false;
let lastSchedulerAt = 0;
let activeStreams = 0;
const alerted = new Map<string, number>();
export const monitoring = {
  increment(name: string, amount = 1) {
    counts[name] = (counts[name] || 0) + amount;
  },
  alert(code: string, details: Record<string, string | number> = {}) {
    this.increment(`alerts.${code}`);
    if (Date.now() - (alerted.get(code) || 0) > 60000) {
      alerted.set(code, Date.now());
      logger.warn({ alert: code, ...details }, 'Backend attention required');
      if (env.ALERT_WEBHOOK_URL)
        void fetch(env.ALERT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alert: code, details, timestamp: new Date().toISOString() }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => logger.error({ alert: code }, 'Alert delivery failed'));
    }
  },
  setReady(value: boolean) {
    ready = value;
  },
  schedulerTick() {
    lastSchedulerAt = Date.now();
  },
  stream(delta: number) {
    activeStreams += delta;
  },
  snapshot() {
    return {
      ready,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      lastSchedulerAt,
      activeStreams,
      counters: { ...counts },
    };
  },
};
