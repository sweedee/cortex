#!/usr/bin/env node
/**
 * jira-mock: a stand-in for the Atlassian CLI's `acli jira workitem …` commands, backed by a JSON
 * file. Output is Jira Cloud REST v3 issue JSON, so code written against it works with real acli.
 *
 *   node jira-mock.mjs [jira workitem] search --jql "<jql>" [--json] [--limit N] [--fields a,b]
 *   node jira-mock.mjs [jira workitem] view <KEY> [--json] [--fields a,b|*all]
 *   node jira-mock.mjs [jira workitem] transition --key <KEY> --status "<status>" [--yes]
 *   node jira-mock.mjs [jira workitem] create --project X --type Story --summary "…" [--description …] [--assignee @me|email] [--parent KEY] [--json]
 *   node jira-mock.mjs [jira workitem] comment create --key <KEY> --body "…" [--json]
 *   node jira-mock.mjs [jira workitem] edit --key <KEY> [--summary …] [--description …] [--assignee …] [--labels a,b] [--yes]
 *
 * Data: $JIRA_MOCK_DB (or --db <file>), default ~/.cortex/jira-mock.json; seeded on first use.
 * Site for URLs: $JIRA_MOCK_SITE, default https://example.atlassian.net.
 *   node jira-mock.mjs jira auth status
 *
 * Like acli 1.3, `transition`, `edit` and `comment create` with --json print a bulk result
 * `{results: [{status: 'SUCCESS', message, id}], totalCount, successCount}`.
 * Exit codes: 0 ok, 1 error (not found, invalid transition, bad JQL), 2 usage error.
 * No dependencies; plain ESM so it runs with `node`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ISSUES, ME, PROJECTS, USERS } from './seed.mjs';

const SITE = (process.env.JIRA_MOCK_SITE || 'https://example.atlassian.net').replace(/\/$/, '');

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}
const usage = (msg) => new CliError(`${msg}\nRun with --help for usage.`, 2);

// ---- workflow ---------------------------------------------------------------------------

const CATEGORY = {
  'To Do': { id: 2, key: 'new', name: 'To Do', colorName: 'blue-gray' },
  'In Progress': { id: 4, key: 'indeterminate', name: 'In Progress', colorName: 'yellow' },
  Done: { id: 3, key: 'done', name: 'Done', colorName: 'green' },
};
const STATUSES = {
  'To Do': { id: '10000', category: 'To Do' },
  'In Progress': { id: '3', category: 'In Progress' },
  'In Review': { id: '10002', category: 'In Progress' },
  Blocked: { id: '10003', category: 'In Progress' },
  Done: { id: '10001', category: 'Done' },
};
/** allowed transitions per status (the same workflow for every project) */
const WORKFLOW = {
  'To Do': ['In Progress', 'Blocked'],
  'In Progress': ['In Review', 'To Do', 'Blocked'],
  'In Review': ['Done', 'In Progress', 'Blocked'],
  Blocked: ['To Do', 'In Progress'],
  Done: ['To Do'],
};
const TYPES = {
  Epic: { id: '10000', hierarchyLevel: 1 },
  Story: { id: '10001' },
  Task: { id: '10002' },
  Bug: { id: '10004' },
  Spike: { id: '10005' },
  Subtask: { id: '10006', subtask: true, hierarchyLevel: -1 },
};
const PRIORITIES = { Highest: '1', High: '2', Medium: '3', Low: '4', Lowest: '5' };
const LINK_TYPES = { Blocks: { id: '10000', inward: 'is blocked by', outward: 'blocks' }, Relates: { id: '10003', inward: 'relates to', outward: 'relates to' } };

const findCI = (names, value) => names.find((n) => n.toLowerCase() === String(value).toLowerCase());

// ---- ADF ----------------------------------------------------------------------------------

function textToAdf(text) {
  const content = [];
  for (const para of String(text)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)) {
    const lines = para.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      content.push({
        type: 'bulletList',
        content: lines.map((l) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: l.replace(/^\s*[-*] /, '') }] }] })),
      });
    } else {
      const inl = [];
      lines.forEach((l, i) => {
        if (i > 0) inl.push({ type: 'hardBreak' });
        inl.push({ type: 'text', text: l });
      });
      content.push({ type: 'paragraph', content: inl });
    }
  }
  return { type: 'doc', version: 1, content };
}

const adfText = (n) => (!n ? '' : typeof n === 'string' ? n : n.type === 'text' ? n.text || '' : (n.content || []).map(adfText).join(n.type === 'doc' ? '\n' : ' '));

// ---- database --------------------------------------------------------------------------

const now = () => new Date().toISOString().replace('Z', '+0000');

function seedDb() {
  const byName = (name) => USERS.find((u) => u.displayName === name)?.accountId ?? null;
  const counter = {};
  const issues = ISSUES.map((s, i) => {
    const [project, n] = s.key.split('-');
    counter[project] = Math.max(counter[project] ?? 0, Number(n));
    let cid = 0;
    return {
      id: String(10100 + i),
      key: s.key,
      project,
      type: s.type,
      summary: s.summary,
      status: s.status,
      priority: s.priority,
      assignee: s.assignee ? byName(s.assignee) : null,
      reporter: byName(s.reporter),
      labels: s.labels ?? [],
      parent: s.parent ?? null,
      points: s.points ?? null,
      sprint: s.sprint ?? null,
      description: s.description ? textToAdf(s.description) : null,
      links: s.links ?? [],
      comments: (s.comments ?? []).map((c) => ({ id: String(20000 + i * 10 + cid++), author: byName(c.author), body: textToAdf(c.body), created: c.created })),
      created: s.created,
      updated: s.updated,
    };
  });
  return { version: 1, me: ME.accountId, users: USERS, projects: PROJECTS.map((p) => ({ ...p, next: (counter[p.key] ?? 0) + 1 })), issues, nextId: 10100 + issues.length, nextCommentId: 30000 };
}

function dbPath(flags) {
  return flags.db || process.env.JIRA_MOCK_DB || join(homedir(), '.cortex', 'jira-mock.json');
}

function loadDb(file) {
  if (!existsSync(file)) {
    const db = seedDb();
    saveDb(file, db);
    return db;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new CliError(`Error: could not read the mock database ${file}: ${e.message}`);
  }
}

function saveDb(file, db) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, file);
}

// ---- REST v3 rendering ---------------------------------------------------------------------

const userJson = (db, accountId) => {
  const u = db.users.find((x) => x.accountId === accountId);
  return u
    ? {
        self: `${SITE}/rest/api/3/user?accountId=${u.accountId}`,
        accountId: u.accountId,
        emailAddress: u.emailAddress,
        displayName: u.displayName,
        active: true,
        timeZone: 'Europe/Vienna',
        accountType: 'atlassian',
      }
    : null;
};
const statusJson = (name) => {
  const st = STATUSES[name];
  const cat = CATEGORY[st.category];
  return { self: `${SITE}/rest/api/3/status/${st.id}`, description: '', name, id: st.id, statusCategory: { self: `${SITE}/rest/api/3/statuscategory/${cat.id}`, ...cat } };
};
const typeJson = (name) => {
  const t = TYPES[name] ?? TYPES.Task;
  return { self: `${SITE}/rest/api/3/issuetype/${t.id}`, id: t.id, name, subtask: !!t.subtask, hierarchyLevel: t.hierarchyLevel ?? 0 };
};
const issueSelf = (i) => `${SITE}/rest/api/3/issue/${i.id}`;
const refJson = (db, key) => {
  const o = db.issues.find((x) => x.key === key);
  return o
    ? {
        id: o.id,
        key: o.key,
        self: issueSelf(o),
        fields: { summary: o.summary, status: statusJson(o.status), priority: { name: o.priority, id: PRIORITIES[o.priority] }, issuetype: typeJson(o.type) },
      }
    : null;
};

function issueJson(db, i, fieldsFilter) {
  const project = db.projects.find((p) => p.key === i.project);
  const fields = {
    summary: i.summary,
    status: statusJson(i.status),
    issuetype: typeJson(i.type),
    project: { self: `${SITE}/rest/api/3/project/${project?.id}`, id: project?.id, key: i.project, name: project?.name },
    priority: i.priority ? { self: `${SITE}/rest/api/3/priority/${PRIORITIES[i.priority]}`, id: PRIORITIES[i.priority], name: i.priority } : null,
    assignee: userJson(db, i.assignee),
    reporter: userJson(db, i.reporter),
    creator: userJson(db, i.reporter),
    labels: i.labels,
    description: i.description,
    created: i.created,
    updated: i.updated,
    resolution: i.status === 'Done' ? { id: '10000', name: 'Done', description: 'Work has been completed on this issue.' } : null,
    parent: i.parent ? refJson(db, i.parent) : null,
    issuelinks: i.links.flatMap((l, n) => {
      const lt = LINK_TYPES[l.type] ?? LINK_TYPES.Relates;
      const type = { id: lt.id, name: l.type, inward: lt.inward, outward: lt.outward, self: `${SITE}/rest/api/3/issueLinkType/${lt.id}` };
      const other = refJson(db, l.outward ?? l.inward);
      if (!other) return [];
      return [{ id: String(40000 + Number(i.id) * 10 + n), self: `${SITE}/rest/api/3/issueLink/${40000 + n}`, type, ...(l.outward ? { outwardIssue: other } : { inwardIssue: other }) }];
    }),
    comment: {
      comments: i.comments.map((c) => ({
        self: `${issueSelf(i)}/comment/${c.id}`,
        id: c.id,
        author: userJson(db, c.author),
        updateAuthor: userJson(db, c.author),
        body: c.body,
        created: c.created,
        updated: c.created,
        jsdPublic: true,
      })),
      self: `${issueSelf(i)}/comment`,
      maxResults: i.comments.length,
      total: i.comments.length,
      startAt: 0,
    },
    customfield_10016: i.points,
    customfield_10020: i.sprint,
  };
  let out = fields;
  if (fieldsFilter && !fieldsFilter.includes('*all')) {
    out = {};
    for (const f of fieldsFilter) if (f in fields) out[f] = fields[f];
  }
  return { expand: 'renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations', id: i.id, self: issueSelf(i), key: i.key, fields: out };
}

// ---- JQL (the simple subset) ------------------------------------------------------------------

function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (quote) {
      cur += ch;
      if (ch === quote && text[k - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && sep.test(text.slice(k)) && /\s/.test(text[k - 1] ?? ' ')) {
      const m = sep.exec(text.slice(k));
      parts.push(cur);
      cur = '';
      k += m[0].length - 1;
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const unq = (v) => {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1).replace(/\\(["'])/g, '$1') : t;
};

function parseValue(raw) {
  const t = raw.trim();
  if (t.startsWith('(') && t.endsWith(')')) return splitTop(t.slice(1, -1).replace(/,/g, ' , '), /^,\s*/).map(unq);
  return [unq(t)];
}

function compileJql(db, jql) {
  const where = jql
    .replace(/\s+ORDER\s+BY\s+[\s\S]*$/i, '')
    .replace(/^\s*ORDER\s+BY\s+[\s\S]*$/i, '')
    .trim();
  if (!where) return () => true;
  if (/\s+OR\s+/i.test(where)) throw new CliError('Error: JQL with OR is not supported by jira-mock (only AND).');
  const clauses = splitTop(where, /^AND\s+/i).map((c) => {
    const m = /^("[^"]+"|[\w.]+)\s*(not\s+in|is\s+not|!=|!~|=|~|in|is)\s*([\s\S]+)$/i.exec(c);
    if (!m) throw new CliError(`Error in the JQL Query: cannot parse "${c}".`);
    const field = unq(m[1]).toLowerCase();
    const op = m[2].toLowerCase().replace(/\s+/g, ' ');
    const values = parseValue(m[3]);
    return { field, op, values };
  });
  const me = db.me;
  const userMatches = (accountId, v) => {
    if (/^currentuser\(\)$/i.test(v)) return accountId === me;
    if (/^(empty|null)$/i.test(v)) return accountId == null;
    const u = db.users.find((x) => x.accountId === accountId);
    return !!u && [u.accountId, u.displayName, u.emailAddress].some((s) => s?.toLowerCase() === v.toLowerCase());
  };
  const getters = {
    assignee: (i) => i.assignee,
    reporter: (i) => i.reporter,
    project: (i) => i.project,
    status: (i) => i.status,
    statuscategory: (i) => STATUSES[i.status].category,
    key: (i) => i.key,
    issuekey: (i) => i.key,
    id: (i) => i.id,
    type: (i) => i.type,
    issuetype: (i) => i.type,
    priority: (i) => i.priority,
    labels: (i) => i.labels,
    parent: (i) => i.parent,
    summary: (i) => i.summary,
    text: (i) => `${i.summary}\n${adfText(i.description)}`,
    sprint: (i) => i.sprint?.[0],
  };
  return (issue) =>
    clauses.every(({ field, op, values }) => {
      const get = getters[field];
      if (!get) throw new CliError(`Error in the JQL Query: Field '${field}' does not exist or you do not have permission to view it.`);
      const actual = get(issue);
      const one = (v) => {
        if (field === 'assignee' || field === 'reporter') return userMatches(actual, v);
        if (field === 'sprint') {
          if (/^opensprints\(\)$/i.test(v)) return actual?.state === 'active';
          if (/^closedsprints\(\)$/i.test(v)) return actual?.state === 'closed';
          return actual?.name?.toLowerCase() === v.toLowerCase() || String(actual?.id) === v;
        }
        if (/^(empty|null)$/i.test(v)) return actual == null || (Array.isArray(actual) && actual.length === 0);
        if (field === 'project') return String(actual).toLowerCase() === v.toLowerCase() || db.projects.some((p) => p.key === actual && p.name.toLowerCase() === v.toLowerCase());
        if (field === 'statuscategory') return String(actual).toLowerCase() === v.toLowerCase() || CATEGORY[actual].key === v.toLowerCase() || String(CATEGORY[actual].id) === v;
        if (Array.isArray(actual)) return actual.some((a) => a.toLowerCase() === v.toLowerCase());
        return String(actual ?? '').toLowerCase() === v.toLowerCase();
      };
      switch (op) {
        case '=':
        case 'is':
          return one(values[0]);
        case '!=':
        case 'is not':
          return !one(values[0]);
        case 'in':
          return values.some(one);
        case 'not in':
          return !values.some(one);
        case '~':
        case '!~': {
          const hit = String(Array.isArray(actual) ? actual.join(' ') : (actual ?? ''))
            .toLowerCase()
            .includes(values[0].toLowerCase());
          return op === '~' ? hit : !hit;
        }
        default:
          throw new CliError(`Error in the JQL Query: operator '${op}' is not supported.`);
      }
    });
}

// ---- argv ------------------------------------------------------------------------------------

const BOOL_FLAGS = new Set(['json', 'yes', 'help', 'web', 'count', 'paginate']);

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-h') flags.help = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = (eq > 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
      if (eq > 0) flags[name] = a.slice(eq + 1);
      else if (BOOL_FLAGS.has(name)) flags[name] = true;
      else {
        if (k + 1 >= argv.length) throw usage(`Error: flag --${name} needs a value`);
        flags[name] = argv[++k];
      }
    } else pos.push(a);
  }
  return { pos, flags };
}

const HELP = `jira-mock — mock of \`acli jira workitem\`

Commands:
  search --jql "<jql>" [--json] [--limit N] [--fields a,b]
  view <KEY> [--json] [--fields a,b|*all]
  transition --key <KEY> --status "<status>"
  create --project X --type Story --summary "…" [--description "…"] [--assignee @me|email] [--parent KEY] [--json]
  comment create --key <KEY> --body "…" [--json]
  edit --key <KEY> [--summary "…"] [--description "…"] [--assignee @me|email] [--labels a,b]

Environment: JIRA_MOCK_DB (data file), JIRA_MOCK_SITE (URL base)`;

const out = (s) => process.stdout.write(s.endsWith('\n') ? s : s + '\n');
const fieldList = (f) =>
  typeof f === 'string'
    ? f
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;

function getIssue(db, key) {
  const i = db.issues.find((x) => x.key.toLowerCase() === String(key).toLowerCase());
  if (!i) throw new CliError(`Error: Issue does not exist or you do not have permission to see it.: ${key}`);
  return i;
}

function resolveUser(db, v) {
  if (v === '@me' || /^currentuser\(\)$/i.test(v)) return db.me;
  if (/^(none|unassigned|null)$/i.test(v)) return null;
  const u = db.users.find((x) => [x.accountId, x.emailAddress, x.displayName].some((s) => s?.toLowerCase() === v.toLowerCase()));
  if (!u) throw new CliError(`Error: user "${v}" not found`);
  return u.accountId;
}

/** acli's `--json` output of bulk-capable commands */
const bulk = (keys, message) => JSON.stringify({ results: keys.map((id) => ({ status: 'SUCCESS', message: message(id), id })), totalCount: keys.length, successCount: keys.length }, null, 2);

function run(argv) {
  let args = argv;
  if (args[0] === 'jira' && args[1] === 'auth' && args[2] === 'status') {
    out(`✓ Authenticated\n  Site: ${SITE.replace(/^https?:\/\//, '')}\n  Email: you@example.com\n  Authentication Type: mock`);
    return 0;
  }
  if (args[0] === 'jira' && args[1] === 'workitem') args = args.slice(2);
  else if (args[0] === 'workitem') args = args.slice(1);
  const { pos, flags } = parseArgs(args);
  const cmd = pos[0];
  if (!cmd || flags.help) {
    out(HELP);
    return cmd || flags.help ? 0 : 2;
  }
  const file = dbPath(flags);
  const db = loadDb(file);
  const touch = (i) => (i.updated = now());

  switch (cmd) {
    case 'search': {
      if (!flags.jql) throw usage('Error: --jql is required');
      const match = compileJql(db, flags.jql);
      const limit = flags.limit ? Number(flags.limit) : 50;
      const found = db.issues
        .filter(match)
        .sort((a, b) => b.updated.localeCompare(a.updated))
        .slice(0, limit);
      if (flags.count) return (out(String(found.length)), 0);
      if (flags.json)
        out(
          JSON.stringify(
            found.map((i) => issueJson(db, i, fieldList(flags.fields))),
            null,
            2,
          ),
        );
      else out(found.map((i) => `${i.key}\t${i.type}\t${i.status}\t${i.summary}`).join('\n') || 'No work items found.');
      return 0;
    }
    case 'view': {
      const key = pos[1] ?? flags.key;
      if (!key) throw usage('Error: a work item key is required');
      const i = getIssue(db, key);
      if (flags.json) out(JSON.stringify(issueJson(db, i, fieldList(flags.fields)), null, 2));
      else out(`${i.key}  ${i.summary}\nType: ${i.type}  Status: ${i.status}  Priority: ${i.priority}\n${SITE}/browse/${i.key}\n\n${adfText(i.description)}`);
      return 0;
    }
    case 'transition': {
      if (!flags.key || !flags.status) throw usage('Error: --key and --status are required');
      const keys = String(flags.key)
        .split(',')
        .map((k) => k.trim());
      const target = findCI(Object.keys(STATUSES), flags.status);
      for (const key of keys) {
        const i = getIssue(db, key);
        if (!target) throw new CliError(`Error: status "${flags.status}" does not exist. Statuses: ${Object.keys(STATUSES).join(', ')}`);
        if (i.status === target) throw new CliError(`Error: ${i.key} is already in status "${target}"`);
        const allowed = WORKFLOW[i.status];
        if (!allowed.includes(target)) throw new CliError(`Error: transition to "${target}" is not available for ${i.key} (status "${i.status}"). Available: ${allowed.join(', ')}`);
        i.status = target;
        touch(i);
      }
      saveDb(file, db);
      if (flags.json)
        out(
          bulk(
            keys.map((k) => k.toUpperCase()),
            (k) => `Work item ${k} has been successfully transitioned to ${target}`,
          ),
        );
      else for (const k of keys) out(`✓ Work item ${k.toUpperCase()} transitioned to ${target}`);
      return 0;
    }
    case 'create': {
      if (!flags.project || !flags.type || !flags.summary) throw usage('Error: --project, --type and --summary are required');
      const project = db.projects.find((p) => p.key.toLowerCase() === String(flags.project).toLowerCase());
      if (!project) throw new CliError(`Error: project "${flags.project}" not found`);
      const type = findCI(Object.keys(TYPES), flags.type);
      if (!type) throw new CliError(`Error: issue type "${flags.type}" is not valid for project ${project.key}. Types: ${Object.keys(TYPES).join(', ')}`);
      if (flags.parent) getIssue(db, flags.parent);
      const at = now();
      const issue = {
        id: String(db.nextId++),
        key: `${project.key}-${project.next++}`,
        project: project.key,
        type,
        summary: flags.summary,
        status: 'To Do',
        priority: findCI(Object.keys(PRIORITIES), flags.priority ?? 'Medium') ?? 'Medium',
        assignee: flags.assignee ? resolveUser(db, flags.assignee) : null,
        reporter: db.me,
        labels: fieldList(flags.label ?? flags.labels) ?? [],
        parent: flags.parent ? String(flags.parent).toUpperCase() : null,
        points: null,
        sprint: null,
        description: flags.description ? textToAdf(flags.description) : null,
        links: [],
        comments: [],
        created: at,
        updated: at,
      };
      db.issues.push(issue);
      saveDb(file, db);
      if (flags.json) out(JSON.stringify(issueJson(db, issue), null, 2));
      else out(`✓ Work item ${issue.key} created: ${SITE}/browse/${issue.key}`);
      return 0;
    }
    case 'comment': {
      const sub = pos[1];
      if (sub === 'list') {
        const i = getIssue(db, flags.key);
        out(JSON.stringify(issueJson(db, i).fields.comment, null, 2));
        return 0;
      }
      if (sub !== 'create') throw usage(`Error: unknown command "comment ${sub ?? ''}"`);
      if (!flags.key || !flags.body) throw usage('Error: --key and --body are required');
      const i = getIssue(db, flags.key);
      const c = { id: String(db.nextCommentId++), author: db.me, body: textToAdf(flags.body), created: now() };
      i.comments.push(c);
      touch(i);
      saveDb(file, db);
      if (flags.json) out(bulk([i.key], (k) => `Comment on work item ${k} has been successfully added`));
      else out(`✓ Comment added to ${i.key}`);
      return 0;
    }
    case 'edit': {
      if (!flags.key) throw usage('Error: --key is required');
      const i = getIssue(db, flags.key);
      if (flags.summary === undefined && flags.description === undefined && flags.assignee === undefined && flags.labels === undefined)
        throw usage('Error: nothing to edit (use --summary, --description, --assignee or --labels)');
      if (flags.summary !== undefined) i.summary = flags.summary;
      if (flags.description !== undefined) i.description = flags.description ? textToAdf(flags.description) : null;
      if (flags.assignee !== undefined) i.assignee = resolveUser(db, flags.assignee);
      if (flags.labels !== undefined) i.labels = fieldList(flags.labels) ?? [];
      touch(i);
      saveDb(file, db);
      if (flags.json) out(bulk([i.key], (k) => `Work item ${k} has been successfully edited`));
      else out(`✓ Work item ${i.key} updated`);
      return 0;
    }
    default:
      throw usage(`Error: unknown command "${cmd}"`);
  }
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`${e instanceof CliError ? e.message : `Error: ${e?.stack ?? e}`}\n`);
  process.exitCode = e instanceof CliError ? e.code : 1;
}
