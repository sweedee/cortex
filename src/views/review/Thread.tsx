import { useEffect, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip, Markdown } from '@dynatrace/strato-components/content';
import { TextArea } from '@dynatrace/strato-components/forms';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { CheckmarkIcon, ChevronDownIcon, ChevronRightIcon, DeleteIcon, UndoIcon } from '@dynatrace/strato-icons';
import type { ReviewThread } from '../../model/types';
import { addReviewComment, deleteReviewComment, resolveThread } from '../../state/actions';
import { initials, plural, timeAgo } from './theme';

export function Initials({ name, me }: { name: string; me?: boolean }) {
  return (
    <span className="rv-initials" data-me={me || undefined} aria-hidden>
      {initials(name)}
    </span>
  );
}

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  /** shown left of the buttons, e.g. the anchor or a "pending" hint */
  hint?: React.ReactNode;
  standalone?: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

export function Composer({ placeholder, submitLabel, hint, standalone, onSubmit, onCancel }: ComposerProps) {
  const [body, setBody] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const canSubmit = body.trim().length > 0;

  useEffect(() => {
    root.current?.querySelector('textarea')?.focus({ preventScroll: true });
    root.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const submit = () => {
    if (canSubmit) onSubmit(body.trim());
  };

  return (
    <div className="rv-composer" data-standalone={standalone || undefined} ref={root}>
      <TextArea
        aria-label={placeholder}
        placeholder={placeholder}
        value={body}
        onChange={(value) => setBody(value)}
        rows={3}
        width="full"
        resize="vertical"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape' && !body) {
            onCancel();
          }
        }}
      />
      <div className="rv-composer-foot">
        {hint}
        <span className="rv-spacer" />
        <span>Ctrl+Enter to submit</span>
        <Button size="condensed" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="condensed" variant="accent" color="primary" disabled={!canSubmit} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

interface ThreadProps {
  workId: string;
  thread: ReviewThread;
  me: string;
  /** merged PR: no replies, no resolving */
  readOnly: boolean;
  /** I am reviewing: my comments are pending until the review is submitted */
  reviewMode: boolean;
  flash: boolean;
  /** shown for threads whose line is not part of the diff */
  outdated?: boolean;
}

export function Thread({ workId, thread, me, readOnly, reviewMode, flash, outdated }: ThreadProps) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const open = !thread.resolved || expanded;
  const allPending = thread.comments.every((c) => c.pending);
  const first = thread.comments[0];

  // Resolving a thread folds it away; reopening shows it again.
  useEffect(() => {
    if (thread.resolved) setExpanded(false);
  }, [thread.resolved]);

  return (
    <div
      className="rv-thread"
      id={`rv-thread-${thread.id}`}
      data-open={!thread.resolved && !allPending ? true : undefined}
      data-pending={allPending || undefined}
      data-flash={flash || undefined}
    >
      {thread.resolved && (
        <button
          type="button"
          className="rv-thread-collapsed"
          aria-expanded={open}
          onClick={() => setExpanded((v) => !v)}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <span className="rv-resolved-mark">
            <CheckmarkIcon /> Resolved
          </span>
          {!open && first && (
            <span className="rv-desc-preview">
              <b style={{ fontWeight: 500 }}>{first.author}:</b> {first.body.replace(/[`*_]/g, '')}
            </span>
          )}
          {open && <span className="rv-spacer" style={{ flex: 1 }} />}
          <span style={{ flex: 'none' }}>{plural(thread.comments.length, 'comment')}</span>
        </button>
      )}

      {open && (
        <>
          {outdated && (
            <div className="rv-comment-head" style={{ padding: '6px 12px 0' }}>
              <span className="rv-anchor">
                {thread.side === 'old' ? 'old' : 'new'} line {thread.line} · not part of this diff
              </span>
            </div>
          )}
          {thread.comments.map((c) => (
            <div className="rv-comment" key={c.id}>
              <Initials name={c.author} me={c.author === me} />
              <div style={{ minWidth: 0 }}>
                <div className="rv-comment-head">
                  <strong>{c.author}</strong>
                  <span title={new Date(c.at).toLocaleString()}>{timeAgo(c.at)}</span>
                  {c.pending && (
                    <Tooltip text="Only visible to you until you finish the review">
                      <Chip size="condensed" color="primary">
                        Pending
                      </Chip>
                    </Tooltip>
                  )}
                  <span className="rv-spacer" />
                  {c.pending && c.author === me && !readOnly && (
                    <Tooltip text="Delete pending comment">
                      <button
                        type="button"
                        className="rv-icon-btn"
                        aria-label="Delete pending comment"
                        onClick={() => deleteReviewComment(workId, thread.id, c.id)}
                      >
                        <DeleteIcon />
                      </button>
                    </Tooltip>
                  )}
                </div>
                <div className="rv-comment-body">
                  <Markdown>{c.body}</Markdown>
                </div>
              </div>
            </div>
          ))}

          {!readOnly &&
            (replying ? (
              <Composer
                placeholder={`Reply to ${first?.author ?? 'thread'}…`}
                submitLabel={reviewMode ? 'Add pending reply' : 'Reply'}
                onCancel={() => setReplying(false)}
                onSubmit={(body) => {
                  addReviewComment(workId, { threadId: thread.id }, body);
                  setReplying(false);
                }}
              />
            ) : (
              <div className="rv-thread-foot">
                <button type="button" className="rv-reply-stub" onClick={() => setReplying(true)}>
                  Reply…
                </button>
                <Button size="condensed" onClick={() => resolveThread(workId, thread.id, !thread.resolved)}>
                  <Button.Prefix>{thread.resolved ? <UndoIcon /> : <CheckmarkIcon />}</Button.Prefix>
                  {thread.resolved ? 'Unresolve' : 'Resolve'}
                </Button>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
