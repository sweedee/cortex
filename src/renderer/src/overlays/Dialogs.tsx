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
import type { ItemOf, Kind } from '../domain';
import { answerQuestion } from '../kinds/agent';
import { buildFailed } from '../kinds/build';
import { getKind, kindIcon, kindLabel, KINDS, useViews } from '../kinds/registry';
import { place } from '../layout';
import { addItem, closeDialog, insertSkill, itemById, makeItem, select, useStore } from '../store';
import { TONE_CHIP } from '../tones';

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'add':
      return <AddDialog key={dialog.kind + dialog.at.x} kind={dialog.kind} at={dialog.at} />;
    case 'session':
      return <SessionSheet id={dialog.itemId} />;
    case 'record':
      return <RecordDialog id={dialog.itemId} />;
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

/** Guess what a pasted reference is (the first kind whose `addable.detect` matches). */
function detect(v: string): Kind | null {
  return v ? (KINDS.find((k) => getKind(k).addable?.detect?.(v)) ?? null) : null;
}

function AddDialog({ kind: initial, at }: { kind: Kind; at: { x: number; y: number } }) {
  const items = useStore((s) => s.items);
  const projects = items.filter((i): i is ItemOf<'project'> => i.kind === 'project');
  const [kind, setKind] = useState<Kind>(initial);
  const [value, setValue] = useState('');
  const [project, setProject] = useState<string | null>(projects[0]?.id ?? null);
  const meta = getKind(kind).addable!;
  const guessed = detect(value.trim());
  const field = useRef<HTMLDivElement>(null);
  // Strato inputs have no autoFocus prop: focus the field once the modal is in place
  useEffect(() => {
    const t = setTimeout(() => field.current?.querySelector<HTMLElement>('input, textarea')?.focus(), 80);
    return () => clearTimeout(t);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- refocus only when the field type flips
  }, [!!meta.multiline]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    const proj = projects.find((p) => p.id === project && kind !== 'project');
    const item = makeItem({ ...meta.create(v, proj), ...(proj && { projectId: proj.id }) });
    place.seed(item.id, at);
    addItem(item, proj ? [{ from: item.id, to: proj.id, label: kind === 'ticket' ? 'in project' : 'belongs to' }] : []);
    closeDialog();
    select([item.id]);
    showToast({ type: 'success', title: `${kindLabel(kind)} added`, message: item.title, lifespan: 2500 });
  };

  return (
    <Modal
      title={
        <Flex alignItems="center" gap={8}>
          {kindIcon(kind, 20)}
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
              <Button.Prefix>{kindIcon(k.kind, 14)}</Button.Prefix>
              {kindLabel(k.kind)}
            </Button>
          ))}
        </Flex>
        <div ref={field}>
        <FormField>
          <Label>{meta.multiline ? 'Text' : 'Reference'}</Label>
          {meta.multiline ? (
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
            Looks like a {kindLabel(guessed).toLowerCase()}, switched type for you.
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

// ---- agent session viewer ----------------------------------------------------------------

/** Prototype transcript (phase 1 streams the real one from the claude CLI); the question card is real data. */
function SessionSheet({ id }: { id: string }) {
  const item = useStore((s) => s.items.find((i) => i.id === id));
  const views = useViews();
  const [answer, setAnswer] = useState('');
  if (!item || item.kind !== 'agent') return null;
  const ring = views.get(item.id)?.ring ?? [];
  const question = item.data.status === 'waiting' ? item.data.pendingQuestion?.questions[0] : undefined;

  const reply = (text: string) => {
    answerQuestion(item, text);
    closeDialog();
  };

  return (
    <Sheet
      title={
        <Flex alignItems="center" gap={8}>
          {kindIcon('agent', 20)}
          <span>{item.title}</span>
          {ring.map((s, i) => (
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
        {question ? (
          <div className="question-card">
            <div className="question-head">{question.header ? `Claude is asking · ${question.header}` : 'Claude is asking'}</div>
            <div className="question-text">{question.question}</div>
            {question.options.length > 0 && (
              <Flex gap={8} flexWrap="wrap">
                {question.options.map((o) => (
                  <Button key={o.label} variant="emphasized" onClick={() => reply(o.label)}>
                    {o.description ? `${o.label} (${o.description})` : o.label}
                  </Button>
                ))}
              </Flex>
            )}
            <Flex gap={8} alignItems="center">
              <TextInput value={answer} onChange={setAnswer} placeholder="Or type an answer…" />
              <Button variant="accent" color="primary" disabled={!answer.trim()} onClick={() => reply(answer)}>
                Send
              </Button>
            </Flex>
          </div>
        ) : (
          <Turn who="claude">{ring[0]?.label ?? 'Idle'}…</Turn>
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

/** Prototype content (phase 2 renders the markdown file at `data.path`). */
function RecordDialog({ id }: { id: string }) {
  const item = itemById(id);
  if (!item || item.kind !== 'record') return null;
  const plan = item.data.recordType === 'plan';
  return (
    <Modal
      title={
        <Flex alignItems="center" gap={8}>
          {kindIcon('record', 20)}
          <span>{item.title}</span>
        </Flex>
      }
      show
      size="medium"
      onDismiss={closeDialog}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          {plan && (
            <Button
              onClick={() => {
                closeDialog();
                insertSkill('grill-plan', [item.id]);
              }}
            >
              Grill it
            </Button>
          )}
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
      <Text textStyle="small" className="subdued">
        {item.data.path}
      </Text>
      <Markdown>{PLAN_MD(item.title)}</Markdown>
    </Modal>
  );
}

function LogDialog({ id }: { id: string }) {
  const item = itemById(id);
  if (!item || item.kind !== 'build') return null;
  const failed = buildFailed(item);
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
