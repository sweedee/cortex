/** Jira REST issue JSON (what `acli jira workitem view --json` prints) → domain Ticket. */
import type { Ticket, TicketPriority, TicketStatus, TicketType } from '../../model/types';
import { config } from '../config';
import type { AdfNode, JiraIssue, JiraRichText } from '../types';

// ---- rich text ---------------------------------------------------------------

function inline(nodes: AdfNode[] = []): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text': {
          let text = n.text ?? '';
          for (const mark of n.marks ?? []) {
            if (mark.type === 'code') text = `\`${text}\``;
            else if (mark.type === 'strong') text = `**${text}**`;
            else if (mark.type === 'em') text = `*${text}*`;
            else if (mark.type === 'strike') text = `~~${text}~~`;
            else if (mark.type === 'link') text = `[${text}](${String(mark.attrs?.href ?? '')})`;
          }
          return text;
        }
        case 'hardBreak':
          return '\n';
        case 'mention':
          return String(n.attrs?.text ?? '@someone');
        case 'emoji':
          return String(n.attrs?.text ?? n.attrs?.shortName ?? '');
        case 'inlineCard':
          return String(n.attrs?.url ?? '');
        default:
          return inline(n.content);
      }
    })
    .join('');
}

function block(node: AdfNode, indent = ''): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((c) => block(c, indent)).join('\n\n');
    case 'paragraph':
      return indent + inline(node.content);
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 3))} ${inline(node.content)}`;
    case 'bulletList':
    case 'orderedList':
      return (node.content ?? [])
        .map((item, i) => {
          const marker = node.type === 'orderedList' ? `${i + 1}.` : '-';
          const [first, ...rest] = item.content ?? [];
          const head = `${indent}${marker} ${first ? block(first).trim() : ''}`;
          return [head, ...rest.map((c) => block(c, indent + '  '))].join('\n');
        })
        .join('\n');
    case 'codeBlock':
      return `\`\`\`${String(node.attrs?.language ?? '')}\n${inline(node.content)}\n\`\`\``;
    case 'blockquote':
      return (node.content ?? []).map((c) => `> ${block(c)}`).join('\n');
    case 'rule':
      return '---';
    case 'table': {
      const rows = (node.content ?? []).map((row) => `| ${(row.content ?? []).map((cell) => (cell.content ?? []).map((c) => block(c)).join(' ')).join(' | ')} |`);
      const columns = node.content?.[0]?.content?.length ?? 0;
      return [rows[0], `|${' --- |'.repeat(columns)}`, ...rows.slice(1)].join('\n');
    }
    default:
      return node.content ? node.content.map((c) => block(c, indent)).join('\n\n') : inline([node]);
  }
}

/**
 * Jira rich text → markdown. Strings pass through (REST v2 / wrappers that already
 * convert); ADF documents (REST v3) are converted for the common node types.
 */
export function richTextToMarkdown(value: JiraRichText | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : block(value);
}

// ---- fields ------------------------------------------------------------------

function mapStatus(name: string): TicketStatus {
  const n = name.toLowerCase();
  if (/(done|closed|resolved|released)/.test(n)) return 'Done';
  if (n.includes('review')) return 'In Review';
  if (n.includes('progress') || n.includes('development')) return 'In Progress';
  return 'To Do';
}

function mapType(name: string): TicketType {
  const n = name.toLowerCase();
  if (n.includes('bug') || n.includes('defect')) return 'Bug';
  if (n.includes('spike') || n.includes('research')) return 'Spike';
  if (n.includes('story')) return 'Story';
  return 'Task';
}

function mapPriority(name: string | undefined): TicketPriority {
  const n = (name ?? '').toLowerCase();
  if (n.includes('block') || n.includes('highest') || n.includes('critical')) return 'Blocker';
  if (n.includes('high')) return 'High';
  if (n.includes('low')) return 'Low';
  return 'Medium';
}

/** Sprint custom field: an array of sprint objects (take the latest) or a plain string. */
function mapSprint(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) {
    const last = value[value.length - 1] as { name?: string } | string;
    return typeof last === 'string' ? last : last.name;
  }
  return undefined;
}

/** Acceptance criteria custom field (rich text with one list item per criterion) → string[]. */
function mapAcceptanceCriteria(value: unknown): string[] {
  return richTextToMarkdown(value as JiraRichText)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.|\[[ x]\])\s+/, '').trim())
    .filter(Boolean);
}

export function mapJiraIssue(issue: JiraIssue): Ticket {
  const f = issue.fields;
  const custom = config.jira.fields;
  const points = f[custom.storyPoints];
  return {
    key: issue.key,
    summary: f.summary,
    type: mapType(f.issuetype.name),
    status: mapStatus(f.status.name),
    priority: mapPriority(f.priority?.name),
    assignee: f.assignee?.displayName ?? 'Unassigned',
    reporter: f.reporter?.displayName ?? 'Unknown',
    epic: f.parent?.fields.summary,
    sprint: mapSprint(f[custom.sprint]),
    storyPoints: typeof points === 'number' ? points : undefined,
    labels: f.labels ?? [],
    descriptionMd: richTextToMarkdown(f.description),
    acceptanceCriteria: mapAcceptanceCriteria(f[custom.acceptanceCriteria]),
    comments: (f.comment?.comments ?? []).map((c) => ({
      id: c.id,
      author: c.author.displayName,
      at: c.created,
      bodyMd: richTextToMarkdown(c.body),
    })),
    links: (f.issuelinks ?? []).flatMap((link) => {
      const other = link.outwardIssue ?? link.inwardIssue;
      if (!other) return [];
      return [{ relation: link.outwardIssue ? link.type.outward : link.type.inward, key: other.key, summary: other.fields.summary }];
    }),
    updatedAt: f.updated,
  };
}
