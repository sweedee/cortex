import type { Ticket } from '../../model/types';

/**
 * Mocked Jira tickets of the CTX project (a SaaS observability product).
 * Repos: `ingest-gateway` (Node/TypeScript backend), `console-ui` (React frontend).
 */

const base = {
  assignee: 'Sven Weber',
  reporter: 'Priya Raman',
  sprint: 'Sprint 48',
};

export const tickets: Record<string, Ticket> = {
  'CTX-1423': {
    ...base,
    key: 'CTX-1423',
    summary: 'Add retry with exponential backoff to webhook dispatcher',
    type: 'Story',
    status: 'In Review',
    priority: 'High',
    storyPoints: 5,
    epic: 'Reliable ingest',
    labels: ['ingest-gateway', 'webhooks', 'reliability'],
    updatedAt: '2026-11-11T08:47:00Z',
    descriptionMd: `### Context

Alerting webhooks are delivered by the \`WebhookDispatcher\` in \`ingest-gateway\`. Today a delivery is attempted **exactly once**: if the customer endpoint answers with a 5xx or the connection times out, the event is logged and dropped.

In October we had three support escalations (see CTX-1391) where customers missed problem notifications because their receiver was restarting during a deployment.

### Problem

- A single transient failure loses the notification for good.
- Customers have no way to tell from the delivery log whether we tried again.
- Naive immediate retries would hammer an endpoint that is already struggling.

### Expected behaviour

Failed deliveries are retried with **exponential backoff and full jitter**:

| Attempt | Base delay | Max delay with jitter |
| --- | --- | --- |
| 1 (initial) | – | – |
| 2 | 1 s | 1 s |
| 3 | 2 s | 2 s |
| 4 | 4 s | 4 s |
| 5 | 8 s | 8 s |

After the fifth failed attempt the delivery is marked \`exhausted\` and moved to the dead-letter queue.

Only retry what is worth retrying: network errors, timeouts, \`408\`, \`429\` and \`5xx\`. Any other \`4xx\` is a permanent failure. A \`Retry-After\` header on \`429\`/\`503\` takes precedence over the computed delay (capped at 60 s).

### Technical notes

- Policy lives in \`src/dispatcher/retry.ts\`, wired into \`src/dispatcher/webhook-dispatcher.ts\`.
- Delays must be injectable (\`Clock\` interface) so tests can run on fake timers.
- Config per tenant: \`webhooks.retry.maxAttempts\` (default \`5\`), \`webhooks.retry.baseDelayMs\` (default \`1000\`).
- Emit \`webhook.delivery.attempts\` (histogram) and \`webhook.delivery.exhausted\` (counter).`,
    acceptanceCriteria: [
      'Deliveries failing with a network error, timeout, 408, 429 or 5xx are retried up to 5 attempts in total',
      'Delay between attempts doubles from 1 s and uses full jitter; `Retry-After` is honoured up to 60 s',
      'Other 4xx responses are not retried and are marked as `failed` immediately',
      'Exhausted deliveries land in the dead-letter queue with the last status code and attempt count',
      'Attempt count is visible in the delivery log API (`GET /v2/webhooks/{id}/deliveries`)',
      'Unit and integration tests cover the backoff schedule using fake timers',
    ],
    links: [
      { relation: 'relates to', key: 'CTX-1391', summary: 'Customers miss problem notifications during receiver restarts' },
      { relation: 'blocks', key: 'CTX-1429', summary: 'Show delivery attempts in the webhook settings UI' },
      { relation: 'is blocked by', key: 'CTX-1402', summary: 'Dead-letter queue for outbound deliveries' },
    ],
    comments: [
      {
        id: 'c-1423-1',
        author: 'Priya Raman',
        at: '2026-11-06T10:21:00Z',
        bodyMd:
          'Two of the three escalated customers are on the enterprise plan, so I would like to get this into **Sprint 48**. Five attempts is what we promised in the support thread — please do not go lower.',
      },
      {
        id: 'c-1423-2',
        author: 'Jonas Becker',
        at: '2026-11-09T14:05:00Z',
        bodyMd:
          'Heads-up from the platform side: the outbound proxy closes idle sockets after 15 s. If you keep the request object around between attempts you will see `ECONNRESET` on attempt 5. Create a fresh request per attempt.',
      },
      {
        id: 'c-1423-3',
        author: 'Sven Weber',
        at: '2026-11-10T16:40:00Z',
        bodyMd:
          'PR is up (#491). Went with **full jitter** (`random(0, base * 2^n)`) rather than equal jitter — it spreads the thundering herd better when a big tenant recovers.\n\nOpen point: the integration suite for the dispatcher uses real timers in one place, I am converting it.',
      },
      {
        id: 'c-1423-4',
        author: 'Mila Novak',
        at: '2026-11-11T08:12:00Z',
        bodyMd:
          'Build #4 is red: `retries a 503 with exponential backoff` in `webhook-dispatcher.int.test.ts` expects the second attempt after 1000 ms, but it only goes out after 2000 ms. Smells like an off-by-one in the exponent of `computeDelay`.',
      },
    ],
  },

  'CTX-1431': {
    ...base,
    key: 'CTX-1431',
    summary: 'Dashboard tiles flicker when the timeframe changes',
    type: 'Bug',
    status: 'In Progress',
    priority: 'Medium',
    storyPoints: 3,
    epic: 'Dashboards polish',
    reporter: 'Mila Novak',
    labels: ['console-ui', 'dashboards', 'regression'],
    updatedAt: '2026-11-11T09:12:00Z',
    descriptionMd: `### Context

Since release **1.312** every tile on a dashboard briefly disappears and shows its skeleton whenever the global timeframe is changed. On dashboards with 20+ tiles the whole page visibly "blinks", and charts lose their hover and zoom state.

### Steps to reproduce

1. Open any dashboard with at least four chart tiles in \`console-ui\` (e.g. *Ingest overview*).
2. Change the timeframe from **Last 2 hours** to **Last 24 hours**.
3. Watch the tiles while the new data loads.

### Actual behaviour

All tiles unmount, render a skeleton for 200–600 ms and mount again. Scroll position inside table tiles is reset.

### Expected behaviour

Tiles stay mounted and keep showing the previous data (slightly dimmed, with the small loading bar on the tile header) until the new result arrives — the behaviour we had before 1.312.

### Technical notes

- Suspected cause: \`DashboardGrid\` builds the tile \`key\` from \`\${tile.id}:\${timeframe.from}:\${timeframe.to}\` since the grid refactoring (CTX-1367), which forces a remount.
- \`useTileQuery\` drops \`data\` as soon as the query key changes; it should keep the previous result (\`keepPreviousData\`).
- Please add a regression test that asserts a tile's DOM node identity survives a timeframe change.

**Environment:** console-ui 1.312.0–1.314.2, all browsers.`,
    acceptanceCriteria: [
      'Changing the timeframe does not unmount tiles (DOM nodes and chart zoom state are preserved)',
      'While new data loads, tiles show the previous result dimmed plus the header loading bar',
      'Skeletons are only shown on the very first load of a tile',
      'Regression test covers tile identity across timeframe changes',
    ],
    links: [
      { relation: 'is caused by', key: 'CTX-1367', summary: 'Refactor dashboard grid to CSS grid layout' },
      { relation: 'relates to', key: 'CTX-1461', summary: 'Spike: evaluate server-sent events for live tile updates' },
    ],
    comments: [
      {
        id: 'c-1431-1',
        author: 'Mila Novak',
        at: '2026-11-09T09:30:00Z',
        bodyMd:
          'Bisected it to `3e1f0aa` (grid refactoring). The `key` on `<Tile>` now includes the timeframe. Removing it fixes the remount, but then the tiles show *stale data without any loading hint* — so it needs the `keepPreviousData` part as well.',
      },
      {
        id: 'c-1431-2',
        author: 'Priya Raman',
        at: '2026-11-10T11:02:00Z',
        bodyMd:
          'This came up in two customer calls last week. Not a blocker, but it makes the product feel cheap — would be great to have it in the next patch release.',
      },
      {
        id: 'c-1431-3',
        author: 'Sven Weber',
        at: '2026-11-11T09:12:00Z',
        bodyMd:
          'Picked it up. Plan is drafted; the fix is running locally on `bugfix/CTX-1431-tile-flicker` if anyone wants to have a look at the preview.',
      },
    ],
  },

  'CTX-1440': {
    ...base,
    key: 'CTX-1440',
    summary: 'Migrate notification settings page to the new form components',
    type: 'Story',
    status: 'To Do',
    priority: 'Medium',
    storyPoints: 8,
    epic: 'Design system adoption',
    labels: ['console-ui', 'settings', 'tech-debt'],
    updatedAt: '2026-11-09T14:00:00Z',
    descriptionMd: `### Context

\`console-ui\` is moving all settings pages from the legacy form kit (\`@ctx/legacy-forms\`) to the design-system form components. *Notification settings* (\`/settings/notifications\`) is the largest page that is still on the old kit and the last consumer of \`LegacyFieldArray\`.

### Problem

- The page ships ~38 kB of legacy form code that no other route needs.
- Validation is implemented twice (inline handlers and the submit handler) and the two disagree on e-mail lists.
- Keyboard navigation in the channel list is broken (reported by the accessibility audit, CTX-1288).

### Expected behaviour

Functionally the page stays the same. Visually it follows the new settings layout:

- Sections *Channels*, *Routing rules* and *Quiet hours* become form sections with a sticky footer (**Save** / **Discard**).
- All inputs use the design-system components incl. their built-in validation states.
- The channel list is a keyboard-operable list with add / remove / reorder.

### Technical notes

- Entry point: \`src/pages/settings/notifications/NotificationSettingsPage.tsx\`.
- Use \`useForm\` from \`@ctx/forms\` with the existing zod schema in \`notification-settings.schema.ts\`; delete the hand-written validators.
- The \`PUT /v1/settings/notifications\` payload must not change.
- Remove \`@ctx/legacy-forms\` from \`package.json\` once nothing imports it any more.`,
    acceptanceCriteria: [
      'Page uses only design-system form components; no imports from `@ctx/legacy-forms` remain',
      'Validation is driven by the zod schema and shown inline on blur and on submit',
      'Channels can be added, removed and reordered with the keyboard',
      'Unsaved changes trigger the standard "Discard changes?" prompt on navigation',
      'Request payload of `PUT /v1/settings/notifications` is unchanged (contract test stays green)',
    ],
    links: [
      { relation: 'relates to', key: 'CTX-1288', summary: 'Accessibility audit findings for settings' },
      { relation: 'is part of', key: 'CTX-1210', summary: 'Remove @ctx/legacy-forms from console-ui' },
    ],
    comments: [
      {
        id: 'c-1440-1',
        author: 'Jonas Becker',
        at: '2026-11-07T13:18:00Z',
        bodyMd:
          'I migrated *API tokens* last sprint — `TokenSettingsPage.tsx` is a good template, especially the sticky footer and the dirty-state handling. Took me about three days including tests.',
      },
      {
        id: 'c-1440-2',
        author: 'Priya Raman',
        at: '2026-11-09T14:00:00Z',
        bodyMd: 'Design signed off the mock-ups. No functional changes please — anything new goes into a follow-up ticket.',
      },
    ],
  },

  'CTX-1398': {
    ...base,
    key: 'CTX-1398',
    summary: 'Rate limit API tokens per tenant',
    type: 'Story',
    status: 'In Review',
    priority: 'High',
    storyPoints: 5,
    epic: 'Reliable ingest',
    labels: ['ingest-gateway', 'api', 'multi-tenancy'],
    updatedAt: '2026-11-10T16:30:00Z',
    descriptionMd: `### Context

The ingest API (\`POST /v2/ingest/*\`) currently has one global rate limit per gateway instance. A single tenant with a misconfigured agent fleet can consume the whole budget and cause \`429\`s for everybody else — this is what happened in incident **INC-2291**.

### Problem

There is no isolation between tenants, and the limit is not tied to what a tenant has purchased.

### Expected behaviour

Introduce a **per-tenant token bucket**:

- Bucket capacity and refill rate come from the tenant's plan (\`limits.ingest.requestsPerSecond\`, burst = 2× rate).
- Requests over the limit get \`429 Too Many Requests\` with \`Retry-After\` and the \`X-RateLimit-Limit\` / \`-Remaining\` / \`-Reset\` headers.
- Limits are enforced across all gateway instances (shared state in Redis), with a local fallback if Redis is unavailable.

### Technical notes

- Middleware in \`src/middleware/rate-limit.ts\`, executed after authentication (the tenant id comes from the API token).
- Use a Lua script for the atomic *take* in Redis; key \`rl:{tenantId}\`, TTL 2× refill interval.
- Fallback: in-memory bucket with \`rate / instanceCount\`, flagged by the \`ratelimit.fallback.active\` gauge.
- Plan limits are cached for 60 s (\`TenantLimitsCache\`).`,
    acceptanceCriteria: [
      'Each tenant has its own bucket sized by `limits.ingest.requestsPerSecond` of its plan',
      'Throttled requests return 429 with `Retry-After` and `X-RateLimit-*` headers',
      'A tenant exceeding its limit does not affect the latency or success rate of other tenants',
      'Limits hold across gateway instances; with Redis down the local fallback takes over',
      'Throttling is visible per tenant in the `ingest.requests.throttled` metric',
    ],
    links: [
      { relation: 'relates to', key: 'INC-2291', summary: 'Ingest 429s for all tenants in eu-west' },
      { relation: 'blocks', key: 'CTX-1415', summary: 'Show rate limit usage on the tenant overview page' },
    ],
    comments: [
      {
        id: 'c-1398-1',
        author: 'Jonas Becker',
        at: '2026-11-05T08:50:00Z',
        bodyMd:
          'Please keep the Redis round-trip off the hot path where you can — we measured ~0.4 ms p50 in eu-west, but p99 is 6 ms. A small local pre-check (reject if the local estimate is far over the limit) would help.',
      },
      {
        id: 'c-1398-2',
        author: 'Sven Weber',
        at: '2026-11-10T15:58:00Z',
        bodyMd:
          'Done in PR #476: Lua take + local pre-check as suggested. Load test with 400 tenants shows **+0.3 ms p50 / +1.1 ms p99** on ingest latency. Build #7 is green.',
      },
      {
        id: 'c-1398-3',
        author: 'Mila Novak',
        at: '2026-11-10T16:30:00Z',
        bodyMd: 'Reviewing today. First pass looks good, only nits on the header naming so far.',
      },
    ],
  },

  'CTX-1450': {
    ...base,
    key: 'CTX-1450',
    summary: 'Persist webhook retry state across restarts',
    type: 'Story',
    status: 'In Review',
    priority: 'Medium',
    storyPoints: 3,
    epic: 'Reliable ingest',
    labels: ['ingest-gateway', 'webhooks', 'reliability'],
    updatedAt: '2026-11-11T09:05:00Z',
    descriptionMd: `### Context

CTX-1423 retries failed webhook deliveries in memory. When the gateway restarts mid-backoff, every pending retry is lost and the event is dropped, which is exactly the failure mode the retries were meant to prevent.

### Expected behaviour

Pending retries are written to the delivery store (\`nextAttemptAt\`, \`attempt\`) and picked up again on start-up. This work **builds on CTX-1423** (stacked PR) because it extends \`withRetry\` and the dispatcher.`,
    acceptanceCriteria: [
      'A retry that is pending during a restart is delivered after start-up',
      'Retries whose `nextAttemptAt` is in the past are sent immediately, spread by jitter',
      'No duplicate deliveries when two replicas start at the same time',
    ],
    links: [{ relation: 'is blocked by', key: 'CTX-1423', summary: 'Add retry with exponential backoff to webhook dispatcher' }],
    comments: [],
  },
};

export const backlogTickets: Ticket[] = [
  {
    ...base,
    key: 'CTX-1452',
    summary: 'Export audit log as CSV',
    type: 'Story',
    status: 'To Do',
    priority: 'Low',
    storyPoints: 3,
    epic: 'Compliance',
    sprint: 'Sprint 49',
    labels: ['console-ui', 'audit-log'],
    updatedAt: '2026-11-09T10:25:00Z',
    descriptionMd: `### Context

Account admins use the audit log (\`/settings/audit-log\`) for compliance reviews. Today they can only read it in the browser, 50 entries at a time. Auditors ask for a file they can archive.

### Expected behaviour

An **Export CSV** button next to the filter bar downloads all entries matching the current filters and timeframe.

- Columns: \`timestamp\` (ISO 8601, UTC), \`user\`, \`action\`, \`resource\`, \`source IP\`, \`result\`.
- File name: \`audit-log_<tenant>_<from>_<to>.csv\`.
- Exports of more than 100 000 rows are rejected with a hint to narrow the timeframe.

### Technical notes

- Backend already offers \`GET /v1/audit-log/export?format=csv\` (streamed); the UI only needs to trigger the download with the active filter parameters.
- Values must be escaped against CSV injection (leading \`=\`, \`+\`, \`-\`, \`@\`).`,
    acceptanceCriteria: [
      'Export respects the active filters and timeframe',
      'Downloaded file opens correctly in Excel and Google Sheets (UTF-8 with BOM)',
      'Cells starting with `=`, `+`, `-` or `@` are escaped',
      'Button is only visible to users with the `audit-log:read` permission',
    ],
    links: [{ relation: 'relates to', key: 'CTX-1320', summary: 'Streaming CSV export endpoint for the audit log' }],
    comments: [
      {
        id: 'c-1452-1',
        author: 'Priya Raman',
        at: '2026-11-09T10:25:00Z',
        bodyMd: 'Requested by two customers going through SOC 2 audits in Q1. Low priority, but it is a small one.',
      },
    ],
  },
  {
    ...base,
    key: 'CTX-1457',
    summary: 'Ingest gateway returns 500 for empty batch payloads',
    type: 'Bug',
    status: 'To Do',
    priority: 'High',
    storyPoints: 2,
    epic: 'Reliable ingest',
    reporter: 'Jonas Becker',
    labels: ['ingest-gateway', 'api', 'error-handling'],
    updatedAt: '2026-11-10T17:44:00Z',
    descriptionMd: `### Context

\`POST /v2/ingest/metrics\` accepts a JSON array of data points. When an agent has nothing to report it sometimes sends an **empty array**. The gateway answers with \`500 Internal Server Error\`, which agents treat as retryable — so they resend the empty batch in a loop.

### Steps to reproduce

\`\`\`bash
curl -i -X POST https://ingest.eu-west.ctx.example/v2/ingest/metrics \\
  -H "Authorization: Api-Token $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '[]'
\`\`\`

### Actual behaviour

\`\`\`
HTTP/1.1 500 Internal Server Error
{"error":{"code":500,"message":"Cannot read properties of undefined (reading 'timestamp')"}}
\`\`\`

### Expected behaviour

\`400 Bad Request\` with error code \`EMPTY_BATCH\` and a message that explains the problem. No stack trace in the logs, no retry by the agent.

### Technical notes

- \`BatchValidator.validate()\` in \`src/ingest/batch-validator.ts\` reads \`batch[0].timestamp\` to derive the partition before checking the length.
- Same pattern exists for \`/v2/ingest/logs\` and \`/v2/ingest/events\` — fix all three.
- Currently ~1 200 of these 500s per hour in eu-west, which pollutes the availability SLO.`,
    acceptanceCriteria: [
      'Empty array payloads return 400 with error code `EMPTY_BATCH` on metrics, logs and events endpoints',
      'No unhandled exception is logged for empty batches',
      'The response is not counted against the availability SLO',
      'Unit tests cover `[]`, `null` and a missing body',
    ],
    links: [
      { relation: 'relates to', key: 'CTX-1444', summary: 'Agent retries non-retryable ingest errors' },
      { relation: 'relates to', key: 'INC-2304', summary: 'Ingest availability SLO burn in eu-west' },
    ],
    comments: [
      {
        id: 'c-1457-1',
        author: 'Jonas Becker',
        at: '2026-11-10T15:10:00Z',
        bodyMd:
          'Found while looking at the SLO burn. Stack trace:\n\n```\nTypeError: Cannot read properties of undefined (reading \'timestamp\')\n    at BatchValidator.validate (src/ingest/batch-validator.ts:41:36)\n    at IngestController.handle (src/ingest/ingest-controller.ts:67:22)\n```',
      },
      {
        id: 'c-1457-2',
        author: 'Priya Raman',
        at: '2026-11-10T17:44:00Z',
        bodyMd: 'Bumped to **High** — the SLO dashboard is shown to customers. Sven, can you squeeze it in after CTX-1423?',
      },
    ],
  },
  {
    ...base,
    key: 'CTX-1461',
    summary: 'Spike: evaluate server-sent events for live tile updates',
    type: 'Spike',
    status: 'To Do',
    priority: 'Medium',
    epic: 'Dashboards polish',
    sprint: 'Sprint 49',
    labels: ['console-ui', 'ingest-gateway', 'dashboards', 'research'],
    updatedAt: '2026-11-11T07:55:00Z',
    descriptionMd: `### Context

Dashboard tiles refresh by polling the query API every 30 s. With large dashboards this means bursts of 20–40 requests, and data is still up to 30 s old. Customers running wall-board dashboards ask for "real" live updates.

### Question

Can we push tile updates with **server-sent events** instead of polling — and is it worth it?

### What to find out

- Does our edge (CDN + ingress) pass \`text/event-stream\` through without buffering? What are the idle timeouts?
- How many concurrent streams per gateway instance can we afford (memory, file descriptors)?
- One stream per dashboard (multiplexed) or one per tile?
- Reconnect and resume behaviour (\`Last-Event-ID\`) after deployments.
- How does it compare with WebSockets and with simply polling smarter (ETag / \`304\`)?

### Outcome

A short decision document with a recommendation, plus a throw-away prototype on a branch: one tile type updated via SSE end to end.

**Time-box: 3 days.**`,
    acceptanceCriteria: [
      'Decision document compares SSE, WebSockets and conditional polling with measurements',
      'Prototype shows one live-updating tile through the real edge in the dev environment',
      'Open risks and a rough estimate for a production implementation are listed',
    ],
    links: [{ relation: 'relates to', key: 'CTX-1431', summary: 'Dashboard tiles flicker when the timeframe changes' }],
    comments: [
      {
        id: 'c-1461-1',
        author: 'Mila Novak',
        at: '2026-11-11T07:55:00Z',
        bodyMd:
          'When you get to this: I tried SSE through the ingress two years ago and it buffered responses until 4 kB. There is an annotation to switch that off now (`proxy-buffering: "off"`), worth checking first.',
      },
    ],
  },
];
