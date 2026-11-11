import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Avatar, Markdown } from '@dynatrace/strato-components/content';
import { TextArea } from '@dynatrace/strato-components/forms';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import type { TicketComment } from '../../model/types';
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
          <Markdown>{comment.bodyMd}</Markdown>
        </div>
      </div>
    </div>
  );
}

/**
 * Ticket comments plus a composer. New comments are kept in local state only —
 * nothing is written back to the (mocked) ticket.
 */
export function Comments({ comments, me, now }: { comments: TicketComment[]; me: string; now: number }) {
  const [local, setLocal] = useState<TicketComment[]>([]);
  const [draft, setDraft] = useState('');
  const all = [...comments, ...local];

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    setLocal((l) => [...l, { id: `local-${l.length + 1}`, author: me, at: new Date().toISOString(), bodyMd: body }]);
    setDraft('');
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
                submit();
              }
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <Button variant="emphasized" color="primary" size="condensed" disabled={!draft.trim()} onClick={submit}>
              Comment
            </Button>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              Ctrl+Enter to send · stays local in this prototype
            </Text>
          </div>
        </div>
      </div>
    </section>
  );
}
