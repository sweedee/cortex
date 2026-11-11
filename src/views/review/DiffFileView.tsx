import { memo, useMemo } from 'react';
import { Checkbox } from '@dynatrace/strato-components/forms';
import { ChevronDownIcon, ChevronRightIcon } from '@dynatrace/strato-icons';
import type { DiffFile, DiffLine, ReviewThread } from '../../model/types';
import { addReviewComment } from '../../state/actions';
import { highlight } from './highlight';
import { Composer, Thread } from './Thread';

export interface Anchor {
  path: string;
  line: number;
  side: 'old' | 'new';
}

export const anchorKey = (a: Anchor) => `${a.path}\u0000${a.side}\u0000${a.line}`;

export function splitPath(path: string) {
  const i = path.lastIndexOf('/');
  return { dir: i >= 0 ? path.slice(0, i + 1) : '', name: path.slice(i + 1) };
}

function Code({ line, language }: { line: DiffLine; language: string }) {
  return (
    <>
      {highlight(line.content, language).map((t, i) =>
        t.kind ? (
          <span key={i} className={`tk-${t.kind === 'type' ? 'literal' : t.kind}`}>
            {t.text}
          </span>
        ) : (
          t.text
        ),
      )}
      {line.content === '' && '​'}
    </>
  );
}

/** The side a comment on this line is anchored to. */
const sideOf = (l: DiffLine): 'old' | 'new' => (l.type === 'del' ? 'old' : 'new');
const numOf = (l: DiffLine) => (l.type === 'del' ? l.oldNo : l.newNo) ?? 0;
const MARKER = { add: '+', del: '−', ctx: '' } as const;

interface Props {
  workId: string;
  index: number;
  file: DiffFile;
  threads: ReviewThread[];
  me: string;
  readOnly: boolean;
  reviewMode: boolean;
  viewed: boolean;
  onViewed: (v: boolean) => void;
  composing: Anchor | null;
  setComposing: (a: Anchor | null) => void;
  flashId: string | null;
}

export const DiffFileView = memo(function DiffFileView(p: Props) {
  const { file, threads, readOnly } = p;
  const { dir, name } = splitPath(file.path);

  // thread lookup by anchor; whatever does not match a diff line is "outdated"
  const { byAnchor, orphans } = useMemo(() => {
    const present = new Set<string>();
    for (const h of file.hunks)
      for (const l of h.lines) {
        if (l.newNo != null) present.add(`new:${l.newNo}`);
        if (l.oldNo != null) present.add(`old:${l.oldNo}`);
      }
    const map = new Map<string, ReviewThread[]>();
    const lost: ReviewThread[] = [];
    for (const t of threads) {
      const k = `${t.side}:${t.line}`;
      if (!present.has(k)) lost.push(t);
      else map.set(k, [...(map.get(k) ?? []), t]);
    }
    return { byAnchor: map, orphans: lost };
  }, [file, threads]);

  const open = threads.filter((t) => !t.resolved).length;
  const startComment = (l: DiffLine) => p.setComposing({ path: file.path, line: numOf(l), side: sideOf(l) });
  const isComposing = (a: Anchor) => p.composing && anchorKey(p.composing) === anchorKey(a);

  const threadProps = { workId: p.workId, me: p.me, readOnly, reviewMode: p.reviewMode };

  return (
    <section className="rv-file" id={`rv-file-${p.index}`} data-collapsed={p.viewed || undefined}>
      <header className="rv-file-head">
        <button
          type="button"
          className="rv-icon-btn"
          aria-label={p.viewed ? 'Expand file' : 'Collapse file'}
          onClick={() => p.onViewed(!p.viewed)}
        >
          {p.viewed ? <ChevronRightIcon /> : <ChevronDownIcon />}
        </button>
        <span className="rv-file-path" title={file.path}>
          {dir}
          <b>{name}</b>
        </span>
        <span className="rv-stat">
          <span className="rv-plus">+{file.additions}</span> <span className="rv-minus">−{file.deletions}</span>
        </span>
        {open > 0 && (
          <span className="rv-count" data-open="true">
            {open} open
          </span>
        )}
        <span className="rv-spacer" />
        <span className="rv-viewed">
          <Checkbox value={p.viewed} onChange={(v) => p.onViewed(v)}>
            Viewed
          </Checkbox>
        </span>
      </header>

      {!p.viewed && (
        <>
          {file.hunks.length === 0 && <div className="rv-banner">No textual changes.</div>}
          <table className="rv-diff rv-unified">
            <colgroup>
              <col className="rv-col-no" />
              <col className="rv-col-no" />
              <col />
            </colgroup>
            {file.hunks.map((h, hi) => {
              const m = /^(@@[^@]*@@)(.*)$/.exec(h.header);
              return (
                <tbody key={hi}>
                  <tr className="rv-hunk">
                    <td colSpan={3}>
                      {m ? m[1] : h.header}
                      {m && m[2] && <span className="rv-hunk-section">{m[2]}</span>}
                    </td>
                  </tr>
                  {h.lines.map((l, li) => {
                    const anchor: Anchor = { path: file.path, line: numOf(l), side: sideOf(l) };
                    const here = [
                      ...(l.newNo != null && l.type !== 'del' ? (byAnchor.get(`new:${l.newNo}`) ?? []) : []),
                      ...(l.type === 'del' || (l.type === 'ctx' && l.oldNo != null && l.oldNo !== l.newNo)
                        ? (byAnchor.get(`old:${l.oldNo}`) ?? [])
                        : []),
                    ].filter((t, i, a) => a.indexOf(t) === i);
                    const composing = isComposing(anchor);
                    const selected = here.some((t) => t.id === p.flashId);
                    return (
                      <LineRows key={li} l={l} language={file.language} selected={selected} readOnly={readOnly} onStart={startComment}>
                        {(here.length > 0 || composing) && (
                          <tr className="rv-inline">
                            <td colSpan={3}>
                              <div className="rv-inline-stack">
                                {here.map((t) => (
                                  <Thread key={t.id} thread={t} flash={t.id === p.flashId} {...threadProps} />
                                ))}
                                {composing && (
                                  <Composer
                                    standalone
                                    placeholder="Leave a comment…"
                                    submitLabel={p.reviewMode ? 'Add pending comment' : 'Comment'}
                                    hint={
                                      <span className="rv-anchor">
                                        {anchor.side === 'old' ? 'old' : 'new'} line {anchor.line}
                                      </span>
                                    }
                                    onCancel={() => p.setComposing(null)}
                                    onSubmit={(body) => {
                                      addReviewComment(p.workId, { filePath: anchor.path, line: anchor.line, side: anchor.side }, body);
                                      p.setComposing(null);
                                    }}
                                  />
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </LineRows>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
          {orphans.length > 0 && (
            <div className="rv-inline-stack" style={{ padding: '8px 16px' }}>
              {orphans.map((t) => (
                <Thread key={t.id} thread={t} flash={t.id === p.flashId} outdated {...threadProps} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
});

function LineRows({
  l,
  language,
  selected,
  readOnly,
  onStart,
  children,
}: {
  l: DiffLine;
  language: string;
  selected: boolean;
  readOnly: boolean;
  onStart: (l: DiffLine) => void;
  children: React.ReactNode;
}) {
  const type = l.type === 'ctx' ? undefined : l.type;
  const start = () => !readOnly && onStart(l);
  return (
    <>
      <tr className={readOnly ? undefined : 'rv-commentable'} data-selected={selected || undefined}>
        <td className="rv-no" data-type={type} onClick={start}>
          {l.oldNo}
        </td>
        <td className="rv-no" data-type={type} onClick={start}>
          {l.newNo}
        </td>
        <td className="rv-code" data-type={l.type} data-marker={MARKER[l.type]}>
          {!readOnly && (
            <button type="button" className="rv-add-btn" aria-label={`Comment on line ${numOf(l)}`} onClick={start}>
              +
            </button>
          )}
          <Code line={l} language={language} />
        </td>
      </tr>
      {children}
    </>
  );
}
