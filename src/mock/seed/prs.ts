import type { DiffFile, DiffHunk, DiffLine, PullRequest, ReviewThread, WorkItem } from '../../model/types';

// ---- diff authoring helper -------------------------------------------------

const LANGUAGES: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  java: 'java',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  md: 'md',
};

/**
 * Turns a compact unified diff into a `DiffFile`.
 *
 * Hunks start with `@@ <oldStart> @@ optional section heading`; every other
 * line starts with ' ' (context), '+' (added) or '-' (removed). Only the old
 * start line is authored — new line numbers, hunk ranges and the +/- totals
 * are derived, so the numbering is always consistent across hunks.
 */
function diff(path: string, status: DiffFile['status'], source: string): DiffFile {
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  /** new line number minus old line number, accumulated over previous hunks */
  let offset = 0;
  let current: { oldStart: number; section: string; lines: DiffLine[] } | undefined;
  let oldNo = 0;
  let newNo = 0;

  const flush = () => {
    if (!current) return;
    const oldCount = current.lines.filter((l) => l.type !== 'add').length;
    const newCount = current.lines.filter((l) => l.type !== 'del').length;
    const oldStart = oldCount === 0 ? 0 : current.oldStart;
    const newStart = newCount === 0 ? 0 : current.oldStart + offset;
    hunks.push({
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${current.section ? ` ${current.section}` : ''}`,
      lines: current.lines,
    });
    offset += newCount - oldCount;
    current = undefined;
  };

  for (const raw of source.replace(/^\n/, '').replace(/\n$/, '').split('\n')) {
    const header = /^@@ (\d+) @@ ?(.*)$/.exec(raw);
    if (header) {
      flush();
      const oldStart = Number(header[1]);
      current = { oldStart, section: header[2], lines: [] };
      oldNo = oldStart;
      newNo = oldStart + offset;
      continue;
    }
    if (!current) continue;
    const marker = raw[0];
    const content = raw.slice(1);
    if (marker === '+') {
      current.lines.push({ type: 'add', newNo: newNo++, content });
      additions++;
    } else if (marker === '-') {
      current.lines.push({ type: 'del', oldNo: oldNo++, content });
      deletions++;
    } else {
      current.lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, content });
    }
  }
  flush();

  const ext = path.slice(path.lastIndexOf('.') + 1);
  return { path, status, language: LANGUAGES[ext] ?? ext, additions, deletions, hunks };
}

/** Whole new file: every line is an addition. */
const added = (path: string, content: string): DiffFile =>
  diff(
    path,
    'added',
    '@@ 1 @@\n' +
      content
        .replace(/^\n/, '')
        .replace(/\n$/, '')
        .split('\n')
        .map((l) => `+${l}`)
        .join('\n'),
  );

/** New-side line number of the first line containing `snippet` — keeps thread anchors honest. */
function lineOf(file: DiffFile, snippet: string): number {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.newNo !== undefined && line.content.includes(snippet)) return line.newNo;
    }
  }
  throw new Error(`prs.ts: "${snippet}" not found in ${file.path}`);
}

const thread = (
  id: string,
  file: DiffFile,
  snippet: string,
  resolved: boolean,
  comments: [author: string, at: string, body: string][],
): ReviewThread => ({
  id,
  filePath: file.path,
  line: lineOf(file, snippet),
  side: 'new',
  resolved,
  comments: comments.map(([author, at, body], i) => ({ id: `${id}-c${i + 1}`, author, at, body })),
});

// ---- #491 · CTX-1423 · webhook retry (ingest-gateway) -----------------------

const retryTs = added(
  'src/dispatcher/retry.ts',
  `
import { setTimeout as sleep } from 'node:timers/promises';

export interface RetryPolicy {
  /** Total attempts including the first one. */
  maxAttempts: number;
  /** Delay before the first retry, in milliseconds. */
  baseDelayMs: number;
  /** Upper bound for a single delay. */
  maxDelayMs: number;
  /** 0 = no jitter, 1 = full jitter. */
  jitter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 30_000,
  jitter: 0.5,
};

export class RetryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super('Giving up after ' + attempts + ' attempts');
    this.name = 'RetryExhaustedError';
  }
}

/** Exponential backoff: base * 2^(attempt - 1), capped, with jitter. */
export function backoffDelay(attempt: number, policy: RetryPolicy, random = Math.random): number {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const spread = capped * policy.jitter;
  return Math.round(capped - spread + random() * spread);
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === policy.maxAttempts) break;
      await sleep(backoffDelay(attempt, policy));
    }
  }
  throw new RetryExhaustedError(policy.maxAttempts, lastError);
}
`,
);

const dispatcherTs = diff(
  'src/dispatcher/webhook-dispatcher.ts',
  'modified',
  `
@@ 1 @@
 import type { Logger } from 'pino';
 import type { Counter } from 'prom-client';
+import type { DispatcherConfig } from '../config/dispatcher.config';
 import type { DeliveryStore } from '../store/delivery-store';
+import { RetryExhaustedError, withRetry } from './retry';
 import { signPayload } from './signature';
 import type { WebhookEvent, WebhookTarget } from './types';

+const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
+
+class DeliveryError extends Error {
+  constructor(
+    readonly status: number | undefined,
+    message: string,
+  ) {
+    super(message);
+  }
+}
+
 export class WebhookDispatcher {
   constructor(
     private readonly store: DeliveryStore,
     private readonly log: Logger,
     private readonly delivered: Counter<'tenant' | 'outcome'>,
+    private readonly config: DispatcherConfig,
   ) {}

@@ 24 @@ export class WebhookDispatcher {
   async dispatch(event: WebhookEvent, target: WebhookTarget): Promise<void> {
     const body = JSON.stringify(event.payload);
     const signature = signPayload(body, target.secret);
+
+    try {
+      const attempts = await withRetry(
+        (attempt) => this.attempt(event, target, body, signature, attempt),
+        (error) => this.isRetryable(error),
+        this.config.retry,
+      );
+      this.delivered.inc({ tenant: event.tenantId, outcome: attempts > 1 ? 'retried' : 'ok' });
+      await this.store.markDelivered(event.id);
+    } catch (error) {
+      const cause = error instanceof RetryExhaustedError ? error.lastError : error;
+      const status = cause instanceof DeliveryError ? cause.status : undefined;
+      this.log.error({ eventId: event.id, status, err: cause }, 'webhook delivery failed permanently');
+      this.delivered.inc({ tenant: event.tenantId, outcome: 'failed' });
+      await this.store.markFailed(event.id, status);
+    }
+  }
+
+  private async attempt(
+    event: WebhookEvent,
+    target: WebhookTarget,
+    body: string,
+    signature: string,
+    attempt: number,
+  ): Promise<number> {
     const response = await fetch(target.url, {
       method: 'POST',
       headers: {
         'content-type': 'application/json',
         'x-cortex-signature': signature,
         'x-cortex-delivery': event.id,
+        'x-cortex-attempt': String(attempt),
       },
       body,
-      signal: AbortSignal.timeout(10_000),
+      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
     });
-
     if (!response.ok) {
-      this.log.warn({ eventId: event.id, status: response.status }, 'webhook delivery failed');
-      this.delivered.inc({ tenant: event.tenantId, outcome: 'failed' });
-      await this.store.markFailed(event.id, response.status);
-      return;
+      this.log.warn({ eventId: event.id, status: response.status, attempt }, 'webhook attempt failed');
+      throw new DeliveryError(response.status, 'Unexpected status ' + response.status);
     }
+    return attempt;
+  }

-    this.delivered.inc({ tenant: event.tenantId, outcome: 'ok' });
-    await this.store.markDelivered(event.id);
+  private isRetryable(error: unknown): boolean {
+    if (error instanceof DeliveryError) {
+      return error.status === undefined || RETRYABLE_STATUS.has(error.status);
+    }
+    // fetch() rejects with TypeError on network failures and DOMException on timeout
+    return error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
   }

   async flush(): Promise<void> {
`,
);

const dispatcherConfigTs = diff(
  'src/config/dispatcher.config.ts',
  'modified',
  `
@@ 1 @@
 import { z } from 'zod';

 export const dispatcherConfigSchema = z.object({
   concurrency: z.number().int().min(1).max(64).default(8),
-  requestTimeoutMs: z.number().int().positive().default(10_000),
+  requestTimeoutMs: z.number().int().positive().default(5_000),
+  retry: z
+    .object({
+      maxAttempts: z.number().int().min(1).max(10).default(5),
+      baseDelayMs: z.number().int().positive().default(250),
+      maxDelayMs: z.number().int().positive().default(30_000),
+      jitter: z.number().min(0).max(1).default(0.5),
+    })
+    .default({}),
 });

 export type DispatcherConfig = z.infer<typeof dispatcherConfigSchema>;
`,
);

const retryTestTs = added(
  'test/dispatcher/retry.test.ts',
  `
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, DEFAULT_RETRY_POLICY, RetryExhaustedError, withRetry } from '../../src/dispatcher/retry';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const policy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 4 };
const always = () => true;

describe('backoffDelay', () => {
  it('doubles the delay with every attempt', () => {
    const noJitter = { ...policy, jitter: 0 };
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, noJitter))).toEqual([250, 500, 1000, 2000]);
  });

  it('caps the delay at maxDelayMs', () => {
    expect(backoffDelay(12, { ...policy, jitter: 0 })).toBe(30_000);
  });

  it('keeps jittered delays within [capped * (1 - jitter), capped]', () => {
    expect(backoffDelay(3, policy, () => 0)).toBe(500);
    expect(backoffDelay(3, policy, () => 1)).toBe(1000);
  });
});

describe('withRetry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the first successful result', async () => {
    const op = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue('ok');
    await expect(withRetry(op, always, policy)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('stops immediately on non-retryable errors', async () => {
    const op = vi.fn().mockRejectedValue(new Error('400'));
    await expect(withRetry(op, () => false, policy)).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and exposes the last error', async () => {
    const boom = new Error('502');
    const op = vi.fn().mockRejectedValue(boom);
    const error = await withRetry(op, always, policy).catch((e) => e);
    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect(error.lastError).toBe(boom);
    expect(op).toHaveBeenCalledTimes(4);
  });
});
`,
);

// ---- #476 · CTX-1398 · per-tenant rate limit (ingest-gateway) ---------------

const tokenBucketTs = added(
  'src/ratelimit/token-bucket.ts',
  `
export interface BucketOptions {
  /** Maximum number of tokens the bucket can hold (burst size). */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export interface Decision {
  allowed: boolean;
  remaining: number;
  /** Seconds until enough tokens are available; 0 when allowed. */
  retryAfterSec: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class TenantRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly defaults: BucketOptions,
    private readonly overrides: ReadonlyMap<string, BucketOptions> = new Map(),
    private readonly now: () => number = Date.now,
  ) {}

  take(tenantId: string, cost = 1): Decision {
    const options = this.overrides.get(tenantId) ?? this.defaults;
    const bucket = this.refill(tenantId, options);

    if (bucket.tokens < cost) {
      const missing = cost - bucket.tokens;
      return {
        allowed: false,
        remaining: Math.floor(bucket.tokens),
        retryAfterSec: Math.max(1, Math.ceil(missing / options.refillPerSecond)),
      };
    }

    bucket.tokens -= cost;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSec: 0 };
  }

  /** Drops buckets that have been idle for a while so the map cannot grow unbounded. */
  sweep(idleMs = 10 * 60_000): number {
    const cutoff = this.now() - idleMs;
    let removed = 0;
    for (const [tenantId, bucket] of this.buckets) {
      if (bucket.updatedAt < cutoff) {
        this.buckets.delete(tenantId);
        removed++;
      }
    }
    return removed;
  }

  private refill(tenantId: string, options: BucketOptions): Bucket {
    const now = this.now();
    const bucket = this.buckets.get(tenantId) ?? { tokens: options.capacity, updatedAt: now };
    const elapsedSec = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(options.capacity, bucket.tokens + elapsedSec * options.refillPerSecond);
    bucket.updatedAt = now;
    this.buckets.set(tenantId, bucket);
    return bucket;
  }
}
`,
);

const rateLimitMiddlewareTs = added(
  'src/middleware/rate-limit.ts',
  `
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Counter } from 'prom-client';
import type { TenantRateLimiter } from '../ratelimit/token-bucket';

export function rateLimit(limiter: TenantRateLimiter, rejected: Counter<'tenant'>) {
  return async function onRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const tenantId = request.auth?.tenantId;
    if (!tenantId) return; // unauthenticated requests are rejected by the auth hook

    const decision = limiter.take(tenantId);
    reply.header('x-ratelimit-remaining', decision.remaining);
    if (decision.allowed) return;

    rejected.inc({ tenant: tenantId });
    request.log.info({ tenantId, retryAfterSec: decision.retryAfterSec }, 'rate limit exceeded');
    await reply
      .code(429)
      .header('retry-after', decision.retryAfterSec)
      .send({ error: 'rate_limited', retryAfterSec: decision.retryAfterSec });
  };
}
`,
);

const serverTs = diff(
  'src/server.ts',
  'modified',
  `
@@ 1 @@
 import Fastify from 'fastify';
 import { loadConfig } from './config';
 import { authenticate } from './middleware/auth';
+import { rateLimit } from './middleware/rate-limit';
 import { metrics } from './metrics';
+import { TenantRateLimiter } from './ratelimit/token-bucket';
 import { registerIngestRoutes } from './routes/ingest';
 import { registerWebhookRoutes } from './routes/webhooks';

@@ 18 @@ export async function buildServer() {
   const config = loadConfig();
   const app = Fastify({ logger: { level: config.logLevel } });

+  const limiter = new TenantRateLimiter(
+    config.rateLimit.defaults,
+    new Map(Object.entries(config.rateLimit.tenants)),
+  );
+  const sweeper = setInterval(() => limiter.sweep(), 60_000);
+  sweeper.unref();
+
   app.addHook('onRequest', authenticate(config.auth));
+  app.addHook('onRequest', rateLimit(limiter, metrics.rateLimited));
+  app.addHook('onClose', async () => clearInterval(sweeper));

   registerIngestRoutes(app, config);
   registerWebhookRoutes(app, config);
`,
);

const tokenBucketTestTs = added(
  'test/ratelimit/token-bucket.test.ts',
  `
import { describe, expect, it } from 'vitest';
import { type BucketOptions, TenantRateLimiter } from '../../src/ratelimit/token-bucket';

function setup(overrides = new Map<string, BucketOptions>()) {
  let now = 1_000_000;
  const limiter = new TenantRateLimiter({ capacity: 3, refillPerSecond: 1 }, overrides, () => now);
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe('TenantRateLimiter', () => {
  it('allows bursts up to capacity', () => {
    const { limiter } = setup();
    expect([1, 2, 3].map(() => limiter.take('acme').allowed)).toEqual([true, true, true]);
    expect(limiter.take('acme')).toEqual({ allowed: false, remaining: 0, retryAfterSec: 1 });
  });

  it('refills over time', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) limiter.take('acme');
    advance(2_000);
    expect(limiter.take('acme')).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('isolates tenants from each other', () => {
    const { limiter } = setup();
    for (let i = 0; i < 4; i++) limiter.take('acme');
    expect(limiter.take('globex').allowed).toBe(true);
  });

  it('applies per-tenant overrides', () => {
    const { limiter } = setup(new Map([['bigcorp', { capacity: 100, refillPerSecond: 50 }]]));
    for (let i = 0; i < 50; i++) expect(limiter.take('bigcorp').allowed).toBe(true);
  });

  it('sweeps idle buckets', () => {
    const { limiter, advance } = setup();
    limiter.take('acme');
    advance(11 * 60_000);
    expect(limiter.sweep()).toBe(1);
  });
});
`,
);

// ---- #482 · CTX-1377 · evict query cache by tenant (query-service) ----------

const queryCacheJava = diff(
  'src/main/java/com/cortex/query/cache/QueryCache.java',
  'modified',
  `
@@ 3 @@
 import com.github.benmanes.caffeine.cache.Cache;
 import com.github.benmanes.caffeine.cache.Caffeine;
+import com.github.benmanes.caffeine.cache.RemovalCause;
 import io.micrometer.core.instrument.MeterRegistry;
 import java.time.Duration;
+import java.util.Set;
+import java.util.concurrent.ConcurrentHashMap;
 import java.util.function.Supplier;
 import org.springframework.stereotype.Component;

@@ 14 @@ @Component
 public class QueryCache {

   private final Cache<CacheKey, QueryResult> cache;
+  private final ConcurrentHashMap<String, Set<CacheKey>> keysByTenant = new ConcurrentHashMap<>();
   private final MeterRegistry meters;

   public QueryCache(CacheProperties properties, MeterRegistry meters) {
     this.cache = Caffeine.newBuilder()
         .maximumSize(properties.maxEntries())
         .expireAfterWrite(Duration.ofSeconds(properties.ttlSeconds()))
+        .removalListener((CacheKey key, QueryResult value, RemovalCause cause) -> untrack(key))
         .recordStats()
         .build();
     this.meters = meters;
   }

   public QueryResult get(CacheKey key, Supplier<QueryResult> loader) {
-    return cache.get(key, k -> loader.get());
+    return cache.get(key, k -> {
+      keysByTenant.computeIfAbsent(k.tenantId(), t -> ConcurrentHashMap.newKeySet()).add(k);
+      return loader.get();
+    });
   }

@@ 38 @@ public class QueryCache {
   public void invalidate(CacheKey key) {
     cache.invalidate(key);
   }

+  /**
+   * Evicts every cached result of the given tenant, e.g. after a schema change
+   * or when the tenant is offboarded.
+   *
+   * @return number of evicted entries
+   */
+  public int evictTenant(String tenantId) {
+    Set<CacheKey> keys = keysByTenant.remove(tenantId);
+    if (keys == null) {
+      return 0;
+    }
+    cache.invalidateAll(keys);
+    meters.counter("query.cache.evictions", "reason", "tenant").increment(keys.size());
+    return keys.size();
+  }
+
+  private void untrack(CacheKey key) {
+    if (key == null) {
+      return;
+    }
+    keysByTenant.computeIfPresent(key.tenantId(), (tenant, keys) -> {
+      keys.remove(key);
+      return keys.isEmpty() ? null : keys;
+    });
+  }
+
   public CacheStats stats() {
     return cache.stats();
   }
`,
);

const evictionListenerJava = added(
  'src/main/java/com/cortex/query/cache/TenantEvictionListener.java',
  `
package com.cortex.query.cache;

import com.cortex.platform.events.TenantEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/** Drops cached query results when a tenant's data model changes. */
@Component
public class TenantEvictionListener {

  private static final Logger log = LoggerFactory.getLogger(TenantEvictionListener.class);

  private final QueryCache cache;

  public TenantEvictionListener(QueryCache cache) {
    this.cache = cache;
  }

  @KafkaListener(topics = "\${cortex.events.tenant-topic}", groupId = "query-service-cache")
  public void onTenantEvent(TenantEvent event) {
    switch (event.type()) {
      case SCHEMA_CHANGED, RETENTION_CHANGED, OFFBOARDED -> {
        int evicted = cache.evictTenant(event.tenantId());
        log.info("Evicted {} cache entries for tenant {} ({})", evicted, event.tenantId(), event.type());
      }
      default -> log.debug("Ignoring tenant event {}", event.type());
    }
  }
}
`,
);

const queryCacheTestJava = diff(
  'src/test/java/com/cortex/query/cache/QueryCacheTest.java',
  'modified',
  `
@@ 5 @@
 import static org.assertj.core.api.Assertions.assertThat;

 import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
+import java.time.Duration;
 import java.util.concurrent.atomic.AtomicInteger;
 import org.junit.jupiter.api.BeforeEach;
 import org.junit.jupiter.api.Test;
@@ 47 @@ class QueryCacheTest {
     assertThat(loads.get()).isEqualTo(1);
   }

+  @Test
+  void evictTenantRemovesOnlyThatTenant() {
+    cache.get(key("acme", "fetch logs"), () -> result(3));
+    cache.get(key("acme", "fetch spans"), () -> result(5));
+    cache.get(key("globex", "fetch logs"), () -> result(7));
+
+    int evicted = cache.evictTenant("acme");
+
+    assertThat(evicted).isEqualTo(2);
+    assertThat(loadCount(key("acme", "fetch logs"))).isEqualTo(2);
+    assertThat(loadCount(key("globex", "fetch logs"))).isEqualTo(1);
+  }
+
+  @Test
+  void evictTenantIsNoOpForUnknownTenant() {
+    assertThat(cache.evictTenant("nobody")).isZero();
+  }
+
+  @Test
+  void expiredEntriesAreUntracked() {
+    cache.get(key("acme", "fetch logs"), () -> result(3));
+    ticker.advance(Duration.ofSeconds(301));
+    cache.cleanUp();
+
+    assertThat(cache.evictTenant("acme")).isZero();
+  }
+
   private static CacheKey key(String tenant, String query) {
     return new CacheKey(tenant, query, TimeRange.lastHours(2));
   }
`,
);

const applicationYaml = diff(
  'src/main/resources/application.yaml',
  'modified',
  `
@@ 21 @@ cortex:
   query:
     cache:
       max-entries: 20000
       ttl-seconds: 300
+  events:
+    tenant-topic: platform.tenant-events.v1

 spring:
   kafka:
`,
);

// ---- seed PRs ----------------------------------------------------------------

/** Seed PRs keyed by work id. */
export const prs: Record<string, PullRequest> = {
  'CTX-1423': {
    number: 491,
    title: 'CTX-1423 Add retry with exponential backoff to webhook dispatcher',
    state: 'changes-requested',
    author: 'Sven Weber',
    sourceBranch: 'feature/CTX-1423-webhook-retry',
    targetBranch: 'main',
    descriptionMd: `Webhook deliveries are currently attempted exactly once; a single 502 from a customer endpoint drops the event. This adds retries with exponential backoff and jitter to the dispatcher.

**What changed**
- New \`withRetry\` helper (\`src/dispatcher/retry.ts\`) with a configurable \`RetryPolicy\` — 5 attempts, 250 ms base delay, capped at 30 s, 50 % jitter by default.
- \`WebhookDispatcher\` retries on network errors, timeouts and \`408/425/429/5xx\`; other \`4xx\` responses fail immediately.
- Each attempt carries an \`x-cortex-attempt\` header so receivers can deduplicate.
- Per-request timeout lowered from 10 s to 5 s, now configurable.

**How to test**
\`npm test -- retry\`, or point a webhook at \`scripts/flaky-receiver.ts\` and watch the \`outcome="retried"\` counter.

**Not in this PR**
Persisting retry state across restarts — tracked in CTX-1450.`,
    reviewers: [
      { name: 'Mila Novak', state: 'changes-requested' },
      { name: 'Jonas Becker', state: 'pending' },
    ],
    files: [retryTs, dispatcherTs, dispatcherConfigTs, retryTestTs],
    threads: [
      thread('t-491-1', retryTs, 'jitter: 0.5,', true, [
        [
          'Mila Novak',
          '2026-11-10T14:12:00Z',
          'Why 0.5 and not full jitter? With many deliveries failing at once (receiver outage) half-jitter still leaves fairly synchronized waves.',
        ],
        [
          'Sven Weber',
          '2026-11-10T15:03:00Z',
          'Deliberate: with full jitter the first retry can fire after ~0 ms, which is pointless for a 502. "Equal jitter" keeps a floor of half the delay. It is configurable per environment though — happy to switch the prod default if we see thundering herds.',
        ],
        ['Mila Novak', '2026-11-10T15:20:00Z', 'Fair enough, the floor argument convinces me.'],
      ]),
      thread('t-491-2', retryTs, 'throw new RetryExhaustedError(policy.maxAttempts, lastError);', false, [
        [
          'Mila Novak',
          '2026-11-11T08:31:00Z',
          'This also runs when we `break` on a **non-retryable** error, so a plain 400 surfaces as "Giving up after 5 attempts" although we tried once. Please rethrow the original error in that case and pass the real attempt count here.',
        ],
      ]),
      thread('t-491-3', dispatcherTs, 'RETRYABLE_STATUS.has(error.status)', false, [
        [
          'Mila Novak',
          '2026-11-11T08:36:00Z',
          'For `429` and `503` receivers usually send `Retry-After`. We ignore it and may hit them again after 250 ms. Can we honour the header (capped by `maxDelayMs`)?',
        ],
      ]),
    ],
    updatedAt: '2026-11-11T08:40:00Z',
  },

  'CTX-1398': {
    number: 476,
    title: 'CTX-1398 Rate limit API tokens per tenant',
    state: 'approved',
    author: 'Sven Weber',
    sourceBranch: 'feature/CTX-1398-tenant-rate-limit',
    targetBranch: 'main',
    descriptionMd: `Adds an in-memory token bucket per tenant in front of all authenticated routes, so one noisy tenant can no longer starve the ingest workers.

**What changed**
- \`TenantRateLimiter\` — token bucket with configurable capacity / refill rate and per-tenant overrides.
- \`rateLimit\` Fastify hook: responds \`429\` with \`retry-after\` and exposes \`x-ratelimit-remaining\`.
- Idle buckets are swept once a minute.
- New counter \`ingest_rate_limited_total{tenant}\`.

**Rollout**
Defaults (\`200\` burst, \`50/s\`) are well above today's p99 per tenant; overrides for the three largest tenants are in the config PR.`,
    reviewers: [
      { name: 'Mila Novak', state: 'approved' },
      { name: 'Jonas Becker', state: 'approved' },
    ],
    files: [tokenBucketTs, rateLimitMiddlewareTs, serverTs, tokenBucketTestTs],
    threads: [
      thread('t-476-1', tokenBucketTs, 'sweep(idleMs = 10 * 60_000): number {', true, [
        [
          'Jonas Becker',
          '2026-11-09T10:05:00Z',
          'Nice. Who calls this? Without a caller the map still grows by one entry per tenant that ever sent a request.',
        ],
        [
          'Sven Weber',
          '2026-11-09T11:40:00Z',
          'Wired up in `server.ts` now — an unref\'d interval that is cleared in `onClose`.',
        ],
      ]),
      thread('t-476-2', tokenBucketTs, 'retryAfterSec: Math.max(1,', true, [
        [
          'Mila Novak',
          '2026-11-09T13:22:00Z',
          'With a high refill rate `ceil(missing / refill)` could be `0`, and clients would retry in a tight loop.',
        ],
        ['Sven Weber', '2026-11-10T09:02:00Z', 'Good catch — clamped to at least 1 s and covered by the burst test.'],
        ['Mila Novak', '2026-11-10T09:30:00Z', 'LGTM.'],
      ]),
      thread('t-476-3', rateLimitMiddlewareTs, "reply.header('x-ratelimit-remaining'", true, [
        ['Jonas Becker', '2026-11-09T10:11:00Z', 'Should we also send `x-ratelimit-limit`? Not blocking.'],
        ['Sven Weber', '2026-11-09T11:42:00Z', 'Follow-up ticket CTX-1447, together with the docs update.'],
      ]),
    ],
    updatedAt: '2026-11-10T16:30:00Z',
  },

  'review-482': {
    number: 482,
    title: 'CTX-1377 Evict query cache entries by tenant',
    state: 'open',
    author: 'Mila Novak',
    sourceBranch: 'feature/CTX-1377-cache-eviction',
    targetBranch: 'main',
    descriptionMd: `After a schema or retention change, tenants keep seeing stale query results until the 5 min TTL expires. This adds targeted eviction by tenant.

**What changed**
- \`QueryCache\` tracks its keys per tenant and gets \`evictTenant(tenantId)\`.
- A Caffeine removal listener keeps the index in sync when entries expire or are evicted by size.
- \`TenantEvictionListener\` consumes \`platform.tenant-events.v1\` and evicts on \`SCHEMA_CHANGED\`, \`RETENTION_CHANGED\` and \`OFFBOARDED\`.

**Things I would like eyes on**
- Memory overhead of the secondary index (one \`Set\` per active tenant).
- Whether the removal listener is the right place to untrack keys.`,
    reviewers: [{ name: 'Sven Weber', state: 'pending' }],
    files: [queryCacheJava, evictionListenerJava, queryCacheTestJava, applicationYaml],
    threads: [
      thread('t-482-1', queryCacheJava, 'keysByTenant.computeIfAbsent', false, [
        [
          'Jonas Becker',
          '2026-11-10T16:48:00Z',
          'The key is tracked *before* the loader runs. If `loader.get()` throws, Caffeine stores nothing and no removal event fires, so the key stays in `keysByTenant` forever. Track after a successful load instead?',
        ],
        ['Mila Novak', '2026-11-11T07:15:00Z', 'Good point. Will move it below the load — want to hear Sven\'s take on the listener first.'],
      ]),
    ],
    updatedAt: '2026-11-11T07:20:00Z',
    reviewRequested: true,
  },
};

// ---- draft PR for the "Create PR" quick action --------------------------------

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 3)
    .join('-') || 'change';

const camel = (slug: string) => slug.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** Draft PR created by the "Create PR" quick action. */
export function makeDraftPr(work: WorkItem, me: string): PullRequest {
  const key = work.ticket?.key;
  const summary = work.ticket?.summary ?? work.title;
  const slug = slugify(summary);
  const name = camel(slug);
  const flag = slug.replace(/-/g, '_');

  const feature = added(
    `src/features/${slug}/${slug}.ts`,
    `
import { getLogger } from '../../platform/logger';
import { isEnabled } from '../../platform/feature-flags';

const log = getLogger('${slug}');

export interface ${name[0].toUpperCase()}${name.slice(1)}Options {
  /** Skip the feature flag check, used by tests. */
  force?: boolean;
}

/**
 * ${summary}
 */
export function ${name}(tenantId: string, options: ${name[0].toUpperCase()}${name.slice(1)}Options = {}): boolean {
  if (!options.force && !isEnabled('${flag}', tenantId)) {
    log.debug({ tenantId }, 'skipped, flag is off');
    return false;
  }
  log.info({ tenantId }, 'applied');
  return true;
}
`,
  );

  const flags = diff(
    'src/platform/feature-flags.ts',
    'modified',
    `
@@ 8 @@ export const FLAGS = {
   compact_tiles: { default: true },
   new_query_editor: { default: false, tenants: ['acme'] },
   streaming_export: { default: false },
+  ${flag}: { default: false },
 } as const satisfies Record<string, FlagDefinition>;

 export type FlagName = keyof typeof FLAGS;
`,
  );

  const test = added(
    `src/features/${slug}/${slug}.test.ts`,
    `
import { describe, expect, it } from 'vitest';
import { ${name} } from './${slug}';

describe('${name}', () => {
  it('is off by default', () => {
    expect(${name}('acme')).toBe(false);
  });

  it('can be forced on', () => {
    expect(${name}('acme', { force: true })).toBe(true);
  });
});
`,
  );

  return {
    number: 500 + Math.floor(Math.random() * 40),
    title: key ? `${key} ${summary}` : summary,
    state: 'draft',
    author: me,
    sourceBranch: work.worktree?.branch ?? `feature/${key ? `${key}-` : ''}${slug}`,
    targetBranch: work.worktree?.baseBranch ?? 'main',
    descriptionMd: `${key ? `Implements **${key}** — ${summary}.` : `${summary}.`}

**What changed**
- New module \`src/features/${slug}\` behind the \`${flag}\` feature flag (off by default).
- Unit tests for the flag-off and forced paths.

**How to test**
\`npm test -- ${slug}\`

_Draft — opened from Cortex. Mark it ready once CI is green._`,
    reviewers: [
      { name: 'Mila Novak', state: 'pending' },
      { name: 'Jonas Becker', state: 'pending' },
    ],
    files: [feature, flags, test],
    threads: [],
    updatedAt: new Date().toISOString(),
  };
}
