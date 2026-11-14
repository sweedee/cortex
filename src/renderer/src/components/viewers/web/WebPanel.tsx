import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { ProgressCircle } from '@dynatrace/strato-components/content';
import { ArrowLeftIcon, ArrowRightIcon, DarkmodeIcon, ExternalLinkIcon, LightmodeIcon, RefreshIcon } from '@dynatrace/strato-icons';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { native } from '../../../native';
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
  /**
   * Light / dark toggle for the page (emulates `prefers-color-scheme` in the guest). Without a pick the
   * page follows the app's theme. Desktop app only; the iframe fallback cannot emulate it.
   */
  colorSchemeToggle?: boolean;
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
  getWebContentsId(): number;
}

export type Scheme = 'light' | 'dark';

/** The app's colour scheme: Strato's AppRoot sets `data-theme` on <html>, else the OS preference. */
export function appScheme(): Scheme {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function subscribeScheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  mq?.addEventListener('change', cb);
  return () => {
    obs.disconnect();
    mq?.removeEventListener('change', cb);
  };
}

const inElectron = typeof navigator !== 'undefined' && /Electron\//.test(navigator.userAgent);

/** Re-creates the inner panel (fresh webview + transient state) whenever the target or partition changes, or on retry. */
export function WebPanel(props: WebPanelProps) {
  const [retry, setRetry] = useState(0);
  return <WebPanelInner key={`${props.partition ?? ''}|${props.src}|${retry}`} {...props} onRetry={() => setRetry((n) => n + 1)} />;
}

function WebPanelInner({ src, partition, onNavigate, onOpenExternal, toolbar = true, viewport: viewportProp = 'desktop', viewportSwitcher, colorSchemeToggle, className, onRetry }: WebPanelProps & { onRetry: () => void }) {
  const ref = useRef<WebviewEl | null>(null);
  const [url, setUrl] = useState(src);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState({ back: false, forward: false });
  const [viewportPick, setViewport] = useState<Viewport | null>(null);
  const viewport = viewportPick ?? viewportProp;
  const [schemePick, setSchemePick] = useState<Scheme | null>(null);
  const app = useSyncExternalStore(subscribeScheme, appScheme);
  const scheme = schemePick ?? app;
  const schemeRef = useRef(scheme);
  useEffect(() => {
    schemeRef.current = scheme;
  }, [scheme]);
  const emulate = colorSchemeToggle && inElectron;
  /** push the effective scheme into the guest (it needs to be attached: dom-ready) */
  const applyScheme = useCallback(() => {
    const wv = ref.current;
    if (!emulate || !wv) return;
    try {
      void native.webview.setColorScheme(wv.getWebContentsId(), schemeRef.current).catch(() => {});
    } catch {
      /* not attached yet: dom-ready calls again */
    }
  }, [emulate]);
  useEffect(applyScheme, [applyScheme, scheme]);
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
    wv.addEventListener('dom-ready', applyScheme);
    wv.addEventListener('did-navigate', applyScheme);
    return () => {
      wv.removeEventListener('dom-ready', applyScheme);
      wv.removeEventListener('did-navigate', applyScheme);
      wv.removeEventListener('did-start-loading', start);
      wv.removeEventListener('did-stop-loading', stop);
      wv.removeEventListener('did-navigate', sync);
      wv.removeEventListener('did-navigate-in-page', sync);
      wv.removeEventListener('did-fail-load', fail);
    };
  }, [applyScheme]);

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
          {emulate && (
            <Tooltip text={`Previewing in ${scheme} mode${schemePick ? '' : ' (follows the app)'}. Switch to ${scheme === 'dark' ? 'light' : 'dark'}.`}>
              <Button size="condensed" variant={schemePick ? 'emphasized' : 'default'} aria-label={`Preview color scheme: ${scheme}`} onClick={() => setSchemePick(scheme === 'dark' ? 'light' : 'dark')}>
                <Button.Prefix>{scheme === 'dark' ? <DarkmodeIcon /> : <LightmodeIcon />}</Button.Prefix>
              </Button>
            </Tooltip>
          )}
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
