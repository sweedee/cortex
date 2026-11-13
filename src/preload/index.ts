/**
 * Preload (sandboxed, CommonJS): exposes the typed bridge as `window.cortex`. It only
 * forwards to ipcRenderer; validation happens in main. Never expose ipcRenderer itself.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { CortexApi, EventChannel, EventChannels, InvokeChannel, Req, Res } from '../shared/ipc';

const invoke = <C extends InvokeChannel>(channel: C, req?: Req<C>) => ipcRenderer.invoke(channel, req) as Promise<Res<C>>;

function on<C extends EventChannel>(channel: C, cb: (payload: EventChannels[C]) => void) {
  const listener = (_e: Electron.IpcRendererEvent, payload: EventChannels[C]) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.removeListener(channel, listener);
}

const api: CortexApi = {
  exec: {
    run: (req) => invoke('exec:run', req),
  },
  proc: {
    start: (req) => invoke('proc:start', req),
    stop: (id) => invoke('proc:stop', { id }),
    list: () => invoke('proc:list'),
    onOutput: (cb) => on('proc:output', cb),
    onExit: (cb) => on('proc:exit', cb),
  },
  dialog: {
    pickDirectory: (req = {}) => invoke('dialog:pickDirectory', req),
    pickFile: (req = {}) => invoke('dialog:pickFile', req),
  },
  shell: {
    openExternal: (url) => invoke('shell:openExternal', { url }),
    openPath: (path) => invoke('shell:openPath', { path }),
    openInEditor: (path) => invoke('shell:openInEditor', { path }),
  },
  notify: {
    desktop: (n) => invoke('notify:desktop', n),
    onClicked: (cb) => on('notify:clicked', cb),
  },
  workspace: {
    load: () => invoke('workspace:load'),
    save: (data) => invoke('workspace:save', { data }),
    path: () => invoke('workspace:path'),
  },
  fs: {
    readText: (path) => invoke('fs:readText', { path }),
    writeText: (path, text) => invoke('fs:writeText', { path, text }),
    list: (dir, options) => invoke('fs:list', { dir, options }),
    watch: (dir) => invoke('fs:watch', { dir }),
    unwatch: (watchId) => invoke('fs:unwatch', { watchId }),
    onChanged: (cb) => on('fs:changed', cb),
  },
  app: {
    info: () => invoke('app:info'),
  },
};

contextBridge.exposeInMainWorld('cortex', api);
