import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { TextArea } from '@dynatrace/strato-components/forms';
import { ExternalLinkIcon, StepIcon } from '@dynatrace/strato-icons';
import { adfToMarkdown, summarizeIssue, type JiraIssue } from '../../../../shared/integrations/jira';
import { Markdown, WebPanel } from '../../components/viewers';
import { userConfig } from '../../data/config';
import { jiraOps, useJiraIssue } from '../../data/jira';
import { SidebarSection, SidebarTabs, SummarySection } from '../../sidebar';
import { useStore } from '../../store';
import { agoText } from '../../tones';
import { errorText, openUrl } from '../../ui/task';
import { focusItem, mono, Note, ToneChip, ValueRow } from '../project/parts';
import type { SidebarProps } from '../types';
import { openChangeStatus, ticketUrl } from './actions';
import { linkRows, personName, relatedIds } from './model';

const labelStyle = { fontSize: 11, color: 'var(--ink-faint)' } as const;

function Fields({ item, issue }: { item: SidebarProps<'ticket'>['item']; issue?: JiraIssue }) {
  const d = item.data;
  const f = issue?.fields;
  const s = issue ? summarizeIssue(issue, userConfig().jira.fields) : undefined;
  const points = s?.storyPoints ?? d.points;
  const sprint = s?.sprint ?? d.sprint;
  const parent = f?.parent;
  return (
    <SidebarSection
      label="Details"
      actions={
        <Button size="condensed" onClick={() => void openChangeStatus(item)}>
          <Button.Prefix>
            <StepIcon />
          </Button.Prefix>
          Change status…
        </Button>
      }
    >
      <ValueRow label="Type">{s?.type || d.type}</ValueRow>
      <ValueRow label="Priority">{s?.priority || d.priority || '–'}</ValueRow>
      <ValueRow label="Assignee">{f ? personName(f.assignee) : (d.assignee ?? 'unassigned')}</ValueRow>
      <ValueRow label="Reporter">{f?.reporter ? f.reporter.displayName : '–'}</ValueRow>
      <ValueRow label="Sprint">{sprint ?? '–'}</ValueRow>
      <ValueRow label="Story points">{points != null ? String(points) : '–'}</ValueRow>
      <ValueRow label="Parent / epic">
        {parent ? (
          <span title={parent.fields.summary}>
            <span style={mono}>{parent.key}</span> {parent.fields.summary}
          </span>
        ) : (
          '–'
        )}
      </ValueRow>
      {d.branch && (
        <ValueRow label="Branch">
          <span style={mono}>{d.branch}</span>
        </ValueRow>
      )}
      {(s?.labels.length ?? 0) > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 6 }}>
          {s!.labels.map((l) => (
            <Chip key={l} size="condensed" color="neutral">
              {l}
            </Chip>
          ))}
        </div>
      )}
    </SidebarSection>
  );
}

function Links({ issue, onCanvas }: { issue: JiraIssue; onCanvas: (key: string) => string | undefined }) {
  const rows = linkRows(issue.fields);
  if (!rows.length) return null;
  return (
    <SidebarSection label="Linked issues">
      {rows.map((r) => {
        const id = onCanvas(r.key);
        return (
          <button key={r.id} className="sidebar-row" title={r.summary} onClick={() => (id ? focusItem(id) : void openUrl(ticketUrl(r.key)))}>
            <span className="sidebar-row-rel" style={{ width: 84 }}>{r.relation}</span>
            <span style={{ flex: 'none', ...mono }}>{r.key}</span>
            <span className="sidebar-row-main">{r.summary}</span>
            {r.status && <ToneChip tone="neutral">{r.status}</ToneChip>}
          </button>
        );
      })}
    </SidebarSection>
  );
}

function Comments({ issue, itemKey }: { issue?: JiraIssue; itemKey: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const comments = issue?.fields.comment?.comments ?? [];
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await jiraOps.comment(itemKey, text.trim());
      setText('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidebarSection label={`Comments · ${issue?.fields.comment?.total ?? comments.length}`}>
      {issue && comments.length === 0 && <Note>No comments yet.</Note>}
      {comments.map((c) => (
        <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 2 }}>
            <strong>{c.author.displayName}</strong>
            <span style={labelStyle}>{agoText(Date.parse(c.created))}</span>
          </div>
          <Markdown source={adfToMarkdown(c.body)} onLinkClick={(h: string) => void openUrl(h)} />
        </div>
      ))}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <TextArea value={text} placeholder="Add a comment…" rows={3} aria-label="New comment" onChange={(v: string) => setText(v)} />
        {error && <Note tone="error">{error}</Note>}
        <div>
          <Button variant="accent" size="condensed" loading={busy} disabled={!text.trim()} onClick={() => void send()}>
            Comment
          </Button>
        </div>
      </div>
    </SidebarSection>
  );
}

function Related({ item, ctx }: SidebarProps<'ticket'>) {
  const ids = relatedIds(ctx.links, item.id, (id) => ctx.get(id)?.kind);
  const rows = ids.map((id) => ctx.get(id)).filter((x): x is NonNullable<typeof x> => !!x && !x.archived);
  if (!rows.length) return null;
  return (
    <SidebarSection label="On the canvas">
      {rows.map((r) => (
        <button key={r.id} className="sidebar-row" onClick={() => focusItem(r.id)} title={r.title}>
          <span className="sidebar-row-icon">{ctx.kind(r.kind).icon(13)}</span>
          <span className="sidebar-row-main">{r.title}</span>
          <span className="sidebar-row-rel">{ctx.kind(r.kind).label}</span>
        </button>
      ))}
    </SidebarSection>
  );
}

function Details(props: SidebarProps<'ticket'>) {
  const { item, ctx } = props;
  const q = useJiraIssue(item.data.key);
  const issue = q.data;
  const keyToItem = useStore((s) => s.items);
  const onCanvas = (key: string) => keyToItem.find((i) => i.kind === 'ticket' && i.data.key === key)?.id;
  const description = issue ? adfToMarkdown(issue.fields.description) : '';
  const url = ticketUrl(item.data.key);
  return (
    <>
      <SummarySection item={item} ctx={ctx} />
      <SidebarSection>
        <ValueRow
          label="Key"
          actions={
            <Button size="condensed" aria-label="Open in Jira" title="Open in Jira" onClick={() => void openUrl(url)}>
              <Button.Prefix>
                <ExternalLinkIcon />
              </Button.Prefix>
            </Button>
          }
        >
          <span style={mono}>{item.data.key}</span>
        </ValueRow>
        {q.isLoading && <Note>Loading from Jira…</Note>}
        {q.isError && <Note tone="error">Could not load the issue from Jira ({errorText(q.error)}). Showing the cached values.</Note>}
      </SidebarSection>
      <Fields item={item} issue={issue} />
      {issue && (
        <SidebarSection label="Description">
          {description ? <Markdown source={description} onLinkClick={(h: string) => void openUrl(h)} /> : <Note>No description.</Note>}
        </SidebarSection>
      )}
      {issue && <Links issue={issue} onCanvas={onCanvas} />}
      <Comments issue={issue} itemKey={item.data.key} />
      <Related {...props} />
    </>
  );
}

export function TicketSidebar(props: SidebarProps<'ticket'>) {
  const url = ticketUrl(props.item.data.key);
  return (
    <SidebarTabs
      rememberAs="ticket"
      tabs={[
        { id: 'details', label: 'Details', render: () => <Details {...props} /> },
        {
          id: 'jira',
          label: 'Jira',
          wide: true,
          render: () => (
            <div style={{ height: 'calc(100vh - 150px)', minHeight: 320 }}>
              <WebPanel src={url} partition="persist:jira" onOpenExternal={(u) => void openUrl(u)} />
            </div>
          ),
        },
      ]}
    />
  );
}

