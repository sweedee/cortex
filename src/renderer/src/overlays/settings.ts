/**
 * Global settings (HUD gear): Claude model / effort / permission mode for new sessions (the chat
 * box's pickers change the same values), the AI-review
 * comment, the refresh interval, notifications, plus read-only paths and the Jira mode.
 * Project settings (paths, commands) live on the project bubble instead.
 */
import { loadIntegrationConfig } from '../data/app';
import { toggleDesktop } from '../desktop';
import { native } from '../native';
import { getState, setColorBy, setSettings, setSoundOn, setDesktopNotify, type ColorBy } from '../store';
import { openForm, str, type FormValues } from '../ui/form';
import { errorText } from '../ui/task';
import type { Settings } from '../store';
import { EFFORT_LEVELS, type ClaudeCatalog } from '../../../shared/integrations/claude';
import { effortChoices, modelChoices, PERMISSION_CHOICES } from '../chat/sessionOptions';

const PERMISSION_MODES: { value: Settings['permissionMode']; label: string }[] = PERMISSION_CHOICES.map((c) => ({ value: c.value, label: c.value === 'default' ? 'CLI default (no flag)' : `${c.label}: ${c.hint}` }));
/** select value for "no flag" (a select can't hold '') */
const DEFAULT = 'default';

/** Model select options: the CLI's models (or the aliases) plus the current custom value. */
export const modelOptions = (catalog: ClaudeCatalog | undefined, current?: string) =>
  modelChoices(catalog, current).map((c) => ({ value: c.value || DEFAULT, label: c.value ? `${c.label}${c.hint ? ` — ${c.hint}` : ''}` : 'CLI default (no flag)' }));
const EFFORT_OPTIONS = effortChoices().map((c) => ({ value: c.value || DEFAULT, label: c.value ? `${c.label}: ${c.hint}` : 'CLI default (no flag)' }));

export const COLOR_BY: { value: ColorBy; label: string }[] = [
  { value: 'project', label: 'Project (one colour per project and everything linked to it)' },
  { value: 'ticket', label: 'Ticket (one colour per ticket)' },
  { value: 'none', label: 'Gray (no colouring)' },
];

/** Form values → the settings patch (pure, tested). Blank text = unset (CLI / main default). */
export function settingsPatch(v: FormValues): Partial<Settings> {
  const mode = PERMISSION_MODES.find((m) => m.value === str(v, 'permissionMode'))?.value ?? 'default';
  const model = str(v, 'modelCustom').trim() || str(v, 'model').trim();
  const effort = EFFORT_LEVELS.find((e) => e === str(v, 'effort'));
  return {
    model: model && model !== DEFAULT ? model : undefined,
    effort,
    permissionMode: mode,
    aiReviewComment: str(v, 'aiReviewComment').trim() || undefined,
    refreshSec: Math.round(Number(str(v, 'refreshSec'))),
  };
}

export const validRefresh = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 10 && n <= 3600 ? undefined : 'Whole seconds between 10 and 3600';
};

export async function openSettings() {
  const s = getState();
  const [workspacePath, info, config, catalog] = await Promise.all([
    native.workspace.path().catch((e: unknown) => `unknown (${errorText(e)})`),
    native.app.info().catch(() => undefined),
    loadIntegrationConfig().catch(() => undefined),
    native.claude.catalog().catch(() => undefined),
  ]);
  const models = modelOptions(catalog, s.settings.model);
  const jira = config ? (config.jira.cli === 'mock' ? `mock (scripts/jira-mock, site ${config.jira.site}); start with CORTEX_JIRA_CLI=acli for the real Atlassian CLI` : `${config.jira.cli} (Atlassian CLI)`) : 'unknown (desktop app only)';
  await openForm({
    title: 'Settings',
    description: 'Apply to new agent sessions and the whole canvas. Project paths and commands are in each project’s own settings.',
    submitLabel: 'Save',
    values: {
      colorBy: s.colorBy,
      model: s.settings.model ?? DEFAULT,
      modelCustom: '',
      effort: s.settings.effort ?? DEFAULT,
      permissionMode: s.settings.permissionMode,
      aiReviewComment: s.settings.aiReviewComment ?? '',
      refreshSec: String(s.settings.refreshSec),
      desktopNotify: s.desktopNotify,
      soundOn: s.soundOn,
      workspacePath,
      userData: info?.userData || '–',
      jira,
    },
    fields: [
      { name: 'colorBy', label: 'Bubble colour', type: 'select', options: COLOR_BY, hint: 'What the colour of a bubble stands for on the canvas.' },
      { name: 'model', label: 'Claude model', type: 'select', options: models, hint: 'claude --model for new sessions (also the model picker under the chat box). A running session changes its model from its own composer.' },
      { name: 'modelCustom', label: 'Or a full model id', type: 'text', placeholder: 'e.g. claude-opus-5-5', hint: 'Overrides the selection above when filled.' },
      { name: 'effort', label: 'Effort', type: 'select', options: EFFORT_OPTIONS, hint: 'claude --effort for new sessions. Low to xhigh also change live in a running session; max only at start.' },
      { name: 'permissionMode', label: 'Permission mode', type: 'select', options: PERMISSION_MODES, hint: 'claude --permission-mode for new sessions (changes live in a running session). Tool prompts show up as Allow / Deny on the agent bubble.' },
      { name: 'aiReviewComment', label: 'AI review comment', type: 'text', placeholder: config?.github.aiReviewComment ?? '@claude review', hint: 'Posted on a PR by “Request AI review”. Blank = the default shown.' },
      { name: 'refreshSec', label: 'Background refresh (seconds)', type: 'text', required: true, validate: validRefresh, hint: 'How often git / GitHub / Jira caches on the bubbles refresh (15 s while checks or builds run).' },
      { name: 'desktopNotify', label: 'Desktop notifications when Cortex is in the background', type: 'checkbox' },
      { name: 'soundOn', label: 'Sound for new notices', type: 'checkbox' },
      { name: 'workspacePath', label: 'Workspace file', type: 'info' },
      { name: 'userData', label: 'User data folder', type: 'info', hint: 'Window state, Jira mock data, Claude session list. Use CORTEX_USER_DATA=<dir> for a separate profile.' },
      { name: 'jira', label: 'Jira', type: 'info' },
    ],
    onSubmit: async (v) => {
      setSettings(settingsPatch(v));
      const by = COLOR_BY.find((c) => c.value === str(v, 'colorBy'))?.value;
      if (by && by !== getState().colorBy) setColorBy(by);
      if (v.soundOn !== getState().soundOn) setSoundOn(v.soundOn === true);
      if (v.desktopNotify !== getState().desktopNotify) {
        if (v.desktopNotify === true) await toggleDesktop();
        else setDesktopNotify(false);
      }
    },
  });
}
