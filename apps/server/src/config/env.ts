import 'dotenv/config';
import { z } from 'zod';
export const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ADMIN_UIDS: z
      .string()
      .refine(
        (v) => v.split(',').every((uid) => !uid.trim() || /^[\w-]{1,200}$/.test(uid.trim())),
        'Use comma-separated Firebase user UIDs.',
      )
      .default(''),
    PAYMENT_UPI_ID: z
      .string()
      .trim()
      .refine(
        (v) => !v || /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test(v),
        'Use a valid UPI ID.',
      )
      .default(''),
    PAYMENT_PAYEE_NAME: z.string().trim().max(120).default(''),
    PAYMENT_NOTIFY_WHATSAPP_NUMBER: z
      .string()
      .trim()
      .regex(/^(?:[1-9]\d{7,14})?$/, 'Use country code and digits only, without +.')
      .default(''),

    PORT: z.coerce.number().default(3001),
    WEB_ORIGIN: z
      .string()
      .default(
        'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174',
      ),
    FIREBASE_PROJECT_ID: z.string().default(''),
    FIREBASE_CLIENT_EMAIL: z.string().default(''),
    FIREBASE_PRIVATE_KEY: z.string().default(''),
    FIREBASE_DATABASE_URL: z.string().default(''),
    WHATSAPP_SESSION_DIR: z.string().default('./data/whatsapp-sessions'),
    MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
    LOG_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
    SSE_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().min(1).max(20).default(3),
    SEND_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    ALERT_JOB_AGE_MINUTES: z.coerce.number().int().min(1).default(60),
    OPERATIONS_TOKEN: z
      .string()
      .refine(
        (v) => !v || /^[A-Za-z0-9_-]{32,256}$/.test(v),
        'Use a random operator token of 32–256 letters, digits, underscores, or hyphens.',
      )
      .default(''),
    ALERT_WEBHOOK_URL: z
      .union([
        z.url().refine((v) => v.startsWith('https://'), 'Use HTTPS for alerts.'),
        z.literal(''),
      ])
      .default(''),
  })
  .parse(process.env);
export const firebaseConfigured = !!(
  env.FIREBASE_PROJECT_ID &&
  env.FIREBASE_DATABASE_URL &&
  env.FIREBASE_CLIENT_EMAIL &&
  env.FIREBASE_PRIVATE_KEY
);
if (env.NODE_ENV === 'production' && !firebaseConfigured)
  throw new Error('Firebase Admin configuration is required in production.');
