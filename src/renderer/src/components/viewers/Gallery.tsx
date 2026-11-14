import { useState } from 'react';
import { CodeEditor, DiffViewer, LogView, Markdown, WebPanel, toggleTask } from './index';

const MD = `# Viewer gallery

Some **bold**, _italic_ and a [link](https://example.com).

## Tasks
- [x] Parse the diff
- [ ] Render the diff
- [ ] Ship it

## Code
\`\`\`ts
export function add(a: number, b: number): number {
  return a + b; // typed
}
\`\`\`

## Diagram
\`\`\`mermaid
flowchart LR
  Plan --> Grill --> Implement --> Verify
\`\`\`

| col | value |
|-----|-------|
| a   | 1     |
`;

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 import x from 'x';
-const a = 1;
+const a = 2;
+const b = 3;
 export { a };

diff --git a/README.md b/README.md
new file mode 100644
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+# Hello
+World
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
`;

const LOG = ['\u001b[32m✓\u001b[0m build ok', '\u001b[33mwarn\u001b[0m  slow chunk', '\u001b[1;31merror\u001b[0m  boom', 'plain line'].join('\n');

/** Dev-only gallery of every viewer with sample data. Not mounted by the app; render it behind a flag. */
export function ViewerGallery() {
  const [md, setMd] = useState(MD);
  const [text, setText] = useState('# Edit me\n\nCtrl+S saves.');
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const [saved, setSaved] = useState('');
  return (
    <div style={{ padding: 16, display: 'grid', gap: 24, overflow: 'auto', height: '100%', color: 'var(--dt-colors-text-neutral-default)', background: 'var(--dt-colors-background-base-default)' }}>
      <section>
        <h3>Markdown</h3>
        <Markdown source={md} onLinkClick={(h) => alert(h)} onToggleTask={(i, c) => setMd((s) => toggleTask(s, i, c))} />
      </section>
      <section>
        <h3>
          Diff{' '}
          <button onClick={() => setMode(mode === 'unified' ? 'split' : 'unified')}>{mode}</button>
        </h3>
        <DiffViewer diff={DIFF} mode={mode} />
      </section>
      <section>
        <h3>Editor {saved && <small>(saved {saved.length} chars)</small>}</h3>
        <CodeEditor value={text} onChange={setText} language="markdown" onSave={setSaved} minHeight={140} placeholder="Write…" />
      </section>
      <section>
        <h3>Log</h3>
        <div style={{ height: 120 }}>
          <LogView text={LOG} />
        </div>
      </section>
      <section>
        <h3>WebPanel</h3>
        <div style={{ height: 300 }}>
          <WebPanel src="http://localhost:5173" partition="persist:gallery" viewportSwitcher onOpenExternal={(u) => window.open(u)} />
        </div>
      </section>
    </div>
  );
}
