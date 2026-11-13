import { useEffect, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip, CodeSnippet, Markdown } from '@dynatrace/strato-components/content';
import { FormField, Label, TextArea, TextInput } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Modal, Sheet } from '@dynatrace/strato-components/overlays';
import { ChatIcon } from '@dynatrace/strato-icons';
import { Text } from '@dynatrace/strato-components/typography';
import { showToast } from '@dynatrace/strato-components/notifications';
import { KINDS_ADDABLE } from '../actions';
import { place } from '../layout';
import type { Item, Kind } from '../model';
import { KIND_LABEL } from '../model';
import { addItem, closeDialog, insertSkill, itemById, newId, patchItem, select, useStore } from '../store';
import { KIND_ICON, TONE_CHIP } from '../visual';

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'add':
      return <AddDialog key={dialog.kind + dialog.at.x} kind={dialog.kind} at={dialog.at} />;
    case 'session':
      return <SessionSheet id={dialog.itemId} />;
    case 'plan':
      return <PlanDialog id={dialog.itemId} />;
    case 'log':
      return <LogDialog id={dialog.itemId} />;
    case 'confirm':
      return (
        <Modal
          title={dialog.title}
          show
          size="small"
          onDismiss={closeDialog}
          footer={
            <Flex justifyContent="flex-end" gap={8}>
              <Button onClick={closeDialog}>Cancel</Button>
              <Button
                variant="accent"
                color={dialog.danger ? 'critical' : 'primary'}
                onClick={() => {
                  closeDialog();
                  dialog.onConfirm();
                }}
              >
                {dialog.confirm}
              </Button>
            </Flex>
          }
        >
          <Text>{dialog.body}</Text>
        </Modal>
      );
  }
}

// ---- add / import -----------------------------------------------------------------------

/** Guess what a pasted reference is. */
function detect(v: string): Kind | null {
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(v) || /\/browse\//.test(v)) return 'ticket';
  if (/\/pull\/\d+|#\d+$/.test(v)) return 'pr';
  if (/^PLAN-.*\.md$/i.test(v)) return 'plan';
  if (/^(feat|fix|chore|spike)\//.test(v)) return 'worktree';
  return null;
}

function AddDialog({ kind: initial, at }: { kind: Kind; at: { x: number; y: number } }) {
  const items = useStore((s) => s.items);
  const projects = items.filter((i) => i.kind === 'project');
  const [kind, setKind] = useState<Kind>(initial);
  const [value, setValue] = useState('');
  const [project, setProject] = useState<string | null>(projects[0]?.id ?? null);
  const meta = KINDS_ADDABLE.find((k) => k.kind === kind)!;
  const guessed = detect(value.trim());
  const field = useRef<HTMLDivElement>(null);
  // Strato inputs have no autoFocus prop: focus the field once the modal is in place
  useEffect(() => {
    const t = setTimeout(() => field.current?.querySelector<HTMLElement>('input, textarea')?.focus(), 80);
    return () => clearTimeout(t);
  }, [kind === 'agent']);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    const id = newId(kind);
    const proj = project ? itemById(project) : undefined;
    const item = build(kind, v, proj);
    item.id = id;
    place.seed(id, at);
    addItem(item, proj && kind !== 'project' ? [{ from: id, to: proj.id, label: kind === 'ticket' ? 'in project' : 'belongs to' }] : []);
    closeDialog();
    select([id]);
    showToast({ type: 'success', title: `${KIND_LABEL[kind]} added`, message: item.title, lifespan: 2500 });
  };

  return (
    <Modal
      title={
        <Flex alignItems="center" gap={8}>
          {KIND_ICON[kind](20)}
          <span>{meta.label.replace('…', '')}</span>
        </Flex>
      }
      show
      size="small"
      onDismiss={closeDialog}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="accent" color="primary" disabled={!value.trim()} onClick={submit}>
            Add to canvas
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <Flex gap={6} flexWrap="wrap">
          {KINDS_ADDABLE.map((k) => (
            <Button key={k.kind} size="condensed" variant={k.kind === kind ? 'accent' : 'default'} color={k.kind === kind ? 'primary' : 'neutral'} onClick={() => setKind(k.kind)}>
              <Button.Prefix>{KIND_ICON[k.kind](14)}</Button.Prefix>
              {KIND_LABEL[k.kind]}
            </Button>
          ))}
        </Flex>
        <div ref={field}>
        <FormField>
          <Label>{kind === 'agent' ? 'Prompt' : 'Reference'}</Label>
          {kind === 'agent' ? (
            <TextArea rows={3} value={value} onChange={setValue} placeholder={meta.hint} />
          ) : (
            <TextInput
              value={value}
              onChange={(v: string) => {
                setValue(v);
                const g = detect(v.trim());
                if (g && g !== kind) setKind(g);
              }}
              placeholder={meta.hint}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && submit()}
            />
          )}
        </FormField>
        </div>
        {guessed && guessed === kind && value && (
          <Text textStyle="small" className="subdued">
            Looks like a {KIND_LABEL[guessed].toLowerCase()}, switched type for you.
          </Text>
        )}
        {kind !== 'project' && (
          <FormField>
            <Label>Link to project</Label>
            <Flex gap={6} flexWrap="wrap">
              {projects.map((p) => (
                <Button key={p.id} size="condensed" variant={p.id === project ? 'emphasized' : 'default'} color={p.id === project ? 'primary' : 'neutral'} onClick={() => setProject(p.id === project ? null : p.id)}>
                  {p.title}
                </Button>
              ))}
            </Flex>
          </FormField>
        )}
      </Flex>
    </Modal>
  );
}

function build(kind: Kind, v: string, proj?: Item): Item {
  const cluster = kind === 'project' ? undefined : proj?.cluster;
  switch (kind) {
    case 'ticket': {
      const key = v.match(/[A-Z][A-Z0-9]+-\d+/)?.[0] ?? v;
      return { id: '', kind, handle: key, short: key.split('-')[1], title: `Imported ticket ${key}`, subtitle: 'Story · Medium · To Do', status: [{ tone: 'neutral', label: 'To Do' }], cluster };
    }
    case 'pr': {
      const num = v.match(/(\d+)\s*$/)?.[1] ?? '?';
      return { id: '', kind, handle: `PR-${num}`, short: `#${num}`, title: `Pull request #${num}`, subtitle: `${proj?.title ?? 'repo'} · open → main`, status: [{ tone: 'pending', label: 'Review pending' }, { tone: 'running', label: 'Checks running' }], flags: { mergeable: false }, cluster };
    }
    case 'project': {
      const name = v.split('/').pop()!;
      return { id: '', kind, handle: name, title: name, subtitle: v, status: [{ tone: 'neutral', label: 'not built yet' }], cluster: undefined };
    }
    case 'worktree':
      return { id: '', kind, handle: `wt/${v.split('/').pop()}`, title: v, subtitle: `~/wt/${proj?.title ?? 'repo'}/${v.split('/').pop()}`, status: [{ tone: 'success', label: 'fresh from main' }], facts: [['Ahead / behind', '0 / 0'], ['Dirty files', '0'], ['Base', 'main']], cluster };
    case 'agent':
      return { id: '', kind, handle: `agent/${Math.random().toString(36).slice(2, 6)}`, title: v.length > 40 ? v.slice(0, 40) + '…' : v, subtitle: 'claude-opus-5-5 · just started', status: [{ tone: 'running', label: 'Running' }], flags: { running: true }, cluster };
    case 'plan':
      return { id: '', kind, handle: v, title: v, subtitle: 'Draft · empty', status: [{ tone: 'pending', label: 'Draft' }], facts: [['Steps', '0'], ['Author', 'you'], ['Approved', 'no']], cluster };
    case 'build':
      return { id: '', kind, handle: `build-${Math.floor(Math.random() * 900 + 1900)}`, short: '…', title: v, subtitle: 'watching', status: [{ tone: 'running', label: 'Running' }], flags: { running: true }, cluster };
  }
}

// ---- agent session viewer ----------------------------------------------------------------

function SessionSheet({ id }: { id: string }) {
  const item = useStore((s) => s.items.find((i) => i.id === id));
  const [answer, setAnswer] = useState('');
  if (!item) return null;
  const waiting = item.flags?.waitingForInput;

  const reply = (text: string) => {
    patchItem(item.id, { flags: { ...item.flags, waitingForInput: false, running: true }, status: [{ tone: 'running', label: 'Running · continuing with your answer' }], notice: undefined });
    showToast({ type: 'success', title: 'Answer sent', message: text, lifespan: 2500 });
    closeDialog();
  };

  return (
    <Sheet
      title={
        <Flex alignItems="center" gap={8}>
          {KIND_ICON.agent(20)}
          <span>{item.title}</span>
          {item.status.map((s, i) => (
            <Chip key={i} size="condensed" color={TONE_CHIP[s.tone]}>
              {s.label}
            </Chip>
          ))}
        </Flex>
      }
      show
      onDismiss={closeDialog}
      actions={
        <Button
          onClick={() => {
            closeDialog();
            insertSkill('continue-session', [item.id]);
          }}
        >
          <Button.Prefix>
            <ChatIcon />
          </Button.Prefix>
          Follow up in chat
        </Button>
      }
    >
      <div className="transcript">
        <Turn who="you">/{item.title.split(' ')[0].toLowerCase()} @{item.handle.replace('agent/', '')}</Turn>
        <Tool name="Read">src/dispatcher/Dispatcher.ts · 312 lines</Tool>
        <Tool name="Grep">“retryPolicy” · 7 matches in 4 files</Tool>
        <Turn who="claude">
          I looked at how the dispatcher hands batches to the exporters. Failures are retried immediately and forever, which explains the
          thundering-herd pattern in the ticket. I will introduce a <code>RetryPolicy</code> with capped exponential backoff and jitter.
        </Turn>
        <Tool name="Edit">src/dispatcher/retry.ts · +84 −0</Tool>
        <Tool name="Bash">npm test -- dispatcher · 41 passed</Tool>
        {waiting ? (
          <div className="question-card">
            <div className="question-head">Claude is asking</div>
            <div className="question-text">Dedup window — should it be a fixed 30 s, or configurable per alert rule?</div>
            <Flex gap={8} flexWrap="wrap">
              <Button variant="emphasized" onClick={() => reply('Fixed 30 s for now')}>
                Fixed 30 s for now
              </Button>
              <Button variant="emphasized" onClick={() => reply('Configurable per rule, default 30 s')}>
                Configurable per rule (default 30 s)
              </Button>
            </Flex>
            <Flex gap={8} alignItems="center">
              <TextInput value={answer} onChange={setAnswer} placeholder="Or type an answer…" />
              <Button variant="accent" color="primary" disabled={!answer.trim()} onClick={() => reply(answer)}>
                Send
              </Button>
            </Flex>
          </div>
        ) : (
          <Turn who="claude">{item.status[0].label}…</Turn>
        )}
      </div>
    </Sheet>
  );
}

const Turn = ({ who, children }: { who: 'you' | 'claude'; children: React.ReactNode }) => (
  <div className={`turn turn-${who}`}>
    <div className="turn-who">{who === 'you' ? 'You' : 'Claude'}</div>
    <div className="turn-body">{children}</div>
  </div>
);
const Tool = ({ name, children }: { name: string; children: React.ReactNode }) => (
  <div className="tool-row">
    <span className="tool-name">{name}</span>
    <span>{children}</span>
  </div>
);

// ---- plan & log ---------------------------------------------------------------------------

const PLAN_MD = (title: string) => `## ${title}

**Context.** Alerts fire once per region today; the same incident in eu-west and us-east pages twice.

**Approach.** Fingerprint alerts on \`(rule, entity, window)\` instead of \`(rule, entity, region)\` and keep a short-lived dedup cache in front of the notifier.

1. ~~Add \`regionAgnosticFingerprint()\` to \`alerting-service/src/fingerprint.ts\`~~
2. ~~Cache with TTL = dedup window (\`DedupCache\`)~~
3. Emit the dedup key from ingest-gateway (\`X-Ctx-Dedup-Key\`)
4. Feature flag \`alerting.crossRegionDedup\`
5. Integration test across two regions
6. Rollout notes in the runbook

**Risks.** Clock skew between regions; window must be ≥ max skew.`;

function PlanDialog({ id }: { id: string }) {
  const item = itemById(id);
  if (!item) return null;
  return (
    <Modal
      title={
        <Flex alignItems="center" gap={8}>
          {KIND_ICON.plan(20)}
          <span>{item.title}</span>
        </Flex>
      }
      show
      size="medium"
      onDismiss={closeDialog}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button
            onClick={() => {
              closeDialog();
              insertSkill('grill-plan', [item.id]);
            }}
          >
            Grill it
          </Button>
          <Button
            variant="accent"
            color="primary"
            onClick={() => {
              closeDialog();
              insertSkill('implement-plan', [item.id]);
            }}
          >
            Implement plan
          </Button>
        </Flex>
      }
    >
      <Markdown>{PLAN_MD(item.title)}</Markdown>
    </Modal>
  );
}

function LogDialog({ id }: { id: string }) {
  const item = itemById(id);
  if (!item) return null;
  const failed = item.status[0].tone === 'critical';
  const log = failed
    ? `[e2e] Running 38 specs with 4 workers
[e2e]  ✓ dashboards/Toolbar.spec.ts (6)
[e2e]  ✗ dashboards/TileGrid.spec.ts > keeps tile nodes across refresh
        Expected: 12 tile nodes to be reused
        Received: 0 reused, 12 re-mounted
          at TileGrid.spec.ts:88:31
[e2e]  ✓ dashboards/Filters.spec.ts (11)
[e2e] 1 failed, 37 passed (14m 40s)
ERROR: stage "e2e" failed with exit code 1`
    : `[build] vite v8.4.1 building for production…
[build] ✓ 1832 modules transformed.
[test]  Test Files  212 passed (212)
[test]       Tests  1904 passed (1904)
[e2e]   38 passed (11m 2s)
Finished: SUCCESS`;
  return (
    <Modal
      title={item.title}
      show
      size="large"
      onDismiss={closeDialog}
      footer={
        failed ? (
          <Flex justifyContent="flex-end">
            <Button
              variant="accent"
              color="primary"
              onClick={() => {
                closeDialog();
                insertSkill('fix-ci', [item.id]);
              }}
            >
              Fix CI
            </Button>
          </Flex>
        ) : undefined
      }
    >
      <CodeSnippet language="bash" showLineNumbers>
        {log}
      </CodeSnippet>
    </Modal>
  );
}
