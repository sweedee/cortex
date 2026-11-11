import type { ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { ArrowRightIcon } from '@dynatrace/strato-icons';
import { Composer } from '../components/session/Composer';
import { Transcript } from '../components/session/Transcript';
import { cxVars, plural, subduedText } from '../components/session/meta';
import { GLOBAL_SESSION_ID } from '../services/config';
import type { WorkTab } from '../model/types';
import { selectWork, sendMessage, stopSession } from '../state/actions';
import { awaitsMyReview } from '../state/derive';
import { useCortex, useSession } from '../state/store';

const SUGGESTIONS = [
  'What needs my attention?',
  "Summarise yesterday's PR feedback",
  "What's failing on CI?",
  'Plan my day',
];

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name}`;
}

interface Entry {
  key: string;
  label: string;
  workId?: string;
  tab?: WorkTab;
}

function Digest() {
  const me = useCortex((s) => s.me);
  const work = useCortex((s) => s.work);
  const sessions = useCortex((s) => s.sessions);
  const backlog = useCortex((s) => s.backlog);
  const titleOf = (id: string | null) => work.find((w) => w.id === id)?.ticket?.key ?? work.find((w) => w.id === id)?.title ?? '';

  const groups: { title: string; entries: Entry[] }[] = [
    {
      title: 'Waiting for your input',
      entries: sessions
        .filter((s) => s.workId && s.status === 'waiting' && s.activity)
        .map((s) => ({ key: s.id, label: `${titleOf(s.workId)} · ${s.title}`, workId: s.workId!, tab: 'agents' as WorkTab })),
    },
    {
      title: 'Agents running',
      entries: sessions
        .filter((s) => s.workId && s.status === 'running')
        .map((s) => ({ key: s.id, label: `${titleOf(s.workId)} · ${s.title}`, workId: s.workId!, tab: 'agents' as WorkTab })),
    },
    {
      title: 'PRs awaiting your review',
      entries: work
        .filter((w) => awaitsMyReview(w, me))
        .map((w) => ({ key: w.id, label: w.pr?.title ?? w.title, workId: w.id, tab: 'review' as WorkTab })),
    },
    {
      title: 'Failed builds',
      entries: work
        .filter((w) => w.pipeline?.status === 'failed')
        .map((w) => ({ key: w.id, label: `${titleOf(w.id)} · build #${w.pipeline!.buildNumber}`, workId: w.id, tab: 'pipeline' as WorkTab })),
    },
    {
      title: 'Backlog',
      entries: backlog.slice(0, 3).map((t) => ({ key: t.key, label: `${t.key} · ${t.summary}` })),
    },
  ];
  const shown = groups.filter((g) => g.entries.length > 0);
  if (shown.length === 0) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      {shown.map((g) => (
        <div key={g.title} className="cx-card" style={{ gap: 4 }}>
          <Text textStyle="small" style={{ ...subduedText, fontWeight: 600 }}>
            {g.title} · {g.entries.length}
          </Text>
          {g.entries.slice(0, 3).map((e) => {
            const body = (
              <>
                <Text textStyle="small" className="cx-ellipsis">
                  {e.label}
                </Text>
                <ArrowRightIcon className="cx-entry-arrow" />
              </>
            );
            return e.workId ? (
              <button key={e.key} type="button" className="cx-btn cx-entry" onClick={() => selectWork(e.workId!, e.tab)}>
                {body}
              </button>
            ) : (
              <div key={e.key} className="cx-entry">
                <Text textStyle="small" className="cx-ellipsis">
                  {e.label}
                </Text>
              </div>
            );
          })}
          {g.entries.length > 3 && (
            <Text textStyle="small" style={subduedText}>
              + {plural(g.entries.length - 3, 'more')}
            </Text>
          )}
        </div>
      ))}
    </div>
  );
}

function Home({ onSend, children }: { onSend: (t: string) => void; children?: ReactNode }) {
  const me = useCortex((s) => s.me);
  const first = me.split(/[\s.@]/)[0] || me;
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  return (
    <div style={{ padding: '8vh 0 0' }}>
      <Heading level={2}>{greeting(name)}</Heading>
      <Text style={{ ...subduedText, display: 'block', margin: '4px 0 20px' }}>What are we working on?</Text>
      <Composer onSend={onSend} rows={3} autoFocus placeholder="Ask Claude anything about your work…" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '14px 0 32px' }}>
        {SUGGESTIONS.map((s) => (
          <Button key={s} size="condensed" onClick={() => onSend(s)}>
            {s}
          </Button>
        ))}
      </div>
      <Text textStyle="small" style={{ ...subduedText, fontWeight: 600, display: 'block', marginBottom: 8 }}>
        At a glance
      </Text>
      <Digest />
      {children}
    </div>
  );
}

export function ChatView() {
  const session = useSession(GLOBAL_SESSION_ID);
  if (!session) return null;
  const send = (t: string) => void sendMessage(session.id, t);

  if (session.messages.length === 0) {
    return (
      <div className="cx-scroll cx-root" style={{ ...cxVars, height: '100%' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 24px 32px' }}>
          <Home onSend={send} />
        </div>
      </div>
    );
  }
  return (
    <div className="cx-root" style={{ ...cxVars, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Transcript session={session} />
      <div style={{ padding: '8px 16px 14px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <Composer
            running={session.status === 'running'}
            onStop={() => stopSession(session.id)}
            onSend={send}
            placeholder="Reply to Claude…"
          />
        </div>
      </div>
    </div>
  );
}
