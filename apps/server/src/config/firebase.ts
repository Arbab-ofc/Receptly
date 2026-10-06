import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { env, firebaseConfigured } from './env.js';
export function firebase() {
  if (!firebaseConfigured)
    throw Object.assign(new Error('Firebase is not configured. Follow docs/firebase.md.'), {
      statusCode: 503,
      code: 'SERVICE_UNCONFIGURED',
    });
  if (!getApps().length)
    initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: env.FIREBASE_DATABASE_URL,
    });
  return { auth: getAuth(), db: getDatabase() };
}
