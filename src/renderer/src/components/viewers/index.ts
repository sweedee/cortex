/**
 * Reusable viewers. Props-driven: no store, no native calls. Heavy ones are lazy chunks (mermaid,
 * react-markdown + highlight.js, diff2html, CodeMirror) exposed under their plain names; the
 * default exports of the *Impl modules are what the lazy wrappers load.
 */
import { lazyViewer } from './lazy';
import type { MarkdownProps } from './markdown/MarkdownImpl';
import type { DiffViewerProps } from './diff/DiffViewerImpl';
import type { CodeEditorProps } from './editor/CodeEditorImpl';

export const Markdown = lazyViewer<MarkdownProps>(() => import('./markdown/MarkdownImpl'), 'markdown');
export const DiffViewer = lazyViewer<DiffViewerProps>(() => import('./diff/DiffViewerImpl'), 'diff');
export const CodeEditor = lazyViewer<CodeEditorProps>(() => import('./editor/CodeEditorImpl'), 'editor');
export { WebPanel, VIEWPORT_WIDTH } from './web/WebPanel';
export { LogView } from './log/LogView';

export type { MarkdownProps, DiffViewerProps, CodeEditorProps };
export type { WebPanelProps, Viewport } from './web/WebPanel';
export type { LogViewProps } from './log/LogView';
export type { EditorLanguage } from './editor/CodeEditorImpl';

// dependency-free helpers (safe for the main bundle)
export { parseDiffStats } from './diff/diffStats';
export type { DiffStats, DiffFileStat, DiffFileStatus } from './diff/diffStats';
export { toggleTask, findTaskLines, splitMermaid } from './markdown/markdownUtils';
export { tailLines } from './log/logUtils';
