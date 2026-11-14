# components/viewers

Reusable, props-driven viewers. No store access, no native calls: the host passes callbacks
(`onLinkClick`, `onOpenExternal`, …). Import from `components/viewers` (`index.ts`). `Markdown`,
`DiffViewer` and `CodeEditor` are `React.lazy` wrappers (Suspense built in), so they cost nothing in the
main bundle until first render. Colours come from Strato tokens (`--dt-colors-*`), so light/dark follow
the app theme. Styles: `viewers.css`.

| Component | Props |
|---|---|
| `<Markdown>` | `source`, `onLinkClick?(href)`, `onToggleTask?(index, checked)`, `className?`. react-markdown + GFM, highlight.js (core + bash/css/diff/js/json/python/ts/xml/yaml), ```` ```mermaid ```` blocks via lazy mermaid. Raw HTML is not rendered. Task boxes are read-only unless `onToggleTask` is given; `index` = nth task item in the document, apply it with `toggleTask(source, index, checked)`. |
| `<DiffViewer>` | `diff` (unified text), `mode?: 'unified' \| 'split'`, `largeFileLines?` (default 800: bigger files start behind "Show anyway"), `className?`. Per-file collapse, summary list with +/- counts, binary note. diff2html is used for parsing only; rendering is React. |
| `parseDiffStats(diff)` | `{ files: [{path, oldPath?, additions, deletions, status: 'added'\|'deleted'\|'renamed'\|'modified', binary}], additions, deletions }`. Dependency-free, safe to import eagerly. |
| `<CodeEditor>` | `value`, `onChange?`, `language?: 'markdown' \| 'json' \| 'text'`, `readOnly?`, `placeholder?`, `onSave?(value)` (Ctrl/Cmd+S), `minHeight?`, `lineNumbers?`. CodeMirror 6, controlled by `value`. |
| `<WebPanel>` | `src`, `partition?` (e.g. `persist:github`), `onNavigate?(url)`, `onOpenExternal?(url)`, `toolbar?` (default true), `viewport?: 'desktop' \| 'tablet' \| 'mobile'`, `viewportSwitcher?`. Electron `<webview>` with back/forward/reload/URL/loading/error+retry; falls back to an `<iframe>` (with a notice) outside Electron. Changing `src` or `partition` recreates the view. Type for `<webview>` is declared in `web/webview.d.ts`. |
| `<LogView>` | `lines?: string[]` or `text?`, `follow?` (default true; scrolling up pauses, "Jump to latest" resumes), `maxLines?` (default 2000), `aria-label?`. ANSI colours via `anser`; bare `\r` progress rewrites collapse to the last frame. |
| `ViewerGallery` (`Gallery.tsx`) | Demo of all of the above with sample data. Mounted only by the smoke harness (`CORTEX_SMOKE_GALLERY=1`, `showGallery()` in `debug.ts`) to check rendering under the CSP. |

Pure helpers (tested in `viewers.test.ts`): `parseDiffStats`, `toggleTask`, `findTaskLines`,
`splitMermaid`, `tailLines`.

```tsx
<Markdown source={record} onLinkClick={(h) => native.openExternal(h)} onToggleTask={(i, c) => save(toggleTask(record, i, c))} />
<DiffViewer diff={worktreeDiff} mode="split" />
<WebPanel src={app.url} partition="persist:preview" viewportSwitcher onOpenExternal={native.openExternal} />
```
