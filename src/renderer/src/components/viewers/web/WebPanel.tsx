import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { ProgressCircle } from '@dynatrace/strato-components/content';
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, RefreshIcon } from '@dynatrace/strato-icons';
import '../viewers.css';

export type Viewport = 'desktop' | 'tablet' | 'mobile';
export const VIEWPORT_WIDTH: Record<Viewport, string> = { desktop: '100%', tablet: '820px', mobile: '390px' };

export interface WebPanelProps {
  src: string;
  /** Session partition, e.g. `persist:github` so logins survive restarts. Fixed for the element's lifetime. */
  partition?: string;
  onNavigate?: (url: string) => void;
  /** Host opens the URL in the OS browser. The button is hidden without it. */
  onOpenExternal?: (url: string) => void;
  /** Slim toolbar (default true). */
  toolbar?: boolean;
  /** Frame width preset for app previews (default desktop = full width). */
  viewport?: Viewport;
  /** Show desktop/tablet/mobile switch buttons in the toolbar; `viewport` is then the initial value. */
  viewportSwitcher?: boolean;
  className?: string;
}

/** The subset of Electron's WebviewTag we use (kept local so the renderer needs no electron types). */
interface WebviewEl extends HTMLElement {
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
}

const inElectron = typeof navigator !== 'undefined' && /Electron\//.test(navigator.userAgent);

/** Re-creates the inner panel (fresh webview + transient state) whenever the target or partition changes, or on retry. */
export function WebPanel(props: WebPanelProps) {
  const [retry, setRetry] = useState(0);
  return <WebPanelInner key={`${props.partition ?? ''}|${props.src}|${retry}`} {...props} onRetry={() => setRetry((n) => n + 1)} />;
}

function WebPanelInner({ src, partition, onNavigate, onOpenExternal, toolbar = true, viewport: viewportProp = 'desktop', viewportSwitcher, className, onRetry }: WebPanelProps & { onRetry: () => void }) {
  const ref = useRef<WebviewEl | null>(null);
  const [url, setUrl] = useState(src);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState({ back: false, forward: false });
  const [viewportPick, setViewport] = useState<Viewport | null>(null);
  const viewport = viewportPick ?? viewportProp;
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    const wv = ref.current;
    if (!wv || !inElectron) return;
    const sync = () => {
      try {
        setNav({ back: wv.canGoBack(), forward: wv.canGoForward() });
        const u = wv.getURL();
        if (u) {
          setUrl(u);
          onNavigateRef.current?.(u);
        }
      } catch {
        /* not attached yet */
      }
    };
    const start = () => {
      setLoading(true);
      setError(null);
    };
    const stop = () => {
      setLoading(false);
      sync();
    };
    const fail = (e: Event) => {
      const ev = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean };
      // -3 = aborted (superseded navigation), not a real failure
      if (ev.isMainFrame === false || ev.errorCode === -3) return;
      setLoading(false);
      setError(ev.errorDescription || 'Load failed');
    };
    wv.addEventListener('did-start-loading', start);
    wv.addEventListener('did-stop-loading', stop);
    wv.addEventListener('did-navigate', sync);
    wv.addEventListener('did-navigate-in-page', sync);
    wv.addEventListener('did-fail-load', fail);
    return () => {
      wv.removeEventListener('did-start-loading', start);
      wv.removeEventListener('did-stop-loading', stop);
      wv.removeEventListener('did-navigate', sync);
      wv.removeEventListener('did-navigate-in-page', sync);
      wv.removeEventListener('did-fail-load', fail);
    };
  }, []);

  const reload = useCallback(() => {
    if (error || !inElectron) onRetry();
    else ref.current?.reload();
  }, [error, onRetry]);

  const width = VIEWPORT_WIDTH[viewport];


  return (
    <div className={`cxv-web${className ? ` ${className}` : ''}`}>
      {toolbar && (
        <div className="cxv-web-bar">
          {inElectron && (
            <>
              <Button size="condensed" variant="default" disabled={!nav.back} aria-label="Back" onClick={() => ref.current?.goBack()}>
                <Button.Prefix>
                  <ArrowLeftIcon />
                </Button.Prefix>
              </Button>
              <Button size="condensed" variant="default" disabled={!nav.forward} aria-label="Forward" onClick={() => ref.current?.goForward()}>
                <Button.Prefix>
                  <ArrowRightIcon />
                </Button.Prefix>
              </Button>
            </>
          )}
          <Button size="condensed" variant="default" aria-label="Reload" onClick={reload}>
            <Button.Prefix>
              <RefreshIcon />
            </Button.Prefix>
          </Button>
          <div className="cxv-web-url" title={url}>
            {url}
          </div>
          {loading && <ProgressCircle size="small" aria-label="Loading" />}
          {viewportSwitcher &&
            (['desktop', 'tablet', 'mobile'] as const).map((v) => (
              <Button key={v} size="condensed" variant={viewport === v ? 'emphasized' : 'default'} onClick={() => setViewport(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </Button>
            ))}
          {onOpenExternal && (
            <Button size="condensed" variant="default" aria-label="Open externally" onClick={() => onOpenExternal(url)}>
              <Button.Prefix>
                <ExternalLinkIcon />
              </Button.Prefix>
            </Button>
          )}
        </div>
      )}
      {!inElectron && <div className="cxv-web-notice">Embedded in an iframe: some sites block embedding. Use “open externally” if the page stays blank.</div>}
      <div className="cxv-web-stage">
        {error && (
          <div className="cxv-web-error" role="alert">
            <div className="cxv-web-error-title">Couldn’t load — is the app running?</div>
            <div className="cxv-web-error-detail">
              {url} · {error}
            </div>
            <Button size="condensed" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
        <div className="cxv-web-frame" style={{ width, visibility: error ? 'hidden' : 'visible' }}>
          {inElectron ? (
            <webview ref={ref as never} src={src} partition={partition} className="cxv-web-view" />
          ) : (
            <iframe src={src} title="Web preview" className="cxv-web-view" onLoad={() => setLoading(false)} />
          )}
        </div>
      </div>
    </div>
  );
}
