import { memo, useMemo } from 'react';
import { Markdown } from '@dynatrace/strato-components/content';
import { Mermaid } from './Mermaid';

type Segment = { kind: 'md' | 'mermaid'; text: string };

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;

/**
 * Split markdown on closed ```mermaid fences. An unterminated trailing fence (still streaming)
 * is left in the markdown text, so it renders as a plain code block until it is closed.
 * (Splitting rather than Strato's customComponentMappings: a partial fence would otherwise
 * reach the diagram renderer with incomplete source.)
 */
export function splitMermaid(src: string): Segment[] {
  const lines = src.split('\n');
  const out: Segment[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push({ kind: 'md', text: buf.join('\n') });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]);
    if (!m) {
      buf.push(lines[i]);
      continue;
    }
    const fence = m[1];
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t.length >= fence.length && t[0] === fence[0] && t.split(t[0]).join('') === '') {
        end = j;
        break;
      }
    }
    if (end < 0) {
      // unterminated: rest of the document is one code block still being written
      buf.push(...lines.slice(i));
      break;
    }
    if (m[2].toLowerCase() === 'mermaid') {
      flush();
      out.push({ kind: 'mermaid', text: lines.slice(i + 1, end).join('\n') });
    } else {
      buf.push(...lines.slice(i, end + 1));
    }
    i = end;
  }
  flush();
  return out;
}

/** Markdown as used everywhere in Cortex, with ```mermaid blocks rendered as diagrams. */
export const Md = memo(function Md({ children }: { children: string }) {
  const segments = useMemo(() => splitMermaid(children), [children]);
  if (segments.length === 1 && segments[0].kind === 'md') return <Markdown>{children}</Markdown>;
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'mermaid' ? <Mermaid key={i} source={s.text} /> : <Markdown key={i}>{s.text}</Markdown>,
      )}
    </>
  );
});
