import { app } from 'electron';
import { Roots } from '../lib/pathPolicy';
import { UserConfigStore } from '../lib/userConfig';
import { createServices } from '../services';
import type { IpcContext } from './handle';
import { registerConfig } from './config';
import { registerDesktop } from './desktop';
import { registerExec } from './exec';
import { registerFiles } from './files';
import { registerIntegrations } from './integrations';

export type { IpcContext } from './handle';

/** Register every invoke channel of the contract in `src/shared/ipc.ts`. */
export function registerIpc(ctx: IpcContext) {
  // ~/.cortex/config.json (lib/userConfig.ts): read once here, watched for edits
  const userConfig = new UserConfigStore(app.getPath('userData'));
  userConfig.ensureFiles();
  userConfig.watch();
  app.on('will-quit', () => userConfig.close());
  const services = createServices({ appRoot: app.getAppPath(), userData: app.getPath('userData'), isElectron: true }, (channel, payload) => ctx.send(channel, payload), process.env, userConfig.config);
  userConfig.onChange((s) => services.setUserConfig(s.config));
  // the folders fs / shell / proc calls may touch (lib/pathPolicy.ts)
  const roots = new Roots({ platform: process.platform, home: app.getPath('home'), userData: app.getPath('userData'), programData: process.env['ProgramData'] });
  registerExec(ctx, { roots, resolve: services.resolveExec });
  registerDesktop(ctx, roots, () => userConfig.config.editor);
  registerConfig(ctx, userConfig);
  registerIntegrations(ctx, services, roots);
  const files = registerFiles(ctx, roots);
  return {
    ...files,
    /** main-trusted folder (the smoke harness's repo / temp dirs) */
    allowRoot: (dir: string) => roots.add(dir),
  };
}
