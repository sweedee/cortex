/**
 * Preload (sandboxed, CommonJS): exposes the typed bridge as `window.cortex`. The forwarders are
 * generated from the channel lists in `shared/ipc.ts` (`shared/bridge.ts`), so only declared
 * channels are reachable. It only forwards; validation happens in main. Never expose ipcRenderer itself.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { buildBridge, type BridgeOn } from '../shared/bridge';

const on: BridgeOn = (channel, cb) => {
  const listener = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld(
  'cortex',
  buildBridge((channel, req) => ipcRenderer.invoke(channel, req), on),
);
