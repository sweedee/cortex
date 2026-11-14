/**
 * The app's sidebar: Preview (the running app in a webview, viewport switcher, reload) and Log
 * (the runner's output, following). Starting = spinner until a URL shows up; crashed = the last log
 * lines and a restart button. Design after `PreviewView` on the toolbox-projects branch.
 */
import { useSyncExternalStore } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { ProgressCircle } from '@dynatrace/strato-components/content';
import { CycleIcon, DesktopIcon, PlayIcon, StopIcon } from '@dynatrace/strato-icons';
import { LogView, WebPanel } from '../../components/viewers';
import { useAppLog } from '../../data/apps';
import { isRealPath, type ItemOf } from '../../domain';
import { DefaultSidebar, SidebarTabs } from '../../sidebar';
import { errorText, openUrl } from '../../ui/task';
import type { SidebarProps } from '../types';
import { cannotStart, restartApp, runnerId, startApp, stopApp } from './ops';
import './app.css';

type App = ItemOf<'app'>;
type TabId = 'preview' | 'log' | 'details';

// the active tab, kept here so "Show log" can switch to it (SidebarTabs only remembers internally)
let tab: TabId = 'preview';
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
/** Open the Log tab (the next time / right now, if the sidebar shows an app). */
export function showAppTab(t: TabId) {
  tab = t;
  version++;
  listeners.forEach((l) => l());
}
const seen = (t: TabId) => {
  tab = t;
};

export function AppSidebar({ item, ctx }: SidebarProps<'app'>) {
  const v = useSyncExternalStore(subscribe, () => version);
  return (
    <SidebarTabs
      key={v}
      initial={tab}
      tabs={[
        { id: 'preview', label: 'Preview', wide: item.data.state === 'running' && !!item.data.url, render: () => (seen('preview'), (<Preview key={item.id} app={item} />)) },
        { id: 'log', label: 'Log', render: () => (seen('log'), (<Log app={item} />)) },
        { id: 'details', label: 'Details', render: () => (seen('details'), (<DefaultSidebar item={item} ctx={ctx} />)) },
      ]}
    />
  );
}

function useLog(app: App) {
  // demo items never ran in main; their log would just be empty
  const id = isRealPath(app.data.cwd) ? runnerId(app) : undefined;
  return useAppLog(id);
}

function Log({ app }: { app: App }) {
  const log = useLog(app);
  return (
    <div className="ap ap-log">
      {log.error ? (
        <div className="ap-error">Could not load the log: {errorText(log.error)}</div>
      ) : log.data ? (
        <LogView text={log.data} follow aria-label={`${app.title} log`} />
      ) : (
        <div className="ap-empty ap-sub">{log.isLoading ? <ProgressCircle size="small" aria-label="Loading the log" /> : 'No output yet.'}</div>
      )}
    </div>
  );
}

function StartButton({ app }: { app: App }) {
  const why = cannotStart(app);
  return (
    <>
      <Button variant="accent" color="primary" disabled={!!why} onClick={() => void startApp(app)}>
        <Button.Prefix>
          <PlayIcon />
        </Button.Prefix>
        Start
      </Button>
      {why && <div className="ap-sub ap-small">{why}</div>}
    </>
  );
}

function Preview({ app }: { app: App }) {
  const log = useLog(app);
  const { state, url, command, cwd } = app.data;
  const out = log.data ?? '';

  if (state === 'running' && url) {
    return (
      <div className="ap">
        <WebPanel src={url} partition="persist:apps" viewportSwitcher colorSchemeToggle onOpenExternal={(u) => void openUrl(u)} />
      </div>
    );
  }

  let body;
  if (state === 'starting' || state === 'running') {
    body = (
      <>
        {state === 'starting' ? <ProgressCircle aria-label="Starting" /> : <DesktopIcon className="ap-icon" />}
        <div className="ap-title">{state === 'starting' ? 'Starting…' : 'Running, but no URL was detected'}</div>
        <div className="ap-sub">{state === 'starting' ? 'Waiting for a local URL in the output.' : 'Open the log to see what it printed.'}</div>
        {out.trim() && <LogView className="ap-tail" text={out} maxLines={14} follow />}
        <Button onClick={() => void stopApp(app)}>
          <Button.Prefix>
            <StopIcon />
          </Button.Prefix>
          {state === 'starting' ? 'Cancel' : 'Stop'}
        </Button>
      </>
    );
  } else if (state === 'crashed') {
    body = (
      <>
        <div className="ap-title ap-critical">The app crashed</div>
        <div className="ap-sub ap-mono">{command}</div>
        {out.trim() ? <LogView className="ap-tail" text={out} maxLines={20} follow /> : <div className="ap-sub">No output.</div>}
        <span className="ap-row">
          <Button variant="accent" color="primary" disabled={!!cannotStart(app)} onClick={() => void restartApp(app)}>
            <Button.Prefix>
              <CycleIcon />
            </Button.Prefix>
            Restart
          </Button>
          <Button onClick={() => showAppTab('log')}>Show full log</Button>
        </span>
      </>
    );
  } else {
    body = (
      <>
        <DesktopIcon className="ap-icon" />
        <div className="ap-title">Not running</div>
        <div className="ap-sub">
          Starts <span className="ap-mono">{command}</span> in <span className="ap-mono">{cwd || '–'}</span> and shows it here.
        </div>
        <StartButton app={app} />
      </>
    );
  }
  return (
    <div className="ap">
      <div className="ap-empty">{body}</div>
    </div>
  );
}
