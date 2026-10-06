import { buildApp } from './app.js';
import { env, firebaseConfigured } from './config/env.js';
import { firebase } from './config/firebase.js';
import { paymentWhatsapp } from './modules/whatsapp/payment-sender.js';
import { whatsapp } from './modules/whatsapp/manager.js';
import { deleteApp, getApps } from 'firebase-admin/app';
import type { Logger } from 'pino';
import { startScheduler } from './jobs/scheduler.js';
import { monitoring } from './services/monitoring.js';
process.umask(0o077);
const app = buildApp();
let stopJobs: undefined | (() => Promise<void>);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  monitoring.setReady(false);
  app.log.info('Graceful shutdown started');
  await stopJobs?.();
  await paymentWhatsapp.shutdown();
  await whatsapp.shutdown();
  await app.close();
  for (const instance of getApps()) await deleteApp(instance);
  await new Promise<void>((resolve) => (app.log as Logger).flush(() => resolve()));
  process.exit(0);
}
process.on(
  'SIGINT',
  () =>
    void shutdown().catch((error) => {
      app.log.error(error);
      process.exit(1);
    }),
);
process.on(
  'SIGTERM',
  () =>
    void shutdown().catch((error) => {
      app.log.error(error);
      process.exit(1);
    }),
);
try {
  if (firebaseConfigured) {
    firebase();
    await whatsapp.restore();
    await paymentWhatsapp.restore();
    stopJobs = startScheduler();
  } else app.log.warn('Firebase not configured: public website and health endpoint only.');
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  monitoring.setReady(true);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
