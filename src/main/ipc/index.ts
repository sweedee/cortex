import type { IpcContext } from './handle';
import { registerDesktop } from './desktop';
import { registerExec } from './exec';
import { registerFiles } from './files';

export type { IpcContext } from './handle';

/** Register every invoke channel of the contract in `src/shared/ipc.ts`. */
export function registerIpc(ctx: IpcContext) {
  registerExec(ctx);
  registerDesktop(ctx);
  return registerFiles(ctx);
}
