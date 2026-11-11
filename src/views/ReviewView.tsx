import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip, Markdown } from '@dynatrace/strato-components/content';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import {
  AgentIcon,
  ArrowRightIcon,
  ChatIcon,
  CheckmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PendingIcon,
  WarningIcon,
} from '@dynatrace/strato-icons';
import type { PrState, ReviewerState } from '../model/types';
import {
  createPr,
  launchAgent,
  markPrReady,
  mergePr,
  submitReview,
} from '../state/actions';
import { useBusy, useCortex, useWork } from '../state/store';
import { Initials } from './review/Thread';
import { DiffFileView, splitPath, type Anchor } from './review/DiffFileView';
import { plural, themeVars } from './review/theme';
import './review/review.css';

const STATE_LABEL: Record<PrState, string> = {
  draft: 'Draft',
  open: 'Open',
  approved: 'Approved',
  'changes-requested': 'Changes requested',
  merged: 'Merged',
};
const STATE_TONE: Record<PrState, 'neutral' | 'primary' | 'success' | 'critical'> = {
  draft: 'neutral',
  open: 'primary',
  approved: 'success',
  'changes-requested': 'critical',
  merged: 'success',
};
const REVIEWER_LABEL: Record<ReviewerState, string> = {
  pending: 'Review pending',
  approved: 'Approved',
  'changes-requested': 'Requested changes',
  commented: 'Commented',
};
const STATUS_LETTER = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' } as const;

function ReviewerIcon({ state }: { state: ReviewerState }) {
  if (state === 'approved') return <CheckmarkIcon />;
  if (state === 'changes-requested') return <WarningIcon />;
  if (state === 'commented') return <ChatIcon />;
  return <PendingIcon />;
}

export function ReviewView({ workId }: { workId: string }) {
  const work = useWork(workId);
  const me = useCortex((s) => s.me);
  const creating = useBusy(workId, 'pr');
  const merging = useBusy(workId, 'merge');
  const submitting = useBusy(workId, 'review');

  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState<Anchor | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [activeFile, setActiveFile] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const cursor = useRef(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  // a different work item starts with a clean slate
  useEffect(() => {
    setViewed(new Set());
    setComposing(null);
    setActiveFile(0);
    cursor.current = -1;
  }, [workId]);

  const pr = work?.pr;

  const threadsByFile = useMemo(() => {
    const m = new Map<string, NonNullable<typeof pr>['threads']>();
    for (const t of pr?.threads ?? []) m.set(t.filePath, [...(m.get(t.filePath) ?? []), t]);
    return m;
  }, [pr]);

  const unresolvedIds = useMemo(() => {
    if (!pr) return [];
    const order = new Map(pr.files.map((f, i) => [f.path, i]));
    return pr.threads
      .filter((t) => !t.resolved)
      .sort((a, b) => (order.get(a.filePath) ?? 0) - (order.get(b.filePath) ?? 0) || a.line - b.line)
      .map((t) => t.id);
  }, [pr]);

  const scrollToFile = useCallback((i: number) => {
    setActiveFile(i);
    document.getElementById(`rv-file-${i}`)?.scrollIntoView({ block: 'start' });
  }, []);

  // keep the active file in the list in sync with the scroll position
  const onScroll = useCallback(() => {
    const root = scroller.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + 24;
    const files = root.querySelectorAll<HTMLElement>('.rv-file');
    let idx = 0;
    files.forEach((el, i) => {
      if (el.getBoundingClientRect().top <= top) idx = i;
    });
    setActiveFile(idx);
  }, []);

  const jumpToNext = () => {
    if (!pr || unresolvedIds.length === 0) return;
    cursor.current = (cursor.current + 1) % unresolvedIds.length;
    const id = unresolvedIds[cursor.current];
    const thread = pr.threads.find((t) => t.id === id);
    if (!thread) return;
    // make sure the file is expanded, then scroll once it is rendered
    setViewed((v) => {
      if (!v.has(thread.filePath)) return v;
      const n = new Set(v);
      n.delete(thread.filePath);
      return n;
    });
    setFlashId(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1800);
    setTimeout(() => document.getElementById(`rv-thread-${id}`)?.scrollIntoView({ block: 'center' }), 30);
  };

  if (!work) return <div className="rv-center" style={themeVars}>Work item not found.</div>;

  // ---- no PR -----------------------------------------------------------------
  if (!pr) {
    const noWorktree = !work.worktree;
    return (
      <div className="rv-center" style={themeVars}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--rv-text)' }}>
          {creating ? 'Creating pull request…' : 'No pull request yet'}
        </div>
        <div style={{ maxWidth: 380, textAlign: 'center', fontSize: 13 }}>
          {noWorktree
            ? 'Create a worktree and push some commits first, then open a pull request to start the review.'
            : `Open a pull request from ${work.worktree?.branch} into ${work.worktree?.baseBranch}.`}
        </div>
        <Tooltip text={noWorktree ? 'There is no worktree for this work item yet' : ''}>
          <span>
            <Button
              variant="accent"
              color="primary"
              disabled={noWorktree}
              loading={creating}
              onClick={() => void createPr(workId)}
            >
              Create pull request
            </Button>
          </span>
        </Tooltip>
      </div>
    );
  }

  const merged = pr.state === 'merged';
  const reviewMode = !!pr.reviewRequested;
  const additions = pr.files.reduce((n, f) => n + f.additions, 0);
  const deletions = pr.files.reduce((n, f) => n + f.deletions, 0);
  const unresolved = unresolvedIds.length;
  const pending = pr.threads.reduce((n, t) => n + t.comments.filter((c) => c.pending).length, 0);
  const openByFile = (path: string) => (threadsByFile.get(path) ?? []).filter((t) => !t.resolved).length;
  const commentsByFile = (path: string) =>
    (threadsByFile.get(path) ?? []).reduce((n, t) => n + t.comments.length, 0);
  const viewedCount = pr.files.filter((f) => viewed.has(f.path)).length;
  const setFileViewed = (path: string, v: boolean) =>
    setViewed((s) => {
      const n = new Set(s);
      if (v) n.add(path);
      else n.delete(path);
      return n;
    });

  return (
    <div className="rv-root" style={themeVars}>
      {/* ---- summary ---- */}
      <div className="rv-summary">
        <div className="rv-summary-row">
          <span className="rv-pr-number">#{pr.number}</span>
          <Chip size="condensed" color={STATE_TONE[pr.state]}>
            {STATE_LABEL[pr.state]}
          </Chip>
          <span className="rv-branches">
            <span className="rv-branch" title={pr.sourceBranch}>{pr.sourceBranch}</span>
            <ArrowRightIcon style={{ width: 14, height: 14, flex: 'none' }} />
            <span className="rv-branch" title={pr.targetBranch}>{pr.targetBranch}</span>
          </span>
          <span className="rv-sep" />
          <span className="rv-person">
            <Initials name={pr.author} me={pr.author === me} />
            {pr.author}
          </span>
          {pr.reviewers.length > 0 && (
            <>
              <span className="rv-meta">Reviewers</span>
              {pr.reviewers.map((r) => (
                <Tooltip key={r.name} text={REVIEWER_LABEL[r.state]}>
                  <span className="rv-person">
                    <Initials name={r.name} me={r.name === me} />
                    <span className="rv-reviewer-state" data-state={r.state}>
                      <ReviewerIcon state={r.state} />
                    </span>
                  </span>
                </Tooltip>
              ))}
            </>
          )}
          <span className="rv-sep" />
          <span className="rv-stat">
            <span className="rv-plus">+{additions}</span> <span className="rv-minus">−{deletions}</span>
          </span>
          <span className="rv-meta">
            {plural(pr.files.length, 'file')}
            {' · '}
            {unresolved > 0 ? (
              <button
                type="button"
                className="rv-desc-toggle"
                style={{ color: 'var(--rv-warning)', fontWeight: 600 }}
                onClick={jumpToNext}
                title="Jump to next unresolved thread"
              >
                {unresolved} unresolved
              </button>
            ) : (
              <span>{pr.threads.length > 0 ? 'all threads resolved' : 'no comments'}</span>
            )}
          </span>

          <div className="rv-summary-actions">
            {merged ? (
              <span className="rv-meta">Merged · read-only</span>
            ) : reviewMode ? (
              <>
                {pending > 0 && <span className="rv-meta"><strong>{plural(pending, 'pending comment')}</strong></span>}
                <Menu>
                  <Menu.Trigger>
                    <Button variant="accent" color="primary" size="condensed" loading={submitting}>
                      Finish review
                      <Button.Suffix><ChevronDownIcon /></Button.Suffix>
                    </Button>
                  </Menu.Trigger>
                  <Menu.Content>
                    <Menu.Label>
                      {plural(pending, 'pending comment')}
                    </Menu.Label>
                    <Menu.Item onSelect={() => void submitReview(workId, 'approve')}>Approve</Menu.Item>
                    <Menu.Item onSelect={() => void submitReview(workId, 'request-changes')}>Request changes</Menu.Item>
                    <Menu.Item onSelect={() => void submitReview(workId, 'comment')}>Comment</Menu.Item>
                  </Menu.Content>
                </Menu>
              </>
            ) : (
              <>
                {unresolved > 0 && (
                  <Button size="condensed" onClick={() => launchAgent(workId, 'review')}>
                    <Button.Prefix><AgentIcon /></Button.Prefix>
                    Address {plural(unresolved, 'comment')} with Claude
                  </Button>
                )}
                {pr.state === 'draft' && (
                  <Button size="condensed" variant="accent" color="primary" onClick={() => markPrReady(workId)}>
                    Mark ready
                  </Button>
                )}
                {pr.state === 'approved' && (
                  <Button
                    size="condensed"
                    variant="accent"
                    color="success"
                    loading={merging}
                    onClick={() => void mergePr(workId)}
                  >
                    Merge
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="rv-summary-row">
          <button
            type="button"
            className="rv-desc-toggle"
            aria-expanded={descOpen}
            onClick={() => setDescOpen((v) => !v)}
          >
            {descOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <b>{pr.title}</b>
            {!descOpen && (
              <span className="rv-desc-preview">
                {' — '}
                {pr.descriptionMd.replace(/[#*`>_\n]+/g, ' ').trim()}
              </span>
            )}
          </button>
        </div>
        {descOpen && (
          <div className="rv-desc">
            <Markdown>{pr.descriptionMd}</Markdown>
          </div>
        )}
      </div>

      {/* ---- body ---- */}
      <div className="rv-body">
        <aside className="rv-files" aria-label="Changed files">
          <div className="rv-pane-head">
            <strong>Files</strong>
            <span>{viewedCount}/{pr.files.length} viewed</span>
          </div>
          <nav className="rv-file-list">
            {pr.files.map((f, i) => {
              const { dir, name } = splitPath(f.path);
              const open = openByFile(f.path);
              const total = commentsByFile(f.path);
              return (
                <button
                  type="button"
                  key={f.path}
                  className="rv-file-item"
                  data-active={i === activeFile}
                  data-viewed={viewed.has(f.path)}
                  title={f.path}
                  onClick={() => scrollToFile(i)}
                >
                  <span className="rv-status" data-status={f.status}>{STATUS_LETTER[f.status]}</span>
                  <span style={{ minWidth: 0 }}>
                    <div className="rv-file-name">{name}</div>
                    {dir && <div className="rv-file-dir">{'‎' + dir}</div>}
                  </span>
                  <span className="rv-file-side">
                    <span>
                      <span className="rv-plus">+{f.additions}</span> <span className="rv-minus">−{f.deletions}</span>
                    </span>
                    {total > 0 && (
                      <span className="rv-count" data-open={open > 0}>
                        <ChatIcon /> {total}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="rv-main">
          <div className="rv-pane-head">
            <strong>{plural(pr.files.length, 'changed file')}</strong>
            <span className="rv-spacer" />
            {unresolved > 0 && (
              <Button size="condensed" onClick={jumpToNext}>
                Next unresolved ({unresolved})
              </Button>
            )}
            <Button
              size="condensed"
              onClick={() =>
                setViewed(viewedCount === pr.files.length ? new Set() : new Set(pr.files.map((f) => f.path)))
              }
            >
              {viewedCount === pr.files.length ? 'Expand all' : 'Collapse all'}
            </Button>
          </div>
          <div className="rv-scroll" ref={scroller} onScroll={onScroll}>
            {merged && (
              <div className="rv-banner">
                <CheckmarkIcon /> This pull request was merged. Threads are read-only.
              </div>
            )}
            {reviewMode && !merged && (
              <div className="rv-banner">
                <PendingIcon /> Your comments stay pending until you finish the review.
              </div>
            )}
            {pr.files.map((f, i) => (
              <DiffFileView
                key={f.path}
                workId={workId}
                index={i}
                file={f}
                threads={threadsByFile.get(f.path) ?? []}
                me={me}
                readOnly={merged}
                reviewMode={reviewMode}
                viewed={viewed.has(f.path)}
                onViewed={(v) => setFileViewed(f.path, v)}
                composing={composing}
                setComposing={setComposing}
                flashId={flashId}
              />
            ))}
            <div className="rv-end">End of changes</div>
          </div>
        </div>
      </div>
    </div>
  );
}
