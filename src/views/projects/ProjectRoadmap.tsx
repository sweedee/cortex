import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { Checkbox, TextInput } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { ArrowDownIcon, ArrowUpIcon, DeleteIcon, PlusIcon } from '@dynatrace/strato-icons';
import { AutoFocus } from '../../components/AutoFocus';
import type { Milestone, MilestoneStatus, Project, RoadmapItem, TicketStatus } from '../../model/types';
import { selectWork } from '../../state/actions';
import type { Tone } from '../../state/derive';
import {
  addMilestone,
  addRoadmapItem,
  deleteMilestone,
  deleteRoadmapItem,
  moveMilestone,
  updateMilestone,
  updateRoadmapItem,
} from '../../state/projects';
import { useCortex } from '../../state/store';
import '../../shell/shell.css';
import './roadmap.css';

const STATUSES: { id: MilestoneStatus; label: string }[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'active', label: 'Active' },
  { id: 'done', label: 'Done' },
];

const TICKET_TONE: Record<TicketStatus, Tone> = {
  'To Do': 'neutral',
  'In Progress': 'primary',
  'In Review': 'warning',
  Done: 'success',
};

const KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/;

/** Click to edit: Enter/blur saves, Esc cancels. */
function InlineText({
  value,
  onSave,
  placeholder,
  label,
  className,
  style,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onSave(draft.trim());
    setDraft(null);
  };
  if (draft !== null)
    return (
      <AutoFocus style={{ flex: 1, minWidth: 0 }}>
        <TextInput
          aria-label={label}
          value={draft}
          onChange={setDraft}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      </AutoFocus>
    );
  return (
    <Text className={className} style={style} title="Click to edit" onClick={() => setDraft(value)}>
      {value || <span className="cx-tone-neutral">{placeholder}</span>}
    </Text>
  );
}

function Item({ projectId, milestoneId, item }: { projectId: string; milestoneId: string; item: RoadmapItem }) {
  const work = useCortex((s) => (item.ticketKey ? s.work.find((x) => x.ticket?.key === item.ticketKey) : undefined));
  const backlogTicket = useCortex((s) => (item.ticketKey ? s.backlog.find((t) => t.key === item.ticketKey) : undefined));
  const ticket = { ticket: work?.ticket ?? backlogTicket, workId: work?.id };
  const patch = (change: Partial<RoadmapItem>) => updateRoadmapItem(projectId, milestoneId, item.id, change);
  const t = ticket?.ticket;

  return (
    <div className="cx-todo">
      <Checkbox name={item.id} aria-label={item.done ? 'Mark as open' : 'Mark as done'} value={item.done} onChange={(v) => patch({ done: !!v })} />
      <InlineText
        label="Edit item"
        value={item.text}
        onSave={(v) => (v ? patch({ text: v }) : deleteRoadmapItem(projectId, milestoneId, item.id))}
        style={{
          flex: 1,
          minWidth: 0,
          cursor: 'text',
          color: item.done ? 'var(--dt-colors-text-neutral-subdued)' : undefined,
          textDecoration: item.done ? 'line-through' : undefined,
        }}
      />
      {item.ticketKey && (
        <button
          type="button"
          className="cx-rm-item-key"
          data-open={ticket?.workId || undefined}
          title={t ? `${t.summary}${ticket?.workId ? ' — open work item' : ''}` : 'Unknown ticket'}
          onClick={() => ticket?.workId && selectWork(ticket.workId)}
        >
          <Chip size="condensed" color={t ? TICKET_TONE[t.status] : 'neutral'}>
            {item.ticketKey}
            {t ? ` · ${t.status}` : ''}
          </Chip>
        </button>
      )}
      <Tooltip text="Delete">
        <Button size="condensed" aria-label="Delete item" className="cx-todo-delete" onClick={() => deleteRoadmapItem(projectId, milestoneId, item.id)}>
          <Button.Prefix>
            <DeleteIcon />
          </Button.Prefix>
        </Button>
      </Tooltip>
    </div>
  );
}

function MilestoneCard({ projectId, m, index, count }: { projectId: string; m: Milestone; index: number; count: number }) {
  const [text, setText] = useState('');
  const done = m.items.filter((i) => i.done).length;
  const pct = m.items.length ? Math.round((done / m.items.length) * 100) : 0;

  const add = () => {
    const raw = text.trim();
    if (!raw) return;
    const key = raw.match(KEY_RE)?.[0];
    const rest = key ? raw.replace(key, '').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').replace(/\s{2,}/g, ' ') : raw;
    addRoadmapItem(projectId, m.id, rest || raw, key);
    setText('');
  };

  const remove = () => {
    if (m.items.length === 0 || window.confirm(`Delete "${m.title}" and its ${m.items.length} items?`)) deleteMilestone(projectId, m.id);
  };

  return (
    <section className="cx-rm-card" data-status={m.status} aria-label={m.title}>
      <div className="cx-rm-head">
        <InlineText
          label="Milestone title"
          className="cx-rm-title"
          value={m.title}
          placeholder="Untitled"
          onSave={(v) => v && updateMilestone(projectId, m.id, { title: v })}
        />
        <InlineText
          label="Milestone target"
          className="cx-rm-target cx-tone-neutral"
          value={m.target ?? ''}
          placeholder="Set target"
          onSave={(v) => updateMilestone(projectId, m.id, { target: v || undefined })}
        />
        <div className="cx-rm-seg" role="group" aria-label="Status">
          {STATUSES.map((s) => (
            <button key={s.id} type="button" data-s={s.id} aria-pressed={m.status === s.id} onClick={() => updateMilestone(projectId, m.id, { status: s.id })}>
              {s.label}
            </button>
          ))}
        </div>
        <Flex gap={0}>
          <Button size="condensed" aria-label="Move up" disabled={index === 0} onClick={() => moveMilestone(projectId, m.id, -1)}>
            <Button.Prefix>
              <ArrowUpIcon />
            </Button.Prefix>
          </Button>
          <Button size="condensed" aria-label="Move down" disabled={index === count - 1} onClick={() => moveMilestone(projectId, m.id, 1)}>
            <Button.Prefix>
              <ArrowDownIcon />
            </Button.Prefix>
          </Button>
          <Button size="condensed" aria-label="Delete milestone" onClick={remove}>
            <Button.Prefix>
              <DeleteIcon />
            </Button.Prefix>
          </Button>
        </Flex>
      </div>

      <div className="cx-rm-progress">
        <div className="cx-rm-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <Text textStyle="small" className="cx-tone-neutral">
          {done}/{m.items.length}
        </Text>
      </div>

      <div>
        {m.items.map((i) => (
          <Item key={i.id} projectId={projectId} milestoneId={m.id} item={i} />
        ))}
      </div>

      <div className="cx-rm-add">
        <TextInput
          aria-label={`Add item to ${m.title}`}
          placeholder="Add item… (a ticket key like CTX-1423 links it)"
          value={text}
          onChange={setText}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          style={{ flex: 1 }}
        />
        <Button disabled={!text.trim()} onClick={add}>
          <Button.Prefix>
            <PlusIcon />
          </Button.Prefix>
          Add
        </Button>
      </div>
    </section>
  );
}

export function ProjectRoadmap({ project }: { project: Project }) {
  const [title, setTitle] = useState('');
  const add = () => {
    if (!title.trim()) return;
    addMilestone(project.id, title.trim());
    setTitle('');
  };
  return (
    <div className="cx-rm">
      <div className="cx-rm-inner">
        {project.roadmap.length === 0 && (
          <div className="cx-rm-empty">
            <Heading level={5}>No milestones yet</Heading>
            <Text className="cx-tone-neutral">Add a first milestone below, then break it into checklist items.</Text>
          </div>
        )}
        {project.roadmap.map((m, i) => (
          <MilestoneCard key={m.id} projectId={project.id} m={m} index={i} count={project.roadmap.length} />
        ))}
        <Flex gap={8}>
          <TextInput
            aria-label="New milestone"
            placeholder="Add milestone… (Enter)"
            value={title}
            onChange={setTitle}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            style={{ flex: 1 }}
          />
          <Button variant="accent" color="primary" disabled={!title.trim()} onClick={add}>
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add milestone
          </Button>
        </Flex>
      </div>
    </div>
  );
}
