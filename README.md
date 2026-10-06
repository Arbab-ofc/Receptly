# Receptly

**Your Smart WhatsApp Receptionist.** Turn WhatsApp Into Your Front Desk.

A light, responsive business messaging application: a React marketing website and dashboard, Firebase email/password authentication, a Fastify API, Firebase Realtime Database persistence, and per-user Baileys linked-device sessions. The server handles messages independently of the dashboard and restores valid sessions after restart.

## Included

Marketing, features, contact, login/registration, privacy, terms, setup guide and 404; protected dashboard; rules, templates, FAQ knowledge base, contacts and lead editing; timezone-aware weekly schedules; global and per-chat automation; six receptionist modes; closed-hours replies; contextual menus; human takeover; cooldowns; manual messaging; lead capture; persistent follow-ups; aggregate analytics and activity; authenticated SSE; QR/reconnect/disconnect/logout; session persistence; validated contact request storage; deployment configurations and tests.

The public product preview is explicitly illustrative. Dashboard metrics come from server-written aggregates and show zero/empty states before activity exists. There is no demo-auth bypass or privileged Firebase credential in the client.

## Local development

Node **22.18+**, npm **11**, a Firebase project with Email/Password Authentication and Realtime Database, and a WhatsApp account to link.

```bash
npm ci
cp .env.example .env
# Fill in Firebase variables (see docs/firebase.md).
npm run build
npm run dev
```

- Website: **http://localhost:5173**
- Backend: **http://localhost:3001**
- Health: **http://localhost:3001/api/health**

Separate processes:

```bash
npm run dev -w @receptly/web
npm run dev -w @receptly/server
```

Without Firebase values, the public site still runs, sign-in explains the setup requirement, and health reports degraded status. Authenticated functionality and contact submission require Firebase. Production startup requires Admin configuration. Do not commit `.env` or service-account/session files.

## Connect your WhatsApp

Register at `/register`, save your business name/timezone, then open **WhatsApp → Connect WhatsApp**. On your phone choose **WhatsApp → Settings/Menu → Linked Devices → Link a Device** and scan the QR. Configure business hours and reviewed rules, then enable the receptionist. Groups are disabled initially. Close the dashboard: the backend continues processing. Keep the backend/VPS running.

`Disconnect` stops the socket but preserves credentials. `Unlink account` removes your session and requires a fresh QR scan. Sessions live under `WHATSAPP_SESSION_DIR/user_<SHA256(uid)>/` (relative paths resolve against server working directory; use an absolute path in production). Directories are 0700 and auth files 0600. Never serve this directory via HTTP.

## Verify and build

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run format
```

Tests cover rule types, cooldown boundaries, open/close boundaries, timezone conversion, overnight schedules, safe template substitution, human detection, normalization, duplicate suppression, closed-hours termination, context-bound menus, manual pause, failed transport, authenticated API CRUD and tenant isolation. API/engine tests use a deterministic in-memory storage adapter and stub transport; they do not prove live Firebase/WhatsApp connectivity.

Production build outputs: `apps/web/dist` and `apps/server/dist`. Start the built backend:

```bash
npm run start -w @receptly/server
```

Use [deployment instructions](docs/deployment.md) for Linux, systemd/PM2, Nginx, HTTPS, firewall and session backups. Exactly one server process owns sessions.

## Repository

```text
apps/web/         React, TypeScript, Vite, Tailwind, Query, RHF, Zod, Zustand, Recharts
apps/server/      Fastify, Firebase Admin, Baileys, Pino, scheduler and engine
packages/shared/  Runtime schemas, defaults and domain models
packages/config/  Shared project conventions
tests/            Domain and API tests
Deploy files: deploy/nginx.conf, deploy/ecosystem.config.cjs, deploy/receptly.service
Database: database.rules.json, firebase.json
```

- [Firebase setup](docs/firebase.md)
- [Architecture and delivery guarantees](docs/architecture.md)
- [API reference](docs/api.md)
- [VPS deployment](docs/deployment.md)
- [QA and live acceptance](docs/qa.md)

## Troubleshooting

**Sign-in setup notice:** fill `VITE_FIREBASE_*`, enable Email/Password, authorize your hostname, restart Vite (or rebuild production).

**503 API:** check server Firebase project/email/private key/database URL. Escape private-key newlines as `\n` in `.env`. Read backend logs without printing secrets.

**QR not available:** wait for connection initialization, use Get a new code/Reconnect, and check outbound connectivity. QR is ephemeral and regenerates; it is not stored in Firebase.

**Session ended:** a logged-out, replaced, forbidden or invalid session does not retry forever. Unlink/reconnect and scan again. Temporary network failures retry with bounded exponential backoff.

**No reply:** check global enabled status, contact VIP/ignore/block, conversation automation/takeover, manual pause window, timezone/business hours, current mode, rule enablement, template enablement, and cooldown. Logs record failures.

**Message failed/pending after restart:** do not blindly replay. Transport and database writes cannot be atomic. Review the chat and send manually if needed. V1 uses at-most-once claims to prevent duplicate receptionist replies; crashes can leave an unanswered message. See architecture documentation.

**Realtime behind Nginx:** ensure proxy buffering is off and read timeout allows long SSE streams. API refetching and stream reconnect recover from short interruptions.

**Protocol upgrades:** this build resolves Baileys 7.0.0-rc14 and uses its installed types. Test a new version against a dedicated WhatsApp account before upgrading. This transport is unofficial and connectivity may change with WhatsApp.

No deployment, live QR scan, external account registration, or real customer messaging has been performed without configuration. Complete `docs/qa.md` on the target Firebase/VPS before using the service with customers.

### Catalog and holiday schedules

Use **Catalog** in the dashboard to add products or services with a price (or leave it blank for contact-based pricing), currency, availability, category and optional matching keywords. Enabled entries answer direct-message enquiries matching their names or keywords. Customers can ask for “catalog”, “products” or “services” to browse. Explicit reply rules take priority; business hours, handover, pause and cooldown controls still apply.

Use **Holidays** to create one override per calendar date in your configured business timezone. Close for the day or set special hours, including overnight hours. An override replaces that entire date’s weekly schedule, including incoming overnight hours. Special overnight hours continue into the next ordinary day; another date override takes priority. An optional holiday reply replaces your usual closed-hours response when that response is enabled. Automated follow-ups defer while closed. `{{business_hours}}` describes the active date override.

Authenticated CRUD routes are `/api/v1/catalog` and `/api/v1/holidays`, with `/:id/toggle` for both and `/:id/duplicate` for catalog entries. Each library supports 200 entries and version checks via `If-Match`. Both are included in account export and deletion. Deploy the updated `database.rules.json` indexes with the server changes.

### Platform admin panel

The admin panel is available at `/dashboard/admin`. Sign in with an existing Firebase account whose UID appears in the server-only `ADMIN_UIDS` environment variable, for example `ADMIN_UIDS=first-admin-uid,second-admin-uid`. Restart the server after changing this variable. Find UIDs in Firebase Console → Authentication → Users. Admin permissions are checked on every API request; empty configuration grants nobody admin access. The sidebar link appears only for authorized admins.

Admins can browse paginated Firebase accounts and workspace summaries, inspect recent daily usage, pause or enable workspace automation, review and resolve public contact enquiries, and inspect process health and an admin audit log. Automation changes preserve the workspace's existing rules, schedules and cooldowns. Enquiry resolution changes internal status and does not send an email or WhatsApp message. Changes require the current record version and write an audit record atomically. This panel also reviews subscription payments; it does not grant staff roles.

Admin API routes (Firebase bearer token required):

- `GET /api/v1/account/access` returns the signed-in user's platform-admin access.
- `GET /api/v1/admin/users?limit=25&cursor=...` lists accounts (maximum page size 100).
- `GET /api/v1/admin/users/:uid` returns identity, workspace summary and recent daily activity.
- `PATCH /api/v1/admin/users/:uid/automation` accepts `{ "enabled": false, "expectedVersion": 3 }`.
- `GET /api/v1/admin/enquiries` and `GET /api/v1/admin/audit` support cursor pagination.
- `PATCH /api/v1/admin/enquiries/:id` accepts `{ "status": "resolved", "expectedVersion": 0 }`; status can be `new` or `resolved`.
- `GET /api/v1/admin/system` returns live process readiness and operational counters.

Deploy the updated database rules for the admin audit index. Admin audit records and support enquiries remain accessible only through server-authorized routes; the browser never receives Firebase service credentials or the operations token.

### Subscriptions and manual UPI payments

`/pricing` offers **₹59/month** and **₹650/year** (same features; ₹58 annual saving). Signed-in customers use `/dashboard/billing` to select a plan, scan the UPI QR, submit a transaction reference and track verification. Plans do not renew automatically. Payment amounts are fixed on the server, in paise.

Configure these server-only values in `.env`, then restart the server:

```dotenv
PAYMENT_UPI_ID=your-real-upi-id@bank
PAYMENT_PAYEE_NAME=Your actual recipient name
```

Payment requests stay disabled until both recipient fields are configured. Automatic replies and follow-ups always require Pro access: an approved, unexpired paid subscription or a complimentary admin grant. Free users can still receive messages, send manual replies and manage their account. Follow-ups defer without consuming retries while access is inactive.

In **Admin panel → Users & workspaces**, use the **Pro access** toggle to grant Pro without payment. Platform admins configured in `ADMIN_UIDS` always have Pro, without payment or expiry. Their plan toggle is locked and server routes reject attempts to downgrade them. Removing a UID from the admin allowlist restores normal paid/granted access rules. Complimentary Pro for normal users lasts until revoked. Switching to Free also ends any current paid subscription immediately; payment history is retained. A later approved payment can activate Pro again. All changes require the current access version and are recorded in the audit log. `PATCH /api/v1/admin/users/:uid/plan` accepts `{ "tier": "pro", "expectedVersion": 0 }` (or `"free"`). The server ignores the old `BILLING_ENFORCED` setting; it cannot bypass Pro checks.

In **Admin panel → Subscription payments**, verify the reference and exact credited amount in your bank account, then approve or reject. Submitting a reference alone never activates access. Approval atomically records the review, audit entry and subscription. Monthly periods use calendar months; yearly periods use twelve calendar months, clamping month-end dates. An active plan cannot be purchased again until it expires. Buying the other plan schedules one prepaid next period after the current period ends; the current plan remains visible until that boundary, then the next plan takes over automatically. A scheduled next period blocks further purchases until it expires. Repeated approvals cannot add a second period, and duplicate transaction references are reserved across workspaces.

Deploy the billing indexes in `database.rules.json` with the server. Billing collections are accessible only through authenticated server routes. The deployment requires one server process, matching the existing in-process write-lock architecture; multiple writers require distributed locking before rollout. No gateway, automatic collection, automatic refunds or bank-verification integration is included.

Billing API routes:

- `GET /api/v1/billing/plans` publicly lists the two fixed plans.
- `GET /api/v1/billing` returns subscription status, recipient configuration status and recent requests.
- `GET /api/v1/billing/payments` supports cursor pagination; `GET /api/v1/billing/payments/:id` returns the owned request, UPI link and QR.
- `POST /api/v1/billing/payments` accepts `{ "planId": "monthly", "requestId": "client-generated-uuid" }` for retry-safe creation.
- `PATCH /api/v1/billing/payments/:id` accepts `{ "action": "submit", "reference": "UTR123456789", "expectedVersion": 1 }`, or `{ "action": "cancel", "expectedVersion": 1 }` for unpaid requests.
- `GET /api/v1/admin/payments?paymentStatus=submitted` lists the review queue with cursor pagination.
- `PATCH /api/v1/admin/payments/:id` approves with `{ "decision": "approve", "expectedVersion": 2, "bankCreditVerified": true, "verifiedAmountPaise": 5900 }`, or rejects with `{ "decision": "reject", "expectedVersion": 2, "note": "Reason" }`.

Account exports include subscriptions and payment history. Account deletion removes tenant billing records and global review queue entries. Hashed transaction-reference reservations remain to prevent replay; they contain no customer identity or raw reference.

### WhatsApp payment-review alerts

When a customer submits a UTR/reference, the server atomically queues one notification with the payment submission. Opening a payment request does not send an alert. Subscription approval remains manual.

Configure only the receiving number in server `.env`, then restart:

```dotenv
PAYMENT_NOTIFY_WHATSAPP_NUMBER=919876543210
```

Use country code and digits only, without `+`. In **Admin panel → Subscription payments → Payment notification WhatsApp**, click **Connect payment WhatsApp**, then scan its QR with the separate payment-alert phone using WhatsApp → Linked Devices → Link a Device. This is a platform connection managed only by admins. It has its own socket, QR, persisted credentials and reconnect/unlink controls. Incoming messages on this sender never enter the receptionist engine. Connecting or unlinking it does not alter any workspace automation connection. The old `PAYMENT_NOTIFY_WHATSAPP_UID` setting is ignored; workspace connections are never used for alerts.

The alert includes customer name/email/UID, selected monthly/yearly plan and exact amount, payment ID, UTR and submission time. It explicitly says bank credit is unverified and directs you to Admin panel → Subscription payments. The queue is checked every minute. Missing recipient settings or disconnection keep requests queued. Safe failures retry with bounded backoff; ambiguous delivery or restart after dispatch is recorded as uncertain and is not automatically resent. Alert status appears in the review queue. Already-reviewed payments are skipped, and customer account deletion removes their queue/history records.

The payment sender restores independently on server startup and closes during graceful shutdown. Its credentials use `payment_` directories, separate from `user_` workspace credentials, with the same restricted file permissions. Encrypted backup/restore includes both namespaces. Deploy the updated server-only `paymentWhatsApp` rules alongside the notification queue index. Admin-only connection routes are `GET /api/v1/admin/payment-whatsapp/status` and `POST /api/v1/admin/payment-whatsapp/{connect,reconnect,disconnect,logout}`. QR codes remain in memory and are returned only through the admin status route.

This reuses the existing Baileys WhatsApp Web transport without a paid Cloud API integration. Hosting still costs money; this unofficial transport's availability is not guaranteed. A real phone must be linked before live alerts can send.

### WhatsApp numbered menu

In Settings → Replies & menu, enable the WhatsApp menu and use **Add pricing & hours menu** to populate editable options. Save settings to enable it. Pricing uses enabled catalog items; opening and closing times use today's business schedule or holiday override. Custom replies remain available. Each new or existing contact receives the menu on their first eligible message of each calendar day, using the business timezone. Subsequent messages use option numbers/names, keyword rules or the default reply; commands and unmatched messages do not resend the menu that day. Selections remain active for 30 minutes. Menu greetings and selections bypass and do not start the normal reply cooldown. The daily greeting precedes Busy and closed-hours replies; Pro access, automation settings, human handover and manual pauses still apply. The current QR transport sends a text menu, not native clickable WhatsApp buttons.

Every menu also includes **0. Stop for today**. After receiving today's menu, the customer can send `0`, `Stop`, or `Stop for today` to pause automated replies for that chat until midnight in the business timezone. Incoming messages continue to appear in the inbox, manual replies remain available, and queued follow-ups for the stopped chat are cancelled. Other chats and the global automation switch are unaffected. The date marker persists across server restarts and expires automatically the next day.

## Credits

Created By Arbab Arshad
