import { memo, useMemo, useState } from 'react';
import { parse } from 'diff2html';
import { ChevronDownSmallIcon, ChevronRightSmallIcon } from '@dynatrace/strato-icons';
import type { DiffBlock, DiffFile } from 'diff2html/lib/types';
import { parseDiffStats, type DiffFileStatus } from './diffStats';
import '../viewers.css';

export interface DiffViewerProps {
  /** Unified diff text (`git diff` output). */
  diff: string;
  mode?: 'unified' | 'split';
  /** Files with more changed+context lines than this start collapsed behind "Show anyway". */
  largeFileLines?: number;
  className?: string;
}

const STATUS_LABEL: Record<DiffFileStatus, string> = { added: 'A', deleted: 'D', renamed: 'R', modified: 'M' };

function fileName(f: DiffFile): string {
  if (f.isRename || (f.oldName !== f.newName && f.oldName !== '/dev/null' && f.newName !== '/dev/null')) return `${f.oldName} → ${f.newName}`;
  return f.newName === '/dev/null' ? f.oldName : f.newName;
}
function fileStatus(f: DiffFile): DiffFileStatus {
  return f.isNew ? 'added' : f.isDeleted ? 'deleted' : f.isRename ? 'renamed' : 'modified';
}
function lineCount(f: DiffFile): number {
  return f.blocks.reduce((n, b) => n + b.lines.length, 0);
}
const body = (content: string) => content.slice(1);

type Cell = { n: number | undefined; text: string; kind: 'ctx' | 'add' | 'del' | 'empty' };

/** Pair runs of deletions with the insertions that follow them for side-by-side. */
function splitRows(block: DiffBlock): [Cell, Cell][] {
  const rows: [Cell, Cell][] = [];
  const empty: Cell = { n: undefined, text: '', kind: 'empty' };
  let dels: Cell[] = [];
  let adds: Cell[] = [];
  const flush = () => {
    const len = Math.max(dels.length, adds.length);
    for (let i = 0; i < len; i++) rows.push([dels[i] ?? empty, adds[i] ?? empty]);
    dels = [];
    adds = [];
  };
  for (const l of block.lines) {
    if (l.type === 'delete') dels.push({ n: l.oldNumber, text: body(l.content), kind: 'del' });
    else if (l.type === 'insert') adds.push({ n: l.newNumber, text: body(l.content), kind: 'add' });
    else {
      flush();
      rows.push([
        { n: l.oldNumber, text: body(l.content), kind: 'ctx' },
        { n: l.newNumber, text: body(l.content), kind: 'ctx' },
      ]);
    }
  }
  flush();
  return rows;
}

function Block({ block, mode }: { block: DiffBlock; mode: 'unified' | 'split' }) {
  const rows = useMemo(() => (mode === 'split' ? splitRows(block) : []), [block, mode]);
  return (
    <>
      <div className="cxv-diff-hunk">{block.header}</div>
      {mode === 'unified'
        ? block.lines.map((l, i) => (
            <div key={i} className={`cxv-diff-row cxv-diff-${l.type === 'insert' ? 'add' : l.type === 'delete' ? 'del' : 'ctx'}`}>
              <span className="cxv-diff-num">{l.oldNumber ?? ''}</span>
              <span className="cxv-diff-num">{l.newNumber ?? ''}</span>
              <span className="cxv-diff-sign">{l.content[0] === ' ' ? '' : l.content[0]}</span>
              <span className="cxv-diff-text">{body(l.content)}</span>
            </div>
          ))
        : rows.map(([a, b], i) => (
            <div key={i} className="cxv-diff-split">
              {[a, b].map((c, j) => (
                <div key={j} className={`cxv-diff-row cxv-diff-${c.kind}`}>
                  <span className="cxv-diff-num">{c.n ?? ''}</span>
                  <span className="cxv-diff-text">{c.text}</span>
                </div>
              ))}
            </div>
          ))}
    </>
  );
}

function FileSection({
  file,
  mode,
  open,
  large,
  forced,
  onToggle,
  onForce,
  id,
}: {
  file: DiffFile;
  mode: 'unified' | 'split';
  open: boolean;
  large: boolean;
  forced: boolean;
  onToggle: () => void;
  onForce: () => void;
  id: string;
}) {
  const status = fileStatus(file);
  return (
    <section className="cxv-diff-file" id={id}>
      <button type="button" className="cxv-diff-file-head" onClick={onToggle} aria-expanded={open}>
        <span className="cxv-diff-caret">{open ? <ChevronDownSmallIcon size={14} /> : <ChevronRightSmallIcon size={14} />}</span>
        <span className={`cxv-diff-status cxv-diff-status-${status}`}>{STATUS_LABEL[status]}</span>
        <span className="cxv-diff-name">{fileName(file)}</span>
        <span className="cxv-diff-counts">
          <span className="cxv-diff-add-n">+{file.addedLines}</span> <span className="cxv-diff-del-n">−{file.deletedLines}</span>
        </span>
      </button>
      {open &&
        (file.isBinary ? (
          <div className="cxv-diff-note">Binary file not shown.</div>
        ) : large && !forced ? (
          <div className="cxv-diff-note">
            Large diff ({lineCount(file).toLocaleString()} lines) not rendered.{' '}
            <button type="button" className="cxv-link-btn" onClick={onForce}>
              Show anyway
            </button>
          </div>
        ) : (
          <div className="cxv-diff-body">
            {file.blocks.map((b, i) => (
              <Block key={i} block={b} mode={mode} />
            ))}
          </div>
        ))}
    </section>
  );
}

/**
 * Unified-diff viewer. diff2html is used only for its battle-tested parser; rendering is plain React so
 * the colours come from Strato tokens (dark/light), nothing is injected as HTML, and per-file
 * collapse / large-diff guards are trivial.
 */
const DiffViewerImpl = memo(function DiffViewerImpl({ diff, mode = 'unified', largeFileLines = 800, className }: DiffViewerProps) {
  const files = useMemo(() => parse(diff, { matching: 'none' }), [diff]);
  const stats = useMemo(() => parseDiffStats(diff), [diff]);
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const [forced, setForced] = useState<Record<number, boolean>>({});

  if (!files.length) return <div className="cxv-empty">No changes.</div>;
  const isOpen = (i: number) => toggled[i] ?? true;

  return (
    <div className={`cxv-diff${className ? ` ${className}` : ''}`}>
      <div className="cxv-diff-summary">
        <div className="cxv-diff-summary-head">
          {files.length} file{files.length === 1 ? '' : 's'} changed <span className="cxv-diff-add-n">+{stats.additions}</span> <span className="cxv-diff-del-n">−{stats.deletions}</span>
          {files.length > 1 && (
            <>
              <button type="button" className="cxv-link-btn" onClick={() => setToggled(Object.fromEntries(files.map((_, i) => [i, false])))}>
                Collapse all
              </button>
              <button type="button" className="cxv-link-btn" onClick={() => setToggled({})}>
                Expand all
              </button>
            </>
          )}
        </div>
        {files.length > 1 &&
          files.map((f, i) => (
            <a
              key={i}
              className="cxv-diff-summary-row"
              href={`#cxv-diff-${i}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(`cxv-diff-${i}`)?.scrollIntoView({ block: 'start' });
              }}
            >
              <span className={`cxv-diff-status cxv-diff-status-${fileStatus(f)}`}>{STATUS_LABEL[fileStatus(f)]}</span>
              <span className="cxv-diff-name">{fileName(f)}</span>
              <span className="cxv-diff-counts">
                <span className="cxv-diff-add-n">+{f.addedLines}</span> <span className="cxv-diff-del-n">−{f.deletedLines}</span>
              </span>
            </a>
          ))}
      </div>
      {files.map((f, i) => (
        <FileSection
          key={i}
          id={`cxv-diff-${i}`}
          file={f}
          mode={mode}
          open={isOpen(i)}
          large={lineCount(f) > largeFileLines}
          forced={!!forced[i]}
          onToggle={() => setToggled((t) => ({ ...t, [i]: !isOpen(i) }))}
          onForce={() => setForced((t) => ({ ...t, [i]: true }))}
        />
      ))}
    </div>
  );
});

export default DiffViewerImpl;
