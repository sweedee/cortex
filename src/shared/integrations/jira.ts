/**
 * Jira Cloud REST v3 issue JSON (what `acli jira workitem view/search --json` prints, and what
 * `scripts/jira-mock` prints), ADF ↔ text helpers and a compact summary mapper. Dependency free.
 */

/** Atlassian Document Format node (REST v3 rich text). */
export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
  version?: number;
}

/** REST v3 uses ADF; v2 / some wrappers give plain strings. */
export type JiraRichText = string | AdfNode | null;

export interface JiraUser {
  accountId?: string;
  displayName: string;
  emailAddress?: string;
  active?: boolean;
  self?: string;
}

export interface JiraStatusCategory {
  id: number;
  key: 'new' | 'indeterminate' | 'done' | 'undefined';
  name: string;
  colorName?: string;
  self?: string;
}

export interface JiraStatus {
  id?: string;
  name: string;
  statusCategory: JiraStatusCategory;
  self?: string;
}

export interface JiraIssueRef {
  id?: string;
  key: string;
  self?: string;
  fields: { summary: string; status?: JiraStatus; issuetype?: { name: string } };
}

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: JiraRichText;
  created: string;
  updated?: string;
  self?: string;
}

export interface JiraIssueLink {
  id?: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: JiraIssueRef;
  outwardIssue?: JiraIssueRef;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    status: JiraStatus;
    issuetype: { id?: string; name: string; subtask?: boolean; hierarchyLevel?: number };
    project?: { id?: string; key: string; name: string };
    priority?: { id?: string; name: string } | null;
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    labels?: string[];
    description?: JiraRichText;
    created?: string;
    /** missing in `acli … search --json` (search only allows a few fields) */
    updated?: string;
    parent?: JiraIssueRef | null;
    issuelinks?: JiraIssueLink[];
    comment?: { comments: JiraComment[]; total?: number; maxResults?: number; startAt?: number };
    /** custom fields (story points, sprint, …) */
    [customField: string]: unknown;
  };
}

/** Custom field ids of the (mock) site; check a real site with `acli jira workitem view <KEY> --json --fields "*all"`. */
export const JIRA_FIELDS = { storyPoints: 'customfield_10016', sprint: 'customfield_10020' } as const;

/**
 * Browse URL of an issue, from its `self` REST URL. Empty when `self` points at Atlassian's API
 * gateway (`*.atl-paas.net`, what acli's OAuth login returns) rather than the site.
 */
export function browseUrl(issue: Pick<JiraIssue, 'key' | 'self'>): string {
  const m = /^(https?:\/\/([^/]+))\//.exec(issue.self ?? '');
  if (!m || /\.atl-paas\.net$/i.test(m[2])) return '';
  return `${m[1]}/browse/${issue.key}`;
}

/**
 * Browse URL of an issue key: the configured site (`integrations:config` → `jira.site`, for acli read
 * from `acli jira auth status`), else the issue's REST `self`, else the mock's default site.
 */
export function jiraBrowseUrl(key: string, opts: { issue?: Pick<JiraIssue, 'key' | 'self'>; site?: string } = {}): string {
  if (opts.site) return `${opts.site.replace(/\/+$/, '')}/browse/${key}`;
  const fromIssue = opts.issue ? browseUrl(opts.issue) : '';
  return fromIssue || `https://example.atlassian.net/browse/${key}`;
}

/** `acli jira auth status` → `https://<site>` (line `Site: acme.atlassian.net`), or null. */
export function parseAcliSite(text: string): string | null {
  const m = /^\s*Site:\s*(\S+)\s*$/im.exec(text);
  if (!m) return null;
  return /^https?:\/\//i.test(m[1]) ? m[1].replace(/\/+$/, '') : `https://${m[1].replace(/\/+$/, '')}`;
}

/**
 * What acli prints with `--json` for bulk-capable commands (`transition`, `edit`, `comment create`,
 * `assign`): one result per work item. acli exits 0 even when a result is a FAILURE.
 */
export interface AcliBulkResult {
  results: { status: 'SUCCESS' | 'FAILURE' | string; message: string; id: string }[];
  totalCount: number;
  successCount: number;
}

export function isAcliBulkResult(v: unknown): v is AcliBulkResult {
  return !!v && typeof v === 'object' && Array.isArray((v as AcliBulkResult).results);
}

/** Failure messages of a bulk result ("CTX-1: No allowed transitions found for given status"). */
export function bulkFailures(v: AcliBulkResult): string[] {
  return v.results.filter((r) => r.status !== 'SUCCESS').map((r) => (r.id ? `${r.id}: ${r.message}` : r.message));
}

/** A status of a project's workflow (names are localized on real sites, e.g. "In Arbeit"). */
export interface JiraStatusOption {
  name: string;
  category: JiraStatusCategory['key'];
}

const CATEGORY_ORDER: Record<string, number> = { new: 0, indeterminate: 1, done: 2, undefined: 3 };

/**
 * The statuses seen on a project's issues, deduped (case-insensitive) and ordered by category
 * (to do → in progress → done), first-seen order inside a category. acli has no "list transitions"
 * command, so this is how Cortex learns a real project's workflow.
 */
export function workflowStatuses(issues: Pick<JiraIssue, 'fields'>[], extra: JiraStatusOption[] = []): JiraStatusOption[] {
  const seen = new Map<string, JiraStatusOption & { at: number }>();
  const add = (o: JiraStatusOption) => {
    const k = o.name.toLowerCase();
    if (o.name && !seen.has(k)) seen.set(k, { ...o, at: seen.size });
  };
  for (const i of issues) {
    const s = i.fields?.status;
    if (s?.name) add({ name: s.name, category: s.statusCategory?.key ?? 'undefined' });
  }
  extra.forEach(add);
  return [...seen.values()].sort((a, b) => (CATEGORY_ORDER[a.category] ?? 3) - (CATEGORY_ORDER[b.category] ?? 3) || a.at - b.at).map(({ name, category }) => ({ name, category }));
}

// ---- ADF ----------------------------------------------------------------------

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
            else if (mark.type === 'link') text = `[${text}](${String(mark.attrs?.['href'] ?? '')})`;
          }
          return text;
        }
        case 'hardBreak':
          return '\n';
        case 'mention':
          return String(n.attrs?.['text'] ?? '@someone');
        case 'emoji':
          return String(n.attrs?.['text'] ?? n.attrs?.['shortName'] ?? '');
        case 'inlineCard':
          return String(n.attrs?.['url'] ?? '');
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
      return `${'#'.repeat(Number(node.attrs?.['level'] ?? 3))} ${inline(node.content)}`;
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
      return `\`\`\`${String(node.attrs?.['language'] ?? '')}\n${inline(node.content)}\n\`\`\``;
    case 'blockquote':
      return (node.content ?? []).map((c) => `> ${block(c)}`).join('\n');
    case 'rule':
      return '---';
    default:
      return node.content ? node.content.map((c) => block(c, indent)).join('\n\n') : inline([node]);
  }
}

/** Jira rich text → markdown (strings pass through). */
export function adfToMarkdown(value: JiraRichText | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : block(value);
}

/** Plain text → ADF doc: blank lines separate paragraphs, `- ` lines become a bullet list. */
export function textToAdf(text: string): AdfNode {
  const content: AdfNode[] = [];
  for (const para of text.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = para.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      content.push({
        type: 'bulletList',
        content: lines.map((l) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: l.replace(/^\s*[-*] /, '') }] }] })),
      });
    } else {
      const inl: AdfNode[] = [];
      lines.forEach((l, i) => {
        if (i > 0) inl.push({ type: 'hardBreak' });
        inl.push({ type: 'text', text: l });
      });
      content.push({ type: 'paragraph', content: inl });
    }
  }
  return { type: 'doc', version: 1, content };
}

// ---- summary ------------------------------------------------------------------

export interface JiraIssueSummary {
  key: string;
  url: string;
  summary: string;
  status: string;
  statusCategory: JiraStatusCategory['key'];
  type: string;
  priority: string;
  assignee: string | null;
  labels: string[];
  epic?: { key: string; summary: string };
  storyPoints?: number;
  sprint?: string;
  updated: string;
}

function sprintName(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) {
    const last = v[v.length - 1] as { name?: string } | string;
    return typeof last === 'string' ? last : last?.name;
  }
  return undefined;
}

export function summarizeIssue(issue: JiraIssue): JiraIssueSummary {
  const f = issue.fields;
  const points = f[JIRA_FIELDS.storyPoints];
  return {
    key: issue.key,
    url: browseUrl(issue),
    summary: f.summary,
    status: f.status?.name ?? '',
    statusCategory: f.status?.statusCategory?.key ?? 'undefined',
    type: f.issuetype?.name ?? '',
    priority: f.priority?.name ?? '',
    assignee: f.assignee?.displayName ?? null,
    labels: f.labels ?? [],
    epic: f.parent ? { key: f.parent.key, summary: f.parent.fields.summary } : undefined,
    storyPoints: typeof points === 'number' ? points : undefined,
    sprint: sprintName(f[JIRA_FIELDS.sprint]),
    updated: f.updated ?? '',
  };
}

/** The mock's workflow; the fallback when a project's statuses are unknown. */
export const JIRA_STATUSES = ['To Do', 'In Progress', 'In Review', 'Done', 'Blocked'] as const;

export const MOCK_STATUS_OPTIONS: JiraStatusOption[] = [
  { name: 'To Do', category: 'new' },
  { name: 'In Progress', category: 'indeterminate' },
  { name: 'In Review', category: 'indeterminate' },
  { name: 'Blocked', category: 'indeterminate' },
  { name: 'Done', category: 'done' },
];
