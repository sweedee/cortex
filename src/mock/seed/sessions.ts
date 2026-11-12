import { GLOBAL_SESSION_ID } from '../../services/config';
import type { AgentKind, AgentSession, SessionMessage, WorkItem } from '../../model/types';

export const MODEL = 'claude-opus-5-5';

/** Id of the global, work-independent chat shown when no work is selected. */
export { GLOBAL_SESSION_ID };

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type Draft = DistributiveOmit<SessionMessage, 'id' | 'at'>;

// ---- tiny authoring helpers -------------------------------------------------

const md = (...lines: string[]) => lines.join('\n');
const user = (...lines: string[]): Draft => ({ role: 'user', text: md(...lines) });
const say = (...lines: string[]): Draft => ({ role: 'assistant', text: md(...lines) });
const tool = (
  name: string,
  summary: string,
  detail?: string | string[],
  status: 'running' | 'ok' | 'error' = 'ok',
): Draft => ({
  role: 'tool',
  tool: name,
  summary,
  detail: Array.isArray(detail) ? detail.join('\n') : detail,
  status,
});

/** Turns drafts into messages with ids and believable, slightly irregular timestamps. */
function transcript(prefix: string, startIso: string, drafts: Draft[]): SessionMessage[] {
  const gaps = [0, 4, 9, 6, 21, 7, 13, 5, 34, 8, 11, 6, 27, 9];
  let at = Date.parse(startIso);
  return drafts.map((d, i) => {
    at += gaps[i % gaps.length] * 1000;
    return { ...d, id: `${prefix}-m${i + 1}`, at: new Date(at).toISOString() } as SessionMessage;
  });
}

// ---- plans --------------------------------------------------------------------

const PLAN_1431 = md(
  '## Plan · CTX-1431 Dashboard tiles flicker when the timeframe changes',
  '',
  '### Context',
  'Changing the timeframe makes every tile blank out for 200–400 ms before the new data arrives. Two independent causes in `console-ui`:',
  '',
  '1. `TileGrid` builds each tile `key` from the tile id **and** the timeframe, so React unmounts and remounts all tiles on every change (chart state, hover and scroll position are lost).',
  '2. `useTileData` resets `data` to `undefined` whenever the query key changes, so even a tile that stays mounted falls back to its skeleton.',
  '',
  '### Approach',
  'Keep tiles mounted and keep showing the previous result while the new one loads. Signal the refresh with the existing subtle `TileRefreshBar` instead of the skeleton. No API changes.',
  '',
  '```mermaid',
  'flowchart LR',
  '  T[Timeframe change] --> G[TileGrid]',
  '  G -->|stable key| M[Tile stays mounted]',
  '  M --> D[useTileData keeps previous result]',
  '  D --> R[TileRefreshBar shown]',
  '  D --> N[New data replaces old]',
  '```',
  '',
  '### Steps',
  '1. `src/dashboard/TileGrid.tsx` — use `tile.id` as the only key; pass `timeframe` as a prop.',
  '2. `src/dashboard/TileGrid.tsx` — memoise the `timeframe` object (`useMemo` on `from`/`to`) so unchanged tiles do not re-render.',
  '3. `src/dashboard/useTileData.ts` — keep the previous result while refetching (`placeholderData: keepPreviousData`) and expose `isRefreshing`.',
  '4. `src/dashboard/Tile.tsx` — render the skeleton only on the very first load; show `TileRefreshBar` while `isRefreshing`.',
  '5. `src/dashboard/Tile.tsx` — drop the `useEffect` that cleared the chart zoom on mount; reset zoom explicitly when the timeframe changes.',
  '',
  '### Test plan',
  '- Unit: `TileGrid.test.tsx` — tiles are **not** remounted when the timeframe changes (mount counter stays at 1).',
  '- Unit: `useTileData.test.ts` — previous data is returned while the next request is pending; `isRefreshing` toggles.',
  '- Manual: local app, dashboard "Ingest overview", switch 2h → 24h → 7d on a throttled connection (Slow 3G).',
  '- e2e: extend `e2e/dashboard.spec.ts` with a "no skeleton after first load" assertion.',
  '',
  '### Risks',
  '- **Stale data looks current.** Mitigated by the refresh bar and by dimming the tile timestamp while refreshing.',
  '- **Tiles with their own timeframe override** rely on remounting to reset; covered by step 5.',
  '- Estimated diff: ~90 lines across 3 files plus tests.',
);

const PLAN_1440 = md(
  '## Plan · CTX-1440 Migrate notification settings page to the new form components',
  '',
  '### Context',
  'The notification settings page in `console-ui` is the last settings screen on the legacy form kit (`@console/legacy-forms`). It hand-rolls validation, dirty tracking and the save bar, which is why it behaves differently from the other settings pages (no inline errors, save button always enabled).',
  '',
  '### Approach',
  'Port the page to the shared form components (`FormField`, `TextInput`, `Select`, `Switch`, `FormActions`) and the `useSettingsForm` hook already used by the profile and token pages. Keep the REST contract (`PUT /api/v2/settings/notifications`) and the page URL unchanged. Ship behind no flag — the page is low traffic — but in two commits so the mechanical port can be reviewed separately from the behaviour changes.',
  '',
  '### Steps',
  '1. `src/settings/notificationSchema.ts` (new) — move the ad-hoc validation out of the component into a schema: e-mail list, webhook URL (https only), quiet-hours range.',
  '2. `src/settings/NotificationForm.tsx` — replace `LegacyForm`, `LegacyInput`, `LegacyToggle` with the new components; wire them to `useSettingsForm(notificationSchema)`.',
  '3. `src/settings/NotificationChannels.tsx` — rebuild the channel list (e-mail / Slack / webhook) as a field array; each row gets inline validation.',
  '4. `src/settings/NotificationSettingsPage.tsx` — use the shared `SettingsPageLayout` and `FormActions` (Save / Discard, disabled while pristine, loading while saving).',
  '5. `src/settings/api/notifications.ts` — map server-side `422` field errors onto form fields instead of the global toast.',
  '6. Delete `src/settings/legacy/NotificationLegacyForm.tsx` and remove the last `@console/legacy-forms` import; drop the dependency from `package.json` if nothing else uses it.',
  '',
  '### Test plan',
  '- Unit: `notificationSchema.test.ts` — valid / invalid e-mail lists, non-https webhook, inverted quiet hours.',
  '- Component: `NotificationForm.test.tsx` — save disabled while pristine, inline errors on blur, server `422` mapped to the right field.',
  '- Visual: compare against the token settings page for spacing and label alignment in light and dark theme.',
  '- e2e: update selectors in `e2e/settings-notifications.spec.ts` (the legacy `data-qa` attributes go away).',
  '',
  '### Risks',
  '- **Behaviour change:** quiet hours used to accept an empty end time; the new schema requires both or neither. Call it out in the PR.',
  '- **Selector churn** in e2e tests owned by the QA guild — give them a heads-up.',
  '- Removing `@console/legacy-forms` may surface a hidden import in `src/onboarding`; check with `npm ls` before deleting.',
  '- Estimate: 8 points holds; roughly 1.5 days including review.',
);

// ---- seed transcripts -----------------------------------------------------------

const s1423 = transcript('s-1423-impl', '2026-11-10T13:02:00Z', [
  user(
    '/implement CTX-1423',
    '',
    'Follow the approved plan: retry 5xx and network errors with exponential backoff + jitter, max 5 attempts, honour `Retry-After`, dead-letter once attempts are exhausted. Keep the dispatcher API stable.',
  ),
  say('Starting with the dispatcher and how deliveries are recorded today, so the retry state has a home.'),
  tool('Read', 'src/webhooks/dispatcher.ts', [
    ' 41  async deliver(delivery: Delivery): Promise<void> {',
    ' 42    const res = await this.http.post(delivery.url, delivery.payload, {',
    ' 43      headers: this.sign(delivery),',
    ' 44      timeoutMs: this.config.timeoutMs,',
    ' 45    });',
    ' 46    if (!res.ok) {',
    ' 47      await this.store.markFailed(delivery.id, res.status);',
    ' 48      this.metrics.failed.inc({ tenant: delivery.tenantId });',
    ' 49      return;',
    ' 50    }',
    ' 51    await this.store.markDelivered(delivery.id);',
    ' 52  }',
  ]),
  tool('Grep', '"deliver\\(" in src/', [
    'src/webhooks/dispatcher.ts:41:  async deliver(delivery: Delivery): Promise<void> {',
    'src/webhooks/worker.ts:28:      await this.dispatcher.deliver(next);',
    'src/webhooks/replay.ts:17:    await dispatcher.deliver({ ...original, id: newId() });',
    'test/webhooks/dispatcher.test.ts:22:    await dispatcher.deliver(delivery);',
  ]),
  tool('Read', 'src/webhooks/deliveryStore.ts', [
    ' 12  export interface DeliveryRecord {',
    ' 13    id: string;',
    ' 14    tenantId: string;',
    " 15    state: 'pending' | 'delivered' | 'failed';",
    ' 16    attempts: number;',
    ' 17    nextAttemptAt?: Date; // unused since the queue rewrite',
    ' 18    lastStatus?: number;',
    ' 19  }',
  ]),
  tool('Read', 'src/config/webhooks.ts'),
  say(
    'What I found:',
    '',
    '- `deliver()` posts exactly once and marks the delivery `failed` on any non-2xx. A thrown network error is not caught at all — it bubbles up to the worker and is only logged.',
    '- `DeliveryRecord` already has `attempts` and an unused `nextAttemptAt`, and the worker polls by `nextAttemptAt <= now()`. So rescheduling is a store update, no new timer infrastructure needed.',
    '- `replay.ts` calls `deliver()` directly, so the signature has to stay as it is.',
    '',
    'I will put the policy (what is retryable, how long to wait) into its own pure module so it can be tested without HTTP.',
  ),
  tool('Write', 'src/webhooks/retryPolicy.ts', [
    '+ export interface RetryPolicy {',
    '+   maxAttempts: number;',
    '+   baseDelayMs: number;',
    '+   maxDelayMs: number;',
    '+ }',
    '+',
    '+ export const isRetryable = (status: number | undefined) =>',
    '+   status === undefined || status === 408 || status === 429 || status >= 500;',
    '+',
    '+ /** Full jitter: random delay in [0, min(max, base * 2^attempt)]. */',
    '+ export function nextDelayMs(policy: RetryPolicy, attempt: number, retryAfter?: string): number {',
    '+   const fromHeader = parseRetryAfter(retryAfter);',
    '+   if (fromHeader !== undefined) return Math.min(fromHeader, policy.maxDelayMs);',
    '+   const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);',
    '+   return Math.floor(Math.random() * ceiling);',
    '+ }',
  ]),
  tool('Edit', 'src/webhooks/dispatcher.ts', [
    '@@ -41,12 +41,27 @@ export class WebhookDispatcher',
    '   async deliver(delivery: Delivery): Promise<void> {',
    '-    const res = await this.http.post(delivery.url, delivery.payload, {',
    '-      headers: this.sign(delivery),',
    '-      timeoutMs: this.config.timeoutMs,',
    '-    });',
    '-    if (!res.ok) {',
    '-      await this.store.markFailed(delivery.id, res.status);',
    '+    const outcome = await this.attempt(delivery);',
    '+    if (outcome.ok) {',
    '+      await this.store.markDelivered(delivery.id);',
    '+      return;',
    '+    }',
    '+    const attempt = delivery.attempts + 1;',
    '+    if (!isRetryable(outcome.status) || attempt >= this.config.retry.maxAttempts) {',
    '+      await this.deadLetter.put(delivery, outcome);',
    '+      await this.store.markFailed(delivery.id, outcome.status);',
    '       this.metrics.failed.inc({ tenant: delivery.tenantId });',
    '       return;',
    '     }',
    '-    await this.store.markDelivered(delivery.id);',
    '+    const delay = nextDelayMs(this.config.retry, attempt, outcome.retryAfter);',
    '+    await this.store.reschedule(delivery.id, attempt, new Date(this.clock.now() + delay));',
    '+    this.metrics.retried.inc({ tenant: delivery.tenantId });',
    '   }',
  ]),
  tool('Edit', 'src/config/webhooks.ts', [
    '@@ -8,6 +8,11 @@ export const webhookConfig = {',
    "   timeoutMs: env.int('WEBHOOK_TIMEOUT_MS', 5_000),",
    '+  retry: {',
    "+    maxAttempts: env.int('WEBHOOK_RETRY_MAX_ATTEMPTS', 5),",
    "+    baseDelayMs: env.int('WEBHOOK_RETRY_BASE_DELAY_MS', 1_000),",
    "+    maxDelayMs: env.int('WEBHOOK_RETRY_MAX_DELAY_MS', 5 * 60_000),",
    '+  },',
  ]),
  tool(
    'Bash',
    'npx tsc --noEmit',
    [
      "src/webhooks/retryPolicy.ts(24,31): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.",
      "src/webhooks/dispatcher.ts(58,24): error TS2339: Property 'reschedule' does not exist on type 'DeliveryStore'.",
      'Found 2 errors in 2 files.',
    ],
    'error',
  ),
  say(
    'Two type errors, both expected: `Retry-After` can be absent (and can be an HTTP date, not only seconds), and the store has no `reschedule` yet. Fixing both.',
  ),
  tool('Edit', 'src/webhooks/retryPolicy.ts', [
    '@@ -20,3 +20,12 @@',
    '+ function parseRetryAfter(value: string | undefined): number | undefined {',
    '+   if (!value) return undefined;',
    '+   const seconds = Number(value);',
    '+   if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);',
    '+   const date = Date.parse(value);',
    '+   return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());',
    '+ }',
  ]),
  tool('Edit', 'src/webhooks/deliveryStore.ts', [
    '@@ -44,0 +45,8 @@ export class DeliveryStore',
    '+  async reschedule(id: string, attempts: number, nextAttemptAt: Date): Promise<void> {',
    '+    await this.db.update(',
    "+      'webhook_deliveries',",
    "+      { state: 'pending', attempts, next_attempt_at: nextAttemptAt },",
    '+      { id },',
    '+    );',
    '+  }',
  ]),
  tool('Bash', 'npx tsc --noEmit', 'No errors.'),
  tool('Write', 'test/webhooks/retryPolicy.test.ts', '+ 9 test cases: retryable statuses, delay ceiling per attempt, Retry-After seconds / HTTP date / garbage'),
  tool('Edit', 'test/webhooks/dispatcher.test.ts', [
    '@@ -61,0 +62,18 @@',
    "+  it('reschedules a 503 with a delay below the ceiling', async () => {",
    '+    http.post.mockResolvedValue({ ok: false, status: 503, headers: {} });',
    '+    await dispatcher.deliver(delivery({ attempts: 2 }));',
    '+    const [, attempts, nextAt] = store.reschedule.mock.calls[0];',
    '+    expect(attempts).toBe(3);',
    '+    expect(nextAt.getTime() - clock.now()).toBe(4_000);',
    '+  });',
  ]),
  tool(
    'Bash',
    'npx vitest run test/webhooks',
    [
      ' ✓ test/webhooks/retryPolicy.test.ts (9)',
      ' ❯ test/webhooks/dispatcher.test.ts (14)',
      '   × reschedules a 503 with a delay below the ceiling',
      '     AssertionError: expected 2713 to be 4000',
      '',
      ' Test Files  1 failed | 1 passed (2)',
      '      Tests  1 failed | 22 passed (23)',
    ],
    'error',
  ),
  say(
    'My own test is wrong, not the code: with full jitter the delay is random in `[0, ceiling]`, so asserting an exact value can never be stable. I will inject the random source into the policy so tests can pin it, and assert the ceiling.',
  ),
  tool('Edit', 'src/webhooks/retryPolicy.ts', [
    '@@ -12,7 +12,12 @@',
    '-export function nextDelayMs(policy: RetryPolicy, attempt: number, retryAfter?: string): number {',
    '+export function nextDelayMs(',
    '+  policy: RetryPolicy,',
    '+  attempt: number,',
    '+  retryAfter?: string,',
    '+  random: () => number = Math.random,',
    '+): number {',
    '@@ -21,1 +26,1 @@',
    '-  return Math.floor(Math.random() * ceiling);',
    '+  return Math.floor(random() * ceiling);',
  ]),
  tool('Edit', 'test/webhooks/dispatcher.test.ts', [
    '@@ -67,1 +67,2 @@',
    '-    expect(nextAt.getTime() - clock.now()).toBe(4_000);',
    '+    expect(nextAt.getTime() - clock.now()).toBeGreaterThanOrEqual(0);',
    '+    expect(nextAt.getTime() - clock.now()).toBeLessThanOrEqual(8_000);',
  ]),
  tool('Bash', 'npx vitest run test/webhooks', [
    ' ✓ test/webhooks/retryPolicy.test.ts (11)',
    ' ✓ test/webhooks/dispatcher.test.ts (16)',
    '',
    ' Test Files  2 passed (2)',
    '      Tests  27 passed (27)',
    '   Duration  1.84s',
  ]),
  tool('Edit', 'src/webhooks/metrics.ts', [
    '@@ -9,0 +10,4 @@',
    '+  retried: new Counter({',
    "+    name: 'webhook_deliveries_retried_total',",
    "+    labelNames: ['tenant'],",
    '+  }),',
  ]),
  tool('Bash', 'npm run lint -- src/webhooks test/webhooks', 'Found 0 warnings and 0 errors.'),
  tool('Bash', 'git commit (3 commits)', [
    'a41c9e2 CTX-1423 Add retry policy with exponential backoff and full jitter',
    '7be03d5 CTX-1423 Reschedule retryable webhook deliveries, dead-letter the rest',
    'f2d8a17 CTX-1423 Cover retry scheduling and Retry-After handling with tests',
  ]),
  say(
    '### Done — retry with exponential backoff is in',
    '',
    '**What changed** (`feature/CTX-1423-webhook-retry`, 3 commits, +214 / −19)',
    '',
    '- `src/webhooks/retryPolicy.ts` — new pure module: `isRetryable`, `nextDelayMs` (full jitter, capped), `Retry-After` parsing for seconds and HTTP dates.',
    '- `src/webhooks/dispatcher.ts` — `deliver()` now reschedules retryable failures (network error, 408, 429, 5xx) and dead-letters after `maxAttempts`. Signature unchanged, so `replay.ts` and the worker are untouched.',
    '- `src/webhooks/deliveryStore.ts` — `reschedule()` reuses the existing `next_attempt_at` column; no migration needed.',
    '- `src/config/webhooks.ts` — `WEBHOOK_RETRY_MAX_ATTEMPTS` (5), `…_BASE_DELAY_MS` (1 s), `…_MAX_DELAY_MS` (5 min).',
    '- New counter `webhook_deliveries_retried_total{tenant}`.',
    '',
    '**Verified:** `tsc` clean, lint clean, 27 / 27 tests in `test/webhooks` green.',
    '',
    '**Worth a look in review**',
    '',
    '1. 4xx other than 408 / 429 go straight to the dead-letter queue — matches the ticket, but confirm for 425.',
    '2. The integration test `webhook-e2e.it.ts` still assumes a single attempt; I did not run the integration stage locally, CI will tell.',
  ),
]);

const s1431plan = transcript('s-1431-plan', '2026-11-11T08:20:00Z', [
  user('/plan CTX-1431 Dashboard tiles flicker when the timeframe changes'),
  tool('Read', 'CTX-1431 — description and 2 comments', [
    'Tiles unmount and remount on every timeframe change.',
    '',
    'Priya Raman: Reproducible on every dashboard with more than ~6 tiles, worst on slow connections.',
    'Mila Novak: Started with 2.41 — probably the grid refactoring (CTX-1377).',
  ]),
  tool('Grep', '"timeframe" in src/dashboard', [
    'src/dashboard/DashboardPage.tsx:34:  const [timeframe, setTimeframe] = useTimeframe();',
    'src/dashboard/TileGrid.tsx:21:export function TileGrid({ tiles, timeframe }: TileGridProps) {',
    'src/dashboard/TileGrid.tsx:38:          key={`${tile.id}-${timeframe.from}-${timeframe.to}`}',
    'src/dashboard/useTileData.ts:12:export function useTileData(tile: TileDef, timeframe: Timeframe) {',
    'src/dashboard/Tile.tsx:19:  const { data, isLoading } = useTileData(tile, timeframe);',
    '… 11 more matches',
  ]),
  tool('Read', 'src/dashboard/TileGrid.tsx', [
    ' 34      {tiles.map((tile) => (',
    ' 35        <GridCell key={tile.id} layout={tile.layout}>',
    ' 36          <Tile',
    ' 37            tile={tile}',
    ' 38            key={`${tile.id}-${timeframe.from}-${timeframe.to}`}',
    ' 39            timeframe={{ from: timeframe.from, to: timeframe.to }}',
    ' 40          />',
    ' 41        </GridCell>',
    ' 42      ))}',
  ]),
  say(
    'First cause is right there: the `Tile` key includes the timeframe (line 38), so React throws every tile away and mounts a fresh one on each change. Line 39 also creates a new `timeframe` object on every render. Checking whether the data hook would flicker on its own.',
  ),
  tool('Read', 'src/dashboard/useTileData.ts', [
    ' 12  export function useTileData(tile: TileDef, timeframe: Timeframe) {',
    ' 13    return useQuery({',
    " 14      queryKey: ['tile', tile.id, timeframe.from, timeframe.to],",
    ' 15      queryFn: () => fetchTileData(tile, timeframe),',
    ' 16      staleTime: 30_000,',
    ' 17    });',
    ' 18  }',
  ]),
  tool('Read', 'src/dashboard/Tile.tsx'),
  tool('Bash', 'git log --oneline -6 -- src/dashboard/TileGrid.tsx', [
    '9c1e77a CTX-1377 Rework tile grid layout, key tiles by timeframe to reset zoom',
    '51f0b2d CTX-1290 Virtualise tile grid',
    '0e88d14 Extract GridCell',
  ]),
  tool('Grep', '"keepPreviousData|placeholderData" in src/', [
    'src/logs/useLogQuery.ts:22:    placeholderData: keepPreviousData,',
    'src/problems/useProblems.ts:18:    placeholderData: keepPreviousData,',
  ]),
  say(
    'Second cause confirmed: a new query key means `data` is `undefined` until the request resolves, and `Tile.tsx` renders the skeleton whenever `isLoading` is true. The timeframe-in-key trick came in with CTX-1377 to reset chart zoom — that intent needs to survive the fix.',
  ),
  tool('Read', 'src/dashboard/TileGrid.test.tsx'),
  tool('Write', '.cortex/plans/CTX-1431.md', 'Plan saved (38 lines) and attached to the work item.'),
  say(PLAN_1431),
]);

const s1431impl = transcript('s-1431-impl', '2026-11-11T09:01:00Z', [
  user('/implement CTX-1431', '', 'Follow the plan. Small commits, tests first where it is cheap.'),
  tool('Read', '.cortex/plans/CTX-1431.md'),
  tool('Bash', 'git status --short && git branch --show-current', ['bugfix/CTX-1431-tile-flicker', '(clean)']),
  say('Plan has five steps. Starting with a failing test that pins the actual bug: tiles must not remount when the timeframe changes.'),
  tool('Edit', 'src/dashboard/TileGrid.test.tsx', [
    '@@ -48,0 +49,14 @@',
    "+  it('keeps tiles mounted when the timeframe changes', () => {",
    '+    const mounts = vi.fn();',
    '+    const { rerender } = render(<TileGrid tiles={tiles} timeframe={last2h} onTileMount={mounts} />);',
    '+    rerender(<TileGrid tiles={tiles} timeframe={last24h} onTileMount={mounts} />);',
    '+    expect(mounts).toHaveBeenCalledTimes(tiles.length);',
    '+  });',
  ]),
  tool(
    'Bash',
    'npx vitest run src/dashboard/TileGrid.test.tsx',
    [
      ' ❯ src/dashboard/TileGrid.test.tsx (7)',
      '   × keeps tiles mounted when the timeframe changes',
      '     AssertionError: expected "spy" to be called 8 times, but got 16 times',
      '',
      '      Tests  1 failed | 6 passed (7)',
    ],
    'error',
  ),
  say('Red for the right reason — 16 mounts instead of 8. Now the fix.'),
  tool('Edit', 'src/dashboard/TileGrid.tsx', [
    '@@ -34,9 +34,5 @@ export function TileGrid({ tiles, timeframe }: TileGridProps) {',
    '       {tiles.map((tile) => (',
    '         <GridCell key={tile.id} layout={tile.layout}>',
    '-          <Tile',
    '-            tile={tile}',
    '-            key={`${tile.id}-${timeframe.from}-${timeframe.to}`}',
    '-            timeframe={{ from: timeframe.from, to: timeframe.to }}',
    '-          />',
    '+          <Tile tile={tile} timeframe={timeframe} />',
    '         </GridCell>',
  ]),
  tool('Read', 'src/dashboard/useTileData.ts'),
  tool('Edit', 'src/dashboard/useTileData.ts', [
    '@@ -12,7 +12,10 @@',
    ' export function useTileData(tile: TileDef, timeframe: Timeframe) {',
    '-  return useQuery({',
    '+  const query = useQuery({',
    "     queryKey: ['tile', tile.id, timeframe.from, timeframe.to],",
    '     queryFn: () => fetchTileData(tile, timeframe),',
    '     staleTime: 30_000,',
    '+    placeholderData: keepPreviousData,',
    '   });',
    '+  return { ...query, isRefreshing: query.isFetching && query.isPlaceholderData };',
    ' }',
  ]),
  tool('Edit', 'src/dashboard/Tile.tsx', [
    '@@ -19,8 +19,9 @@ export function Tile({ tile, timeframe }: TileProps) {',
    '-  const { data, isLoading } = useTileData(tile, timeframe);',
    '-  if (isLoading) return <TileSkeleton />;',
    '+  const { data, isPending, isRefreshing } = useTileData(tile, timeframe);',
    '+  if (isPending) return <TileSkeleton />;',
    '   return (',
    '     <TileFrame title={tile.title}>',
    '+      {isRefreshing && <TileRefreshBar />}',
    '       <TileChart data={data} />',
  ]),
  tool('Bash', 'npx vitest run src/dashboard', [
    ' ✓ src/dashboard/TileGrid.test.tsx (7)',
    ' ✓ src/dashboard/useTileData.test.ts (5)',
    ' ❯ src/dashboard/Tile.test.tsx (9)',
    '   × resets chart zoom when the timeframe changes',
    '',
    '      Tests  1 failed | 20 passed (21)',
  ], 'error'),
  say(
    'The remount test is green. One regression, exactly the risk the plan called out: chart zoom used to reset as a side effect of remounting. Resetting it explicitly in `Tile.tsx`, then memoising the timeframe in the grid (step 2).',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  participant G as TileGrid',
    '  participant T as Tile',
    '  participant C as Chart',
    '  G->>T: timeframe changed (same key)',
    '  T->>C: resetZoom()',
    '  T->>T: keep previous data, show refresh bar',
    '```',
  ),
  tool('Edit', 'src/dashboard/Tile.tsx', [
    '@@ -27,0 +28,4 @@',
    '+  const chart = useRef<TileChartHandle>(null);',
    '+  useEffect(() => {',
    '+    chart.current?.resetZoom();',
    '+  }, [timeframe.from, timeframe.to]);',
  ]),
  tool('Edit', 'src/dashboard/TileGrid.tsx', 'Memoising the timeframe passed to tiles…', 'running'),
]);

const sFlaky = transcript('s-flaky', '2026-11-11T08:05:00Z', [
  user(
    'The checkout e2e failed on `main` twice this week and passed on retry both times. Find out whether it is the test or the product.',
  ),
  tool('Bash', 'jenkins history console-ui/main --stage "E2E" --last 40', [
    '#2291  passed   6m 12s',
    '#2290  FAILED   6m 48s   checkout.spec.ts › applies a promo code',
    '#2289  passed   6m 09s',
    '…',
    '#2271  FAILED   6m 51s   checkout.spec.ts › applies a promo code',
    '',
    '2 failures in 40 builds (5 %), same test, same assertion.',
  ]),
  tool('Read', 'e2e/checkout.spec.ts', [
    " 58  test('applies a promo code', async ({ page }) => {",
    " 59    await page.getByLabel('Promo code').fill('WELCOME10');",
    " 60    await page.getByRole('button', { name: 'Apply' }).click();",
    " 61    await expect(page.getByTestId('order-total')).toHaveText('€ 44.91');",
    ' 62  });',
  ]),
  tool('Bash', 'jenkins artifact console-ui/main #2290 trace.zip | npx playwright show-trace --summary', [
    'click  button "Apply"            +0 ms',
    'POST   /api/cart/promo            +4 ms    200  (312 ms)',
    'GET    /api/cart/total            +6 ms    200  (41 ms)   ← started before promo resolved',
    'expect order-total "€ 44.91"     timeout 5000 ms, received "€ 49.90"',
  ]),
  say(
    'The trace is telling: the total is re-fetched 2 ms after the promo request is *sent*, not after it resolves. When the promo call is slower than the total call, the UI ends up showing the old total — and nothing triggers another fetch.',
  ),
  tool('Read', 'src/checkout/PromoCodeField.tsx', [
    ' 31  const apply = () => {',
    ' 32    applyPromo.mutate(code);',
    " 33    queryClient.invalidateQueries({ queryKey: ['cart', 'total'] });",
    ' 34  };',
  ]),
  tool('Grep', '"invalidateQueries" in src/checkout', [
    'src/checkout/PromoCodeField.tsx:33',
    'src/checkout/QuantityStepper.tsx:27    onSuccess: () => queryClient.invalidateQueries(…)',
    'src/checkout/ShippingOptions.tsx:40    onSuccess: () => queryClient.invalidateQueries(…)',
  ]),
  tool(
    'Bash',
    'npx playwright test e2e/checkout.spec.ts -g "promo" --repeat-each 40 (promo API delayed by 300 ms)',
    ['  37 failed', '   3 passed', '', 'Without the artificial delay: 40 passed.'],
    'error',
  ),
  say(
    '### This is a product bug, not a flaky test',
    '',
    '`PromoCodeField.tsx:33` invalidates the cart total **immediately** instead of in `onSuccess`, unlike the two sibling components. If `POST /api/cart/promo` takes longer than `GET /api/cart/total`, the customer sees the undiscounted total until they change something else. With a 300 ms delay on the promo API it reproduces 37 out of 40 times; on CI it shows up in about 5 % of builds.',
    '',
    'Two ways forward:',
    '',
    '1. **Fix the race** — move the invalidation into `onSuccess` (3-line change) and add a unit test with a delayed promo response. The e2e test stays as it is and keeps guarding this path. Roughly 20 minutes including tests.',
    '2. **Quarantine the test** — tag it `@quarantine` so `main` stops going red, and file a ticket for the checkout team. Unblocks CI now, but the bug stays in production.',
    '',
    'I would do option 1; real customers can hit this. **Which one do you want — quarantine or fix?**',
  ),
]);

export const seedSessions: AgentSession[] = [
  {
    id: GLOBAL_SESSION_ID,
    workId: null,
    kind: 'chat',
    title: 'Cortex',
    status: 'waiting',
    model: MODEL,
    startedAt: '2026-11-11T07:30:00Z',
    messages: [],
  },
  {
    id: 's-1423-impl',
    workId: 'CTX-1423',
    kind: 'implement',
    title: 'Implement retry with backoff',
    status: 'done',
    model: MODEL,
    startedAt: '2026-11-10T13:02:00Z',
    messages: s1423,
  },
  {
    id: 's-1431-impl',
    workId: 'CTX-1431',
    kind: 'implement',
    title: 'Fix tile flicker',
    status: 'running',
    model: MODEL,
    startedAt: '2026-11-11T09:01:00Z',
    activity: 'Editing src/dashboard/TileGrid.tsx',
    messages: s1431impl,
  },
  {
    id: 's-1431-plan',
    workId: 'CTX-1431',
    kind: 'plan',
    title: 'Plan fix for tile flicker',
    status: 'done',
    model: MODEL,
    startedAt: '2026-11-11T08:20:00Z',
    messages: s1431plan,
  },
  {
    id: 's-flaky',
    workId: 'adhoc-flaky-e2e',
    kind: 'chat',
    title: 'Investigate flaky checkout e2e',
    status: 'waiting',
    model: MODEL,
    startedAt: '2026-11-11T08:05:00Z',
    activity: 'Needs your input: quarantine or fix?',
    messages: sFlaky,
  },
];

// ---- scripted agents ------------------------------------------------------------

export type ScriptStep = {
  /** shown on the work card while this step is the latest one */
  activity: string;
  message: DistributiveOmit<SessionMessage, 'id' | 'at'>;
};

/** Where the code for a work item plausibly lives — keeps scripts and plans concrete. */
interface CodeProfile {
  dir: string;
  main: string;
  second: string;
  test: string;
  symbol: string;
}

const PROFILES: Record<string, CodeProfile> = {
  'CTX-1423': {
    dir: 'src/webhooks',
    main: 'src/webhooks/dispatcher.ts',
    second: 'src/webhooks/retryPolicy.ts',
    test: 'test/webhooks/dispatcher.test.ts',
    symbol: 'WebhookDispatcher',
  },
  'CTX-1431': {
    dir: 'src/dashboard',
    main: 'src/dashboard/TileGrid.tsx',
    second: 'src/dashboard/useTileData.ts',
    test: 'src/dashboard/TileGrid.test.tsx',
    symbol: 'TileGrid',
  },
  'CTX-1440': {
    dir: 'src/settings',
    main: 'src/settings/NotificationForm.tsx',
    second: 'src/settings/NotificationSettingsPage.tsx',
    test: 'src/settings/NotificationForm.test.tsx',
    symbol: 'NotificationForm',
  },
  'CTX-1398': {
    dir: 'src/ratelimit',
    main: 'src/ratelimit/tokenBucket.ts',
    second: 'src/ratelimit/middleware.ts',
    test: 'test/ratelimit/tokenBucket.test.ts',
    symbol: 'TenantTokenBucket',
  },
  'review-482': {
    dir: 'src/cache',
    main: 'src/cache/queryCache.ts',
    second: 'src/cache/evictionPolicy.ts',
    test: 'test/cache/queryCache.test.ts',
    symbol: 'QueryCache',
  },
  'adhoc-flaky-e2e': {
    dir: 'src/checkout',
    main: 'src/checkout/PromoCodeField.tsx',
    second: 'src/checkout/useCartTotal.ts',
    test: 'src/checkout/PromoCodeField.test.tsx',
    symbol: 'PromoCodeField',
  },
};

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'as', 'and', 'with', 'when', 'by', 'per', 'add', 'fix',
  'spike', 'evaluate', 'investigate', 'returns', 'new', 'from', 'is', 'are', 'review',
]);

function profileOf(work: WorkItem): CodeProfile {
  const known = PROFILES[work.id];
  if (known) return known;
  const words = work.title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const picked = (words.length ? words : ['feature']).slice(0, 2);
  const pascal = picked.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  const camel = pascal[0].toLowerCase() + pascal.slice(1);
  const dir = `src/${picked[0]}`;
  const ui = /ui|web|console|frontend/.test(work.repo);
  return ui
    ? {
        dir,
        main: `${dir}/${pascal}.tsx`,
        second: `${dir}/use${pascal}.ts`,
        test: `${dir}/${pascal}.test.tsx`,
        symbol: pascal,
      }
    : {
        dir,
        main: `${dir}/${camel}.ts`,
        second: `${dir}/${camel}Config.ts`,
        test: `test/${picked[0]}/${camel}.test.ts`,
        symbol: `${pascal}Service`,
      };
}

const refOf = (work: WorkItem) => work.ticket?.key ?? work.title;
const branchOf = (work: WorkItem) => work.worktree?.branch ?? 'main';
const planPathOf = (work: WorkItem) => `.cortex/plans/${work.ticket?.key ?? work.id}.md`;

function planScript(work: WorkItem): ScriptStep[] {
  const p = profileOf(work);
  const key = work.ticket?.key;
  return [
    { activity: 'Reading the request', message: user(`/plan ${key ? `${key} ${work.title}` : work.title}`) },
    {
      activity: key ? `Reading ${key}` : 'Reading README.md',
      message: key
        ? tool('Read', `${key} — description, acceptance criteria and comments`, work.ticket?.descriptionMd)
        : tool('Read', 'README.md'),
    },
    {
      activity: `Searching ${work.repo} for ${p.symbol}`,
      message: tool('Grep', `"${p.symbol}" in src/`, [
        `${p.main}:14:export function ${p.symbol}(`,
        `${p.second}:6:import { ${p.symbol} } from './${p.main.split('/').pop()?.replace(/\.tsx?$/, '')}';`,
        `${p.test}:3:import { ${p.symbol} } from …`,
        '… 4 more matches in 3 files',
      ]),
    },
    { activity: `Reading ${p.main}`, message: tool('Read', p.main) },
    { activity: `Reading ${p.second}`, message: tool('Read', p.second) },
    {
      activity: 'Mapping the affected code',
      message: say(
        `The change is contained in \`${p.dir}\`: \`${p.symbol}\` is the entry point and has only two callers. Checking how well the current behaviour is covered before I decide where to cut.`,
      ),
    },
    { activity: `Reading ${p.test}`, message: tool('Read', p.test) },
    {
      activity: 'Checking recent history',
      message: tool('Bash', `git log --oneline -5 -- ${p.dir}`, [
        `3fa91c0 Tidy up ${p.symbol} props`,
        '8d02e6b Bump shared components to 4.2',
        `c7715ae Extract ${p.second.split('/').pop()}`,
      ]),
    },
    {
      activity: 'Looking for existing patterns to reuse',
      message: tool('Grep', '"useSettingsForm|FormActions|keepPreviousData" in src/', '6 matches in 4 files'),
    },
    {
      activity: 'Weighing options',
      message: say(
        'There is an established pattern for this elsewhere in the repo, so the plan can reuse it instead of inventing a new one. Existing tests cover the happy path only — the plan adds the missing edge cases first so the refactoring has a safety net.',
      ),
    },
    {
      activity: 'Writing the plan',
      message: tool('Write', planPathOf(work), 'Plan saved and attached to the work item.'),
    },
    { activity: 'Plan ready', message: say(planFor(work)) },
  ];
}

function implementScript(work: WorkItem): ScriptStep[] {
  const p = profileOf(work);
  const ref = refOf(work);
  const hasPlan = !!work.planMd;
  return [
    {
      activity: 'Reading the request',
      message: user(
        `/implement ${ref}`,
        '',
        hasPlan ? 'Follow the plan. Keep the diff small and add tests.' : `${work.title}. Keep the diff small and add tests.`,
      ),
    },
    {
      activity: 'Checking the worktree',
      message: tool('Bash', 'git status --short && git branch --show-current', [branchOf(work), '(clean)']),
    },
    hasPlan
      ? { activity: 'Reading the plan', message: tool('Read', planPathOf(work)) }
      : { activity: `Searching for ${p.symbol}`, message: tool('Grep', `"${p.symbol}" in src/`, '7 matches in 4 files') },
    { activity: `Reading ${p.main}`, message: tool('Read', p.main) },
    { activity: `Reading ${p.second}`, message: tool('Read', p.second) },
    {
      activity: 'Deciding where to cut',
      message: say(
        `I have what I need. The core change goes into \`${p.main}\`; \`${p.second}\` only needs to pass the new option through. Writing the test first so the change is pinned.`,
      ),
    },
    {
      activity: `Editing ${p.test}`,
      message: tool('Edit', p.test, [
        '@@ -40,0 +41,9 @@',
        `+  it('covers ${ref}: ${work.title.toLowerCase()}', async () => {`,
        `+    const subject = setup${p.symbol}();`,
        '+    await subject.run();',
        '+    expect(subject.result()).toMatchObject({ ok: true });',
        '+  });',
      ]),
    },
    {
      activity: `Editing ${p.main}`,
      message: tool('Edit', p.main, [
        `@@ -22,7 +22,14 @@ export function ${p.symbol}(`,
        '-  const result = legacyPath(input);',
        '-  return result;',
        '+  const options = resolveOptions(input, defaults);',
        '+  const result = run(options);',
        '+  if (!result.ok) {',
        '+    return handleFailure(result, options);',
        '+  }',
        '+  return result;',
      ]),
    },
    {
      activity: `Editing ${p.second}`,
      message: tool('Edit', p.second, ['@@ -9,1 +9,2 @@', '-  return create(input);', '+  return create(input, { ...defaults, ...overrides });']),
    },
    { activity: 'Type-checking', message: tool('Bash', 'npx tsc --noEmit', 'No errors.') },
    {
      activity: 'Running unit tests',
      message: tool(
        'Bash',
        `npx vitest run ${p.dir}`,
        [
          ` ❯ ${p.test} (12)`,
          '   × keeps the previous behaviour when no options are passed',
          "     TypeError: Cannot read properties of undefined (reading 'timeout')",
          '',
          '      Tests  1 failed | 11 passed (12)',
        ],
        'error',
      ),
    },
    {
      activity: 'Fixing a failing test',
      message: say('One existing test fails: callers that pass no options hit an `undefined` default. That is a real bug in my change, not in the test — adding the fallback.'),
    },
    {
      activity: `Editing ${p.main}`,
      message: tool('Edit', p.main, ['@@ -22,1 +22,1 @@', '-  const options = resolveOptions(input, defaults);', '+  const options = resolveOptions(input ?? {}, defaults);']),
    },
    {
      activity: 'Running unit tests',
      message: tool('Bash', `npx vitest run ${p.dir}`, [` ✓ ${p.test} (12)`, '', '      Tests  12 passed (12)', '   Duration  1.31s']),
    },
    {
      activity: 'Committing',
      message: tool('Bash', 'npm run lint && git commit (3 commits)', [
        'Found 0 warnings and 0 errors.',
        `e19b7c4 ${ref} Add failing test for the new behaviour`,
        `5a0d3f8 ${ref} ${work.title}`,
        `b64c1e0 ${ref} Keep defaults for callers without options`,
      ]),
    },
    {
      activity: 'Summarising',
      message: say(
        `### Done — ${work.title}`,
        '',
        `**What changed** (\`${branchOf(work)}\`, 3 commits)`,
        '',
        `- \`${p.main}\` — the actual change, including the failure path.`,
        `- \`${p.second}\` — passes the new options through; defaults unchanged for existing callers.`,
        `- \`${p.test}\` — one new test, all 12 green.`,
        '',
        '**Verified:** `tsc` clean, lint clean, unit tests green. Not run: e2e — that is cheaper on CI.',
        '',
        '**Next:** run a self-review or open a draft PR to let CI have a go.',
      ),
    },
  ];
}

function reviewScript(work: WorkItem): ScriptStep[] {
  const p = profileOf(work);
  const base = work.worktree?.baseBranch ?? 'main';
  return [
    {
      activity: 'Reading the request',
      message: user(`/review my changes on \`${branchOf(work)}\` before anyone else sees them. Be picky.`),
    },
    {
      activity: 'Collecting the diff',
      message: tool('Bash', `git diff ${base}...HEAD --stat`, [
        ` ${p.main}   | 48 ++++++++++++-----`,
        ` ${p.second} | 11 ++--`,
        ` ${p.test}   | 37 +++++++++++`,
        ' 3 files changed, 81 insertions(+), 15 deletions(-)',
      ]),
    },
    { activity: `Reading ${p.main}`, message: tool('Read', p.main) },
    { activity: `Reading ${p.second}`, message: tool('Read', p.second) },
    {
      activity: 'Checking callers',
      message: tool('Grep', `"${p.symbol}" in src/`, [
        `${p.main}:14`,
        `${p.second}:6`,
        `${p.dir}/index.ts:3`,
        'src/app/routes.tsx:41',
      ]),
    },
    {
      activity: 'Reviewing the core change',
      message: say(
        `The main change in \`${p.main}\` reads well. Two things I want to verify before judging: whether the failure path is covered by a test, and whether the caller in \`src/app/routes.tsx\` relies on the old default.`,
      ),
    },
    { activity: `Reading ${p.test}`, message: tool('Read', p.test) },
    { activity: 'Reading src/app/routes.tsx', message: tool('Read', 'src/app/routes.tsx') },
    {
      activity: 'Scanning for leftovers',
      message: tool('Grep', '"console\\.log|TODO|as any" in changed files', [
        `${p.main}:57:    // TODO: remove once the legacy path is gone`,
        `${p.test}:12:  const subject = setup${p.symbol}() as any;`,
      ]),
    },
    {
      activity: 'Running tests with coverage',
      message: tool('Bash', `npx vitest run ${p.dir} --coverage`, [
        '      Tests  12 passed (12)',
        '',
        ' File                 | % Stmts | % Branch | Uncovered lines',
        ` ${p.main.split('/').pop()}`.padEnd(22) + '|   91.3  |   75.0   | 44-47',
      ]),
    },
    { activity: 'Linting', message: tool('Bash', 'npm run lint', 'Found 0 warnings and 0 errors.') },
    {
      activity: 'Writing up findings',
      message: say(
        '### Self-review — good to go after one fix',
        '',
        '**Should fix**',
        '',
        `1. \`${p.main}:44-47\` — the failure branch has no test (the only uncovered lines). It is the part of the change most likely to break silently; add a case that forces the error.`,
        '',
        '**Nits**',
        '',
        `- \`${p.test}:12\` — \`as any\` hides the setup type; \`ReturnType<typeof setup${p.symbol}>\` works.`,
        `- \`${p.main}:57\` — the \`TODO\` has no ticket reference; reviewers will ask.`,
        '- Commit 2 mixes a rename with the behaviour change; splitting it makes the PR easier to read.',
        '',
        '**Looks good**',
        '',
        '- No public API change, both callers checked.',
        '- Types, lint and the 12 existing tests are green.',
        '',
        'Want me to fix item 1 and the nits?',
      ),
    },
  ];
}

function fixCiScript(work: WorkItem): ScriptStep[] {
  const p = profileOf(work);
  const ref = refOf(work);
  const pl = work.pipeline;
  const job = pl?.job ?? `${work.repo}/${branchOf(work)}`;
  const build = pl ? `#${pl.buildNumber}` : 'the latest build';
  const stage = pl?.stages.find((s) => s.status === 'failed')?.name ?? 'Unit tests';
  const testName = `${p.symbol} › handles a slow upstream`;
  return [
    {
      activity: 'Reading the request',
      message: user(`/fix-ci ${build} of \`${job}\` failed in stage "${stage}". Find the cause and fix it.`),
    },
    {
      activity: `Fetching the log of ${build}`,
      message: tool('Bash', `jenkins log ${job} ${build} --stage "${stage}" | tail -30`, [
        ` FAIL  ${p.test} > ${testName}`,
        'AssertionError: expected 1 to be 2 // Object.is equality',
        `  at ${p.test}:88:31`,
        '',
        ' Test Files  1 failed | 41 passed (42)',
        '      Tests  1 failed | 386 passed (387)',
        `Stage "${stage}" failed after 2m 14s`,
      ]),
    },
    {
      activity: 'Reading the failing test',
      message: say(`One failing test: \`${testName}\`. Everything else in the stage is green, so this is not an infrastructure problem. Looking at the test and the code it exercises.`),
    },
    { activity: `Reading ${p.test}`, message: tool('Read', `${p.test} (lines 70–95)`) },
    { activity: `Reading ${p.main}`, message: tool('Read', p.main) },
    {
      activity: 'Reproducing locally',
      message: tool(
        'Bash',
        `npx vitest run ${p.test} -t "slow upstream"`,
        [' × handles a slow upstream', '   AssertionError: expected 1 to be 2', '', '      Tests  1 failed (1)'],
        'error',
      ),
    },
    {
      activity: 'Checking what changed',
      message: tool('Bash', `git log --oneline -3 -- ${p.main}`, [
        `5a0d3f8 ${ref} ${work.title}`,
        `3fa91c0 Tidy up ${p.symbol} props`,
      ]),
    },
    {
      activity: 'Narrowing down the cause',
      message: say(
        `Reproduces locally, so it is deterministic. The test expects a second attempt after a timeout; since \`5a0d3f8\` the timeout is treated as a final failure because the new guard checks \`result.status\`, which is \`undefined\` for timeouts. The test is right, the code is wrong.`,
      ),
    },
    {
      activity: `Editing ${p.main}`,
      message: tool('Edit', p.main, [
        '@@ -31,3 +31,3 @@',
        '-  if (result.status >= 500) {',
        '+  if (result.status === undefined || result.status >= 500) {',
        '     return retry(options);',
        '   }',
      ]),
    },
    {
      activity: 'Running the failing test',
      message: tool('Bash', `npx vitest run ${p.test} -t "slow upstream"`, [' ✓ handles a slow upstream', '', '      Tests  1 passed (1)']),
    },
    {
      activity: `Running the full "${stage}" stage locally`,
      message: tool('Bash', 'npm test', [' Test Files  42 passed (42)', '      Tests  387 passed (387)', '   Duration  38.2s']),
    },
    {
      activity: 'Pushing the fix',
      message: tool('Bash', `git commit -m "${ref} Treat timeouts as retryable" && git push`, [
        `[${branchOf(work)} 9d41f0a] ${ref} Treat timeouts as retryable`,
        ' 1 file changed, 1 insertion(+), 1 deletion(-)',
        `To origin  ${branchOf(work)} -> ${branchOf(work)}`,
      ]),
    },
    {
      activity: 'Summarising',
      message: say(
        `### CI fix pushed`,
        '',
        `**Cause:** ${build} failed in "${stage}" on \`${testName}\`. A timeout has no HTTP status, and the guard added in \`5a0d3f8\` only retried when \`status >= 500\` — so timeouts were no longer retried.`,
        '',
        `**Fix:** one line in \`${p.main}\` (treat a missing status as retryable), commit \`9d41f0a\`.`,
        '',
        '**Verified locally:** the failing test and the full suite (387 tests) are green.',
        '',
        'The push triggered a new build — it shows up in the Pipeline tab.',
      ),
    },
  ];
}

/**
 * The scripted transcript the simulator plays back (one step every ~1s) when an
 * agent of `kind` is launched on `work`. The first step is the user prompt, the
 * last one the assistant's final summary.
 */
export function agentScript(kind: AgentKind, work: WorkItem): ScriptStep[] {
  switch (kind) {
    case 'plan':
      return planScript(work);
    case 'implement':
      return implementScript(work);
    case 'review':
      return reviewScript(work);
    case 'fix-ci':
      return fixCiScript(work);
    default:
      return [];
  }
}

/** Markdown implementation plan stored on the work item once a plan agent finishes. */
export function planFor(work: WorkItem): string {
  const key = work.ticket?.key ?? work.id;
  if (key === 'CTX-1431') return PLAN_1431;
  if (key === 'CTX-1440') return PLAN_1440;

  const p = profileOf(work);
  const isBug = work.ticket?.type === 'Bug';
  const criteria = work.ticket?.acceptanceCriteria ?? [];
  return md(
    `## Plan · ${work.ticket ? `${work.ticket.key} ` : ''}${work.title}`,
    '',
    '### Context',
    `${work.ticket?.descriptionMd ?? work.title} The affected code lives in \`${p.dir}\` of \`${work.repo}\`; \`${p.symbol}\` is the entry point and has two callers.`,
    '',
    '### Approach',
    isBug
      ? 'Pin the faulty behaviour with a failing test first, then fix it at the source instead of guarding against it in the callers. No public API change.'
      : `Extend \`${p.symbol}\` behind its existing interface so current callers keep working unchanged, and make the new behaviour configurable with a conservative default.`,
    '',
    '### Steps',
    `1. \`${p.test}\` — add ${isBug ? 'a failing test that reproduces the report' : 'tests describing the new behaviour'}.`,
    `2. \`${p.main}\` — implement the change; keep the old code path for callers that pass no options.`,
    `3. \`${p.second}\` — pass the new options through and document the defaults.`,
    `4. \`${p.dir}/index.ts\` — export what other modules need; nothing else becomes public.`,
    '5. `CHANGELOG.md` — one line under "Unreleased".',
    '',
    '### Test plan',
    `- Unit: \`${p.test}\` — happy path, failure path and the "no options" default.`,
    '- Manual: run the app locally and walk through the acceptance criteria.',
    ...(criteria.length ? criteria.map((c) => `  - ${c}`) : []),
    '- CI: full pipeline on the draft PR before asking for review.',
    '',
    '### Risks',
    '- **Hidden callers** outside this package — check with a repo-wide search before changing defaults.',
    '- **Behaviour drift** for existing users; mitigated by keeping the default path identical.',
    `- Estimate: ${work.ticket?.storyPoints ? `${work.ticket.storyPoints} points holds` : 'about half a day'} including review.`,
  );
}

// ---- canned chat replies ----------------------------------------------------------

type Topic = 'attention' | 'ci' | 'pr' | 'plan' | 'summary' | 'flaky' | 'thanks' | 'default';

function topicOf(text: string): Topic {
  const t = text.toLowerCase();
  if (/\b(quarantine|race|flak)/.test(t)) return 'flaky';
  if (/\b(ci|build|pipeline|jenkins|failing|failed|red)\b/.test(t)) return 'ci';
  if (/\b(pr|prs|pull request|review|feedback|comments?|merge)\b/.test(t)) return 'pr';
  if (/\b(plan|day|today|next|priorit|schedule)/.test(t)) return 'plan';
  if (/\b(attention|urgent|blocked|blocking|waiting|status|what'?s up|needs me)\b/.test(t)) return 'attention';
  if (/\b(summar|recap|overview|tl;?dr|standup|stand-up)/.test(t)) return 'summary';
  if (/^(thanks|thank you|ok|okay|great|cool|nice|perfect)\b/.test(t)) return 'thanks';
  return 'default';
}

function globalReply(topic: Topic): string {
  switch (topic) {
    case 'attention':
      return md(
        'Three things need you, in this order:',
        '',
        '1. **CTX-1423 webhook retry** — CI failed in the integration stage and Mila requested changes. Nothing moves there until you (or a Fix CI agent) pick it up.',
        '2. **Flaky checkout e2e** — the investigation is finished and waiting for a decision: quarantine the test or fix the race in `PromoCodeField.tsx`. It is a real product bug, so I would fix it.',
        '3. **PR #482** (evict query cache entries by tenant) — your review was requested this morning.',
        '',
        'Not blocked on you: **CTX-1431** has an agent running, **CTX-1398** is approved and green — ready to merge whenever you like.',
      );
    case 'ci':
      return md(
        'One red build right now:',
        '',
        '- **CTX-1423** `ingest-gateway/PR-491` — failed in the integration stage. `webhook-e2e.it.ts` still expects a single delivery attempt, which is exactly what the retry change altered. This looks like a test that needs updating rather than a regression.',
        '',
        'Everything else is fine: **CTX-1398** is green, **#482** is green, and `console-ui/main` has passed since the flaky checkout run yesterday (that one fails in about 5 % of builds).',
        '',
        'Open CTX-1423 and launch **Fix CI** if you want me to take it.',
      );
    case 'pr':
      return md(
        "Yesterday's PR feedback in short:",
        '',
        '- **#491 · CTX-1423 webhook retry** — *changes requested* by Mila Novak. Main points: cap the total retry window (not only the per-attempt delay), and do not retry `429` without honouring `Retry-After`. Jonas has not reviewed yet.',
        '- **#476 · CTX-1398 tenant rate limit** — *approved* by Mila and Jonas, CI green. Ready to merge.',
        '- **#482 · query cache eviction** — waiting for **your** review; 3 files, mostly `queryCache.ts`.',
        '',
        'The two comments on #491 are both small. An Implement agent can address them in one pass.',
      );
    case 'plan':
      return md(
        'A sensible order for today:',
        '',
        '1. **Merge CTX-1398** — approved and green, two minutes, gets it off the board.',
        '2. **Answer the flaky e2e question** — a one-word decision unblocks that agent.',
        '3. **Review PR #482** — someone is waiting on you; about 20 minutes.',
        '4. **CTX-1423** — launch Fix CI for the integration stage, then address Mila\'s two comments.',
        '5. **CTX-1431** — the implement agent should be done by then; self-review and open the PR.',
        '',
        'If there is time left, **CTX-1440** (notification settings migration) has not been started — a Plan agent can prepare it in the background while you do the reviews.',
      );
    case 'summary':
      return md(
        'Where things stand:',
        '',
        '| Work | State |',
        '| --- | --- |',
        '| CTX-1423 webhook retry | CI failed, changes requested |',
        '| CTX-1431 tile flicker | implement agent running |',
        '| PR #482 cache eviction | your review requested |',
        '| CTX-1398 rate limit | approved and green — ready to merge |',
        '| Flaky checkout e2e | waiting for your input |',
        '| CTX-1440 notification settings | not started |',
        '',
        'Three tickets are still in the backlog: CTX-1452, CTX-1457 and CTX-1461.',
      );
    case 'flaky':
      return md(
        'The flaky checkout e2e turned out to be a real race: `PromoCodeField.tsx` invalidates the cart total before the promo request has resolved. It fails in roughly 5 % of builds on `main`.',
        '',
        'The investigation is waiting for your call — **quarantine** the test or **fix** the race. Open the work item to answer; the fix is a three-line change.',
      );
    case 'thanks':
      return 'Any time. I will keep an eye on the running agent and the red build in the meantime.';
    default:
      return md(
        'I can see six work items at the moment: **CTX-1423** (CI failed, changes requested), **CTX-1431** (agent running), a review of **PR #482**, **CTX-1398** (ready to merge), the **flaky e2e** investigation (waiting for you) and **CTX-1440** (not started).',
        '',
        'I can help across all of them, for example:',
        '',
        '- "What needs my attention?"',
        '- "What\'s failing on CI?"',
        '- "Summarise yesterday\'s PR feedback"',
        '- "Plan my day"',
        '',
        'For anything that touches code, select the work item on the left — agents run inside its worktree.',
      );
  }
}

function workReply(topic: Topic, text: string, work: WorkItem): string {
  const p = profileOf(work);
  const ref = refOf(work);
  const pl = work.pipeline;
  const pr = work.pr;

  if (work.id === 'adhoc-flaky-e2e' && (topic === 'flaky' || topic === 'default')) {
    if (/quarantin/i.test(text) && !/fix/i.test(text)) {
      return md(
        'Understood — **quarantining** the test for now.',
        '',
        '1. Tag `applies a promo code` in `e2e/checkout.spec.ts` with `@quarantine` so it no longer gates `main`.',
        '2. Draft a bug for the checkout team with the trace from build #2290 and the 37 / 40 reproduction.',
        '',
        'Keep in mind the race stays in production until that ticket is picked up. Launch **Implement** on this work item and I will make the change and write the ticket text.',
      );
    }
    return md(
      'Understood — going with the **fix**; the quarantine tag stays off.',
      '',
      'What I will do:',
      '',
      "1. Move `invalidateQueries` in `src/checkout/PromoCodeField.tsx` into the mutation's `onSuccess`.",
      '2. Add a unit test with a delayed promo response in `PromoCodeField.test.tsx`.',
      '3. Re-run `e2e/checkout.spec.ts` 40× with the 300 ms delay to prove the race is gone.',
      '',
      'This needs a worktree. Launch **Implement** on this work item and I will take it from there.',
    );
  }

  switch (topic) {
    case 'ci': {
      if (!pl) return `There is no pipeline for **${ref}** yet — CI starts once a PR exists. Unit tests can be run locally with \`npx vitest run ${p.dir}\`.`;
      const failed = pl.stages.find((s) => s.status === 'failed');
      if (pl.status === 'failed') {
        return md(
          `Build **#${pl.buildNumber}** of \`${pl.job}\` failed${failed ? ` in stage **${failed.name}**` : ''}.`,
          '',
          failed?.tests
            ? `${failed.tests.failed} test(s) failed, ${failed.tests.passed} passed. The failures are in the area this branch touches, so this is most likely caused by the change rather than by flakiness.`
            : 'The failure is in the area this branch touches, so it is most likely caused by the change rather than by flakiness.',
          '',
          'Launch **Fix CI** and I will read the log, reproduce it locally and push a fix.',
        );
      }
      return `Build **#${pl.buildNumber}** of \`${pl.job}\` is **${pl.status}** on \`${pl.branch}\` (${pl.stages.length} stages). Nothing to do on the CI side right now.`;
    }
    case 'pr': {
      if (!pr) return `**${ref}** has no pull request yet. Once the implementation is committed, run a **Self-review** and open a draft PR from the header.`;
      const open = pr.threads.filter((t) => !t.resolved).length;
      return md(
        `**#${pr.number} · ${pr.title}** is \`${pr.state}\` (\`${pr.sourceBranch}\` → \`${pr.targetBranch}\`).`,
        '',
        ...pr.reviewers.map((r) => `- ${r.name}: ${r.state.replace('-', ' ')}`),
        '',
        open
          ? `${open} unresolved thread${open === 1 ? '' : 's'}. I can go through them and propose changes — launch **Implement** and point me at the review.`
          : 'No unresolved threads.',
      );
    }
    case 'plan':
      return work.planMd
        ? md(
            `There is already a plan for **${ref}** (see the ticket tab). In short: the change is contained in \`${p.dir}\`, starts with a test in \`${p.test}\`, and touches \`${p.main}\` and \`${p.second}\`.`,
            '',
            'Launch **Implement** to execute it, or tell me what to change in the plan first.',
          )
        : md(
            `No plan for **${ref}** yet. From a first look the change is centred on \`${p.main}\`.`,
            '',
            'Launch a **Plan** agent and I will read the ticket and the code, then write up approach, steps, test plan and risks.',
          );
    case 'summary':
    case 'attention':
      return md(
        `**${ref} · ${work.title}** (\`${work.repo}\`)`,
        '',
        `- Ticket: ${work.ticket ? `${work.ticket.status}, ${work.ticket.priority} priority` : 'none — ad-hoc work'}`,
        `- Branch: ${work.worktree ? `\`${work.worktree.branch}\`, ${work.worktree.ahead} ahead / ${work.worktree.behind} behind \`${work.worktree.baseBranch}\`` : 'no worktree yet'}`,
        `- Plan: ${work.planMd ? 'written' : 'not yet'}`,
        `- PR: ${pr ? `#${pr.number}, ${pr.state.replace('-', ' ')}` : 'none'}`,
        `- CI: ${pl ? `build #${pl.buildNumber} ${pl.status}` : 'no builds'}`,
        '',
        pl?.status === 'failed'
          ? 'The red build is the thing to deal with first.'
          : pr?.state === 'approved'
            ? 'Approved — nothing is stopping you from merging.'
            : !work.worktree
              ? 'Next step: create a worktree and launch a Plan agent.'
              : 'Nothing is blocked right now.',
      );
    case 'thanks':
      return 'You are welcome. I am here if anything else comes up on this one.';
    default:
      return md(
        `Looking at **${ref}** in \`${work.repo}\`: the relevant code is in \`${p.dir}\`, with \`${p.symbol}\` in \`${p.main}\` as the entry point${work.worktree ? ` (branch \`${work.worktree.branch}\`)` : ''}.`,
        '',
        'In this chat I can answer questions about the ticket, the code, the PR and CI. For changes, launch one of the agents:',
        '',
        '- **Plan** — reads ticket and code, writes an implementation plan',
        '- **Implement** — makes the change in the worktree, with tests',
        '- **Self-review** — reviews the branch diff before a PR',
        '- **Fix CI** — reads the failing build and pushes a fix',
      );
  }
}

/** Assistant reply to a free-form user message. `work` is null in the global chat. */
export function cannedReply(text: string, work: WorkItem | null): string {
  const topic = topicOf(text);
  return work ? workReply(topic, text, work) : globalReply(topic);
}
