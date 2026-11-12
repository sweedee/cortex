import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { AiLoadingIndicator } from '@dynatrace/strato-components/content';
import { Md } from '../Md';
import { Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { WarningIcon } from '@dynatrace/strato-icons';
import type { AgentSession, SessionMessage } from '../../model/types';
import { isQuestion, openQuestion } from '../../model/session';
import { QuestionCard } from './QuestionCard';
import { ToolCallRow } from './ToolCallRow';
import { cxVars, isFresh, subduedText } from './meta';

type ToolMsg = Extract<SessionMessage, { role: 'tool' }>;
type Block = { kind: 'msg'; msg: SessionMessage } | { kind: 'tools'; msgs: ToolMsg[] } | { kind: 'ask'; msg: ToolMsg };

function group(messages: SessionMessage[]): Block[] {
  const out: Block[] = [];
  for (const m of messages) {
    if (m.role === 'tool' && isQuestion(m)) out.push({ kind: 'ask', msg: m });
    else if (m.role === 'tool') {
      const last = out[out.length - 1];
      if (last?.kind === 'tools') last.msgs.push(m);
      else out.push({ kind: 'tools', msgs: [m] });
    } else out.push({ kind: 'msg', msg: m });
  }
  return out;
}

export const READING_WIDTH = 820;

export function Transcript({ session, empty }: { session: AgentSession; empty?: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = session.messages[session.messages.length - 1];
  const lastState = !last ? '' : last.role === 'tool' ? last.status : last.text.length;
  const tick = `${session.messages.length}:${lastState}:${session.status}`;

  useLayoutEffect(() => {
    stick.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [tick]);

  const blocks = group(session.messages);
  // an open question card says it all, no extra banner
  const waiting = session.status === 'waiting' && !!session.activity && !openQuestion(session.messages);

  return (
    <div
      ref={scrollRef}
      className="cx-scroll"
      style={{ flex: 1, minHeight: 0 }}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      <div style={{ ...cxVars, maxWidth: READING_WIDTH, margin: '0 auto', padding: '20px 24px 12px' }} className="cx-root">
        {blocks.length === 0 && empty}
        {blocks.map((b, i) => {
          const prev = blocks[i - 1];
          const gap = i === 0 ? 0 : prev?.kind === 'tools' || b.kind === 'tools' ? 10 : 18;          if (b.kind === 'ask')
            return (
              <div key={b.msg.id} style={{ marginTop: gap }} data-fresh={isFresh(b.msg.at)}>
                <QuestionCard sessionId={session.id} msg={b.msg} />
              </div>
            );
          if (b.kind === 'tools')
            return (
              <div key={b.msgs[0].id} className="cx-tools" style={{ marginTop: gap }}>
                {b.msgs.map((m) => (
                  <ToolCallRow key={m.id} msg={m} />
                ))}
              </div>
            );
          const m = b.msg;
          if (m.role === 'tool') return null;
          if (m.role === 'user')
            return (
              <div key={m.id} style={{ marginTop: gap, display: 'flex', justifyContent: 'flex-end' }} data-fresh={isFresh(m.at)}>
                <div className="cx-user">
                  <Text style={{ whiteSpace: 'pre-wrap' }}>{m.text}</Text>
                </div>
              </div>
            );
          return (
            <div key={m.id} className="cx-md" style={{ marginTop: gap }} data-fresh={isFresh(m.at)}>
              {m.text ? <Md>{m.text}</Md> : null}
            </div>
          );
        })}
        {session.status === 'running' && (
          <div style={{ marginTop: 16 }}>
            <AiLoadingIndicator>{session.activity ?? 'Working…'}</AiLoadingIndicator>
          </div>
        )}
        {waiting && (
          <div
            role="status"
            style={{
              marginTop: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 'var(--cx-radius)',
              border: `1px solid ${Colors.Border.Warning.Default}`,
              background: Colors.Background.Container.Warning.Default,
            }}
          >
            <WarningIcon style={{ color: Colors.Icon.Warning.Default, flex: 'none' }} />
            <Text>
              <strong>Waiting for your input.</strong> <span style={subduedText}>{session.activity}</span>
            </Text>
          </div>
        )}
        {session.status === 'failed' && (
          <Text style={{ display: 'block', marginTop: 16, color: Colors.Text.Critical.Default }}>This session failed.</Text>
        )}
      </div>
    </div>
  );
}
