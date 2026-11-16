import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { ProgressCircle } from '@dynatrace/strato-components/content';
import { ExternalLinkIcon, RefreshIcon } from '@dynatrace/strato-icons';
import '../viewers.css';

export type Viewport = 'desktop' | 'tablet' | 'mobile';
export const VIEWPORT_WIDTH: Record<Viewport, string> = { desktop: '100%', tablet: '820px', mobile: '390px' };

export interface WebPanelProps {
  src: string;
  /** Host opens the URL in a new tab. For pages that cannot be framed this is the whole panel. */
  onOpenExternal?: (url: string) => void;
  /** Slim toolbar (default true). */
  toolbar?: boolean;
  /** Frame width preset for app previews (default desktop = full width). */
  viewport?: Viewport;
  /** Show desktop/tablet/mobile switch buttons in the toolbar; `viewport` is then the initial value. */
  viewportSwitcher?: boolean;
  className?: string;
}

/** Only apps running on this machine are framed; GitHub, Jira & co. forbid framing (X-Frame-Options / CSP). */
export function isFrameable(src: string): boolean {
  try {
    const u = new URL(src);
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** Re-creates the inner panel (fresh iframe + transient state) whenever the target changes, or on reload. */
export function WebPanel(props: WebPanelProps) {
  const [reload, setReload] = useState(0);
  return isFrameable(props.src) ? <FramePanel key={`${props.src}|${reload}`} {...props} onReload={() => setReload((n) => n + 1)} /> : <LinkPanel {...props} />;
}

/** A page that cannot be embedded: its URL and a button that opens it in a new tab. */
function LinkPanel({ src, onOpenExternal, className }: WebPanelProps) {
  return (
    <div className={`cxv-web${className ? ` ${className}` : ''}`}>
      <div className="cxv-web-stage">
        <div className="cxv-web-error">
          <div className="cxv-web-error-title">This page opens in its own tab</div>
          <div className="cxv-web-error-detail">The site does not allow being embedded.</div>
          <div className="cxv-web-url" title={src} style={{ maxWidth: '90%', flex: 'none' }}>
            {src}
          </div>
          {onOpenExternal && (
            <Button variant="accent" onClick={() => onOpenExternal(src)}>
              <Button.Prefix>
                <ExternalLinkIcon />
              </Button.Prefix>
              Open in new tab
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FramePanel({ src, onOpenExternal, toolbar = true, viewport: viewportProp = 'desktop', viewportSwitcher, className, onReload }: WebPanelProps & { onReload: () => void }) {
  const [loading, setLoading] = useState(true);
  const [viewportPick, setViewport] = useState<Viewport | null>(null);
  const viewport = viewportPick ?? viewportProp;

  return (
    <div className={`cxv-web${className ? ` ${className}` : ''}`}>
      {toolbar && (
        <div className="cxv-web-bar">
          <Button size="condensed" variant="default" aria-label="Reload" onClick={onReload}>
            <Button.Prefix>
              <RefreshIcon />
            </Button.Prefix>
          </Button>
          <div className="cxv-web-url" title={src}>
            {src}
          </div>
          {loading && <ProgressCircle size="small" aria-label="Loading" />}
          {viewportSwitcher &&
            (['desktop', 'tablet', 'mobile'] as const).map((v) => (
              <Button key={v} size="condensed" variant={viewport === v ? 'emphasized' : 'default'} onClick={() => setViewport(v)}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </Button>
            ))}
          {onOpenExternal && (
            <Button size="condensed" variant="default" aria-label="Open in new tab" onClick={() => onOpenExternal(src)}>
              <Button.Prefix>
                <ExternalLinkIcon />
              </Button.Prefix>
            </Button>
          )}
        </div>
      )}
      <div className="cxv-web-stage">
        <div className="cxv-web-frame" style={{ width: VIEWPORT_WIDTH[viewport] }}>
          <iframe src={src} title="Web preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" className="cxv-web-view" onLoad={() => setLoading(false)} />
        </div>
      </div>
    </div>
  );
}
