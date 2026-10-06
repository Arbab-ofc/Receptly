import { useState } from 'react';
import { Search, ArrowRight } from 'lucide-react';
import { defaultSettings } from '@receptly/shared';

type Field = [string, string, string];
type Endpoint = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  request?: unknown;
  response: string;
  public?: boolean;
};
const libraries: { name: string; title: string; fields: Field[]; example: object }[] = [
  {
    name: 'rules',
    title: 'Auto reply rules',
    fields: [
      ['name', 'string · required', '1–120 characters.'],
      ['patterns', 'string[] · required', '1–50 nonempty patterns, up to 200 characters each.'],
      [
        'matchType',
        'enum · contains',
        'exact, contains, starts_with, keyword, any_keyword, all_keywords.',
      ],
      ['scope', 'enum · direct', 'direct or group.'],
      [
        'response',
        'string · empty',
        'Up to 10,000 characters. A response or replyTemplateId is required.',
      ],
      [
        'replyTemplateId',
        'string · empty',
        'Up to 128 characters; must reference an existing template in your workspace.',
      ],
      ['enabled', 'boolean · true', 'Whether the rule can reply.'],
      ['priority', 'integer · 10', '1–1,000.'],
      ['caseSensitive', 'boolean · false', 'Whether matching respects letter case.'],
      ['stopProcessing', 'boolean · true', 'Stop processing further rules after a match.'],
      ['cooldownMinutes', 'number | null · null', '0–10,080; null uses the workspace default.'],
    ],
    example: {
      name: 'Opening hours',
      patterns: ['hours', 'open'],
      response: 'Our hours are {{business_hours}}.',
      enabled: false,
    },
  },
  {
    name: 'templates',
    title: 'Reply templates',
    fields: [
      ['name', 'string · required', '1–120 characters.'],
      ['content', 'string · required', '1–10,000 characters. Supports template variables.'],
      [
        'category',
        'enum · Custom',
        'Welcome, Pricing, Location, Business Hours, Appointment, Payment, Delivery, Support, Away, Custom.',
      ],
      ['enabled', 'boolean · true', 'Whether the template is enabled.'],
    ],
    example: {
      name: 'Welcome reply',
      category: 'Welcome',
      content: 'Hello {{name}}, welcome to {{business_name}}!',
      enabled: true,
    },
  },
  {
    name: 'knowledgeBase',
    title: 'Knowledge base',
    fields: [
      ['question', 'string · required', '1–500 characters.'],
      ['answer', 'string · required', '1–10,000 characters.'],
      ['keywords', 'string[] · required', '1–50 nonempty keywords, up to 200 characters each.'],
      ['enabled', 'boolean · true', 'Whether the entry is enabled.'],
    ],
    example: {
      question: 'Where are you located?',
      answer: 'Visit our main branch.',
      keywords: ['location', 'address'],
      enabled: false,
    },
  },
  {
    name: 'catalog',
    title: 'Product and service catalog',
    fields: [
      [
        'name',
        'string · required',
        '1–120 characters; automatically used for whole-word message matching.',
      ],
      ['kind', 'enum · Product', 'Product or Service.'],
      ['description', 'string · empty', 'Up to 3,000 characters.'],
      ['category', 'string · empty', 'Up to 120 characters.'],
      [
        'price',
        'number | null · null',
        '0–1,000,000,000,000; null asks customers to contact you for pricing.',
      ],
      ['currency', 'string · INR', 'Three-letter currency code; normalized to uppercase.'],
      ['availability', 'enum · Available', 'Available or Unavailable.'],
      [
        'keywords',
        'string[] · empty',
        'Up to 50 additional matching phrases, each up to 200 characters.',
      ],
      [
        'enabled',
        'boolean · true',
        'Include in direct-message catalog replies after explicit reply rules.',
      ],
    ],
    example: { name: 'Haircut', kind: 'Service', price: 499, currency: 'INR', keywords: ['trim'] },
  },
  {
    name: 'holidays',
    title: 'Holiday schedules',
    fields: [
      ['name', 'string · required', '1–120 characters.'],
      [
        'date',
        'string · required',
        'Valid YYYY-MM-DD calendar date in the business timezone. One entry per date per workspace; duplicates return HOLIDAY_EXISTS.',
      ],
      [
        'closed',
        'boolean · true',
        'Close all day; otherwise use special opening and closing times.',
      ],
      ['open', 'string · 10:00', 'HH:mm in the business timezone.'],
      [
        'close',
        'string · 20:00',
        'HH:mm; must differ from opening when closed is false. Earlier times continue into the next day.',
      ],
      [
        'response',
        'string · empty',
        'Up to 10,000 characters. Overrides the default closed-hours reply when enabled; supports template variables.',
      ],
      [
        'enabled',
        'boolean · true',
        'Override weekly hours and defer follow-ups outside these hours. A date override also replaces incoming overnight hours.',
      ],
    ],
    example: {
      name: 'Festival',
      date: '2026-10-20',
      closed: true,
      response: 'We are closed for the festival.',
    },
  },
  {
    name: 'contacts',
    title: 'Contacts',
    fields: [
      [
        'number',
        'string · required',
        'International number with 6–18 digits and an optional leading +. The + is removed when saved. Must be unique in your workspace.',
      ],
      ['name', 'string · empty', 'Up to 120 characters.'],
      ['type', 'enum · Normal', 'Normal, VIP, Ignore, Blocked.'],
      ['notes', 'string · empty', 'Up to 5,000 characters.'],
    ],
    example: { name: 'Example Customer', number: '+15555550123', type: 'Normal', notes: '' },
  },
  {
    name: 'leads',
    title: 'Leads',
    fields: [
      [
        'contactId',
        'string · required',
        '1–128 characters; must match the selected conversation’s contact when creating a lead.',
      ],
      [
        'conversationId',
        'string · required',
        '1–128 characters; use an existing conversation in your workspace.',
      ],
      ['status', 'enum · New', 'New, Interested, Follow Up, Converted, Closed.'],
      ['source', 'string · WhatsApp', 'Up to 100 characters.'],
      ['interest', 'string · empty', 'Up to 500 characters.'],
      ['value', 'number · 0', 'Nonnegative value; the API does not assign a currency.'],
      ['notes', 'string · empty', 'Up to 5,000 characters.'],
      ['tags', 'string[] · []', 'Up to 20 tags, each up to 50 characters.'],
    ],
    example: {
      contactId: 'contact-example',
      conversationId: 'conversation-example',
      interest: 'Appointment',
      status: 'New',
      value: 0,
    },
  },
];
const endpointGroups: { title: string; endpoints: Endpoint[] }[] = [
  {
    title: 'Public endpoints',
    endpoints: [
      {
        method: 'GET',
        path: '/api/health/live',
        public: true,
        description:
          'Check that the API process is responding. This does not check dependency readiness.',
        response: '{ status: "ok" }',
      },
      {
        method: 'GET',
        path: '/api/health/ready',
        public: true,
        description:
          'Check startup and database readiness. Returns 503 while dependencies are unavailable or the server is shutting down.',
        response: '{ status: "ok" | "not_ready" }',
      },
      {
        method: 'GET',
        path: '/api/health',
        public: true,
        description:
          'Check service health. This endpoint does not use the standard success envelope.',
        response:
          '{ status: "ok" | "degraded", timestamp: ISO string, services: { firebase: "ok" | "unconfigured_or_unavailable" } }',
      },
      {
        method: 'POST',
        path: '/api/v1/contact',
        public: true,
        description:
          'Submit a product or support request. name: 1–120 characters; email: valid email up to 254 characters; subject: 1–200; message: 1–5,000. All four fields are required.',
        request: {
          name: 'Example Customer',
          email: 'customer@example.com',
          subject: 'Setup question',
          message: 'How do I configure opening hours?',
        },
        response: '{ id: string }',
      },
    ],
  },

  {
    title: 'Subscriptions & manual payments',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/billing/plans',
        public: true,
        description: 'Public prices: monthly ₹59 (5900 paise), yearly ₹650 (65000 paise).',
        response: '{ plans: SubscriptionPlan[] }',
      },
      {
        method: 'GET',
        path: '/api/v1/account/access',
        description:
          'Read the authenticated user’s admin flag and effective Free/Pro access. Admins always have Pro.',
        response: '{ admin, access: { tier, source, expiresAt, version } }',
      },
      {
        method: 'GET',
        path: '/api/v1/billing',
        description:
          'Read plans, payment configuration, effective subscription, access and recent payment requests.',
        response:
          '{ plans, paymentConfigured, enforcementEnabled, access, subscription, active, payments }',
      },
      {
        method: 'GET',
        path: '/api/v1/billing/payments',
        description: 'List your payment requests using limit and cursor pagination.',
        response: '{ items, nextCursor }',
      },
      {
        method: 'GET',
        path: '/api/v1/billing/payments/:id',
        description: 'Read your request with its UPI link and QR image.',
        response: 'ManualPayment with upiLink and qrDataUrl',
      },
      {
        method: 'POST',
        path: '/api/v1/billing/payments',
        description:
          'Create an idempotent request. Reusing requestId for a different plan returns REQUEST_CONFLICT. An active same plan, scheduled next plan, or unfinished request blocks purchase. Limit: 10 requests/hour.',
        request: {
          planId: 'monthly',
          requestId: '00000000-0000-4000-8000-000000000001',
        },
        response:
          'ManualPayment; amountPaise, INR currency, status, version and timestamps are server assigned.',
      },
      {
        method: 'PATCH',
        path: '/api/v1/billing/payments/:id',
        description:
          'Submit a reference or cancel a pending unpaid request. Use its latest version. Submit queues admin notification and review; it does not activate Pro. References must be unique. To cancel send { action: "cancel", expectedVersion }.',
        request: {
          action: 'submit',
          reference: '123456789012',
          expectedVersion: 1,
        },
        response:
          'Updated ManualPayment; statuses: pending, submitted, approved, rejected, cancelled.',
      },
    ],
  },
  {
    title: 'Platform administration',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/admin/system',
        description: 'Platform admin only (ADMIN_UIDS). Read operator metrics.',
        response: 'Monitoring snapshot',
      },
      {
        method: 'GET',
        path: '/api/v1/admin/users',
        description:
          'Platform admin only (ADMIN_UIDS). List Firebase users and workspace summaries; limit 1–100, default 25, cursor supported.',
        response: '{ items, nextCursor }',
      },
      {
        method: 'GET',
        path: '/api/v1/admin/users/:id',
        description:
          'Platform admin only (ADMIN_UIDS). Read a user, workspace summary and up to 30 daily analytics records.',
        response: 'User detail with workspace and analytics',
      },
      {
        method: 'PATCH',
        path: '/api/v1/admin/users/:id/plan',
        description:
          'Platform admin only (ADMIN_UIDS). Grant complimentary Pro or switch to Free using the access version. Platform admin plans cannot be changed.',
        response: 'Updated access profile',
        request: {
          tier: 'pro',
          expectedVersion: 0,
        },
      },
      {
        method: 'PATCH',
        path: '/api/v1/admin/users/:id/automation',
        description:
          'Platform admin only (ADMIN_UIDS). Set workspace automation using the settings version; effective Pro access is still required to reply.',
        response: '{ automationEnabled, version }',
        request: {
          enabled: true,
          expectedVersion: 0,
        },
      },
      {
        method: 'GET',
        path: '/api/v1/admin/enquiries',
        description: 'Platform admin only (ADMIN_UIDS). List support enquiries with pagination.',
        response: '{ items, nextCursor }',
      },
      {
        method: 'PATCH',
        path: '/api/v1/admin/enquiries/:id',
        description:
          'Platform admin only (ADMIN_UIDS). Set an enquiry to new or resolved using its latest version.',
        response: 'Updated enquiry',
        request: {
          status: 'resolved',
          expectedVersion: 0,
        },
      },
      {
        method: 'GET',
        path: '/api/v1/admin/audit',
        description:
          'Platform admin only (ADMIN_UIDS). List administrator actions with pagination.',
        response: '{ items, nextCursor }',
      },
      {
        method: 'GET',
        path: '/api/v1/admin/payments',
        description:
          'Platform admin only (ADMIN_UIDS). List payment reviews; paymentStatus filters requests, such as submitted. Includes notification status.',
        response: '{ items, nextCursor }',
      },
      {
        method: 'PATCH',
        path: '/api/v1/admin/payments/:id',
        description:
          'Platform admin only (ADMIN_UIDS). Approve only after confirming actual bank credit and exact amount. A different active plan queues the approved period after expiry. Reject with decision: reject, expectedVersion and a required note.',
        response: 'Updated ManualPayment with approved period when applicable',
        request: {
          decision: 'approve',
          expectedVersion: 2,
          bankCreditVerified: true,
          verifiedAmountPaise: 5900,
          note: 'Bank credit verified.',
        },
      },
      {
        method: 'GET',
        path: '/api/v1/admin/payment-whatsapp/status',
        description:
          'Platform admin only (ADMIN_UIDS). Read the separate payment sender session, including QR when available and configured recipientNumber.',
        response: 'WhatsAppStatus with recipientNumber',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/payment-whatsapp/connect',
        description:
          'Platform admin only. Connect the payment notification sender independently of business automation. No body required; omit Content-Type when sending no body.',
        response: 'WhatsAppStatus',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/payment-whatsapp/reconnect',
        description:
          'Platform admin only. Reconnect the payment notification sender independently of business automation. No body required; omit Content-Type when sending no body.',
        response: 'WhatsAppStatus',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/payment-whatsapp/disconnect',
        description:
          'Platform admin only. Disconnect the payment notification sender independently of business automation. No body required; omit Content-Type when sending no body.',
        response: 'WhatsAppStatus',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/payment-whatsapp/logout',
        description:
          'Platform admin only. Logout the payment notification sender independently of business automation. No body required; omit Content-Type when sending no body.',
        response: 'WhatsAppStatus',
      },
    ],
  },
  {
    title: 'Workspace & availability',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/settings',
        description: 'Read workspace settings, including defaults for a new workspace.',
        response: 'Settings object; see the full field reference below.',
      },
      {
        method: 'PATCH',
        path: '/api/v1/settings',
        description:
          'Update selected settings. Omitted fields retain their current values. The merged settings are validated.',
        request: {
          businessName: 'Example Studio',
          timezone: 'Asia/Kolkata',
          automationEnabled: false,
        },
        response: 'Updated Settings object.',
      },
      {
        method: 'GET',
        path: '/api/v1/schedule',
        description: 'Read all seven days of your business schedule.',
        response: 'Array of seven { day, enabled, open, close } objects.',
      },
      {
        method: 'PATCH',
        path: '/api/v1/schedule',
        description:
          'Replace the full schedule. Send exactly seven unique days: 0 = Sunday through 6 = Saturday. enabled is a boolean; open and close use 24-hour HH:mm. Overnight hours are supported and evaluated in settings.timezone.',
        request: Array.from({ length: 7 }, (_, day) => ({
          day,
          enabled: day !== 0,
          open: '10:00',
          close: '18:00',
        })),
        response: 'Saved schedule array.',
      },
      {
        method: 'GET',
        path: '/api/v1/receptionist/status',
        description: 'Read the receptionist’s current enablement and business-hours state.',
        response: '{ enabled: boolean, mode: string, businessOpen: boolean, timezone: string }',
      },
      {
        method: 'GET',
        path: '/api/v1/onboarding',
        description: 'Read setup completion flags.',
        response:
          '{ connected: boolean, scheduleConfigured: boolean, hasRules: boolean, enabled: boolean }',
      },
    ],
  },
  ...libraries.map((library) => ({
    title: library.title,
    endpoints: [
      {
        method: 'GET' as const,
        path: `/api/v1/${library.name}`,
        description: `List records. Accepts limit and before; ordered by ${library.name === 'rules' ? 'priority' : 'createdAt'} in descending order.`,
        response: 'Array of records. An empty collection returns [].',
      },
      {
        method: 'POST' as const,
        path: `/api/v1/${library.name}`,
        description: `Create a record using the ${library.title.toLowerCase()} field reference below.`,
        request: library.example,
        response: 'Created record with id, createdAt and updatedAt.',
      },
      {
        method: 'GET' as const,
        path: `/api/v1/${library.name}/:id`,
        description: 'Read a record belonging to your signed-in workspace.',
        response: 'Record object; missing records return 404.',
      },
      {
        method: 'PATCH' as const,
        path: `/api/v1/${library.name}/:id`,
        description:
          'Update selected fields. Existing values are merged with your changes before validation.',
        request:
          library.name === 'knowledgeBase'
            ? { answer: 'Our updated answer.' }
            : library.name === 'leads'
              ? { status: 'Interested' }
              : { name: 'Updated name' },
        response: 'Updated record including id and updatedAt.',
      },
      {
        method: 'DELETE' as const,
        path: `/api/v1/${library.name}/:id`,
        description:
          library.name === 'templates'
            ? 'Delete a template. First remove references from reply rules; referenced templates return TEMPLATE_IN_USE.'
            : library.name === 'leads'
              ? 'Delete a lead and clear its linked conversation’s leadId.'
              : 'Delete a record. This action cannot be undone through the API.',
        response: '{ deleted: true }',
      },
      ...(library.name === 'holidays'
        ? [
            {
              method: 'PATCH' as const,
              path: '/api/v1/holidays/:id/toggle',
              description: 'Enable or disable the date override.',
              request: { enabled: false },
              response: 'Updated holiday schedule.',
            },
          ]
        : []),
      ...(['rules', 'templates', 'knowledgeBase', 'catalog'].includes(library.name)
        ? [
            {
              method: 'POST' as const,
              path: `/api/v1/${library.name}/:id/duplicate`,
              description:
                'Create a disabled copy with a new ID and timestamps. Usage and trigger counters are reset.',
              response: 'Duplicated record.',
            },
            {
              method: 'PATCH' as const,
              path: `/api/v1/${library.name}/:id/toggle`,
              description:
                'Enable or disable the record. enabled is required and must be a boolean.',
              request: { enabled: false },
              response: 'Record with the updated enabled value.',
            },
          ]
        : []),
    ],
  })),
  {
    title: 'Conversations & messages',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/conversations',
        description:
          'List conversations ordered by lastMessageAt descending. Accepts limit and before.',
        response: 'Conversation[]; see response fields below.',
      },
      {
        method: 'GET',
        path: '/api/v1/conversations/:id',
        description: 'Read one conversation.',
        response: 'Conversation object.',
      },
      {
        method: 'PATCH',
        path: '/api/v1/conversations/:id',
        description:
          'Update notes (up to 5,000 characters), tags (up to 20 strings of 50 characters each), or mark a chat read with unreadCount: 0. Other unread counts are rejected.',
        request: { unreadCount: 0, notes: 'Requested an appointment', tags: ['Appointment'] },
        response: 'Updated Conversation object.',
      },
      {
        method: 'GET',
        path: '/api/v1/conversations/:id/messages',
        description:
          'Read message history, newest timestamp first. Accepts limit and before; the conversation must exist.',
        response: 'StoredMessage[]; see response fields below.',
      },
      {
        method: 'POST',
        path: '/api/v1/conversations/:id/messages',
        description:
          'Send a manual text reply. text is required, trimmed, and must contain 1–10,000 characters. requestId is a required UUID generated by your client for this send. Template variables are resolved before sending. A successful send pauses automatic replies for pauseAfterManualReplyMinutes.',
        request: {
          text: 'Hello {{name}}, how can we help?',
          requestId: '00000000-0000-4000-8000-000000000001',
        },
        response:
          'StoredMessage with source: "manual" and sendStatus: "sent". Repeating the same requestId and original text returns the saved result without sending again. Different text or conversation with that ID returns REQUEST_ID_REUSED. Uncertain delivery returns DELIVERY_UNCERTAIN; check history before creating a new request. Results are retained for seven days.',
      },
      {
        method: 'POST',
        path: '/api/v1/conversations/:id/pause-automation',
        description:
          'Pause automation for this conversation. Clears needsHuman and pauseUntil. No request body is required.',
        response: 'Updated Conversation with automationEnabled: false.',
      },
      {
        method: 'POST',
        path: '/api/v1/conversations/:id/resume-automation',
        description:
          'Resume automation for this conversation. Clears needsHuman and pauseUntil. Workspace settings still determine whether replies run. No request body is required.',
        response: 'Updated Conversation with automationEnabled: true.',
      },
    ],
  },
  {
    title: 'WhatsApp connection',
    endpoints: [
      ...['status', 'qr'].map((action) => ({
        method: 'GET' as const,
        path: `/api/v1/whatsapp/${action}`,
        description:
          action === 'qr'
            ? 'Read the current connection status including a QR image when linking is required. This returns the same status shape as /whatsapp/status.'
            : 'Read the current connection status.',
        response:
          'WhatsAppStatus object. A QR image is account-linking data; display it only to the authenticated account owner.',
      })),
      ...(['connect', 'reconnect', 'disconnect', 'logout'] as const).map((action) => ({
        method: 'POST' as const,
        path: `/api/v1/whatsapp/${action}`,
        description:
          {
            connect:
              'Start linking or connecting WhatsApp. Poll status or listen for events; connection completion is asynchronous.',
            reconnect: 'Restart the connection using the existing linked session when available.',
            disconnect:
              'Stop the current connection while retaining the linked session for later reconnect.',
            logout:
              'Unlink the account and remove its saved linked session. Linking again requires a new QR scan.',
          }[action] + ' No request body is required.',
        response: 'Current WhatsAppStatus object after initiating the action.',
      })),
    ],
  },
  {
    title: 'Recovery & account data',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/send-requests/:id',
        description:
          'Read your saved manual-send result by requestId. Status is prepared, sending, completed, failed, or uncertain. A failed disconnected send can be retried using the same requestId. A completed request returns its original result; do not automatically resend uncertain requests.',
        response:
          '{ id, conversationId, status, timestamp, result?: StoredMessage, errorCode?: string }',
      },
      {
        method: 'GET',
        path: '/api/v1/diagnostics',
        description:
          'Inspect up to 100 records per failure category in your workspace. Response summaries omit message payloads.',
        response:
          '{ failedInputs: operation summaries[], failedJobs: operation summaries[], uncertainSends: operation summaries[] }; summary fields: id, status, attempts, timestamp, errorCode, nextAttemptAt, scheduledFor when available.',
      },
      {
        method: 'GET',
        path: '/api/v1/account/export',
        description:
          'Export your settings, schedule, reply libraries, contacts, leads, conversations, messages, analytics, and activity logs. Linked-device credentials and private send fingerprints are excluded. Protect the exported customer data.',
        response: '{ formatVersion: 1, exportedAt: ISO timestamp, data: collection objects }',
      },
      {
        method: 'DELETE',
        path: '/api/v1/account',
        description:
          'Permanently delete your account and workspace data, and unlink WhatsApp. Requires a sign-in within the last five minutes and the exact confirmation below. Interrupted deletion is resumed by maintenance. This action cannot be undone through the API.',
        request: { confirmation: 'DELETE MY ACCOUNT' },
        response: '{ deleted: true }',
      },
      {
        method: 'GET',
        path: '/api/operations',
        description:
          'Operator-only endpoint. Requires a separately configured operator bearer token, not a Firebase user token. It is disabled by default and returns 404 when unauthorized. Keep operator credentials in server administration tools.',
        response:
          '{ ready, uptimeSeconds, lastSchedulerAt, activeStreams, counters: numeric metrics } inside the standard success envelope.',
      },
    ],
  },
  {
    title: 'Activity & live updates',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/logs',
        description:
          'Read activity logs ordered by timestamp descending. Accepts limit and before.',
        response: 'ActivityLog[]; see response fields below.',
      },
      {
        method: 'GET',
        path: '/api/v1/analytics',
        description:
          'Read daily activity and totals. range accepts 1d, 7d, or 30d; default 7d. Date keys and hourly buckets use UTC.',
        response:
          '{ daily: { [YYYY-MM-DD]: DailyAnalytics }, totals: metric totals, hourTimezone: "UTC" }',
      },
      {
        method: 'GET',
        path: '/api/v1/events',
        description:
          'Open an authenticated server-sent event stream. Accept: text/event-stream is recommended. This returns streamed events rather than a JSON success envelope; see live updates below.',
        response:
          'text/event-stream; initial ready event, JSON data events, and heartbeat comments.',
      },
    ],
  },
];
const settingsDescriptions: Record<string, string> = {
  businessName: 'Up to 120 characters.',
  timezone: 'Valid IANA timezone, such as Asia/Kolkata. Controls business hours.',
  automationEnabled: 'Enable workspace automatic replies.',
  groupsEnabled: 'Allow group conversations.',
  unknownContactsOnly: 'Restrict automation to unknown contacts.',
  vipBypass: 'Apply the VIP bypass preference.',
  defaultCooldownMinutes: '0–10,080 minutes.',
  pauseAfterManualReplyMinutes: '0–10,080 minutes; pause duration following a manual reply.',
  fallbackEnabled: 'Enable the fallback response.',
  fallbackMessage: 'Up to 10,000 characters.',
  fallbackCooldownMinutes: '0–10,080 minutes.',
  outOfHoursEnabled: 'Enable the closed-hours response.',
  outOfHoursMessage: 'Up to 10,000 characters.',
  outOfHoursCooldownMinutes: '0–10,080 minutes.',
  mode: 'Available, Busy, Away, Meeting, Vacation, Offline.',
  modeReplies: 'Object mapping mode names to reply strings, each up to 10,000 characters.',
  humanKeywords: 'Up to 30 nonempty strings, each up to 100 characters.',
  humanAcknowledgement: 'Up to 10,000 characters.',
  leadDetectionEnabled: 'Enable lead detection.',
  leadKeywords: 'Up to 30 nonempty strings, each up to 100 characters.',
  welcomeEnabled: 'Enable the welcome response.',
  welcomeMessage: 'Up to 10,000 characters.',
  menuEnabled: 'Send a numbered menu once per eligible direct chat per business-timezone day.',
  menuMessage: 'Menu introduction, up to 10,000 characters; supports reply placeholders.',
  menuOptions:
    'Up to 9 { label, response, action } objects. label: 1–120 characters. action: custom (default), pricing, opening_hours, closing_hours. Custom replies require nonempty response (max 10,000). Built-in Stop for today is appended separately.',
  followUpEnabled: 'Enable follow-ups.',
  followUpHours: '1–168 hours.',
  followUpMessage: 'Up to 10,000 characters.',
};
const responseFields: { title: string; fields: Field[] }[] = [
  {
    title: 'Conversation',
    fields: [
      [
        'id, contactId, chatId, name, number',
        'string',
        'Conversation identifier, contact reference, WhatsApp chat identifier, and customer details.',
      ],
      ['lastMessageAt, createdAt, updatedAt', 'number', 'Unix timestamps in milliseconds.'],
      ['unreadCount', 'number', 'Unread message count.'],
      [
        'automationEnabled, needsHuman',
        'boolean',
        'Conversation automation and human-attention flags.',
      ],
      [
        'lastMessageText, leadId, notes',
        'string · optional',
        'Latest message, linked lead, and customer notes.',
      ],
      ['tags', 'string[] · optional', 'Customer tags.'],
      [
        'menuLastSentDate, receptionistStoppedDate',
        'string · optional',
        'Business-timezone dates for daily menu delivery and the customer’s Stop for today preference. Read-only.',
      ],
      [
        'pauseUntil, lastAutoReplyAt, lastManualReplyAt',
        'number · optional',
        'Millisecond timestamps; pauseUntil: 0 means no timed pause.',
      ],
      [
        'state, stateData, stateExpiresAt, cooldowns',
        'optional',
        'Conversation workflow state: string, string-value object, expiry timestamp, and numeric timestamp map respectively. Treat these response fields as read-only.',
      ],
    ],
  },
  {
    title: 'StoredMessage',
    fields: [
      ['id, conversationId', 'string', 'Message and conversation identifiers.'],
      ['direction', 'enum', 'incoming or outgoing.'],
      [
        'type',
        'enum',
        'text, image, document, audio, video, unknown. The manual-send endpoint accepts text only.',
      ],
      ['source', 'enum', 'customer, receptly, manual.'],
      ['timestamp', 'number', 'Unix milliseconds.'],
      [
        'text, ruleId, mediaName, mimeType',
        'string · optional',
        'Text and message metadata; media metadata does not imply a media-upload API.',
      ],
      ['autoReply', 'boolean · optional', 'Whether this was an automated reply.'],
      [
        'sendStatus',
        'enum · optional',
        'pending, sent, failed, uncertain, delivered, read. Uncertain means delivery could not be confirmed; do not automatically resend.',
      ],
    ],
  },
  {
    title: 'WhatsAppStatus',
    fields: [
      ['status', 'enum', 'disconnected, connecting, qr_required, connected, reconnecting, error.'],
      [
        'phoneNumber, displayName, error',
        'string · optional',
        'Connected account information or connection error text.',
      ],
      ['connectedAt, lastActivityAt, qrExpiresAt', 'number · optional', 'Unix milliseconds.'],
      [
        'qr',
        'string · optional',
        'Temporary QR image data URL. Do not publish or log actual QR contents.',
      ],
    ],
  },
  {
    title: 'ActivityLog',
    fields: [
      ['id, type, message', 'string', 'Log ID, event type, and display message.'],
      ['severity', 'enum', 'info, success, warning, error.'],
      ['timestamp', 'number', 'Unix milliseconds.'],
      ['metadata', 'object · optional', 'Additional event details when available.'],
    ],
  },
  {
    title: 'DailyAnalytics & totals',
    fields: [
      ['incoming, outgoing, autoReplies, manualReplies', 'number', 'Message counters.'],
      ['leads, humanTakeovers, newContacts, rulesTriggered', 'number', 'Activity counters.'],
      [
        'hours',
        'object · optional · daily only',
        'UTC hour keys with incoming, autoReplies, and manualReplies counters.',
      ],
      ['rules', 'object · optional · daily only', 'Rule IDs mapped to trigger counts.'],
    ],
  },
];
export const apiContents = [
  ['api-overview', 'API basics'],
  ['api-endpoints', 'Endpoint reference'],
  ['api-fields', 'Request fields'],
  ['api-responses', 'Response fields'],
  ['api-events', 'Live events'],
  ['api-errors', 'Errors & limits'],
] as const;
const json = (value: unknown) => JSON.stringify(value, null, 2);
function Fields({ fields }: { fields: Field[] }) {
  return (
    <div className="api-table-scroll">
      <table className="api-fields-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type / default</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([name, type, detail]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>{type}</td>
              <td>{detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ApiDocumentation() {
  const [search, setSearch] = useState('');
  const groups = endpointGroups
    .map((group) => ({
      ...group,
      endpoints: group.endpoints.filter((endpoint) =>
        `${group.title} ${endpoint.method} ${endpoint.path} ${endpoint.description}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    }))
    .filter((group) => group.endpoints.length);
  return (
    <div className="api-documentation">
      <section id="api-overview">
        <span className="eyebrow">DEVELOPER REFERENCE · V1</span>
        <h2>Build with the Receptly API.</h2>
        <p>
          Manage your workspace, conversations, replies, and connection through the same API used by
          Receptly. Examples below use fictional data and placeholder credentials.
        </p>
        <h3>Base URL & authentication</h3>
        <p>
          Use your Receptly deployment’s origin. Versioned endpoints begin with <code>/api/v1</code>
          ; health is at <code>/api/health</code>. Local development uses{' '}
          <code>http://localhost:3001</code>. Use HTTPS for hosted deployments.
        </p>
        <p>
          Except for health, public billing plans, contact submission, and the operator-only
          operations endpoint, every endpoint requires{' '}
          <code>Authorization: Bearer &lt;FIREBASE_ID_TOKEN&gt;</code>. Obtain a fresh Firebase ID
          token from the signed-in user in your client. This API does not issue passwords, API keys,
          or service-account tokens. Requests access only the signed-in user’s workspace. Admin
          routes explicitly allow configured platform admins to manage users and payment requests by
          ID.
        </p>
        <pre>
          <code>
            {
              'curl "https://your-receptly.example/api/v1/settings" \\\n  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>"'
            }
          </code>
        </pre>
        <p>
          Send <code>Content-Type: application/json</code> with JSON bodies. Standard successful
          JSON responses use HTTP 200, including creation. For bodyless actions, omit Content-Type
          or send an empty JSON object; an empty body with application/json is invalid:
        </p>
        <pre>
          <code>
            {json({
              success: true,
              data: {
                businessName: 'Example Studio',
                timezone: 'Asia/Kolkata',
                automationEnabled: false,
              },
            })}
          </code>
        </pre>
        <p>
          This is an abbreviated settings example. The <code>data</code> field may contain an
          object, an array, or a deletion confirmation. Health and the event stream have different
          response formats.
        </p>
        <h3>Pagination & identifiers</h3>
        <p>
          List endpoints accept <code>limit</code> (integer 1–200, default 50). Use{' '}
          <code>page=true</code> for a response containing <code>{'{ items, nextCursor }'}</code>.
          Pass the returned opaque <code>cursor</code> to fetch the next page; the cursor includes
          an ordering value and record ID so equal timestamps are retained. Keep the same filters
          when following a cursor. A sparse filtered page may be empty while still having a
          nextCursor; continue until nextCursor is null.
        </p>
        <pre>
          <code>
            {
              'GET /api/v1/conversations?page=true&limit=25&filter=unread\nGET /api/v1/conversations?page=true&limit=25&filter=unread&cursor=<NEXT_CURSOR>'
            }
          </code>
        </pre>
        <p>
          Without page=true or cursor, existing integrations still receive arrays. Legacy numeric{' '}
          <code>before</code> remains supported, but can skip ties; do not combine it with cursor.
          Ordering uses priority for rules, createdAt for libraries, lastMessageAt for
          conversations, and timestamp for messages/logs. Optional filters: <code>search</code> (up
          to 120 characters), conversation <code>filter</code> (all, unread, human, paused), lead{' '}
          <code>status</code>, and contact <code>type</code>.
        </p>
        <h3>Concurrent edits</h3>
        <p>
          Settings and editable library records include a numeric <code>version</code>. To protect
          an edit, send <code>If-Match: "&lt;VERSION&gt;"</code>. A stale version returns 409
          VERSION_CONFLICT. Legacy records start at version 0. Versions increase after updates;
          omitting If-Match retains backward-compatible merge behavior. Schedule versions are
          returned through the ETag header on GET /schedule.
        </p>
        <p>
          Use IDs returned by the API. URL record IDs allow letters, digits, underscores, and
          hyphens, up to 200 characters. Timestamps are Unix milliseconds unless a field explicitly
          uses an ISO date string.
        </p>
      </section>
      <section id="api-endpoints">
        <h2>Endpoint reference</h2>
        <p>
          Expand a route for its behavior, request example, and response. All endpoints require a
          user token unless marked Public or explicitly described as operator-only.
        </p>
        <label className="api-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search API endpoints"
            placeholder="Search routes, methods, or topics…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <p className="api-result-count" role="status">
          {groups.reduce((count, group) => count + group.endpoints.length, 0)} endpoints
        </p>
        {groups.map((group) => (
          <div className="api-endpoint-group" key={group.title}>
            <h3>{group.title}</h3>
            {group.endpoints.map((endpoint) => (
              <details className="api-endpoint" key={`${endpoint.method}:${endpoint.path}`}>
                <summary>
                  <span className={`api-method api-method-${endpoint.method.toLowerCase()}`}>
                    {endpoint.method}
                  </span>
                  <code>{endpoint.path}</code>
                  {endpoint.public && <span className="api-public">Public</span>}
                </summary>
                <div className="api-endpoint-content">
                  <p>{endpoint.description}</p>
                  {endpoint.request !== undefined && (
                    <>
                      <h4>Example JSON body</h4>
                      <pre>
                        <code>{json(endpoint.request)}</code>
                      </pre>
                    </>
                  )}
                  <h4>
                    {endpoint.path.startsWith('/api/health') || endpoint.path.endsWith('/events')
                      ? 'Response'
                      : 'Response data'}
                  </h4>
                  <p>{endpoint.response}</p>
                </div>
              </details>
            ))}
          </div>
        ))}
        {!groups.length && (
          <p className="api-empty">
            No endpoints match “{search}”. Try settings, messages, or GET.
          </p>
        )}
      </section>
      <section id="api-fields">
        <h2>Request fields</h2>
        <p>
          Required fields apply to creation. For PATCH, supply only the fields you want to change.
          The API validates the resulting record and retains omitted values. Rules, templates, and
          knowledge-base, catalog and holiday libraries each support up to 200 records when creating
          through their standard POST route.
        </p>
        {libraries.map((library) => (
          <details className="api-schema" key={library.name}>
            <summary>
              {library.title} <code>/{library.name}</code>
            </summary>
            <Fields fields={library.fields} />
            <p>
              Response records include <code>id</code>, <code>createdAt</code>, and{' '}
              <code>updatedAt</code>, plus <code>version</code> for API-managed library records.
              Optional rule activity: <code>triggerCount</code> and <code>lastTriggeredAt</code>;
              template activity: <code>usageCount</code>; contact activity: <code>firstSeenAt</code>
              , <code>lastSeenAt</code>, and <code>messageCount</code>; lead activity:{' '}
              <code>lastInteractionAt</code>. These are response metadata, not editable request
              fields.
            </p>
          </details>
        ))}
        <details className="api-schema">
          <summary>
            Workspace settings <code>/settings</code>
          </summary>
          <Fields
            fields={Object.entries(defaultSettings).map(([name, value]) => [
              name,
              `${Array.isArray(value) ? 'array' : typeof value} · ${json(value)}`,
              settingsDescriptions[name],
            ])}
          />
        </details>
        <h3>Template variables</h3>
        <p>
          Reply templates and manually sent text can use <code>{'{{name}}'}</code>,{' '}
          <code>{'{{business_name}}'}</code>, <code>{'{{current_time}}'}</code>, and{' '}
          <code>{'{{business_hours}}'}</code>. These resolve using the customer name and workspace
          settings. Unknown variable markers are removed; if a manual message becomes empty after
          rendering, it is rejected.
        </p>
      </section>
      <section id="api-responses">
        <h2>Response fields</h2>
        <p>
          Optional fields may be absent. Read counters and timestamps from responses; do not send
          generated metadata in create or update requests.
        </p>
        {responseFields.map((schema) => (
          <details className="api-schema" key={schema.title}>
            <summary>{schema.title}</summary>
            <Fields fields={schema.fields} />
          </details>
        ))}
      </section>
      <section id="api-events">
        <h2>Live events</h2>
        <p>
          <code>GET /api/v1/events</code> uses server-sent events with bearer authentication. Use
          streaming fetch or an SSE client that supports request headers; the browser’s native
          EventSource cannot set an Authorization header. Do not put tokens in the URL.
        </p>
        <pre>
          <code>
            {
              'const token = await signedInUser.getIdToken();\nconst response = await fetch(`${baseUrl}/api/v1/events`, {\n  headers: {\n    Authorization: `Bearer ${token}`,\n    Accept: "text/event-stream",\n  },\n  signal: abortController.signal,\n});\nif (!response.ok || !response.body) throw new Error("Stream unavailable");\n// Pass response.body to an SSE parser; chunks may split event boundaries.'
            }
          </code>
        </pre>
        <p>
          The stream starts with a named <code>ready</code> event. Updates use unnamed{' '}
          <code>data:</code> events with a JSON object. For example:
        </p>
        <pre>
          <code>
            {
              'event: ready\ndata: {}\n\ndata: {"type":"message","conversationId":"conversation-example"}\n\n: heartbeat\n\n'
            }
          </code>
        </pre>
        <p>
          Types include settings, rules, templates, knowledgeBase, catalog, holidays, contacts,
          leads, conversation, message, and whatsapp. Some events include conversationId or
          connection data. Treat updates as signals to refetch the affected resource rather than a
          complete record. Ignore heartbeat comments, sent every 20 seconds.
        </p>
        <p>
          A user can open up to three concurrent streams by default; extra connections return 429
          STREAM_LIMIT. Slow clients are disconnected instead of buffering unbounded data. The
          connection closes after 45 minutes or shortly before the user token expires, and may end
          sooner. A named reconnect event can precede closure. Reconnect with a fresh user token and
          a delay; abort when the user signs out or leaves the workspace. No event IDs, replay
          cursor, or Last-Event-ID recovery are provided. Refetch current data after reconnecting.
        </p>
      </section>
      <section id="api-errors">
        <h2>Errors & limits</h2>
        <pre>
          <code>
            {json({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'patterns: Too small: expected array to have >=1 items',
              },
            })}
          </code>
        </pre>
        <Fields
          fields={[
            [
              '400',
              'Invalid request',
              'VALIDATION_ERROR, INVALID_ID, INVALID_TEMPLATE, INVALID_CONVERSATION, EMPTY_MESSAGE. Check fields, references, and rendered message text.',
            ],
            [
              '401',
              'Authentication',
              'UNAUTHENTICATED for a missing bearer token; INVALID_TOKEN for an expired or invalid token. Refresh the user token or sign in again.',
            ],
            [
              '404',
              'Missing resource',
              'NOT_FOUND or CONVERSATION_NOT_FOUND. Check that the ID exists in the current workspace.',
            ],
            [
              '409',
              'Conflict',
              'CONTACT_EXISTS, LIBRARY_LIMIT, TEMPLATE_IN_USE, DUPLICATE_REQUEST, REQUEST_ID_REUSED, DELIVERY_UNCERTAIN, VERSION_CONFLICT, ACCOUNT_DELETING, WHATSAPP_DISCONNECTED. Resolve the conflict before retrying.',
            ],
            ['413', 'Body too large', 'Maximum JSON request body: 65,536 bytes.'],
            [
              '429',
              'Rate limit',
              'General limit: 120 requests per minute. Contact submission: 5 requests per 15 minutes. Respect Retry-After when present.',
            ],
            [
              '500',
              'Service failure',
              'Server errors return a generic service-unavailable message. Do not automatically repeat an uncertain manual send with a new requestId.',
            ],
          ]}
        />
        <p>
          Framework-generated errors may use their own error code. Display the returned message
          rather than assuming all failures have one code. Browser cross-origin requests require
          your frontend’s exact origin to be configured in the deployment’s allowed-origin list;
          CORS does not replace bearer authentication.
        </p>
        <a href="#api-endpoints" className="text-link">
          Back to endpoint reference <ArrowRight size={16} />
        </a>
      </section>
    </div>
  );
}
