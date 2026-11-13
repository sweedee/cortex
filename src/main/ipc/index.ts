import { app } from 'electron';
import { createServices } from '../services';
import type { IpcContext } from './handle';
import { registerDesktop } from './desktop';
import { registerExec } from './exec';
import { registerFiles } from './files';
import { registerIntegrations } from './integrations';

export type { IpcContext } from './handle';

/** Register every invoke channel of the contract in `src/shared/ipc.ts`. */
export function registerIpc(ctx: IpcContext) {
  const services = createServices({ appRoot: app.getAppPath(), userData: app.getPath('userData'), isElectron: true }, (channel, payload) => ctx.send(channel, payload));
  registerExec(ctx, { resolve: services.resolveExec });
  registerDesktop(ctx);
  registerIntegrations(ctx, services);
  return registerFiles(ctx);
}
