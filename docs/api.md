# HTTP API

Base: `/api/v1`. Public endpoints are `POST /contact`, `GET /billing/plans`, and the health endpoints outside this prefix. Other workspace endpoints require `Authorization: Bearer <Firebase ID token>`. The server derives the UID from the verified token. Responses use `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`. Validation failures return 400, expired/missing auth 401, missing records 404, disconnected transport or duplicate requests 409, unavailable services 503. No stack traces are returned.

| Method               | Path                                                                                                                     | Purpose                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| GET                  | `/api/health` (outside prefix)                                                                                           | Firebase availability, UTC timestamp                               |
| POST                 | `/contact`                                                                                                               | Store name/email/subject/message; 5 requests/15 minutes/IP         |
| GET                  | `/settings`                                                                                                              | Settings or safe defaults (automation off)                         |
| PATCH                | `/settings`                                                                                                              | Validate merged settings                                           |
| GET / PATCH          | `/schedule`                                                                                                              | Seven uniquely numbered day intervals (Sun=0)                      |
| GET                  | `/whatsapp/status`, `/whatsapp/qr`                                                                                       | Own connection state and ephemeral QR                              |
| POST                 | `/whatsapp/connect`, `/reconnect`, `/disconnect`, `/logout`                                                              | Connection lifecycle; use full `/whatsapp` prefix for every action |
| GET                  | `/conversations`                                                                                                         | Latest conversations; limit/before                                 |
| GET / PATCH          | `/conversations/:id`                                                                                                     | Detail; set notes/tags/unreadCount=0                               |
| GET                  | `/conversations/:id/messages`                                                                                            | Newest-first normalized messages; limit/before                     |
| POST                 | `/conversations/:id/messages`                                                                                            | `{ text, requestId: UUID }`; send manually once                    |
| POST                 | `/conversations/:id/pause-automation`                                                                                    | Pause conversation                                                 |
| POST                 | `/conversations/:id/resume-automation`                                                                                   | Resume, clear takeover and manual pause                            |
| GET / POST           | `/rules`, `/templates`, `/knowledgeBase`, `/catalog`, `/holidays`, `/contacts`, `/leads`                                 | List/create scoped resources                                       |
| GET / PATCH / DELETE | `/<resource>/:id`                                                                                                        | Read/update/delete scoped resource                                 |
| POST                 | `/rules/:id/duplicate`, `/templates/:id/duplicate`, `/knowledgeBase/:id/duplicate`, `/catalog/:id/duplicate`             | Disabled duplicate                                                 |
| PATCH                | `/rules/:id/toggle`, `/templates/:id/toggle`, `/knowledgeBase/:id/toggle`, `/catalog/:id/toggle`, `/holidays/:id/toggle` | `{ enabled: boolean }`                                             |
| GET                  | `/analytics?range=1d\|7d\|30d`                                                                                           | Daily UTC aggregates and totals; chart hours are UTC               |
| GET                  | `/logs`                                                                                                                  | Newest-first activity, limit/before                                |
| GET                  | `/events`                                                                                                                | Authenticated SSE, heartbeat every 20 seconds                      |

The public `/documentation` page includes searchable endpoint details, request examples, resource fields, live events, and error guidance. It also explains daily menus, reply priority, password recovery and billing.

Lists accept `page=true` to return `{ items, nextCursor }`; pass the opaque `cursor` with the same filters for the next page. Without page/cursor, workspace lists retain their array response. Billing and admin lists return paginated objects. Do not combine `before` and `cursor`. Lists accept `limit` (1–200, default 50) and timestamp `before` for newest-first pages. Conversations use `lastMessageAt`; messages/logs use `timestamp`. Configuration lists are bounded and intended for modest libraries; rules are sorted by `priority`, then ID for deterministic evaluation. Fields, enums, bounds and defaults are defined in `packages/shared/src/index.ts`. UI forms use the same schemas.

## Rule example

```json
{
  "name": "Pricing",
  "enabled": true,
  "priority": 1,
  "matchType": "contains",
  "patterns": ["price", "cost", "charges"],
  "caseSensitive": false,
  "response": "Our pricing starts from ₹499.",
  "replyTemplateId": "",
  "stopProcessing": true,
  "cooldownMinutes": null
}
```

Match types: `exact`, `contains`, `starts_with`, `keyword`, `any_keyword`, `all_keywords`. Keyword matches use Unicode word boundaries and escape pattern regex metacharacters. Templates allow `{{name}}`, `{{business_name}}`, `{{current_time}}`, `{{business_hours}}`; unknown tokens are removed.

SSE uses a fetch stream so the bearer token stays in a header, not a query string. Events are invalidation hints. The client batches invalidations, refetches canonical API data, reconnects after stream interruption, and refreshes tokens. No messages are sent on behalf of a different user.

## Billing and access

| Method | Path                    | Purpose                                                                                       |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/billing/plans`        | Public monthly ₹59 / yearly ₹650 plans                                                        |
| GET    | `/account/access`       | Admin flag and effective Free/Pro access                                                      |
| GET    | `/billing`              | Access, subscription, prices and recent payments                                              |
| GET    | `/billing/payments`     | Paginated own payment requests                                                                |
| GET    | `/billing/payments/:id` | Own payment, UPI link and QR                                                                  |
| POST   | `/billing/payments`     | `{ planId: "monthly" or "yearly", requestId: UUID }`                                          |
| PATCH  | `/billing/payments/:id` | `{ action: "submit", reference, expectedVersion }` or `{ action: "cancel", expectedVersion }` |

Amounts are integer paise. Creating a request is limited to 10/hour. Only pending requests can be submitted or cancelled. Submitted references are unique and queue notifications; approval requires actual bank-credit verification. An active same-plan purchase is blocked until expiry. A different approved plan starts after the current paid period; only one next plan is allowed. Automation requires effective Pro access; platform admins always have Pro.

## Platform admin

These routes require a Firebase token whose UID is configured in server `ADMIN_UIDS`. They can access platform records beyond the admin’s own workspace.

| Method | Path                                                                                                                                           | Purpose / body                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/admin/system`                                                                                                                                | Monitoring snapshot                                                 |
| GET    | `/admin/users`                                                                                                                                 | User/workspace list; limit 1–100 (default 25), cursor               |
| GET    | `/admin/users/:id`                                                                                                                             | User, workspace and recent analytics                                |
| PATCH  | `/admin/users/:id/plan`                                                                                                                        | `{ tier: "free" or "pro", expectedVersion }`; admin plans are fixed |
| PATCH  | `/admin/users/:id/automation`                                                                                                                  | `{ enabled, expectedVersion }` using settings version               |
| GET    | `/admin/enquiries`                                                                                                                             | Paginated support requests                                          |
| PATCH  | `/admin/enquiries/:id`                                                                                                                         | `{ status: "new" or "resolved", expectedVersion }`                  |
| GET    | `/admin/audit`                                                                                                                                 | Paginated admin audit log                                           |
| GET    | `/admin/payments`                                                                                                                              | Payment queue; optional paymentStatus filter                        |
| PATCH  | `/admin/payments/:id`                                                                                                                          | Approve/reject a submitted request                                  |
| GET    | `/admin/payment-whatsapp/status`                                                                                                               | Separate sender session, QR and recipient number                    |
| POST   | `/admin/payment-whatsapp/connect`, `/admin/payment-whatsapp/reconnect`, `/admin/payment-whatsapp/disconnect`, `/admin/payment-whatsapp/logout` | Separate payment-sender lifecycle                                   |

Approval body: `{ decision: "approve", expectedVersion, bankCreditVerified: true, verifiedAmountPaise, note }`. Rejection: `{ decision: "reject", expectedVersion, note }`, with a required nonempty note. Use the latest payment version. The verified amount must match the request.

## Additional workspace and operations routes

`GET /receptionist/status`, `GET /onboarding`, and `GET /diagnostics` expose setup and runtime information. `GET /account/export` exports workspace data. `DELETE /account` requires `{ confirmation: "DELETE MY ACCOUNT" }`. `GET /send-requests/:id` checks a manual-send operation; preserve request IDs rather than blindly resending uncertain deliveries.

Outside the versioned prefix, `GET /api/health/live` checks the process and `GET /api/health/ready` checks readiness. `GET /api/operations` requires the separately configured operator bearer token (`OPERATIONS_TOKEN`); it is disabled by default and returns 404 when unauthorized.

Send JSON content type only with a JSON body. For bodyless connection actions omit Content-Type, or send `{}`. An empty body with `Content-Type: application/json` is rejected. Settings and library updates support `If-Match: "<VERSION>"`; stale versions return `409 VERSION_CONFLICT`. Billing/admin bodies use `expectedVersion`.

The daily menu uses `menuEnabled`, `menuMessage`, and up to nine `menuOptions` with `{ label, response, action }`. Actions: `custom`, `pricing`, `opening_hours`, `closing_hours`; custom requires a nonempty response. The first eligible direct message per business-timezone day sends a numbered text menu. Stop for today is built in and applies only to that conversation until local midnight. After the menu, closed hours and non-Available modes precede option replies and keyword rules.

Password reset and password changes use the Firebase client SDK, not additional Receptly API endpoints. Google-linked accounts use Google account recovery; the in-app password change requires a password-provider account without Google linkage and reauthentication with its current password.

Created By Arbab Arshad
