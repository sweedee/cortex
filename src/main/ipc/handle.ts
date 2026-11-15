import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { EventChannel, EventChannels, InvokeChannel, Req, Res } from '../../shared/ipc';
import { parseRequest } from '../lib/validate';
import { PathNotAllowedError } from '../lib/pathPolicy';
import { ipcError } from './errors';

/** Shared state the handler modules need. */
export interface IpcContext {
  getWindow(): BrowserWindow | null;
  /** push an event to the app window (no-op when it is gone) */
  send<C extends EventChannel>(channel: C, payload: EventChannels[C]): void;
}

/**
 * Register a typed, validated invoke handler. Only the app window's main frame may call: webviews
 * (GitHub, Jira, running apps) never get a preload, and this check makes sure of it.
 */
export function handle<C extends InvokeChannel>(ctx: IpcContext, channel: C, fn: (req: Req<C>, e: IpcMainInvokeEvent) => Res<C> | Promise<Res<C>>): void {
  ipcMain.handle(channel, async (e, raw: unknown) => {
    const win = ctx.getWindow();
    // the app window's own top-level page: no webview guest, no (future) iframe inside the app
    const frame = e.senderFrame;
    const main = win?.webContents.mainFrame;
    const isMain = !!frame && !!main && frame.processId === main.processId && frame.routingId === main.routingId;
    if (!win || e.sender !== win.webContents || !isMain) throw ipcError(new PathNotAllowedError(`${channel}: caller not allowed`));
    try {
      return await fn(parseRequest(channel, raw), e);
    } catch (err) {
      throw ipcError(err);
    }
  });
}
