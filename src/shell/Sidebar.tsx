import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { TextInput } from '@dynatrace/strato-components/forms';
import { Divider, Flex } from '@dynatrace/strato-components/layouts';
import { Modal } from '@dynatrace/strato-components/overlays';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { AiIcon, PlusIcon } from '@dynatrace/strato-icons';
import type { WorkItem } from '../model/types';
import { selectWork, startAdhocWork, startWorkOnTicket } from '../state/actions';
import { attentionOf, type AttentionGroup } from '../state/derive';
import { useCortex } from '../state/store';
import { WorkCard } from './WorkCard';
import './shell.css';

const GROUPS: { id: AttentionGroup; label: string }[] = [
  { id: 'needs-you', label: 'Needs you' },
  { id: 'in-flight', label: 'In flight' },
  { id: 'idle', label: 'Up next' },
];

const REPOS = ['console-ui', 'ingest-gateway', 'query-service'];

function NewWorkModal({ show, onDismiss }: { show: boolean; onDismiss: () => void }) {
  const backlog = useCortex((s) => s.backlog);
  const [title, setTitle] = useState('');
  const [repo, setRepo] = useState(REPOS[0]);

  const startAdhoc = () => {
    if (!title.trim()) return;
    startAdhocWork(title.trim(), repo);
    setTitle('');
    onDismiss();
  };

  return (
    <Modal title="Start work" show={show} onDismiss={onDismiss} size="small">
      <Flex flexDirection="column" gap={16}>
        <Flex flexDirection="column" gap={8}>
          <Text textStyle="small-emphasized" className="cx-tone-neutral">
            Assigned to you in Jira
          </Text>
          {backlog.length === 0 && <Text className="cx-tone-neutral">Nothing left in your backlog.</Text>}
          {backlog.map((t) => (
            <Flex key={t.key} alignItems="center" gap={8}>
              <Text className="cx-mono" style={{ flex: 'none' }}>
                {t.key}
              </Text>
              <Text className="cx-ellipsis" style={{ flex: 1 }}>
                {t.summary}
              </Text>
              <Chip size="condensed" color={t.type === 'Bug' ? 'critical' : 'neutral'}>
                {t.type}
              </Chip>
              <Button
                size="condensed"
                variant="emphasized"
                onClick={() => {
                  startWorkOnTicket(t.key);
                  onDismiss();
                }}
              >
                Start
              </Button>
            </Flex>
          ))}
        </Flex>
        <Divider />
        <Flex flexDirection="column" gap={8}>
          <Text textStyle="small-emphasized" className="cx-tone-neutral">
            Or something without a ticket
          </Text>
          <TextInput
            placeholder="What are you working on?"
            aria-label="Title"
            value={title}
            onChange={setTitle}
            onKeyDown={(e) => e.key === 'Enter' && startAdhoc()}
          />
          <Flex alignItems="center" gap={4} flexWrap="wrap">
            {REPOS.map((r) => (
              <Button key={r} size="condensed" variant={r === repo ? 'accent' : 'default'} color={r === repo ? 'primary' : 'neutral'} onClick={() => setRepo(r)}>
                {r}
              </Button>
            ))}
            <span style={{ marginLeft: 'auto' }} />
            <Button variant="accent" color="primary" disabled={!title.trim()} onClick={startAdhoc}>
              Start
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </Modal>
  );
}

export function Sidebar() {
  const work = useCortex((s) => s.work);
  const sessions = useCortex((s) => s.sessions);
  const me = useCortex((s) => s.me);
  const selectedId = useCortex((s) => s.view.workId);
  const [showNew, setShowNew] = useState(false);

  const grouped = new Map<AttentionGroup, WorkItem[]>();
  for (const w of work) {
    const g = attentionOf(w, sessions, me).group;
    grouped.set(g, [...(grouped.get(g) ?? []), w]);
  }

  return (
    <Flex flexDirection="column" gap={0} style={{ height: '100%', minHeight: 0 }}>
      <Flex alignItems="center" gap={8} padding={12} paddingBottom={8}>
        <Heading level={5} as="h1">
          Cortex
        </Heading>
        <Text textStyle="small" className="cx-tone-neutral">
          {work.length} in progress
        </Text>
        <span style={{ marginLeft: 'auto' }} />
        <Button size="condensed" variant="emphasized" onClick={() => setShowNew(true)}>
          <Button.Prefix>
            <PlusIcon />
          </Button.Prefix>
          New work
        </Button>
      </Flex>

      <div style={{ padding: '0 8px 8px' }}>
        <button className="cx-home" aria-current={selectedId === null ? 'page' : undefined} onClick={() => selectWork(null)}>
          <AiIcon />
          <Text textStyle="base-emphasized">Ask Cortex</Text>
          <Text textStyle="small" className="cx-tone-neutral" style={{ marginLeft: 'auto' }}>
            across all work
          </Text>
        </button>
      </div>
      <Divider />

      <Flex flexDirection="column" gap={8} padding={8} style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {GROUPS.map(({ id, label }) => {
          const items = grouped.get(id);
          if (!items?.length) return null;
          return (
            <Flex key={id} flexDirection="column" gap={8}>
              <div className="cx-group-label">
                {label}
                <span>{items.length}</span>
              </div>
              {items.map((w) => (
                <WorkCard key={w.id} work={w} selected={w.id === selectedId} />
              ))}
            </Flex>
          );
        })}
        {work.length === 0 && (
          <Text className="cx-tone-neutral" style={{ padding: 16, textAlign: 'center' }}>
            Nothing in progress. Start something with “New work”.
          </Text>
        )}
      </Flex>

      <NewWorkModal show={showNew} onDismiss={() => setShowNew(false)} />
    </Flex>
  );
}
