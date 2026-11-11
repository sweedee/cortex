import { useEffect, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { ProgressCircle } from '@dynatrace/strato-components/content';
import { Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import {
  ChevronDownSmallIcon,
  ChevronRightSmallIcon,
  DesktopIcon,
  ExternalLinkIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
  TerminalIcon,
} from '@dynatrace/strato-icons';
import type { WorkItem } from '../model/types';
import { launchApp, stopApp } from '../state/actions';
import { useBusy, useWork } from '../state/store';
import { previewCss } from './preview/styles';

type Viewport = 'desktop' | 'tablet' | 'mobile';
const WIDTHS: Record<Viewport, { label: string; width: string; px?: number }> = {
  desktop: { label: 'Desktop', width: '100%' },
  tablet: { label: 'Tablet', width: '820px', px: 820 },
  mobile: { label: 'Mobile', width: '390px', px: 390 },
};

export function PreviewView({ workId }: { workId: string }) {
  return <PreviewPage key={workId} workId={workId} />;
}

function runsFrom(work: WorkItem) {
  return work.worktree ? `worktree ${work.worktree.path} (${work.worktree.branch})` : `the main checkout of ${work.repo}`;
}

function LogLines({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  return (
    <div className="ctx-pv__log" ref={ref} role="log" aria-label="Dev server log">
      {lines.join('\n')}
    </div>
  );
}

function PreviewPage({ workId }: { workId: string }) {
  const work = useWork(workId);
  const launching = useBusy(workId, 'app');
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [reloadKey, setReloadKey] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  if (!work) return null;
  const { app } = work;

  if (app.status === 'stopped') {
    return (
      <div className="ctx-pv">
        <style>{previewCss}</style>
        <div className="ctx-pv__stage">
          <div className="ctx-pv__empty">
            <DesktopIcon style={{ width: 32, height: 32 }} />
            <Text textStyle="base-emphasized" style={{ color: Colors.Text.Neutral.Default }}>
              App is not running
            </Text>
            <Text style={{ maxWidth: 460 }}>
              Launching starts the dev server from {runsFrom(work)} and shows it here.
            </Text>
            <Button variant="accent" color="primary" loading={launching} onClick={() => void launchApp(workId)}>
              <Button.Prefix>
                <PlayIcon />
              </Button.Prefix>
              Launch app
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (app.status === 'starting') {
    return (
      <div className="ctx-pv">
        <style>{previewCss}</style>
        <div className="ctx-pv__stage">
          <div className="ctx-pv__empty">
            <ProgressCircle aria-label="Starting dev server" />
            <Text textStyle="base-emphasized" style={{ color: Colors.Text.Neutral.Default }}>
              Starting dev server…
            </Text>
            <Text>Running from {runsFrom(work)}</Text>
            <div className="ctx-pv__term">{app.logs.join('\n')}</div>
            <Button size="condensed" onClick={() => stopApp(workId)}>
              <Button.Prefix>
                <StopIcon />
              </Button.Prefix>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const cfg = WIDTHS[viewport];
  const narrow = viewport !== 'desktop';
  return (
    <div className="ctx-pv">
      <style>{previewCss}</style>
      <div className="ctx-pv__bar">
        <Button size="condensed" aria-label="Reload" onClick={() => setReloadKey((k) => k + 1)}>
          <Button.Prefix>
            <RefreshIcon />
          </Button.Prefix>
          Reload
        </Button>
        <div className="ctx-pv__addr" aria-label="Address" title={`http://localhost:${app.port}/`}>
          {`http://localhost:${app.port}/`}
        </div>
        <div className="ctx-pv__seg" role="group" aria-label="Viewport">
          {(Object.keys(WIDTHS) as Viewport[]).map((v) => (
            <Button
              key={v}
              size="condensed"
              variant={viewport === v ? 'emphasized' : 'default'}
              aria-pressed={viewport === v}
              onClick={() => setViewport(v)}
              style={viewport === v ? undefined : { border: 'none', background: 'transparent' }}
            >
              {WIDTHS[v].label}
            </Button>
          ))}
        </div>
        <Button size="condensed" aria-label="Open in new tab" onClick={() => window.open(app.url, '_blank', 'noopener')}>
          <Button.Prefix>
            <ExternalLinkIcon />
          </Button.Prefix>
          Open
        </Button>
        <Button size="condensed" color="critical" onClick={() => stopApp(workId)}>
          <Button.Prefix>
            <StopIcon />
          </Button.Prefix>
          Stop
        </Button>
      </div>

      <div className="ctx-pv__stage">
        <div className="ctx-pv__canvas">
          <iframe
            key={reloadKey}
            className="ctx-pv__frame"
            data-narrow={narrow}
            style={{ width: cfg.width }}
            src={app.url}
            title={`${work.title} - running app`}
          />
        </div>
        <div className="ctx-pv__drawer">
          <button type="button" className="ctx-pv__drawer-head" aria-expanded={logOpen} onClick={() => setLogOpen((o) => !o)}>
            {logOpen ? <ChevronDownSmallIcon /> : <ChevronRightSmallIcon />}
            <TerminalIcon />
            Dev server log
            <span style={{ color: Colors.Text.Neutral.Subdued }}>{app.logs.length} lines</span>
          </button>
          {logOpen && <LogLines lines={app.logs} />}
        </div>
      </div>
    </div>
  );
}
