/**
 * Choices for a Claude Code session: model, effort, permission mode (the composer pickers and the
 * Settings dialog), and the slash-command list for autocomplete. Pure, tested in
 * `sessionOptions.test.ts`.
 */
import { EFFORT_LEVELS, MODEL_ALIASES, type ClaudeCatalog, type ClaudeConfigureResult, type ClaudeEffort } from '../../../shared/integrations/claude';

export interface Choice<V extends string = string> {
  /** '' = the CLI default (no flag) */
  value: V | '';
  label: string;
  /** short form for the picker button */
  short: string;
  hint?: string;
}

/** `claude-opus-5-5` → `opus-5-5`; aliases stay. */
export const modelLabel = (m: string | undefined) => (m ? m.replace(/^claude-/, '').replace(/-\d{8}$/, '') : 'default');

/** The CLI's models (from `initialize`) or the known aliases, plus a custom current value. */
export function modelChoices(catalog: Pick<ClaudeCatalog, 'models'> | undefined, current?: string): Choice[] {
  const fromCli = (catalog?.models ?? []).filter((m) => m.value !== 'default');
  const out: Choice[] = [
    { value: '', label: 'CLI default', short: 'default', hint: catalog?.models.find((m) => m.value === 'default')?.description ?? 'Whatever the claude CLI is set to' },
    ...(fromCli.length
      ? fromCli.map((m) => ({ value: m.value, label: m.displayName ?? m.value, short: m.value.startsWith('claude-') ? modelLabel(m.value) : m.value, hint: [m.description, m.resolvedModel && m.resolvedModel !== m.value ? m.resolvedModel : ''].filter(Boolean).join(' · ') }))
      : MODEL_ALIASES.map((a) => ({ value: a, label: a, short: a, hint: 'latest model of this family' }))),
  ];
  if (current && !out.some((c) => c.value === current || (c.value && catalog?.models.find((m) => m.value === c.value)?.resolvedModel === current)))
    out.push({ value: current, label: current, short: modelLabel(current), hint: 'custom' });
  return out;
}

/** The choice a model id / alias belongs to ('' when unset). */
export function modelChoiceOf(catalog: Pick<ClaudeCatalog, 'models'> | undefined, model: string | undefined): string {
  if (!model) return '';
  const hit = catalog?.models.find((m) => m.value === model) ?? catalog?.models.find((m) => m.value !== 'default' && m.resolvedModel === model);
  return hit ? (hit.value === 'default' ? '' : hit.value) : model;
}

const EFFORT_HINT: Record<ClaudeEffort, string> = {
  low: 'fastest, least thinking',
  medium: 'balanced',
  high: 'more thinking',
  xhigh: 'extra thinking',
  max: 'most thinking; the CLI only takes it at start (restarts the session)',
};

/** Effort levels the model supports (all when unknown). */
export function effortChoices(catalog?: Pick<ClaudeCatalog, 'models'>, model?: string): Choice<ClaudeEffort>[] {
  const m = catalog?.models.find((x) => x.value === (model || 'default') || x.resolvedModel === model);
  const levels = EFFORT_LEVELS.filter((l) => !m?.supportedEffortLevels || m.supportedEffortLevels.includes(l));
  return [{ value: '', label: 'CLI default', short: 'effort', hint: 'The model’s default effort' }, ...levels.map((l) => ({ value: l, label: l, short: l, hint: EFFORT_HINT[l] }))];
}

export type PermissionValue = 'default' | 'manual' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';

export const PERMISSION_CHOICES: (Choice<PermissionValue> & { value: PermissionValue; tone?: 'warning' | 'critical' })[] = [
  { value: 'default', label: 'CLI default', short: 'mode', hint: 'No flag: the CLI’s configured permission mode' },
  { value: 'manual', label: 'manual', short: 'manual', hint: 'Ask before every tool' },
  { value: 'acceptEdits', label: 'acceptEdits', short: 'accept edits', hint: 'Edits run, other tools ask' },
  { value: 'plan', label: 'plan', short: 'plan', hint: 'Read-only planning, no changes' },
  { value: 'auto', label: 'auto', short: 'auto', hint: 'Claude decides what needs asking' },
  { value: 'dontAsk', label: 'dontAsk', short: 'don’t ask', hint: 'Deny what isn’t pre-approved', tone: 'warning' },
  { value: 'bypassPermissions', label: 'bypassPermissions', short: 'bypass', hint: 'Run everything without asking (careful)', tone: 'critical' },
];

export const permissionChoice = (mode: string | undefined) => PERMISSION_CHOICES.find((c) => c.value === (mode || 'default')) ?? PERMISSION_CHOICES[0];

const SETTING_LABEL: Record<keyof ClaudeConfigureResult, string> = { model: 'Model', effort: 'Effort', permissionMode: 'Permission mode' };

/** `claude:configure` result → a toast: what applied now, what waits. */
export function configureMessage(r: ClaudeConfigureResult): { title: string; message: string } {
  const entries = Object.entries(r) as [keyof ClaudeConfigureResult, 'live' | 'restart' | 'next'][];
  const names = entries.map(([k]) => SETTING_LABEL[k]).join(', ');
  const restart = entries.filter(([, v]) => v === 'restart');
  const next = entries.filter(([, v]) => v === 'next');
  if (!restart.length && !next.length) return { title: `${names} changed`, message: 'Applied to the running session.' };
  if (restart.length) return { title: `${names} changed`, message: `${restart.map(([k]) => SETTING_LABEL[k]).join(', ')} applies with your next message (the CLI restarts with --resume).` };
  return { title: `${names} changed`, message: 'Applies when the session continues.' };
}

// ---- slash commands -----------------------------------------------------------------------

export interface SlashOption {
  name: string;
  desc: string;
  /** argument hint, e.g. `<pr>` */
  args?: string;
  /** where it comes from: a Cortex skill (inserted by actions) or the CLI (built-in command, user / project skill) */
  source: 'cortex' | 'cli';
}

/** Cortex's skills + the CLI's commands, de-duplicated, matching `query` (prefix matches first). */
export function slashOptions(query: string, skills: { name: string; desc: string }[], commands: { name: string; description?: string; argumentHint?: string }[] = [], limit = 8): SlashOption[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const all: SlashOption[] = [];
  for (const s of skills) if (!seen.has(s.name)) seen.add(s.name), all.push({ name: s.name, desc: s.desc, source: 'cortex' });
  for (const c of commands) if (!seen.has(c.name)) seen.add(c.name), all.push({ name: c.name, desc: firstSentence(c.description ?? ''), args: c.argumentHint, source: 'cli' });
  return all
    .filter((o) => o.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
    .slice(0, limit);
}

function firstSentence(s: string, max = 90) {
  const one = s.split(/(?<=\.)\s|\n/)[0].trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}
