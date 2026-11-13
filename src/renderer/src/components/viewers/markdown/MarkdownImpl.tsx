import { createContext, memo, useContext, useMemo, type ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Mermaid } from './Mermaid';
import { findTaskLines, splitMermaid, taskIndexForLine } from './markdownUtils';
import '../viewers.css';

export interface MarkdownProps {
  source: string;
  /** Called for every link click; the host decides (e.g. shell.openExternal). Without it links open normally. */
  onLinkClick?: (href: string) => void;
  /** Makes task-list checkboxes interactive. `index` = nth task item in the document. */
  onToggleTask?: (index: number, checked: boolean) => void;
  className?: string;
}

// highlight.js core + an explicit language set (rehype-highlight/lowlight would drag in all "common" grammars).
const LANGUAGES = { bash, css, diff, javascript, json, python, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, def);
const ALIASES: Record<string, string> = { sh: 'bash', shell: 'bash', zsh: 'bash', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'xml', yml: 'yaml', py: 'python' };

function Code({ className, children }: ComponentProps<'code'>) {
  const raw = /language-([\w-]+)/.exec(className ?? '')?.[1]?.toLowerCase();
  const lang = raw && (ALIASES[raw] ?? raw);
  if (lang && hljs.getLanguage(lang)) {
    // hljs escapes the source itself, so its HTML output is safe to inject
    const html = hljs.highlight(String(children).replace(/\n$/, ''), { language: lang, ignoreIllegals: true }).value;
    return <code className={`hljs language-${lang}`} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <code className={className}>{children}</code>;
}

interface TaskInfo {
  index: number;
  toggle?: (index: number, checked: boolean) => void;
}
const TaskCtx = createContext<TaskInfo | null>(null);

function Checkbox({ type, checked }: ComponentProps<'input'>) {
  const t = useContext(TaskCtx);
  if (type !== 'checkbox') return <input type={type} disabled />;
  const interactive = !!t?.toggle && t.index >= 0;
  return (
    <input
      type="checkbox"
      checked={!!checked}
      disabled={!interactive}
      onChange={(e) => t?.toggle?.(t.index, e.target.checked)}
    />
  );
}

function buildComponents(
  segLine: number,
  taskLines: number[],
  onLinkClick: MarkdownProps['onLinkClick'],
  onToggleTask: MarkdownProps['onToggleTask'],
): Components {
  return {
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => {
          if (href && onLinkClick) {
            e.preventDefault();
            onLinkClick(href);
          }
        }}
      >
        {children}
      </a>
    ),
    li: ({ node, children, className }) => {
      if (!className?.includes('task-list-item')) return <li className={className}>{children}</li>;
      const line = node?.position ? node.position.start.line - 1 + segLine : -1;
      return (
        <TaskCtx.Provider value={{ index: taskIndexForLine(taskLines, line), toggle: onToggleTask }}>
          <li className={className}>{children}</li>
        </TaskCtx.Provider>
      );
    },
    input: Checkbox,
    code: Code,
  };
}

function Segmented({ source, onLinkClick, onToggleTask }: MarkdownProps) {
  const segments = useMemo(() => splitMermaid(source), [source]);
  const taskLines = useMemo(() => findTaskLines(source), [source]);
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'mermaid' ? (
          <Mermaid key={i} source={s.text} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={buildComponents(s.line, taskLines, onLinkClick, onToggleTask)}
          >
            {s.text}
          </ReactMarkdown>
        ),
      )}
    </>
  );
}

/**
 * Markdown with GFM, highlighted code, mermaid diagrams and task lists.
 * Raw HTML in the source is NOT rendered (react-markdown has no rehype-raw here), and unsafe URL
 * schemes are dropped by react-markdown's default urlTransform, so no extra sanitiser is needed.
 */
const MarkdownImpl = memo(function MarkdownImpl(props: MarkdownProps) {
  return (
    <div className={`cxv-md${props.className ? ` ${props.className}` : ''}`}>
      <Segmented {...props} />
    </div>
  );
});

export default MarkdownImpl;
