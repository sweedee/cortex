import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Avatar } from '@dynatrace/strato-components/content';
import { TextArea } from '@dynatrace/strato-components/forms';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { Md } from '../../components/Md';
import type { TicketComment } from '../../model/types';
import { addTicketComment } from '../../state/actions';
import { absoluteTime, initials, relativeTime } from './time';

function Comment({ comment, me, now }: { comment: TicketComment; me: string; now: number }) {
  return (
    <div className="ctx-ticket__comment">
      <Avatar abbreviation={initials(comment.author)} aria-label={comment.author} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <Text textStyle="base-emphasized">{comment.author}</Text>
          {comment.author === me && (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              you
            </Text>
          )}
          <Tooltip text={absoluteTime(comment.at)}>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              {relativeTime(comment.at, now)}
            </Text>
          </Tooltip>
        </div>
        <div className="ctx-ticket__comment-body ctx-ticket__md">
          <Md>{comment.bodyMd}</Md>
        </div>
      </div>
    </div>
  );
}

/** Ticket comments plus a composer that posts to Jira (through the Jira service). */
export function Comments({ workId, comments, me, now }: { workId: string; comments: TicketComment[]; me: string; now: number }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const all = comments;

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await addTicketComment(workId, body);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="ctx-ticket__section">
      <div className="ctx-ticket__section-head">
        <Text textStyle="base-emphasized" as="h3" style={{ margin: 0 }}>
          Comments
        </Text>
        <span className="ctx-ticket__count">{all.length}</span>
      </div>
      {all.length === 0 && (
        <Text as="p" style={{ color: Colors.Text.Neutral.Subdued, margin: '0 0 16px' }}>
          No comments yet.
        </Text>
      )}
      {all.map((c) => (
        <Comment key={c.id} comment={c} me={me} now={now} />
      ))}
      <div className="ctx-ticket__comment" style={{ marginTop: 20 }}>
        <Avatar abbreviation={initials(me)} aria-label={me} />
        <div style={{ minWidth: 0 }}>
          <TextArea
            value={draft}
            onChange={setDraft}
            placeholder="Add a comment… (Markdown supported)"
            rows={draft.includes('\n') || draft.length > 120 ? 4 : 2}
            width="full"
            resize="vertical"
            aria-label="Add a comment"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <Button variant="emphasized" color="primary" size="condensed" disabled={!draft.trim()} loading={sending} onClick={() => void submit()}>
              Comment
            </Button>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              Ctrl+Enter to send
            </Text>
          </div>
        </div>
      </div>
    </section>
  );
}
