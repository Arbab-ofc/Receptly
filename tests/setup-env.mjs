// Tests must never inherit live Firebase Admin credentials or outbound alert destinations.
Object.assign(process.env, {
  NODE_ENV: 'test',
  FIREBASE_PROJECT_ID: '',
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
  FIREBASE_DATABASE_URL: '',
  ALERT_WEBHOOK_URL: '',
  OPERATIONS_TOKEN: '',
  ADMIN_UIDS: '',
  PAYMENT_UPI_ID: '',
  PAYMENT_PAYEE_NAME: '',
  PAYMENT_NOTIFY_WHATSAPP_NUMBER: '',
  MESSAGE_RETENTION_DAYS: '0',
  LOG_RETENTION_DAYS: '0',
});
