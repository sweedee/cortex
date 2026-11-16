import type { UserConfigStore } from '../lib/userConfig';
import { handle, type IpcContext } from './handle';

/**
 * `config:get` / `config:update` and the `config:changed` event. The request schema only lets the
 * renderer change the gear-dialog settings (`RendererConfigPatchSchema`): `editor.*` and
 * `claude.bin` name programs main runs, so they come from config.json alone.
 */
export function registerConfig(ctx: IpcContext, store: UserConfigStore) {
  handle(ctx, 'config:get', () => store.state);
  handle(ctx, 'config:update', (req) => store.update(req));
  store.onChange((s) => ctx.send('config:changed', s));
}
