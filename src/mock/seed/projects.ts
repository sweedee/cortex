/** First-run content for the toolbox and the projects page (afterwards localStorage wins). */
import type { Diagram, Milestone, Project, RoadmapItem, ToolboxLink } from '../../model/types';

const project = (
  id: string,
  name: string,
  description: string,
  port: number,
  startCommand: string,
  roadmap: Milestone[] = [],
  diagrams: Diagram[] = [],
): Project => ({
  id,
  name,
  description,
  github: { owner: 'ctx-observability', repo: id },
  baseBranch: 'main',
  localPath: `~/src/${id}`,
  worktreeRoot: `~/wt/${id}`,
  startCommand,
  port,
  jira: { projectKey: 'CTX', labels: [id], ticketKeys: [] },
  roadmap,
  diagrams,
});

const item = (id: string, text: string, done = false, ticketKey?: string): RoadmapItem => ({ id, text, done, ticketKey });
const AT = (daysAgo: number) => new Date(Date.UTC(2026, 10, 11, 9, 0, 0) - daysAgo * 86_400_000).toISOString();

export const SEED_PROJECTS: Project[] = [
  project(
    'console-ui',
    'Console UI',
    'The web console customers use to explore their telemetry.',
    5174,
    'npm run dev',
    [
      {
        id: 'ms-cui-1',
        title: 'Dashboards without flicker',
        target: 'Dec 2026',
        status: 'active',
        items: [
          item('ri-cui-1', 'Fix tile flicker on timeframe change', false, 'CTX-1431'),
          item('ri-cui-2', 'Evaluate server-sent events for live tiles', false, 'CTX-1461'),
          item('ri-cui-3', 'Move dashboard grid to CSS grid', true),
          item('ri-cui-4', 'Add visual regression snapshots for tiles'),
        ],
      },
      {
        id: 'ms-cui-2',
        title: 'Settings cleanup',
        target: 'Q1 2027',
        status: 'planned',
        items: [
          item('ri-cui-5', 'Remove @ctx/legacy-forms', false, 'CTX-1440'),
          item('ri-cui-6', 'Accessibility audit fixes for settings'),
          item('ri-cui-7', 'Migrate settings pages to the new form components'),
        ],
      },
      {
        id: 'ms-cui-3',
        title: 'Audit log v2',
        target: 'Q2 2027',
        status: 'planned',
        items: [item('ri-cui-8', 'Audit log filters and saved views', false, 'CTX-1452'), item('ri-cui-9', 'Streaming CSV export'), item('ri-cui-10', 'Retention settings UI')],
      },
    ],
    [
      {
        id: 'dg-cui-1',
        title: 'Component graph',
        updatedAt: AT(6),
        source: `flowchart TB
  App --> Router
  Router --> Dashboards
  Router --> Settings
  Router --> AuditLog
  subgraph Shared
    Store[(Query cache)]
    Grid[Dashboard grid]
    Forms[Form components]
  end
  Dashboards --> Grid
  Dashboards --> Store
  Settings --> Forms
  AuditLog --> Store
  Store --> API[[Query Service API]]
`,
      },
      {
        id: 'dg-cui-2',
        title: 'Tile refresh sequence',
        updatedAt: AT(2),
        source: `sequenceDiagram
  participant U as User
  participant T as Timeframe picker
  participant C as Query cache
  participant Q as Query Service
  U->>T: Select "Last 6h"
  T->>C: invalidate(tiles)
  C->>Q: POST /query (per tile)
  Q-->>C: result
  C-->>T: tiles updated
`,
      },
    ],
  ),
  project(
    'ingest-gateway',
    'Ingest Gateway',
    'Receives telemetry, validates it and dispatches it to the pipeline.',
    8080,
    './gradlew bootRun',
    [
      {
        id: 'ms-ig-1',
        title: 'Reliable webhook delivery',
        target: 'Nov 2026',
        status: 'active',
        items: [
          item('ri-ig-1', 'Retry with backoff for outbound webhooks', false, 'CTX-1423'),
          item('ri-ig-2', 'Dead-letter queue for failed deliveries', true, 'CTX-1402'),
          item('ri-ig-3', 'Show delivery attempts in settings UI', false, 'CTX-1429'),
          item('ri-ig-4', 'Alert when DLQ depth exceeds threshold'),
        ],
      },
      {
        id: 'ms-ig-2',
        title: 'Per-tenant rate limits',
        target: 'Dec 2026',
        status: 'active',
        items: [
          item('ri-ig-5', 'Token bucket per tenant', false, 'CTX-1398'),
          item('ri-ig-6', 'Return 429 with Retry-After', true),
          item('ri-ig-7', 'Rate limit usage on tenant overview', false, 'CTX-1415'),
        ],
      },
      {
        id: 'ms-ig-3',
        title: 'Error handling clean-up',
        target: 'Q1 2027',
        status: 'planned',
        items: [item('ri-ig-8', 'Structured, non-retryable error codes', false, 'CTX-1457'), item('ri-ig-9', 'Document the error contract'), item('ri-ig-10', 'Fix agent retrying non-retryable errors', false, 'CTX-1444')],
      },
    ],
    [
      {
        id: 'dg-ig-1',
        title: 'Request flow',
        updatedAt: AT(12),
        source: `flowchart LR
  agent[Agent / SDK] -->|HTTPS| lb[Load balancer]
  subgraph gateway[Ingest Gateway]
    auth[Auth] --> limit[Rate limiter]
    limit --> validate[Validator]
    validate --> dispatch[Dispatcher]
  end
  lb --> auth
  limit -. 429 .-> agent
  dispatch --> kafka[[Pipeline topic]]
  dispatch -->|failed| dlq[(Dead-letter queue)]
`,
      },
      {
        id: 'dg-ig-2',
        title: 'Dispatch and retry',
        updatedAt: AT(3),
        source: `sequenceDiagram
  participant D as Dispatcher
  participant R as Receiver
  participant Q as Dead-letter queue
  D->>R: POST webhook
  R-->>D: 503
  loop up to 5 attempts with backoff
    D->>R: POST webhook
    R-->>D: 503
  end
  D->>Q: park delivery
  Note over D,Q: replay from the settings UI
`,
      },
    ],
  ),
  project(
    'query-service',
    'Query Service',
    'Executes queries against the storage tier.',
    8090,
    './gradlew bootRun',
    [
      {
        id: 'ms-qs-1',
        title: 'Query planner v2',
        target: 'Q1 2027',
        status: 'active',
        items: [
          item('ri-qs-1', 'Push down filters to storage', true),
          item('ri-qs-2', 'Cost-based join ordering'),
          item('ri-qs-3', 'Plan cache with invalidation'),
          item('ri-qs-4', 'Explain output in the console'),
        ],
      },
      {
        id: 'ms-qs-2',
        title: 'Tenant isolation',
        target: 'Q2 2027',
        status: 'planned',
        items: [item('ri-qs-5', 'Per-tenant query concurrency limits'), item('ri-qs-6', 'Memory budget per query'), item('ri-qs-7', 'Noisy-neighbour load test')],
      },
      {
        id: 'ms-qs-3',
        title: 'Storage client hardening',
        target: 'Oct 2026',
        status: 'done',
        items: [item('ri-qs-8', 'Connection pool tuning', true), item('ri-qs-9', 'Timeouts and cancellation', true), item('ri-qs-10', 'Circuit breaker for storage errors', true)],
      },
    ],
    [
      {
        id: 'dg-qs-1',
        title: 'Query execution',
        updatedAt: AT(20),
        source: `flowchart TB
  req[Query request] --> parse[Parser]
  parse --> plan[Planner]
  plan --> cache{Plan cached?}
  cache -- yes --> exec[Executor]
  cache -- no --> opt[Optimizer] --> exec
  subgraph storage[Storage tier]
    hot[(Hot store)]
    cold[(Cold store)]
  end
  exec --> hot
  exec --> cold
  exec --> res[Result stream]
`,
      },
    ],
  ),
];

export const SEED_TOOLBOX: ToolboxLink[] = [
  { id: 'link-seed-gh', label: 'GitHub org', url: 'https://github.com/ctx-observability', icon: 'code', group: 'Code & CI' },
  { id: 'link-seed-jenkins', label: 'Jenkins', url: 'https://jenkins.ctx-observability.example/', icon: 'workflow', group: 'Code & CI' },
  { id: 'link-seed-console-ci', label: 'Console UI pipeline', url: 'https://jenkins.ctx-observability.example/job/console-ui/', icon: 'workflow', group: 'Code & CI', projectId: 'console-ui' },
  { id: 'link-seed-jira', label: 'Jira board CTX', url: 'https://jira.ctx-observability.example/jira/software/projects/CTX/boards/1', icon: 'bug', group: 'Planning' },
  { id: 'link-seed-confluence', label: 'Runbooks', url: 'https://confluence.ctx-observability.example/display/OPS/Runbooks', icon: 'docs', group: 'Planning' },
  { id: 'link-seed-grafana', label: 'Service health', url: 'https://grafana.ctx-observability.example/d/service-health', icon: 'chart', group: 'Observability' },
  { id: 'link-seed-ingest-dash', label: 'Ingest throughput', url: 'https://grafana.ctx-observability.example/d/ingest-throughput', icon: 'chart', group: 'Observability', projectId: 'ingest-gateway' },
  { id: 'link-seed-oncall', label: 'On-call schedule', url: 'https://oncall.ctx-observability.example/schedule/platform', icon: 'oncall', group: 'Observability' },
  { id: 'link-seed-slack', label: '#ctx-dev on Slack', url: 'https://ctx-observability.slack.example/archives/ctx-dev', icon: 'chat', group: 'Team' },
  { id: 'link-seed-staging', label: 'Staging console', url: 'https://console.staging.ctx-observability.example/', icon: 'cloud', group: 'Team' },
  { id: 'link-seed-query-docs', label: 'Query language docs', url: 'https://docs.ctx-observability.example/query/', icon: 'docs', group: 'Team', projectId: 'query-service' },
];
