# Firebase setup

1. In the Firebase console, create a project. Choose a region appropriate for your customers and VPS.
2. Open **Build → Authentication → Get started → Sign-in method**. Enable **Email/Password**. Google sign-in is not required.
3. Under Authentication settings, authorize `localhost` for development and your production hostname for deployment.
4. Open **Build → Realtime Database → Create database**. Select a location and choose locked mode. Copy the exact database URL (regional databases use `firebasedatabase.app`).
5. Open **Project settings → General → Your apps**. Register a web app. Copy `apiKey`, `authDomain`, `projectId`, `appId`, and database URL into the `VITE_FIREBASE_*` entries of the root `.env`.
6. Open **Project settings → Service accounts → Firebase Admin SDK → Generate new private key**. Keep this file outside the source repository. Copy `project_id`, `client_email`, and `private_key` into the corresponding server environment variables.
7. Set `FIREBASE_DATABASE_URL` to the database URL. Private key example: `FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"`. The environment parser converts escaped newlines. Never use a `VITE_` prefix for Admin credentials.
8. Publish the contents of `database.rules.json` in the Realtime Database Rules editor, or use `npx firebase-tools deploy --only database --project YOUR_PROJECT_ID` after authentication. Reads are scoped to the UID. Client writes are denied; every mutation goes through the validating authenticated API. Server-only contact requests and session control are denied to clients. Query indexes are included.
9. Run `npm run build`, then `npm run dev`. Register an account at `/register`. Configure your business in Settings and connect WhatsApp.

The API verifies Firebase ID tokens (including revocation checks). UIDs always come from verified tokens, never request bodies or custom headers. The frontend uses Firebase Authentication only and receives data through the API and an authenticated SSE stream. Firebase Admin is initialized once. A missing configuration produces a usable public site, a clear sign-in setup message, and a degraded health response; production refuses to start without Admin configuration.

## Testing live storage

Create two users. Create a rule as the first. Confirm the second cannot retrieve it by ID. Send a contact request; inspect `contactRequests` through the Firebase console. Contact requests are intentionally inaccessible to normal dashboard users. Review them as the deployment operator.

## Credentials

Restrict `.env` to the service user (`chmod 600 .env`). Rotate keys using IAM if exposed. Rebuild the frontend after changing `VITE_*` values. Its Firebase configuration is public by design; Admin credentials are private. Enable a suitable Firebase password policy and monitor Auth quotas for a public registration deployment.

Optionally set `VITE_SUPPORT_EMAIL` to your real support inbox. The contact page displays this address as a mail link when configured; otherwise it directs users to the persisted support form.
