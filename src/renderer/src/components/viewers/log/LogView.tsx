import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Anser from 'anser';
import { tailLines } from './logUtils';
import '../viewers.css';

export interface LogViewProps {
  /** Either an array of lines or one text blob. */
  lines?: string[];
  text?: string;
  /** Keep scrolled to the newest line (default true). Scrolling up pauses; "Jump to latest" resumes. */
  follow?: boolean;
  /** Only the last N lines are rendered (default 2000). */
  maxLines?: number;
  className?: string;
  'aria-label'?: string;
}

const Line = memo(function Line({ text }: { text: string }) {
  const parts = useMemo(() => (text.includes('\u001b') ? Anser.ansiToJson(text, { use_classes: false, remove_empty: true }) : null), [text]);
  if (!parts) return <div className="cxv-log-line">{text || ' '}</div>;
  return (
    <div className="cxv-log-line">
      {parts.map((p, i) => (
        <span
          key={i}
          style={{
            color: p.fg ? `rgb(${p.fg})` : undefined,
            backgroundColor: p.bg ? `rgb(${p.bg})` : undefined,
            fontWeight: p.decoration === 'bold' ? 600 : undefined,
            opacity: p.decoration === 'dim' ? 0.7 : undefined,
            textDecoration: p.decoration === 'underline' ? 'underline' : undefined,
          }}
        >
          {p.content}
        </span>
      ))}
      {parts.length === 0 && ' '}
    </div>
  );
});

/** Monospace log tail with ANSI colours and auto-follow. Output is capped to the last `maxLines` lines. */
export const LogView = memo(function LogView({ lines, text, follow = true, maxLines = 2000, className, 'aria-label': label = 'Log' }: LogViewProps) {
  const { lines: shown, dropped } = useMemo(() => tailLines({ lines, text }, maxLines), [lines, text, maxLines]);
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const stuck = follow && !paused;

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [shown, stuck]);

  const onScroll = () => {
    const el = ref.current;
    if (!el || !follow) return;
    setPaused(el.scrollHeight - el.scrollTop - el.clientHeight >= 24);
  };

  return (
    <div className={`cxv-log-wrap${className ? ` ${className}` : ''}`}>
      <div className="cxv-log" ref={ref} onScroll={onScroll} role="log" aria-label={label} tabIndex={0}>
        {dropped > 0 && <div className="cxv-log-dropped">… {dropped.toLocaleString()} earlier lines hidden</div>}
        {shown.map((l, i) => (
          <Line key={dropped + i} text={l} />
        ))}
      </div>
      {follow && !stuck && (
        <button type="button" className="cxv-log-jump" onClick={() => setPaused(false)}>
          Jump to latest
        </button>
      )}
    </div>
  );
});
