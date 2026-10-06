# HTTP API

Base: `/api/v1`. All endpoints except `POST /contact` require `Authorization: Bearer <Firebase ID token>`. The server derives the UID from the verified token. Responses use `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`. Validation failures return 400, expired/missing auth 401, missing records 404, disconnected transport or duplicate requests 409, unavailable services 503. No stack traces are returned.

| Method               | Path                                                                               | Purpose                                                            |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| GET                  | `/api/health` (outside prefix)                                                     | Firebase availability, UTC timestamp                               |
| POST                 | `/contact`                                                                         | Store name/email/subject/message; 5 requests/15 minutes/IP         |
| GET                  | `/settings`                                                                        | Settings or safe defaults (automation off)                         |
| PATCH                | `/settings`                                                                        | Validate merged settings                                           |
| GET / PATCH          | `/schedule`                                                                        | Seven uniquely numbered day intervals (Sun=0)                      |
| GET                  | `/whatsapp/status`, `/whatsapp/qr`                                                 | Own connection state and ephemeral QR                              |
| POST                 | `/whatsapp/connect`, `/reconnect`, `/disconnect`, `/logout`                        | Connection lifecycle; use full `/whatsapp` prefix for every action |
| GET                  | `/conversations`                                                                   | Latest conversations; limit/before                                 |
| GET / PATCH          | `/conversations/:id`                                                               | Detail; set notes/tags/unreadCount=0                               |
| GET                  | `/conversations/:id/messages`                                                      | Newest-first normalized messages; limit/before                     |
| POST                 | `/conversations/:id/messages`                                                      | `{ text, requestId: UUID }`; send manually once                    |
| POST                 | `/conversations/:id/pause-automation`                                              | Pause conversation                                                 |
| POST                 | `/conversations/:id/resume-automation`                                             | Resume, clear takeover and manual pause                            |
| GET / POST           | `/rules`, `/templates`, `/knowledgeBase`, `/contacts`, `/leads`                    | List/create scoped resources                                       |
| GET / PATCH / DELETE | `/<resource>/:id`                                                                  | Read/update/delete scoped resource                                 |
| POST                 | `/rules/:id/duplicate`, `/templates/:id/duplicate`, `/knowledgeBase/:id/duplicate` | Disabled duplicate                                                 |
| PATCH                | `/rules/:id/toggle`, `/templates/:id/toggle`, `/knowledgeBase/:id/toggle`          | `{ enabled: boolean }`                                             |
| GET                  | `/analytics?range=1d\|7d\|30d`                                                     | Daily UTC aggregates and totals; chart hours are UTC               |
| GET                  | `/logs`                                                                            | Newest-first activity, limit/before                                |
| GET                  | `/events`                                                                          | Authenticated SSE, heartbeat every 20 seconds                      |

Lists accept `limit` (1–200, default 50) and timestamp `before` for newest-first pages. Conversations use `lastMessageAt`; messages/logs use `timestamp`. Configuration lists are bounded and intended for modest libraries; rules are sorted by `priority`, then ID for deterministic evaluation. Fields, enums, bounds and defaults are defined in `packages/shared/src/index.ts`. UI forms use the same schemas.

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
