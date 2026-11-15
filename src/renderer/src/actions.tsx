/**
 * Selection-level actions and the chat box "send". Per-kind actions live in the kind
 * modules (`kinds/<kind>/index.tsx`); `actionsForItem` (registry) combines them with the shared ones.
 */
import { Button } from '@dynatrace/strato-components/buttons';
import { dismissToast, showToast } from '@dynatrace/strato-components/notifications';
import { ChatIcon, LinkIcon } from '@dynatrace/strato-icons';
import { agentHandle, agentTarget, agentTitle, buildPrompt, resolveCwd, skillOf } from './chat/prompt';
import { claudeOps } from './data/claude';
import { isRealPath, type Item, type ItemOf, type Kind, type NewLink } from './domain';
import { camera, place } from './layout';
import { archive, archiveAction, removeAction, skill, toast, unarchiveAction } from './kinds/common';
import { actionsForItem, ctxOf, KINDS, getKind } from './kinds/registry';
import type { Action, KindModule } from './kinds/types';
import { isDesktop } from './native';
import { addItem, addLink, getState, insertSkill, inspect, itemById, newId, notify, openDialog, patchData, select } from './store';
import { openForm } from './ui/form';
import { errorText } from './ui/task';

export type { Action, ActionKind } from './kinds/types';
export { actionsForItem } from './kinds/registry';

/** Actions that act on a whole multi-selection. */
function multiActions(items: Item[]): Action[] {
  const out: Action[] = [skill('ask', 'Ask about these', '', { icon: <ChatIcon />, primary: true, run: (xs) => insertSkill(null, xs.map((x) => x.id)) })];
  // the kinds' own multi-select actions, in kind order
  for (const k of KINDS) {
    const mine = items.filter((i) => i.kind === k);
    const fn = (getKind(k) as unknown as KindModule).multiActions;
    if (mine.length && fn) out.push(...fn(mine, mine.length === items.length));
  }
  out.push(skill('summary', 'Status summary', 'status-summary'));
  if (items.every((i) => i.archived)) return [unarchiveAction, out[0]];
  if (items.length === 2) {
    out.push({
      id: 'link',
      label: 'Link',
      type: 'direct',
      icon: <LinkIcon />,
      run: ([a, b]) => {
        addLink(a.id, b.id, 'related to');
        toast('Linked', `${a.handle} ↔ ${b.handle}`);
      },
    });
  }
  out.push({ ...archiveAction, label: 'Archive all', run: (xs) => archive(xs.filter((x) => !x.archived)) });
  return out;
}

export function actionsForSelection(ids: string[]): { items: Item[]; actions: Action[] } {
  const items = ids.map(itemById).filter((i): i is Item => !!i);
  if (items.length === 0) return { items, actions: [] };
  if (items.length === 1) return { items, actions: actionsForItem(items[0], ctxOf()) };
  return { items, actions: multiActions(items) };
}

// ---- sending the chat box ---------------------------------------------------------

/** Ask where a session should run when no mention has a directory: a configured project or any folder. */
async function askCwd(): Promise<{ cwd: string; project?: ItemOf<'project'> } | null> {
  const projects = getState().items.filter((i): i is ItemOf<'project'> => i.kind === 'project' && !i.archived && isRealPath(i.data.baseDir));
  let picked: { cwd: string; project?: ItemOf<'project'> } | null = null;
  const values = await openForm({
    title: 'Where should the agent work?',
    description: 'None of the mentioned bubbles has a folder. Pick a project, or any folder.',
    submitLabel: 'Start agent',
    fields: [
      ...(projects.length
        ? [{ name: 'project', label: 'Project', type: 'radio' as const, options: [...projects.map((p) => ({ value: p.id, label: p.title, hint: p.data.baseDir })), { value: '', label: 'Another folder' }], default: projects[0].id }]
        : []),
      { name: 'dir', label: 'Folder', type: 'directory', when: (v) => !projects.length || !v.project, required: true, validate: (v) => (isRealPath(String(v)) ? undefined : 'Use an absolute path') },
    ],
    onSubmit: (v) => {
      const p = projects.find((x) => x.id === v.project);
      picked = p ? { cwd: p.data.baseDir!, project: p } : { cwd: String(v.dir) };
    },
  });
  return values ? picked : null;
}

/**
 * Send the chat box: to the one mentioned agent session (`claude:send`), or start a new Claude Code
 * session (`claude:start`) in the most specific mentioned directory, with the @mentions expanded into
 * context lines. Resolves with the agent item id, or null (cancelled / failed to send).
 */
export async function sendPrompt(text: string, mentioned: string[]): Promise<string | null> {
  const ctx = ctxOf();
  const items = mentioned.map((id) => ctx.get(id)).filter((i): i is Item => !!i);
  if (!isDesktop) {
    toast('Agents need the desktop app', 'Start Cortex with npm run dev to use Claude Code.', 'warning');
    return null;
  }

  // a follow-up to one agent session
  const target = agentTarget(items);
  if (target) {
    const prompt = buildPrompt(text, items.filter((i) => i.id !== target.id), ctx);
    try {
      patchData<'agent'>(target, { status: 'running', lastActivity: 'Sending your message', endedAt: undefined }, { notice: undefined });
      await claudeOps.send(target.data.localId!, prompt);
    } catch (e) {
      patchData<'agent'>(target, { status: 'failed', error: errorText(e) });
      toast('Could not send the message', errorText(e), 'critical');
      return null;
    }
    select([target.id], false, { mention: false });
    agentToast('Message sent', target);
    return target.id;
  }

  const where = resolveCwd(items, ctx) ?? (await askCwd());
  if (!where) return null;
  const sk = skillOf(text);
  const subject = items.find((i) => i.kind !== 'project') ?? items[0];
  const project = where.project ?? (subject ? (subject.kind === 'project' ? subject : ctx.projectOf(subject)) : undefined);
  const title = agentTitle(sk, subject);
  const id = newId('a');
  const taken = new Set(getState().items.map((i) => i.handle.toLowerCase()));
  const { model, effort, permissionMode } = getState().settings;
  const links: NewLink[] = items.map((m) => ({ from: id, to: m.id, label: 'about' }));
  if (project && !items.some((m) => m.id === project.id)) links.push({ from: id, to: project.id, label: 'belongs to' });
  const at = subject ? place.near(subject.id) : project ? place.near(project.id) : place.center();
  const agent = addItem(
    {
      id,
      kind: 'agent',
      handle: agentHandle(sk, subject, (h) => taken.has(h.toLowerCase())),
      title,
      projectId: project?.id,
      data: { cwd: where.cwd, localId: id, model, effort, ...(permissionMode !== 'default' ? { permissionMode } : {}), status: 'running', skill: sk, lastActivity: 'Starting Claude Code', startedAt: Date.now() },
    },
    links,
  ) as ItemOf<'agent'>;
  place.seed(id, at);
  select([id], false, { mention: false });
  try {
    await claudeOps.start({ localId: id, cwd: where.cwd, prompt: buildPrompt(text, items, ctx), title, model, effort, permissionMode });
  } catch (e) {
    patchData<'agent'>(agent, { status: 'failed', error: errorText(e), lastActivity: 'Could not start', endedAt: Date.now() });
    notify(id, { text: `${title} could not start: ${errorText(e)}`, tone: 'critical' });
    return id;
  }
  agentToast('Agent started', agent, text);
  return id;
}

function agentToast(title: string, a: Item, text?: string) {
  const toastId = showToast({
    type: 'info',
    title,
    message: text ? (text.length > 90 ? text.slice(0, 90) + '…' : text) : a.title,
    lifespan: 4000,
    actions: (
      <Button
        size="condensed"
        onClick={() => {
          inspect(a.id);
          camera.focus([a.id]);
          dismissToast(toastId);
        }}
      >
        Open
      </Button>
    ),
  });
}

/** The canvas *Add* entry of a kind: its own flow (`addable.open`) or the add dialog. */
export function openAdd(kind: Kind, at: { x: number; y: number }) {
  const a = getKind(kind).addable;
  if (a?.open) a.open(at);
  else openDialog({ type: 'add', kind, at });
}

/** Kinds that can be added from the canvas menu / add dialog, in display order. */
export const KINDS_ADDABLE: { kind: Kind; label: string; hint: string }[] = KINDS.flatMap((k) => {
  const a = getKind(k).addable;
  return a ? [{ kind: k, label: a.label, hint: a.hint }] : [];
});

/** The kind the canvas's "Paste a link…" opens the add dialog with: the first one that recognises pasted references (the dialog switches kind as you paste). */
export const PASTE_KIND: Kind = KINDS.find((k) => getKind(k).addable?.detect && !getKind(k).addable?.open) ?? KINDS[0];

/** Items linked to the given ones (not themselves). */
export function relatedItems(ids: string[]): Item[] {
  const { links } = getState();
  const set = new Set(ids);
  const out = new Set<string>();
  for (const l of links) {
    if (set.has(l.from) && !set.has(l.to)) out.add(l.to);
    if (set.has(l.to) && !set.has(l.from)) out.add(l.from);
  }
  return [...out].map(itemById).filter((i): i is Item => !!i);
}

/** Delete-key handler. */
export function removeSelected() {
  const items = getState()
    .selected.map(itemById)
    .filter((i): i is Item => !!i);
  if (items.length) removeAction.run(items);
}
