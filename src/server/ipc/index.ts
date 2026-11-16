import { homedir } from 'node:os';
import { Roots, type PathEnv } from '../lib/pathPolicy';
import { setLimits } from '../lib/limits';
import { UserConfigStore } from '../lib/userConfig';
import { createServices } from '../services';
import type { IpcContext } from './handle';
import { registerConfig } from './config';
import { registerDesktop } from './desktop';
import { registerExec } from './exec';
import { registerFiles } from './files';
import { registerIntegrations } from './integrations';

export { Registry, handle, type Caller, type IpcContext, type InvokeOutcome } from './handle';

export interface IpcOptions {
  /** Cortex's data folder (`lib/userData.ts`) */
  userData: string;
  /** the package root (scripts/jira-mock lives there) */
  appRoot: string;
  version: string;
  production: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Register a handler for every invoke channel of the contract in `src/shared/ipc.ts`. */
export function registerIpc(ctx: IpcContext, opts: IpcOptions) {
  const env = opts.env ?? process.env;
  // ~/.cortex/config.json (lib/userConfig.ts): read once here, watched for edits
  const userConfig = new UserConfigStore(opts.userData);
  userConfig.ensureFiles();
  userConfig.watch();
  const services = createServices({ appRoot: opts.appRoot, userData: opts.userData, production: opts.production }, (channel, payload) => ctx.send(channel, payload), env, userConfig.config);
  setLimits(userConfig.config.limits);
  userConfig.onChange((s) => {
    services.setUserConfig(s.config);
    setLimits(s.config.limits);
  });
  // the folders fs / shell / proc calls may touch (lib/pathPolicy.ts)
  const pathEnv: PathEnv = { platform: process.platform, home: homedir(), userData: opts.userData, programData: env['ProgramData'] };
  const roots = new Roots(pathEnv);
  const exec = registerExec(ctx, { roots, production: opts.production, resolve: services.resolveExec });
  registerDesktop(ctx, { roots, pathEnv, editor: () => userConfig.config.editor, version: opts.version });
  registerConfig(ctx, userConfig);
  registerIntegrations(ctx, services, roots);
  const files = registerFiles(ctx, roots, opts.userData);
  return {
    closeWatchers: files.closeWatchers,
    /** server-trusted folder (tests) */
    allowRoot: (dir: string) => roots.add(dir),
    /** kill every child tree (agents, dev servers, test runs, proc:start), finish a workspace write */
    async shutdown() {
      services.stopAll();
      exec.stopAll();
      userConfig.close();
      await files.flush();
    },
  };
}
