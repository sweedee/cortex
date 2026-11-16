/** Builds the integration services for the server (paths are passed in). */
import { join } from 'node:path';
import type { EventChannel, EventChannels, ExecRequest } from '../../shared/ipc';
import type { ExecSpawn } from '../lib/exec';
import { ClaudeSessions } from './claude';
import { DEFAULT_USER_CONFIG, type UserConfig } from '../../shared/userConfig';
import { applyUserConfig, jiraCliSpec, jiraSiteFixed, resolveConfig } from './config';
import { GhService } from './gh';
import { GitService } from './git';
import { JiraService } from './jira';
import { AppRunner, TestRunner } from './runners';

export interface ServicePaths {
  /** app root (where scripts/ lives): the package root */
  appRoot: string;
  userData: string;
  /** a production run (`lib/runtime.ts`): Jira never falls back to the mock by itself */
  production?: boolean;
}

/** What the UI shows when Jira has no working CLI. */
export const JIRA_NOT_CONFIGURED = 'Jira not configured: install acli and run `acli jira auth login`, or set jira.cli in config.json';

type Send = <C extends EventChannel>(channel: C, payload: EventChannels[C]) => void;

export function createServices(paths: ServicePaths, send: Send, env: NodeJS.ProcessEnv = process.env, user: UserConfig = DEFAULT_USER_CONFIG) {
  let userConfig = user;
  const config = resolveConfig(env, user);
  // CORTEX_CLAUDE_BIN may point at a node script (e.g. the fake CLI fixture): run it with this runtime
  const claudeScript = /\.[cm]?js$/i.test(config.claude.bin);
  const jira = new JiraService(jiraCliSpec(config, paths, env), { cwd: paths.userData });
  let jiraReady: Promise<void> | null = null;
  const services = {
    config,
    /** config.json changed: apply what works without a restart (GitHub settings, a fixed Jira site) */
    setUserConfig(next: UserConfig) {
      userConfig = next;
      applyUserConfig(config, next, env);
    },
    git: new GitService(),
    gh: new GhService(config.github, { cwd: paths.userData }),
    jira,
    claude: new ClaudeSessions({
      bin: claudeScript ? process.execPath : config.claude.bin,
      prefixArgs: claudeScript ? [config.claude.bin, ...config.claude.prefixArgs] : config.claude.prefixArgs,
      storeFile: join(paths.userData, 'claude-sessions.json'),
      send: send as ConstructorParameters<typeof ClaudeSessions>[0]['send'],
      defaultPermissionMode: config.claude.defaultPermissionMode,
    }),
    apps: new AppRunner(send, { flushMs: config.runners.flushMs, runningAfterMs: config.runners.runningAfterMs }),
    tests: new TestRunner(send, { flushMs: config.runners.flushMs }),
    /** `exec:run` keeps the allowlist name `jira-mock`; here it becomes the configured Jira CLI */
    resolveExec(req: ExecRequest): ExecSpawn {
      if (req.cmd !== 'jira-mock') return req;
      return { ...req, cmd: jira.command, args: [...jira.prefix, ...req.args], env: { ...req.env, ...jira.env } };
    },
    /**
     * Once: reads the Jira site from `acli jira auth status` (`integrations:config` waits for it). When acli
     * cannot be started and no CLI was chosen on purpose (CORTEX_JIRA_CLI, or `mock` in config.json), a dev run falls back to the mock; production
     * (and an explicit `acli`) marks Jira `unavailable` instead, which the UI shows as a banner.
     */
    initJira(): Promise<void> {
      jiraReady ??= (async () => {
        if (config.jira.cli !== 'acli') return;
        try {
          const site = await jira.site();
          if (site && !jiraSiteFixed(env, userConfig)) config.jira.site = site;
          if (!site) {
            config.jira.note = JIRA_NOT_CONFIGURED;
            config.jira.unavailable = true;
          }
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          if (config.jira.explicit) {
            config.jira.note = `acli could not be started: ${why}`;
            config.jira.unavailable = true;
            return;
          }
          if (paths.production) {
            // never show fake data in production
            config.jira.note = JIRA_NOT_CONFIGURED;
            config.jira.unavailable = true;
            return;
          }
          config.jira.cli = 'mock';
          if (!jiraSiteFixed(env, userConfig)) config.jira.site = env['JIRA_MOCK_SITE'] || 'https://example.atlassian.net';
          config.jira.note = 'acli not found on PATH: using the Jira mock';
          jira.setSpec(jiraCliSpec(config, paths, env));
        }
      })();
      return jiraReady;
    },
    stopAll() {
      services.claude.stopAll();
      services.apps.stopAll();
      services.tests.stopAll();
    },
  };
  return services;
}

export type Services = ReturnType<typeof createServices>;
