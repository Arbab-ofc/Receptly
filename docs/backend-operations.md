# Backend reliability and operations

The backend remains a single-server application. No team roles, distributed locks, or multi-instance connection ownership were introduced.

## Message recovery and delivery

Incoming events are persisted before processing. Processing claims have a two-minute lease, renew during active work, and can be recovered after a restart. Intake records, contact/conversation changes, and incoming counters are committed together. Recovery is bounded to five attempts with exponential backoff. Exhausted inputs remain available for diagnosis for 30 days.

Outgoing requests move through `prepared`, `sending`, `completed`, `failed`, or `uncertain`. The sending marker is persisted before invoking WhatsApp. Completed requests replay their saved result. The same request ID cannot be used for different content or a different conversation. Idempotency results are retained for seven days.

Only a failure known to occur before transmission, such as `WHATSAPP_DISCONNECTED`, is safe to retry automatically. Timeouts, interrupted sends, and confirmation-write failures remain uncertain. Reconcile these with message history before deliberately creating a new send request. Exactly-once external delivery is not promised.

Manual requests can be checked with `GET /api/v1/send-requests/:id`. The inbox retains the request ID for unchanged text while navigating within the signed-in browser session; it does not persist draft content or request state across browser reloads. `uncertain` messages display “Delivery unconfirmed”.

Follow-up jobs have renewable leases, bounded retry attempts, and failure codes. Closed business hours and timed pauses defer work rather than cancel it. Completed/cancelled/uncertain work moves to job history; retries reuse the same send intent. Customer replies cancel pending follow-ups in that conversation.

## Edits and pagination

Settings and library mutations are serialized within this process. Related lead/link changes are committed together. Optional `If-Match: "VERSION"` rejects a stale edit with `VERSION_CONFLICT`. New API-created records start at version 1; legacy records without versions are treated as version 0. Schedule reads expose their version in `ETag`. Read the latest record before resolving a conflict.

The settings, schedule, and resource editors send the version they loaded when saving. A conflict leaves the draft available and asks the user to refresh before saving again.

List endpoints support `page=true`, returning `{ items, nextCursor }`. Pass the opaque cursor and unchanged filters to continue. Cursors use both the ordering field and record key. Queries are bounded to 4,000 scanned records per request; sparse filters can return an empty page with a continuation cursor. Legacy array responses and numeric `before` remain supported.

Supported filters include `search`, conversation `filter=unread|human|paused|all`, lead `status`, and contact `type`. The inbox and resource libraries now use cursor pagination. There is no total-count query or external search index.

## Health, monitoring, and alerts

- `/api/health/live`: process liveness, HTTP 200 while responding.
- `/api/health/ready`: startup/dependency readiness, HTTP 503 while unavailable or shutting down.
- `/api/health`: backwards-compatible dependency summary.
- `/api/operations`: private aggregate counters, latency buckets, active streams, uptime, and last maintenance tick. Disabled unless `OPERATIONS_TOKEN` is configured. Requires that operator bearer token; Firebase user tokens are not sufficient.
- `/api/v1/diagnostics`: authenticated, workspace-specific failure summaries without message payloads.

Every API response has `X-Request-Id`; errors include the request ID. Logs redact authorization and request bodies. Alerts cover failed processing, uncertain sends, overdue follow-ups, exhausted reconnects, slow requests, server errors, and maintenance failures. Repeated alerts of the same type are throttled to once per minute, while counters retain all occurrences.

Set a random `OPERATIONS_TOKEN` of 32–256 letters/digits/underscores/hyphens in server administration. Optionally configure an HTTPS `ALERT_WEBHOOK_URL`; webhook bodies contain an alert code, safe diagnostic details, and timestamp, not customer message text or credentials. Alert delivery times out after five seconds. Aggregate counters reset on process restart; use your monitoring collector for historical retention.

`SEND_TIMEOUT_MS` defaults to 30,000. A send exceeding that deadline becomes uncertain, releasing the conversation queue without issuing a replacement send.

## Live streams

`SSE_MAX_CONNECTIONS_PER_USER` defaults to 3. Excess streams return `STREAM_LIMIT`. Streams preserve CORS/security headers, close before token expiration or after 45 minutes, and release listeners/timers on disconnect. Slow readers are disconnected instead of buffering unlimited events. Clients refresh their token and refetch current data after reconnect. There is no event replay log.

## Retention and account data

`MESSAGE_RETENTION_DAYS=0` and `LOG_RETENTION_DAYS=0` disable automatic message/log deletion. Enable an explicit positive retention period only after choosing a policy. Cleanup runs independently of WhatsApp connection status. Pending and uncertain messages are retained for reconciliation; stale conversation previews are removed when message retention applies. Job history is kept for 30 days; old completed operation markers are pruned after their documented retention period.

`GET /api/v1/account/export` returns the signed-in account’s settings and customer data, excluding linked-device credentials and private send fingerprints. This export reads collections sequentially; use an offline backup for a consistent recovery snapshot.

`DELETE /api/v1/account` requires a Firebase sign-in within five minutes and `{ "confirmation": "DELETE MY ACCOUNT" }`. It closes live streams, stops and unlinks WhatsApp, revokes tokens, deletes customer records, and deletes the Firebase Auth user. Interrupted deletion resumes during maintenance. A minimal server-only deletion marker remains to prevent delayed work or older backups from recreating deleted customer records. Deleted-account customer data is excluded during restore. Previously created exports and offsite backup copies must follow your separate retention policy.

## Encrypted backups and restore verification

Keep `BACKUP_ENCRYPTION_KEY` as a separate 32-byte hexadecimal secret. Do not store it beside the backup or put it in frontend variables. Backups use AES-256-GCM with authenticated integrity and include the database and local linked-device session files. Files are created with restricted permissions and existing backup files are never overwritten.

Use a maintenance window and stop the API before creating a snapshot so database writes and session files do not change during capture:

```sh
npm run backup -w @receptly/server -- --offline --output /secure/backups/receptly.enc
npm run restore-backup -w @receptly/server -- --input /secure/backups/receptly.enc
```

The second command validates and decrypts without modifying the database or sessions, printing only a timestamp and collection/file counts. A wrong key, modified ciphertext, or unsafe session filename is rejected. Firebase Auth users are managed separately and are not exported by the database backup.

For a recovery drill, use a separate Firebase project and an empty session directory. Verify the backup first, keep Receptly stopped, then explicitly apply:

```sh
npm run restore-backup -w @receptly/server -- --input /secure/backups/receptly.enc --apply --offline --replace-database
```

Applying replaces the target database. Session files are restored only into empty paths. Existing deletion markers are preserved and deleted accounts’ data/session files are excluded. A restore interrupted before completion should be repeated from an empty staging session directory. Start the service, check readiness, verify workspace isolation and record counts, and confirm connection status before reopening access. Periodically rehearse this procedure; no live backup or destructive restore is executed by the automated suite.

## Deployment and verification

Publish the updated `database.rules.json` indexes during deployment. New processing/claim indexes are server-only. Production credentials and operational secrets remain environment variables. Restart the backend after changing operational environment values, and rebuild the frontend for its cursor/status changes.

The automated suite explicitly excludes live Admin credentials and outbound alert destinations. It covers intake crash recovery, expired claims, uncertain sends, concurrent edits, pagination ties, validation consistency, live-stream headers/limits, retention, account isolation/deletion recovery, and encrypted backup integrity. Database behavior is tested with an isolated in-memory store; perform an emulator/staging check before deployment to validate Firebase indexes and live transport behavior.
