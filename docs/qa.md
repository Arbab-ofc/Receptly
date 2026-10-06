# QA and live acceptance

## Completed automated checks

- Strict TypeScript compilation, ESLint, and production builds.
- 33 domain, API and filesystem-session tests using controlled storage/transport adapters.
- Public homepage horizontal-overflow checks at 320, 360, 375, 390, 430, 640, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920 and 2560px.
- Other public routes at 320, 768 and 1440px; mobile menu; four contact validation errors; logged-out dashboard redirects to login.
- Protected routes passed 117 overflow checks: 13 routes at 320, 375, 390, 430, 768, 1024, 1280, 1440 and 1920px. Browser interaction checks passed rule creation, mobile inbox, customer details sheet, rule empty state and API error state.
- Visual review of desktop and mobile marketing, authentication, dashboard, connection and schedule layouts. Browser-only fixtures are explicitly synthetic and never added to the running application or database.

Run local checks:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Browser QA requires the development server (`npm run dev`) and the Playwright CLI:

```bash
npx --yes --package @playwright/cli playwright-cli open http://localhost:5173
node tests/run-browser-qa.mjs public
node tests/run-browser-qa.mjs dashboard
```

Screenshots/reports are saved under ignored `output/playwright/`. Dashboard checks stub REST/SSE and set the client auth store inside the QA browser only. Server token verification remains required in every real request. The browser fixture method uses Vite's development source modules and is intentionally unavailable in production builds. API tests independently verify authentication, authorization and real route behavior against an in-memory repository.

## Required live acceptance on your configured project

These checks need Firebase credentials, a linked WhatsApp account, another phone/account, and the actual VPS. They have **not** been completed by offline/stub tests.

1. Register a new account; sign out/in; refresh and confirm auth persistence. Access `/dashboard` logged out and verify login redirection. Confirm an invalid token and another UID cannot read a user's records.
2. Save business name/timezone and each working day's interval. Create an enabled Pricing rule matching `price,cost,charges` with `Our pricing starts from ₹499.`. Add a custom template and FAQ.
3. Connect WhatsApp, scan the current QR, and verify account/status display. Close the browser. Send `Hi, what is the price?` from a second account. Confirm one reply and one normalized incoming record, contact, lead, trigger count, log, and analytics increment.
4. Send more messages inside cooldown; confirm no repeated receptionist spam. Repeat the same event in a test integration; confirm its persisted ID claim suppresses duplicate processing.
5. Set closed hours and send a message. Confirm only the closed-hours reply, followed by cooldown suppression. Test exactly opening/closing and overnight intervals in your timezone.
6. Send `Can I speak to a human?`. Verify one acknowledgement, Needs Human, and paused chat automation. Send a second customer message; confirm no automatic reply. Resume in the inbox and verify normal behavior returns.
7. Send a manual reply from the inbox. Confirm it reaches WhatsApp, persists as manual, and pauses automation for the configured interval. Send from the owner's phone and confirm it is also normalized as manual, without duplicating dashboard-origin messages.
8. Add or update a VIP/Ignore/Blocked contact. Verify it remains visible but receives no automation according to settings. Confirm default groups receive no replies; enabling groups requires dedicated group rules and never uses direct-message fallback.
9. Restart the service. Verify authenticated sessions reconnect without rescanning. Disconnect (preserves credentials), reconnect, then unlink (requires a fresh QR). Revoke a linked device from your phone and verify terminal logout does not loop.
10. Check Firebase/SSE with Nginx/HTTPS, token expiry/revocation, slow/failed transport, network reconnect, follow-up cancellation, and graceful SIGTERM. Review failed/pending send records manually: claims deliberately avoid automatic ambiguous resends.
11. At 320, 375, 390, 430, 768, 1024, 1280, 1440 and 1920px, check each dashboard page, rules dialog, delete confirmation, QR card, mobile navigation and inbox list→chat→details→back. Use keyboard navigation and visible focus indicators.
12. Review privacy/terms and your contact/support configuration, backups, database retention, service monitoring and Firebase quotas before customer launch.

## Boundaries

Single backend process, at most 200 rules/templates/FAQ entries per workspace, text-only outbound composer, metadata-only inbound media, no payments/superadmin/external AI. Timestamp cursors are bounded APIs; very large tenants should add compound value/key cursors and server-side search indexes. Auth-state storage has a replaceable interface; encrypted distributed storage and distributed socket ownership are needed for multiple backend instances.
