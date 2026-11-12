import type { Pipeline, PipelineStage, WorkItem } from '../../model/types';

/**
 * Mocked Jenkins builds. Every build runs the same declarative pipeline:
 * Checkout → Build → Unit tests → Integration tests → Static analysis → Publish.
 * The console logs are generated from a small per-build context so that job
 * names, branches and commits are consistent across the stages.
 */

interface BuildCtx {
  repo: string;
  job: string;
  buildNumber: number;
  branch: string;
  commit: string;
  /** small per-build variation of durations and counts */
  seed: number;
}

type Tests = NonNullable<PipelineStage['tests']>;

interface StageDef {
  name: string;
  durationSec: number;
  tests?: Tests;
  log: string;
}

const AGENT = 'linux-build-07';
const fullSha = (c: string) => (c + '5d0be41f7c92a6038e1b4dd97c20a3f1e86b5c4d7').slice(0, 40);
const secs = (n: number) => `${n.toFixed(1)} s`;

/** Suites printed by jest, per repository. */
const SUITES: Record<string, { unit: string[]; integration: string[]; lang: string }> = {
  'ingest-gateway': {
    lang: 'ts',
    unit: [
      'src/dispatcher/retry.test.ts',
      'src/dispatcher/webhook-dispatcher.test.ts',
      'src/middleware/rate-limit.test.ts',
      'src/middleware/auth.test.ts',
      'src/ingest/batch-validator.test.ts',
      'src/ingest/ingest-controller.test.ts',
      'src/tenants/tenant-limits-cache.test.ts',
      'src/util/clock.test.ts',
    ],
    integration: [
      'test/integration/ingest-metrics.int.test.ts',
      'test/integration/ingest-logs.int.test.ts',
      'test/integration/rate-limit.int.test.ts',
      'test/integration/dead-letter-queue.int.test.ts',
      'test/integration/webhook-dispatcher.int.test.ts',
    ],
  },
  'query-service': {
    lang: 'ts',
    unit: [
      'src/cache/query-cache.test.ts',
      'src/cache/eviction-policy.test.ts',
      'src/planner/query-planner.test.ts',
      'src/planner/timeframe.test.ts',
      'src/api/query-controller.test.ts',
      'src/tenants/tenant-context.test.ts',
    ],
    integration: [
      'test/integration/query-api.int.test.ts',
      'test/integration/cache-eviction.int.test.ts',
      'test/integration/tenant-isolation.int.test.ts',
    ],
  },
  'console-ui': {
    lang: 'tsx',
    unit: [
      'src/dashboards/DashboardGrid.test.tsx',
      'src/dashboards/Tile.test.tsx',
      'src/dashboards/useTileQuery.test.ts',
      'src/timeframe/TimeframeSelector.test.tsx',
      'src/pages/settings/notifications/NotificationSettingsPage.test.tsx',
      'src/pages/settings/tokens/TokenSettingsPage.test.tsx',
      'src/shell/Navigation.test.tsx',
    ],
    integration: [
      'e2e/dashboards/timeframe.spec.ts',
      'e2e/dashboards/tiles.spec.ts',
      'e2e/settings/notifications.spec.ts',
      'e2e/login.spec.ts',
    ],
  },
};

const suitesOf = (repo: string) => SUITES[repo] ?? SUITES['ingest-gateway'];

function checkoutLog(c: BuildCtx, triggeredBy: string): string {
  const sha = fullSha(c.commit);
  return `Started by user ${triggeredBy}
[Pipeline] Start of Pipeline
[Pipeline] node
Running on ${AGENT} in /var/jenkins/workspace/${c.job.replace('/', '_')}
[Pipeline] {
[Pipeline] stage
[Pipeline] { (Checkout)
[Pipeline] checkout
The recommended git tool is: NONE
using credential github-app-ctx
 > git rev-parse --resolve-git-dir /var/jenkins/workspace/${c.job.replace('/', '_')}/.git # timeout=10
Fetching changes from the remote Git repository
 > git config remote.origin.url https://github.com/ctx-observability/${c.repo}.git # timeout=10
Fetching upstream changes from https://github.com/ctx-observability/${c.repo}.git
 > git fetch --no-tags --force --progress -- https://github.com/ctx-observability/${c.repo}.git +refs/heads/${c.branch}:refs/remotes/origin/${c.branch} # timeout=10
 > git rev-parse origin/${c.branch}^{commit} # timeout=10
Checking out Revision ${sha} (origin/${c.branch})
 > git config core.sparsecheckout # timeout=10
 > git checkout -f ${sha} # timeout=10
Commit message: "${c.repo === 'console-ui' ? 'Keep tiles mounted across timeframe changes' : 'Address review comments'}"
 > git rev-list --no-walk ${fullSha('7c1d' + c.commit.slice(0, 3))} # timeout=10
[Pipeline] sh
+ git clean -fdx
+ git log -1 --format=%h %an %s
${c.commit} checked out on ${c.branch}
[Pipeline] }
[Pipeline] // stage`;
}

function buildLog(c: BuildCtx): string {
  const pkgs = 1284 + c.seed * 3;
  const files = 212 + c.seed * 7;
  return `[Pipeline] stage
[Pipeline] { (Build)
[Pipeline] nodejs
[Pipeline] {
[Pipeline] sh
+ node --version
v22.11.0
+ npm --version
10.9.0
+ npm ci --prefer-offline --no-audit --no-fund
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory.
npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported

added ${pkgs} packages in ${secs(31.2 + c.seed)}
[Pipeline] sh
+ npm run lint

> ${c.repo}@${3 + (c.seed % 3)}.${40 + c.seed}.0 lint
> eslint . --max-warnings 0

[Pipeline] sh
+ npm run build

> ${c.repo}@${3 + (c.seed % 3)}.${40 + c.seed}.0 build
> ${c.repo === 'console-ui' ? 'tsc -b && vite build' : 'tsc -p tsconfig.build.json'}

${
  c.repo === 'console-ui'
    ? `vite v6.3.5 building for production...
transforming...
✓ 2417 modules transformed.
rendering chunks...
dist/index.html                     1.42 kB │ gzip:   0.71 kB
dist/assets/index-Dq3fK2xP.css     48.90 kB │ gzip:   9.84 kB
dist/assets/index-BX1o7c4e.js     612.37 kB │ gzip: 187.02 kB
✓ built in ${secs(17.4 + c.seed)}`
    : `Compiled ${files} files with tsc 5.6.3 in ${secs(18.6 + c.seed)}
dist/ written (${files} modules, 1.9 MB)`
}
[Pipeline] stash
Stashed ${files + 4} file(s) as 'dist'
[Pipeline] }
[Pipeline] // nodejs
[Pipeline] }
[Pipeline] // stage`;
}

function unitLog(c: BuildCtx, tests: Tests, durationSec: number): string {
  const s = suitesOf(c.repo);
  const total = tests.passed + tests.failed + tests.skipped;
  const lines = s.unit.map((f, i) => `PASS  ${f} (${secs(0.6 + ((i * 7 + c.seed) % 9) / 4)})`);
  const extra = 38 + c.seed - s.unit.length;
  return `[Pipeline] stage
[Pipeline] { (Unit tests)
[Pipeline] sh
+ npm run test:unit -- --ci --coverage --reporters=default --reporters=jest-junit

> ${c.repo}@${3 + (c.seed % 3)}.${40 + c.seed}.0 test:unit
> jest --selectProjects unit --ci --coverage --reporters=default --reporters=jest-junit

${lines.join('\n')}
PASS  … ${extra} more test suites

--------------------------|---------|----------|---------|---------|
File                      | % Stmts | % Branch | % Funcs | % Lines |
--------------------------|---------|----------|---------|---------|
All files                 |   ${(87.4 + c.seed / 10).toFixed(2)} |    ${(79.1 + c.seed / 10).toFixed(2)} |   ${(90.2 + c.seed / 10).toFixed(2)} |   ${(88.0 + c.seed / 10).toFixed(2)} |
--------------------------|---------|----------|---------|---------|

Test Suites: ${extra + s.unit.length} passed, ${extra + s.unit.length} total
Tests:       ${tests.skipped} skipped, ${tests.passed} passed, ${total} total
Snapshots:   ${c.repo === 'console-ui' ? 24 : 0} total
Time:        ${secs(durationSec - 6.4)}
Ran all test suites in project "unit".
[Pipeline] junit
Recording test results
[Checks API] No suitable checks publisher found.
[Pipeline] publishCoverage
[Coverage] Coverage thresholds met (lines ≥ 85 %, branches ≥ 75 %)
[Pipeline] }
[Pipeline] // stage`;
}

function integrationLog(c: BuildCtx, tests: Tests, durationSec: number): string {
  const s = suitesOf(c.repo);
  const total = tests.passed + tests.failed + tests.skipped;
  const e2e = c.repo === 'console-ui';
  const head = e2e
    ? `+ npx playwright test --project=chromium --reporter=line,junit

Running ${total} tests using 4 workers`
    : `+ docker compose -f docker-compose.ci.yml up -d --wait redis kafka mock-receiver
 Container ci-redis-1          Healthy
 Container ci-kafka-1          Healthy
 Container ci-mock-receiver-1  Healthy
[Pipeline] sh
+ npm run test:integration -- --ci --runInBand --reporters=default --reporters=jest-junit

> ${c.repo}@${3 + (c.seed % 3)}.${40 + c.seed}.0 test:integration
> jest --selectProjects integration --ci --runInBand --reporters=default --reporters=jest-junit
`;
  const lines = s.integration.map(
    (f, i) => `${e2e ? '  ✓ ' : 'PASS  '}${f} (${secs(4.2 + ((i * 5 + c.seed) % 11) * 1.3)})`,
  );
  return `[Pipeline] stage
[Pipeline] { (Integration tests)
[Pipeline] sh
${head}
${lines.join('\n')}

${
  e2e
    ? `  ${tests.passed} passed (${secs(durationSec - 9.8)})${tests.skipped ? `\n  ${tests.skipped} skipped` : ''}`
    : `Test Suites: ${s.integration.length} passed, ${s.integration.length} total
Tests:       ${tests.skipped ? `${tests.skipped} skipped, ` : ''}${tests.passed} passed, ${total} total
Snapshots:   0 total
Time:        ${secs(durationSec - 21.3)}
Ran all test suites in project "integration".`
}
[Pipeline] junit
Recording test results
${
  e2e
    ? ''
    : `[Pipeline] sh
+ docker compose -f docker-compose.ci.yml down -v
 Container ci-mock-receiver-1  Removed
 Container ci-kafka-1          Removed
 Container ci-redis-1          Removed
`
}[Pipeline] }
[Pipeline] // stage`;
}

/** Build #4 of CTX-1423: the backoff timing assertion in the dispatcher suite fails. */
function integrationFailedLog(c: BuildCtx, tests: Tests): string {
  const total = tests.passed + tests.failed + tests.skipped;
  return `[Pipeline] stage
[Pipeline] { (Integration tests)
[Pipeline] sh
+ docker compose -f docker-compose.ci.yml up -d --wait redis kafka mock-receiver
 Container ci-redis-1          Healthy
 Container ci-kafka-1          Healthy
 Container ci-mock-receiver-1  Healthy
[Pipeline] sh
+ npm run test:integration -- --ci --runInBand --reporters=default --reporters=jest-junit

> ${c.repo}@4.41.0 test:integration
> jest --selectProjects integration --ci --runInBand --reporters=default --reporters=jest-junit

PASS  test/integration/ingest-metrics.int.test.ts (9.4 s)
PASS  test/integration/ingest-logs.int.test.ts (8.1 s)
PASS  test/integration/rate-limit.int.test.ts (14.7 s)
PASS  test/integration/dead-letter-queue.int.test.ts (6.9 s)
FAIL  test/integration/webhook-dispatcher.int.test.ts (12.3 s)
  WebhookDispatcher › delivery
    ✓ delivers an event to the configured endpoint (212 ms)
    ✓ signs the payload with the tenant secret (87 ms)
    ✓ does not retry a 404 (64 ms)
  WebhookDispatcher › retry
    ✕ retries a 503 with exponential backoff (1041 ms)
    ✓ honours Retry-After on 429 (118 ms)
    ✓ moves the delivery to the dead-letter queue after 5 attempts (96 ms)

  ● WebhookDispatcher › retry › retries a 503 with exponential backoff

    expect(received).toHaveLength(expected)

    Expected length: 2
    Received length: 1
    Received array:  [{"attempt": 1, "at": 0, "status": 503}]

      84 |       // attempt 2 is due after baseDelayMs * 2^0 = 1000 ms
      85 |       await clock.advanceBy(1000);
    > 86 |       expect(receiver.requests).toHaveLength(2);
         |                                 ^
      87 |
      88 |       // attempt 3 is due another 2000 ms later
      89 |       await clock.advanceBy(2000);

      at Object.<anonymous> (test/integration/webhook-dispatcher.int.test.ts:86:33)

  console.warn
    [WebhookDispatcher] delivery d-7f3a attempt 1 failed with 503, next attempt in 2000 ms

      at RetryPolicy.schedule (src/dispatcher/retry.ts:58:15)

Test Suites: 1 failed, 4 passed, 5 total
Tests:       ${tests.failed} failed, ${tests.passed} passed, ${total} total
Snapshots:   0 total
Time:        118.6 s
Ran all test suites in project "integration".
npm ERR! Lifecycle script \`test:integration\` failed with error:
npm ERR! code 1
npm ERR! path /var/jenkins/workspace/${c.job.replace('/', '_')}
npm ERR! command failed
npm ERR! command sh -c jest --selectProjects integration --ci --runInBand
[Pipeline] }
[Pipeline] // stage
[Pipeline] stage
[Pipeline] { (Declarative: Post Actions)
[Pipeline] junit
Recording test results
[Pipeline] sh
+ docker compose -f docker-compose.ci.yml down -v
 Container ci-mock-receiver-1  Removed
 Container ci-kafka-1          Removed
 Container ci-redis-1          Removed
[Pipeline] }
[Pipeline] // stage
ERROR: script returned exit code 1
Stage "Static analysis" skipped due to earlier failure(s)
Stage "Publish" skipped due to earlier failure(s)
Finished: FAILURE`;
}

function sonarLog(c: BuildCtx, durationSec: number): string {
  const s = suitesOf(c.repo);
  return `[Pipeline] stage
[Pipeline] { (Static analysis)
[Pipeline] withSonarQubeEnv
Injecting SonarQube environment variables using the configuration: sonar-ctx
[Pipeline] {
[Pipeline] sh
+ npx sonar-scanner -Dsonar.projectKey=ctx:${c.repo} -Dsonar.pullrequest.branch=${c.branch} -Dsonar.pullrequest.base=main
INFO: Scanner configuration file: NONE
INFO: Project root configuration file: /var/jenkins/workspace/${c.job.replace('/', '_')}/sonar-project.properties
INFO: SonarScanner CLI 6.2.1.4610
INFO: Analyzing on SonarQube server 10.7.0
INFO: Load project settings for component key: 'ctx:${c.repo}'
INFO: Indexing files...
INFO: ${238 + c.seed * 7} files indexed
INFO: Quality profile for ${s.lang === 'tsx' ? 'ts' : s.lang}: CTX way
INFO: Sensor TypeScript analysis [javascript]
INFO: ${238 + c.seed * 7}/${238 + c.seed * 7} source files have been analyzed
INFO: Sensor JaCoCo/LCOV coverage report [javascript]
INFO: Analysing coverage/lcov.info
INFO: CPD Executor Calculating CPD for ${201 + c.seed * 5} files
INFO: Analysis report uploaded in 412ms
INFO: ANALYSIS SUCCESSFUL, you can find the results at: https://sonar.ctx.example/dashboard?id=ctx%3A${c.repo}&pullRequest=${c.job.split('PR-')[1] ?? c.buildNumber}
INFO: EXECUTION SUCCESS
INFO: Total time: ${secs(durationSec - 14.2)}
[Pipeline] }
[Pipeline] // withSonarQubeEnv
[Pipeline] waitForQualityGate
Checking status of SonarQube task 'AZk3${c.commit}Tq' on server 'sonar-ctx'
SonarQube task 'AZk3${c.commit}Tq' status is 'IN_PROGRESS'
SonarQube task 'AZk3${c.commit}Tq' status is 'SUCCESS'
SonarQube task 'AZk3${c.commit}Tq' completed. Quality gate is 'OK'
  new code: 0 bugs · 0 vulnerabilities · ${c.seed % 3} code smells · ${(91.3 + c.seed / 5).toFixed(1)} % coverage · 0.0 % duplication
[Pipeline] }
[Pipeline] // stage`;
}

function publishLog(c: BuildCtx): string {
  const image = `registry.ctx.example/${c.repo}`;
  const tag = `${c.job.split('/')[1]?.toLowerCase().replace(/[^a-z0-9.-]+/g, '-') ?? 'main'}-${c.buildNumber}-${c.commit}`;
  return `[Pipeline] stage
[Pipeline] { (Publish)
[Pipeline] unstash
[Pipeline] withDockerRegistry
$ docker login -u jenkins-ctx -p ******** https://registry.ctx.example
Login Succeeded
[Pipeline] {
[Pipeline] sh
+ docker build --pull -t ${image}:${tag} --build-arg GIT_COMMIT=${c.commit} .
#1 [internal] load build definition from Dockerfile
#1 DONE 0.0s
#2 [internal] load metadata for ${c.repo === 'console-ui' ? 'docker.io/library/nginx:1.27-alpine' : 'gcr.io/distroless/nodejs22-debian12:nonroot'}
#2 DONE 0.6s
#3 [1/4] FROM ${c.repo === 'console-ui' ? 'docker.io/library/nginx:1.27-alpine' : 'gcr.io/distroless/nodejs22-debian12:nonroot'}
#3 CACHED
#4 [2/4] COPY package.json package-lock.json ./
#4 DONE 0.1s
#5 [3/4] COPY ${c.repo === 'console-ui' ? 'dist /usr/share/nginx/html' : 'node_modules ./node_modules'}
#5 DONE ${secs(3.1 + c.seed / 4).replace(' ', '')}
#6 [4/4] COPY ${c.repo === 'console-ui' ? 'nginx.conf /etc/nginx/conf.d/default.conf' : 'dist ./dist'}
#6 DONE 0.3s
#7 exporting to image
#7 writing image sha256:${fullSha(c.commit).slice(4, 16)}e09b1c done
#7 naming to ${image}:${tag} done
#7 DONE 1.2s
[Pipeline] sh
+ docker push ${image}:${tag}
The push refers to repository [${image}]
5f70bf18a086: Layer already exists
a3c1e8d2f4b7: Pushed
9d4e0b6c7a12: Pushed
${tag}: digest: sha256:${fullSha(c.commit).slice(0, 12)}7be2c4409a1d3f size: 1783
[Pipeline] }
[Pipeline] // withDockerRegistry
[Pipeline] archiveArtifacts
Archiving artifacts
[Pipeline] }
[Pipeline] // stage
[Pipeline] }
[Pipeline] // node
[Pipeline] End of Pipeline
[GitHub Checks] Published check 'continuous-integration/jenkins/pr-head' — success
Finished: SUCCESS`;
}

/** The six stages of a build, fully populated. `failAt` = index of the failing stage. */
function buildStages(c: BuildCtx, triggeredBy: string, failAt?: number): PipelineStage[] {
  const e2e = c.repo === 'console-ui';
  const unitTests: Tests = { passed: (e2e ? 618 : 409) + c.seed * 3, failed: 0, skipped: 3 };
  const intTests: Tests =
    failAt === 3
      ? { passed: 57, failed: 1, skipped: 0 }
      : { passed: (e2e ? 46 : 55) + c.seed, failed: 0, skipped: e2e ? 2 : 0 };
  const d = {
    checkout: 8 + (c.seed % 4),
    build: 71 + c.seed * 2,
    unit: 94 + c.seed * 3,
    integration: failAt === 3 ? 141 : 152 + c.seed * 4,
    sonar: 58 + c.seed,
    publish: 43 + (c.seed % 5),
  };
  const defs: StageDef[] = [
    { name: 'Checkout', durationSec: d.checkout, log: checkoutLog(c, triggeredBy) },
    { name: 'Build', durationSec: d.build, log: buildLog(c) },
    { name: 'Unit tests', durationSec: d.unit, tests: unitTests, log: unitLog(c, unitTests, d.unit) },
    {
      name: 'Integration tests',
      durationSec: d.integration,
      tests: intTests,
      log: failAt === 3 ? integrationFailedLog(c, intTests) : integrationLog(c, intTests, d.integration),
    },
    { name: 'Static analysis', durationSec: d.sonar, log: sonarLog(c, d.sonar) },
    { name: 'Publish', durationSec: d.publish, log: publishLog(c) },
  ];
  return defs.map((s, i) => {
    if (failAt !== undefined && i > failAt) {
      return { name: s.name, status: 'skipped', log: `Stage "${s.name}" skipped due to earlier failure(s)` };
    }
    return { ...s, status: failAt === i ? 'failed' : 'passed' };
  });
}

const seedOf = (commit: string) => parseInt(commit.slice(0, 2), 16) % 6;

function seedPipeline(
  p: Omit<Pipeline, 'stages'>,
  repo: string,
  failAt?: number,
): Pipeline {
  const ctx: BuildCtx = { repo, job: p.job, buildNumber: p.buildNumber, branch: p.branch, commit: p.commit, seed: seedOf(p.commit) };
  return { ...p, stages: buildStages(ctx, p.triggeredBy, failAt) };
}

/** Seed pipelines keyed by work id. */
export const pipelines: Record<string, Pipeline> = {
  'CTX-1423': seedPipeline(
    {
      job: 'ingest-gateway/PR-491',
      buildNumber: 4,
      status: 'failed',
      branch: 'feature/CTX-1423-webhook-retry',
      commit: 'a41c9e2',
      triggeredBy: 'Sven Weber',
      startedAt: '2026-11-11T08:42:00Z',
      history: [
        { buildNumber: 3, status: 'passed', durationSec: 412 },
        { buildNumber: 2, status: 'failed', durationSec: 250 },
        { buildNumber: 1, status: 'passed', durationSec: 398 },
      ],
    },
    'ingest-gateway',
    3,
  ),
  'CTX-1450': seedPipeline(
    {
      job: 'ingest-gateway/PR-493',
      buildNumber: 2,
      status: 'passed',
      branch: 'feature/CTX-1450-persist-retry-state',
      commit: '5c1d0e7',
      triggeredBy: 'Sven Weber',
      startedAt: '2026-11-11T09:06:00Z',
      history: [{ buildNumber: 1, status: 'passed', durationSec: 405 }],
    },
    'ingest-gateway',
  ),
  'CTX-1398': seedPipeline(
    {
      job: 'ingest-gateway/PR-476',
      buildNumber: 7,
      status: 'passed',
      branch: 'feature/CTX-1398-tenant-rate-limit',
      commit: '9be07d1',
      triggeredBy: 'Sven Weber',
      startedAt: '2026-11-10T16:05:00Z',
      history: [
        { buildNumber: 6, status: 'passed', durationSec: 431 },
        { buildNumber: 5, status: 'failed', durationSec: 187 },
        { buildNumber: 4, status: 'passed', durationSec: 426 },
        { buildNumber: 3, status: 'passed', durationSec: 412 },
        { buildNumber: 2, status: 'failed', durationSec: 250 },
        { buildNumber: 1, status: 'passed', durationSec: 398 },
      ],
    },
    'ingest-gateway',
  ),
  'review-482': seedPipeline(
    {
      job: 'query-service/PR-482',
      buildNumber: 2,
      status: 'passed',
      branch: 'feature/CTX-1377-cache-eviction',
      commit: '3fd2a80',
      triggeredBy: 'Mila Novak',
      startedAt: '2026-11-11T07:15:00Z',
      history: [{ buildNumber: 1, status: 'passed', durationSec: 398 }],
    },
    'query-service',
  ),
};

/**
 * A fresh build with every stage `queued`. The simulator flips the stages to
 * running → passed one after another, so `log` and `durationSec` must already
 * hold the final values.
 */
export function makeQueuedPipeline(work: WorkItem, buildNumber: number, triggeredBy: string): Pipeline {
  const job = `${work.repo}/${work.pr ? `PR-${work.pr.number}` : work.worktree?.branch ?? 'main'}`;
  const branch = work.worktree?.branch ?? 'main';
  const commit = Math.random().toString(16).slice(2, 9).padEnd(7, '0');
  const ctx: BuildCtx = { repo: work.repo, job, buildNumber, branch, commit, seed: seedOf(commit) };
  return {
    job,
    buildNumber,
    status: 'queued',
    branch,
    commit,
    triggeredBy,
    startedAt: new Date().toISOString(),
    stages: buildStages(ctx, triggeredBy).map((s) => ({ ...s, status: 'queued' })),
    history: work.pipeline
      ? [
          {
            buildNumber: work.pipeline.buildNumber,
            status: work.pipeline.status === 'passed' ? 'passed' : 'failed',
            durationSec: work.pipeline.stages.reduce((a, s) => a + (s.durationSec ?? 0), 0),
          },
          ...work.pipeline.history,
        ]
      : [],
  };
}
