import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { EventChannel, EventChannels, InvokeChannel, Req, Res } from '../../shared/ipc';
import { parseRequest } from '../lib/validate';

/** Shared state the handler modules need. */
export interface IpcContext {
  getWindow(): BrowserWindow | null;
  /** push an event to the app window (no-op when it is gone) */
  send<C extends EventChannel>(channel: C, payload: EventChannels[C]): void;
}

/**
 * Register a typed, validated invoke handler. Only the app's own window may call: webviews
 * (GitHub, Jira, running apps) never get a preload, and this check makes sure of it.
 */
export function handle<C extends InvokeChannel>(
  ctx: IpcContext,
  channel: C,
  fn: (req: Req<C>, e: IpcMainInvokeEvent) => Res<C> | Promise<Res<C>>,
): void {
  ipcMain.handle(channel, async (e, raw: unknown) => {
    const win = ctx.getWindow();
    if (!win || e.sender !== win.webContents) throw new Error(`${channel}: caller not allowed`);
    return fn(parseRequest(channel, raw), e);
  });
}
