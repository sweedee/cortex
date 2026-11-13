import { useEffect, useState } from 'react';

type MermaidApi = typeof import('mermaid').default;

let loader: Promise<MermaidApi> | null = null;
const loadMermaid = () => (loader ??= import('mermaid').then((m) => m.default));

let counter = 0;
let queue: Promise<unknown> = Promise.resolve();
let initializedFor: 'dark' | 'default' | null = null;

/** Strato's AppRoot sets data-theme on <html>; fall back to the OS preference. */
function currentTheme(): 'dark' | 'default' {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return 'dark';
  if (t === 'light') return 'default';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

function useTheme() {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const update = () => setTheme(currentTheme());
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', update);
    return () => {
      obs.disconnect();
      mq?.removeEventListener('change', update);
    };
  }, []);
  return theme;
}

type Result = { svg: string } | { error: string };

/** Renders are serialised: mermaid uses shared temp nodes and global config. */
function renderDiagram(source: string, theme: 'dark' | 'default'): Promise<Result> {
  const run = async (): Promise<Result> => {
    const mermaid = await loadMermaid();
    if (initializedFor !== theme) {
      // natural size + horizontal scroll: scaled to fit, wide diagrams become unreadable
      const size = { useMaxWidth: false };
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, suppressErrorRendering: true, flowchart: size, sequence: size, er: size, class: size, state: size, gantt: size });
      initializedFor = theme;
    }
    const id = `cxv-mermaid-${++counter}`;
    try {
      const { svg } = await mermaid.render(id, source);
      return { svg };
    } catch (e) {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      return { error: (e instanceof Error ? e.message : String(e)).split('\n')[0] };
    }
  };
  const p = queue.then(run, run);
  queue = p;
  return p;
}

/** Renders Mermaid source as a diagram (mermaid itself is a lazily imported chunk). */
export function Mermaid({ source }: { source: string }) {
  const theme = useTheme();
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let stale = false;
    renderDiagram(source, theme).then((r) => {
      if (!stale) setResult(r);
    });
    return () => {
      stale = true;
    };
  }, [source, theme]);

  if (result && 'error' in result) {
    return (
      <div className="cxv-mermaid-error">
        <div className="cxv-mermaid-error-msg">Diagram could not be rendered: {result.error}</div>
        <pre>{source}</pre>
      </div>
    );
  }
  if (!result) return <div className="cxv-mermaid" />;
  return <div className="cxv-mermaid" dangerouslySetInnerHTML={{ __html: result.svg }} />;
}
