/** Builds the integration services for main (no Electron imports: paths are passed in). */
import { join } from 'node:path';
import type { EventChannel, EventChannels, ExecRequest } from '../../shared/ipc';
import type { ExecSpawn } from '../lib/exec';
import { ClaudeSessions } from './claude';
import { jiraCliSpec, resolveConfig } from './config';
import { GhService } from './gh';
import { GitService } from './git';
import { JiraService } from './jira';
import { AppRunner, TestRunner } from './runners';

export interface ServicePaths {
  /** app root (where scripts/ lives): `app.getAppPath()` */
  appRoot: string;
  userData: string;
  /** running inside Electron: node scripts run via process.execPath + ELECTRON_RUN_AS_NODE */
  isElectron: boolean;
}

type Send = <C extends EventChannel>(channel: C, payload: EventChannels[C]) => void;

export function createServices(paths: ServicePaths, send: Send) {
  const config = resolveConfig();
  // CORTEX_CLAUDE_BIN may point at a node script (e.g. the fake CLI fixture): run it with this runtime
  const claudeScript = /\.[cm]?js$/i.test(config.claude.bin);
  const jira = new JiraService(jiraCliSpec(config, paths), { cwd: paths.userData });
  const services = {
    config,
    git: new GitService(),
    gh: new GhService(config.github, { cwd: paths.userData }),
    jira,
    claude: new ClaudeSessions({
      bin: claudeScript ? process.execPath : config.claude.bin,
      prefixArgs: claudeScript ? [config.claude.bin, ...config.claude.prefixArgs] : config.claude.prefixArgs,
      env: claudeScript && paths.isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : undefined,
      storeFile: join(paths.userData, 'claude-sessions.json'),
      send: send as ConstructorParameters<typeof ClaudeSessions>[0]['send'],
      defaultPermissionMode: config.claude.defaultPermissionMode,
    }),
    apps: new AppRunner(send, { flushMs: config.runners.flushMs, runningAfterMs: config.runners.runningAfterMs }),
    tests: new TestRunner(send, { flushMs: config.runners.flushMs }),
    /** `exec:run` keeps the allowlist name `jira-mock`; here it becomes the configured Jira CLI */
    resolveExec(req: ExecRequest): ExecSpawn {
      if (req.cmd !== 'jira-mock') return req;
      return { ...req, cmd: jira.command, args: [...jira.prefix, ...req.args], env: { ...jira.env, ...req.env } };
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
