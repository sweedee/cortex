/**
 * Open Renovate PRs per repository, and the transcript the mock "Renovate review" agent plays over them.
 * The agent decides like the real prompt tells it to (services/prompts.ts): merge patch and minor updates with a
 * green build, leave majors, red and still-running builds to a human with a comment.
 */
import type { ScriptStep } from './sessions';

export interface RenovateSeed {
  number: number;
  /** package, as Renovate writes it in the title */
  dep: string;
  from: string;
  to: string;
  updateType: 'patch' | 'minor' | 'major';
  ci: 'passed' | 'failed' | 'pending';
  /** what the release notes say, in one line (the agent "reads" these) */
  notes: string;
  /** failing check, for `ci: 'failed'` */
  failure?: string;
  /** shown in the agent's comment when it leaves a major / red PR alone */
  needs?: string;
  hoursAgo: number;
}

export const renovateTitle = (p: RenovateSeed) => `Update dependency ${p.dep} to v${p.to}`;
export const renovateBranch = (p: RenovateSeed) => `renovate/${p.dep.replace(/^@/, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${p.to.split('.')[0]}.x`;

const seed = (
  number: number,
  dep: string,
  from: string,
  to: string,
  updateType: RenovateSeed['updateType'],
  ci: RenovateSeed['ci'],
  hoursAgo: number,
  notes: string,
  extra: Pick<RenovateSeed, 'failure' | 'needs'> = {},
): RenovateSeed => ({ number, dep, from, to, updateType, ci, hoursAgo, notes, ...extra });

/** Fresh copy per call: the mock world mutates its list when the agent merges. */
export const seedRenovate = (): Record<string, RenovateSeed[]> => ({
  'console-ui': [
    seed(301, 'vite', '8.3.5', '8.3.6', 'patch', 'passed', 5, 'Bug fixes only: fixes HMR reconnect after the dev server restarts, no API changes.'),
    seed(302, 'mermaid', '12.3.0', '12.3.1', 'patch', 'passed', 9, 'Fixes a sequence-diagram label clipping bug. No breaking changes.'),
    seed(303, 'react-intl', '7.0.0', '7.1.0', 'minor', 'passed', 20, 'Adds `formatListToParts`; existing message formatting is unchanged. No breaking changes listed.'),
    seed(304, 'oxlint', '1.90.0', '1.95.0', 'minor', 'pending', 2, 'New rules (off by default) and faster startup. No breaking changes.'),
    seed(305, 'typescript', '5.9.3', '6.0.2', 'major', 'passed', 30, 'Major release: new default `moduleResolution`, removed deprecated compiler options, stricter `lib` checks.', {
      needs: 'Major bump. TypeScript is pinned to 5.9 on purpose (Strato peer dependencies, see CLAUDE.md), so this needs a decision first.',
    }),
    seed(306, '@vitejs/plugin-react', '6.1.2', '6.2.0', 'minor', 'failed', 14, 'Adds React Compiler options; Babel is now only loaded when needed.', {
      failure: "Stage 'Build': `vite build` fails with 'Cannot find module @babel/core' in plugin-react",
      needs: "Build fails in stage 'Build' (`@babel/core` can no longer be resolved by the plugin). Needs a manual look at the plugin's new peer dependencies.",
    }),
  ],
  'ingest-gateway': [
    seed(412, 'pino', '9.5.0', '9.5.1', 'patch', 'passed', 6, 'Fixes redaction of nested paths when `censor` is a function. No breaking changes.'),
    seed(413, 'zod', '3.23.7', '3.23.8', 'patch', 'passed', 11, 'Type-only fixes for `z.discriminatedUnion`. No runtime changes.'),
    seed(414, 'prom-client', '15.1.0', '15.2.0', 'minor', 'passed', 22, 'Adds `Histogram.zero()` and exemplar support; default metrics unchanged.'),
    seed(415, 'undici', '6.21.0', '7.0.0', 'major', 'passed', 28, 'Major release: drops Node 18, changes the default `connect.timeout`, removes `Client#pipelining` defaults.', {
      needs: 'Major bump. Drops Node 18 (our Docker image still builds on it) and changes the default connect timeout the webhook dispatcher relies on.',
    }),
    seed(416, 'fastify', '4.28.1', '4.29.0', 'minor', 'failed', 17, 'Adds `request.routeOptions.url`; deprecates `reply.sent`.', {
      failure: "Stage 'Unit tests': 3 failures in test/server/hooks.test.ts (expected 400, got 500)",
      needs: "Build fails in stage 'Unit tests' (3 failures in `test/server/hooks.test.ts`, the new version changes error handling in `onRequest` hooks). Needs a code change.",
    }),
  ],
  'query-service': [
    seed(233, 'com.fasterxml.jackson.core:jackson-databind', '2.17.1', '2.17.2', 'patch', 'passed', 7, 'Bug fixes, including a deserialization fix for `Optional` wrappers. No breaking changes.'),
    seed(234, 'org.springframework.boot:spring-boot-starter-parent', '3.3.2', '3.4.0', 'minor', 'pending', 3, 'Spring Boot 3.4: new structured logging, Micrometer 1.14. Some properties deprecated.'),
    seed(235, 'org.postgresql:postgresql', '42.7.3', '42.7.4', 'patch', 'passed', 16, 'Fixes a connection leak with `COPY` on pipelined statements. No breaking changes.'),
    seed(236, 'org.flywaydb:flyway-core', '10.17.0', '11.0.0', 'major', 'failed', 26, 'Major release: Java 17 minimum, community edition drops several database modules, changed `baselineOnMigrate` defaults.', {
      failure: "Stage 'Integration tests': FlywayException 'Unsupported Database: PostgreSQL 16' (flyway-database-postgresql missing)",
      needs: "Major bump and the build is red: Flyway 11 moved PostgreSQL support into `flyway-database-postgresql`, which has to be added to the pom before it can be tested.",
    }),
    seed(237, 'io.micrometer:micrometer-registry-prometheus', '1.13.2', '1.14.0', 'minor', 'passed', 13, 'Adds native histograms; metric names unchanged. Requires Prometheus client 1.3 (already in use).'),
  ],
});

// ---- the agent's transcript ----------------------------------------------------------

const ASK_PENDING = (p: RenovateSeed) => `CI on #${p.number} (${p.dep} ${p.from} -> ${p.to}) has not finished. What should I do?`;
const WAIT = 'Wait for CI, merge if green';
const SKIP = 'Skip it for now';

const CI_TEXT: Record<RenovateSeed['ci'], string> = { passed: 'all checks passed', failed: 'checks failed', pending: 'checks pending' };

/** `merge` is how the mock world takes the PR off the open list. */
export function renovateScript(owner: string, repo: string, prs: RenovateSeed[], merge: (number: number) => void): ScriptStep[] {
  const slug = `${owner}/${repo}`;
  const flag = `--repo ${slug}`;
  const say = (activity: string, text: string, extra: Partial<ScriptStep> = {}): ScriptStep => ({ activity, message: { role: 'assistant', text }, ...extra });
  const tool = (name: string, summary: string, detail: string, extra: Partial<ScriptStep> = {}): ScriptStep => ({
    activity: `Running ${summary}`,
    message: { role: 'tool', tool: name, summary, detail, status: 'ok' },
    ...extra,
  });

  const steps: ScriptStep[] = [
    say('Reading the prompt', `Starting with the open Renovate PRs of **${slug}**.`), // step 0 is dropped by the runner (it is the user's prompt)
    say('Starting', `I will go through every open Renovate PR in **${slug}**, check the release notes and the build, and merge only what is safe. First, the list.`),
    tool(
      'Bash',
      `gh pr list ${flag} --author "app/renovate" --state open --json number,title,headRefName,labels,statusCheckRollup,reviewDecision`,
      prs.map((p) => `#${p.number}  ${renovateTitle(p)}  [${p.updateType}]  ${CI_TEXT[p.ci]}`).join('\n'),
    ),
  ];

  if (prs.length === 0) return [...steps, say('Done', 'There are no open Renovate PRs, nothing to review.')];

  // the pending PR is merged only if the user says to wait and it turns green
  const waits = (p: RenovateSeed) => (a: Record<string, string>) => (a[ASK_PENDING(p)] ?? '').startsWith('Wait');

  for (const p of prs) {
    const url = `https://github.com/${slug}/releases/tag/v${p.to}`;
    const diffFiles = repo === 'query-service' ? 'pom.xml' : 'package.json, package-lock.json';
    steps.push(
      tool('Bash', `gh pr view ${p.number} ${flag} --json title,body,files`, `${renovateTitle(p)}\n${p.dep}: ${p.from} -> ${p.to} (${p.updateType})\nfiles: ${diffFiles}\n\nRenovate release notes section: ${url}`),
      tool('WebFetch', url, `${p.dep} v${p.to}\n\n${p.notes}`),
      tool(
        'Bash',
        `gh pr checks ${p.number} ${flag}`,
        p.ci === 'passed'
          ? 'Build / Jenkins\tpass\nLint\tpass\nUnit tests\tpass'
          : p.ci === 'pending'
            ? 'Build / Jenkins\tpending\nLint\tpass\nUnit tests\tpending'
            : `Build / Jenkins\tfail\nLint\tpass\n${p.failure ?? 'Unit tests\tfail'}`,
      ),
    );

    if (p.ci === 'pending') {
      steps.push({
        activity: 'Has a question for you',
        message: { role: 'assistant', text: '' },
        ask: [
          {
            question: ASK_PENDING(p),
            header: `#${p.number}`,
            multiSelect: false,
            options: [
              { label: WAIT, description: 'Watch the build; approve and merge only if it turns green and nothing else needs doing.' },
              { label: SKIP, description: 'Leave a comment and move on; Renovate keeps the PR open.' },
            ],
          },
        ],
      });
      steps.push(
        tool('Bash', `gh pr checks ${p.number} ${flag} --watch`, 'Build / Jenkins\tpass\nLint\tpass\nUnit tests\tpass', { when: waits(p) }),
        say('Approving', `#${p.number} is green now and the ${p.updateType} update looks safe (${p.notes.split('.')[0].toLowerCase()}). Approving and merging.`, { when: waits(p) }),
        tool('Bash', `gh pr review ${p.number} ${flag} --approve --body "Green build, no breaking changes in the release notes."`, `✓ Approved pull request #${p.number}`, { when: waits(p) }),
        tool('Bash', `gh pr merge ${p.number} ${flag} --squash --delete-branch`, `✓ Squashed and merged pull request #${p.number} (${renovateTitle(p)})\n✓ Deleted branch ${renovateBranch(p)}`, { when: waits(p), effect: () => merge(p.number) }),
        tool('Bash', `gh pr comment ${p.number} ${flag} --body "Build not finished yet, skipped by request. Merge once it is green if the ${p.updateType} update is wanted."`, `https://github.com/${slug}/pull/${p.number}#issuecomment-1`, { when: (a) => !waits(p)(a) }),
      );
      continue;
    }

    if (p.updateType !== 'major' && p.ci === 'passed') {
      steps.push(
        say('Approving', `**#${p.number}** ${p.dep} ${p.from} -> ${p.to} is a ${p.updateType} update. ${p.notes} The build is green and only dependency files changed, so it is safe. Approving and merging.`),
        tool('Bash', `gh pr review ${p.number} ${flag} --approve --body "Green build, no breaking changes in the release notes."`, `✓ Approved pull request #${p.number}`),
        tool('Bash', `gh pr merge ${p.number} ${flag} --squash --delete-branch`, `✓ Squashed and merged pull request #${p.number} (${renovateTitle(p)})\n✓ Deleted branch ${renovateBranch(p)}`, { effect: () => merge(p.number) }),
      );
    } else {
      const why = p.updateType === 'major' ? 'a major update' : 'red';
      steps.push(
        say('Commenting', `**#${p.number}** ${p.dep} ${p.from} -> ${p.to}: ${why}. ${p.notes} I will not merge this one and leave a note for you.`),
        tool('Bash', `gh pr comment ${p.number} ${flag} --body "${p.needs}"`, `https://github.com/${slug}/pull/${p.number}#issuecomment-1`),
      );
    }
  }

  // the summary depends on the answer to the question about the pending PR
  const summary = (a: Record<string, string>) => {
    const rows = prs.map((p) => {
      const merged = p.ci === 'pending' ? waits(p)(a) : p.updateType !== 'major' && p.ci === 'passed';
      const stage = /Stage '([^']+)'/.exec(p.failure ?? '')?.[1];
      const result = merged
        ? 'Merged'
        : p.ci === 'pending'
          ? 'Skipped: build still running'
          : p.updateType === 'major'
            ? `Needs human: major bump${p.ci === 'failed' ? ', build red' : ''}`
            : `Needs human: build red${stage ? ` (${stage})` : ''}`;
      return { p, result, merged };
    });
    const mergedCount = rows.filter((r) => r.merged).length;
    const humanCount = rows.length - mergedCount;
    return [
      `Reviewed ${prs.length} Renovate PRs in **${slug}**: **${mergedCount} merged**, **${humanCount} need${humanCount === 1 ? 's' : ''} a human**.`,
      '',
      '| PR | Update | Result |',
      '| --- | --- | --- |',
      ...rows.map(({ p, result }) => `| #${p.number} | ${p.dep} ${p.from} -> ${p.to} (${p.updateType}) | ${result} |`),
    ].join('\n');
  };
  steps.push(say('Summarising', '', { text: summary }));
  return steps;
}
